import { BODY_RADIUS, DT, TICK_HZ } from '../config';
import type { FighterIntent, TargetHeight } from '../input/actions';
import type { V3 } from '../math';
import type { ContactInfo, RoundEndReason, Ruleset } from '../rules/rules';
import { type AttackState, Fighter, type FighterStats } from './Fighter';
import { inGuardArc, testLegs, testStrike, type HitZone } from './hit';
import type { MoveDef } from './moves';

export type CombatEvent =
  | { type: 'attack'; fighter: 0 | 1; move: MoveDef; height: TargetHeight }
  | {
      type: 'hit';
      attacker: 0 | 1;
      defender: 0 | 1;
      move: MoveDef;
      zone: HitZone;
      damage: number;
      points: number;
      counter: boolean;
      point: V3;
      /** Competitive: did the contact score, and what was it? */
      valid?: boolean;
      label?: string;
      reason?: string;
      turning?: boolean;
    }
  | { type: 'block'; attacker: 0 | 1; defender: 0 | 1; move: MoveDef; point: V3; guardBreak: boolean }
  | { type: 'whiff'; fighter: 0 | 1; move: MoveDef }
  | { type: 'ko'; fighter: 0 | 1 }
  | { type: 'round-start'; round: number }
  | { type: 'round-end'; round: number; winner: 0 | 1 | null; reason: RoundEndReason; detail?: string }
  | { type: 'match-end'; winner: 0 | 1 | null }
  /** Competitive: a penalty (gam-jeom) against `fighter`; points go to the opponent. */
  | { type: 'penalty'; fighter: 0 | 1; reason: string; label: string; pointsToOpponent: number; count: number }
  /** Competitive: the referee stops the bout (Kal-yeo). */
  | { type: 'stoppage'; reason: string }
  | { type: 'resume' }
  | { type: 'down'; fighter: 0 | 1; cause: 'fall' | 'knockdown' };

/** 'break' = stopped by the referee (Kal-yeo); the clock does not run. */
export type MatchPhase = 'intro' | 'fight' | 'break' | 'round-over' | 'match-over';

const INTRO_TICKS = Math.round(TICK_HZ * 2.2);
const ROUND_OVER_TICKS = Math.round(TICK_HZ * 3);
export const START_GAP = 2.4;
const HITSTOP_HIT = 5;
const HITSTOP_BLOCK = 3;
const GUARD_BREAK_STUN = 22;
const CHIP_FRACTION = 0.12;

/**
 * Owns the two fighters and advances the fight one fixed tick at a time.
 * Pure TypeScript: no Three.js, no React. The renderer and UI read from it.
 */
export class CombatWorld {
  readonly fighters: [Fighter, Fighter];
  rules: Ruleset;
  tick = 0;
  phase: MatchPhase = 'intro';
  phaseTick = 0;
  round = 1;
  roundWins: [number, number] = [0, 0];
  points: [number, number] = [0, 0];
  roundTicksLeft = 0;
  hitstop = 0;
  lastRoundWinner: 0 | 1 | null = null;
  matchWinner: 0 | 1 | null = null;
  readonly events: CombatEvent[] = [];
  /** Optional: tests can disable the intro countdown. */
  skipIntro = false;
  /** Stoppage (Kal-yeo) bookkeeping. */
  breakTicks = 0;
  breakReason = '';
  private breakReset = false;
  /** Tick at which the current stoppage was called. */
  stoppageTick = -1;

  constructor(rules: Ruleset, stats: [FighterStats, FighterStats]) {
    this.rules = rules;
    this.fighters = [new Fighter(0, stats[0]), new Fighter(1, stats[1])];
    if (rules.boundary !== undefined) for (const f of this.fighters) f.boundsLimit = rules.boundary + 0.9;
    this.resetMatch();
  }

  resetMatch() {
    this.round = 1;
    this.roundWins = [0, 0];
    this.matchWinner = null;
    this.rules.hooks?.onMatchStart(this);
    this.startRound();
  }

  startRound() {
    const [a, b] = this.fighters;
    a.reset(0, -START_GAP / 2, 0);
    b.reset(0, START_GAP / 2, Math.PI);
    this.points = [0, 0];
    const hooks = this.rules.hooks;
    this.roundTicksLeft = (hooks ? hooks.roundLength(this) : this.rules.roundSeconds) * TICK_HZ;
    this.hitstop = 0;
    this.phase = this.skipIntro ? 'fight' : 'intro';
    this.phaseTick = 0;
    this.events.push({ type: 'round-start', round: this.round });
    hooks?.onRoundStart(this);
  }

  /** Referee stoppage (Kal-yeo): the clock stops; optionally fighters return to their marks. */
  callStoppage(reason: string, ticks: number, resetPositions: boolean) {
    if (this.phase !== 'fight' && this.phase !== 'break') return;
    const already = this.phase === 'break';
    this.phase = 'break';
    this.phaseTick = 0;
    this.breakTicks = Math.max(already ? this.breakTicks : 0, ticks);
    this.breakReason = reason;
    this.breakReset = this.breakReset || resetPositions;
    this.stoppageTick = this.tick;
    this.events.push({ type: 'stoppage', reason });
  }

