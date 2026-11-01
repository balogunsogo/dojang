import { BODY_RADIUS, DT, TICK_HZ } from '../config';
import type { FighterIntent, TargetHeight } from '../input/actions';
import type { V3 } from '../math';
import type { Ruleset } from '../rules/rules';
import { type AttackState, Fighter, type FighterStats } from './Fighter';
import { inGuardArc, testStrike, type HitZone } from './hit';
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
    }
  | { type: 'block'; attacker: 0 | 1; defender: 0 | 1; move: MoveDef; point: V3; guardBreak: boolean }
  | { type: 'whiff'; fighter: 0 | 1; move: MoveDef }
  | { type: 'ko'; fighter: 0 | 1 }
  | { type: 'round-start'; round: number }
  | { type: 'round-end'; round: number; winner: 0 | 1 | null; reason: 'ko' | 'time' }
  | { type: 'match-end'; winner: 0 | 1 | null };

export type MatchPhase = 'intro' | 'fight' | 'round-over' | 'match-over';

const INTRO_TICKS = Math.round(TICK_HZ * 2.2);
const ROUND_OVER_TICKS = Math.round(TICK_HZ * 3);
const START_GAP = 2.4;
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

  constructor(rules: Ruleset, stats: [FighterStats, FighterStats]) {
    this.rules = rules;
    this.fighters = [new Fighter(0, stats[0]), new Fighter(1, stats[1])];
    this.resetMatch();
  }

  resetMatch() {
    this.round = 1;
    this.roundWins = [0, 0];
    this.matchWinner = null;
    this.startRound();
  }

  startRound() {
    const [a, b] = this.fighters;
    a.reset(0, -START_GAP / 2, 0);
    b.reset(0, START_GAP / 2, Math.PI);
    this.points = [0, 0];
    this.roundTicksLeft = this.rules.roundSeconds * TICK_HZ;
    this.hitstop = 0;
    this.phase = this.skipIntro ? 'fight' : 'intro';
    this.phaseTick = 0;
    this.events.push({ type: 'round-start', round: this.round });
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

    a.step(intents[0], b);
    b.step(intents[1], a);
    for (const f of this.fighters) {
      if (f.state === 'attack' && f.stateTick === 1 && f.attack) {
        this.events.push({ type: 'attack', fighter: f.id, move: f.attack.move, height: f.attack.height });
      }
    }

    this.separate();

    // Resolve strikes for both fighters before applying either (allows trades).
    const results = [this.checkStrike(a, b), this.checkStrike(b, a)];
    for (const r of results) if (r) r();

    this.roundTicksLeft--;
    this.checkRoundEnd();
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
    if (def.state === 'ko') return null;
    const zone = testStrike(p0, p1, atk.move.radius, def.x, def.z);
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
    const side = move.id === 'round' ? att.mirror : 0;
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
    });
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
    let winner: 0 | 1 | null | undefined;
    let reason: 'ko' | 'time' = 'ko';
    if (a.state === 'ko' || b.state === 'ko') {
      winner = a.state === 'ko' ? (b.state === 'ko' ? null : 1) : 0;
    } else if (this.roundTicksLeft <= 0) {
      reason = 'time';
      winner = this.rules.decideTimeout(this.fighters, this.points);
    }
    if (winner === undefined) return;
    this.lastRoundWinner = winner;
    if (winner !== null) {
      this.roundWins[winner]++;
      const w = this.fighters[winner];
      if (w.state !== 'ko') w.setState('victory');
    }
    this.events.push({ type: 'round-end', round: this.round, winner, reason });
    const decided = this.roundWins[0] >= this.rules.roundsToWin || this.roundWins[1] >= this.rules.roundsToWin;
    const maxRounds = this.rules.roundsToWin * 2 - 1;
    if (decided || this.round >= maxRounds) {
      this.phase = 'match-over';
      this.matchWinner = this.roundWins[0] === this.roundWins[1] ? null : this.roundWins[0] > this.roundWins[1] ? 0 : 1;
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