  private resume() {
    if (this.breakReset) {
      const [a, b] = this.fighters;
      // Return to the start marks (Kye-sok), keeping who-faces-whom.
      for (const [f, z, yaw] of [
        [a, -START_GAP / 2, 0],
        [b, START_GAP / 2, Math.PI],
      ] as const) {
        f.x = 0;
        f.z = z;
        f.yaw = yaw;
        f.vx = f.vz = 0;
        if (f.state !== 'down') f.setState('idle');
      }
    }
    this.breakReset = false;
    this.phase = 'fight';
    this.phaseTick = 0;
    this.events.push({ type: 'resume' });
  }

  get secondsLeft(): number {
    return Math.ceil(this.roundTicksLeft / TICK_HZ);
  }

  /** Advance one simulation tick. Events produced are appended to `events`. */
  step(intents: [FighterIntent, FighterIntent]) {
    this.tick++;
    this.phaseTick++;
    const [a, b] = this.fighters;

    if (this.phase === 'intro') {
      // Fighters hold position during the countdown but can shuffle in place.
      const idle = [{ ...intents[0], attack: null, dash: false, moveX: 0, moveZ: 0 }, { ...intents[1], attack: null, dash: false, moveX: 0, moveZ: 0 }];
      a.step(idle[0], b);
      b.step(idle[1], a);
      if (this.phaseTick >= INTRO_TICKS) {
        this.phase = 'fight';
        this.phaseTick = 0;
      }
      return;
    }
    if (this.phase === 'round-over' || this.phase === 'match-over') {
      const none = { ...intents[0], attack: null, dash: false, moveX: 0, moveZ: 0, guard: false, switchStance: false };
      a.step(none, b);
      b.step(none, a);
      if (this.phase === 'round-over' && this.phaseTick >= ROUND_OVER_TICKS) {
        this.round++;
        this.startRound();
      }
      return;
    }

    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }

    const stopped = this.phase === 'break';
    if (stopped) {
      // During a stoppage fighters hold their ground. Inputs still reach the
      // fighters so that an attack thrown after Kal-yeo can be detected.
      const hold = (i: FighterIntent) => ({ ...i, moveX: 0, moveZ: 0, dash: false });
      a.step(hold(intents[0]), b);
      b.step(hold(intents[1]), a);
    } else {
      a.step(intents[0], b);
      b.step(intents[1], a);
    }
    for (const f of this.fighters) {
      if (f.state === 'attack' && f.stateTick === 1 && f.attack) {
        this.events.push({ type: 'attack', fighter: f.id, move: f.attack.move, height: f.attack.height });
        this.rules.hooks?.onAttackStart(this, f);
      }
    }

    this.separate();

    // Resolve strikes for both fighters before applying either (allows trades).
    const results = [this.checkStrike(a, b), this.checkStrike(b, a)];
    for (const r of results) if (r) r();

    if (stopped) {
      if (this.phase === 'break' && this.phaseTick >= this.breakTicks) this.resume();
      return;
    }
    this.roundTicksLeft--;
    this.rules.hooks?.afterTick(this);
    if (this.phase === 'fight') this.checkRoundEnd();
  }

  private separate() {
    const [a, b] = this.fighters;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    const min = BODY_RADIUS * 2;
    if (d < min && d > 1e-6) {
      const push = (min - d) / 2;
      const nx = dx / d;
      const nz = dz / d;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
    } else if (d <= 1e-6) {
      b.z += min;
    }
  }

  private checkStrike(att: Fighter, def: Fighter): (() => void) | null {
    const atk = att.attack;
    if (!atk || att.attackPhase !== 'active' || atk.hasHit) return null;
    const i = att.stateTick - atk.startup; // 0..active-1
    const n = atk.move.active;
    const p0 = att.strikePoint(i / n);
    const p1 = att.strikePoint((i + 1) / n);
    if (def.state === 'ko' || def.state === 'down') return null;
    const zone = testStrike(p0, p1, atk.move.radius, def.x, def.z);
    if (!zone && this.rules.hooks && testLegs(p0, p1, atk.move.radius, def.x, def.z)) {
      // Contact below the trunk protector: a prohibited target (Competitive).
      atk.hasHit = true;
      return () => this.rules.hooks!.onIllegalContact(this, att, 'below-waist');
    }
    if (!zone) {
      if (i === n - 1) this.events.push({ type: 'whiff', fighter: att.id, move: atk.move });
      return null;
    }
    atk.hasHit = true;
    return () => this.applyStrike(att, def, atk, zone, p1);
  }

  private applyStrike(att: Fighter, def: Fighter, atk: AttackState, zone: HitZone, point: V3) {
    const move = atk.move;
    const fx = Math.sin(att.yaw);
    const fz = Math.cos(att.yaw);
    // Side the technique arrives from, as seen by the defender (presentation only):
    // an orthodox rear-leg roundhouse sweeps in from the attacker's right,
    // which is the defender's left.
    const side = move.id === 'round' ? att.mirror : move.id === 'leadRound' ? -att.mirror : 0;
    const react = (heavy: boolean) => ({ zone, heavy, fromYaw: att.yaw, kind: move.id, side });
    const blocking = def.isGuarding && inGuardArc(def.yaw, def.x, def.z, att.x, att.z);
    if (blocking) {
      const cost = move.stamina * 0.8;
      const guardBreak = def.stamina < cost;
      def.spendStamina(cost);
      atk.blocked = true;
      this.events.push({ type: 'block', attacker: att.id, defender: def.id, move, point, guardBreak });
      if (guardBreak) {
        const out = this.rules.scoreHit({ attacker: att, defender: def, move, zone, counter: false, tired: true });
        def.receiveHit(GUARD_BREAK_STUN, fx * move.pushback, fz * move.pushback, react(true));
        this.damage(def, Math.round(out.damage * 0.5));
        this.hitstop = HITSTOP_HIT;
      } else {
        if (this.rules.usesHealth) {
          const out = this.rules.scoreHit({ attacker: att, defender: def, move, zone, counter: false, tired: atk.tired });
          this.damage(def, Math.round(out.damage * CHIP_FRACTION));
        }
        def.receiveBlock(move.blockstun, fx * move.pushback * 0.6, fz * move.pushback * 0.6, react(false));
        this.hitstop = HITSTOP_BLOCK;
      }
      return;
    }
    const counter = def.state === 'attack' && def.attackPhase === 'startup';
    const out = this.rules.scoreHit({ attacker: att, defender: def, move, zone, counter, tired: atk.tired });
    const hooks = this.rules.hooks;
    const contact: ContactInfo | null = hooks ? { attacker: att, defender: def, attack: atk, zone, counter } : null;
    const verdict = hooks && contact ? hooks.judgeContact(this, contact) : null;
    if (verdict) out.points = verdict.points;
    this.points[att.id] += out.points;
    const heavy = move.pushback > 3 || zone === 'head' || counter;
    def.receiveHit(move.hitstun, fx * move.pushback, fz * move.pushback, react(heavy));
    // Damage after the reaction so a knockout state is not overwritten by hitstun.
    if (this.rules.usesHealth) this.damage(def, out.damage);
    this.hitstop = HITSTOP_HIT;
    this.events.push({
      type: 'hit',
      attacker: att.id,
      defender: def.id,
      move,
      zone,
      damage: out.damage,
      points: out.points,
      counter,
      point,
      valid: verdict?.valid,
      label: verdict?.label,
      reason: verdict?.reason,
      turning: verdict?.turning,
    });
    if (hooks && contact && verdict) hooks.afterContact(this, contact, verdict);
  }

  private damage(f: Fighter, amount: number) {
    f.health = Math.max(0, f.health - amount);
    if (f.health <= 0 && f.state !== 'ko') {
      f.setState('ko');
      this.events.push({ type: 'ko', fighter: f.id });
    }
  }

  private checkRoundEnd() {
    const [a, b] = this.fighters;
    if (a.state === 'ko' || b.state === 'ko') {
      this.endRound(a.state === 'ko' ? (b.state === 'ko' ? null : 1) : 0, 'ko');
    } else if (this.roundTicksLeft <= 0) {
      const hooks = this.rules.hooks;
      if (hooks) {
        const d = hooks.decideRound(this);
        this.endRound(d.winner, d.reason, d.detail);
      } else {
        this.endRound(this.rules.decideTimeout(this.fighters, this.points), 'time');
      }
    }
  }

  /** End the current round (rulesets call this for point-gap / penalty endings). */
  endRound(winner: 0 | 1 | null, reason: RoundEndReason, detail?: string) {
    if (this.phase === 'round-over' || this.phase === 'match-over') return;
    this.lastRoundWinner = winner;
    if (winner !== null) {
      this.roundWins[winner]++;
      const w = this.fighters[winner];
      if (w.state !== 'ko') w.setState('victory');
    }
    this.events.push({ type: 'round-end', round: this.round, winner, reason, detail });
    let over: boolean;
    let matchWinner: 0 | 1 | null;
    if (this.rules.hooks) {
      ({ over, winner: matchWinner } = this.rules.hooks.matchResult(this));
    } else {
      const decided = this.roundWins[0] >= this.rules.roundsToWin || this.roundWins[1] >= this.rules.roundsToWin;
      over = decided || this.round >= this.rules.roundsToWin * 2 - 1;
      matchWinner = this.roundWins[0] === this.roundWins[1] ? null : this.roundWins[0] > this.roundWins[1] ? 0 : 1;
    }
    if (over) {
      this.phase = 'match-over';
      this.matchWinner = matchWinner;
      this.events.push({ type: 'match-end', winner: this.matchWinner });
    } else {
      this.phase = 'round-over';
    }
    this.phaseTick = 0;
  }

  /** Simulated seconds elapsed. */
  get time(): number {
    return this.tick * DT;
  }
}
