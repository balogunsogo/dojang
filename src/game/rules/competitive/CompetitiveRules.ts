import type { CombatWorld } from '../../combat/CombatWorld';
import type { Fighter } from '../../combat/Fighter';
import { TICK_HZ } from '../../config';
import type { ContactInfo, ContactVerdict, HitOutcome, RoundDecision, RuleHooks, Ruleset } from '../rules';
import { type CompetitiveConfig, WT_2026 } from './config';
import { decideRound, emptyStats, type FighterRoundStats, matchResult } from './rounds';
import { pointsFor, SCORE_LABEL, scoreKind } from './scoring';
import { isOutOfBounds, validateContact } from './validation';

export type PenaltyReason = 'boundary' | 'fall' | 'below-waist' | 'after-kalyeo' | 'fallen-opponent' | 'head-punch';

export const PENALTY_LABEL: Record<PenaltyReason, string> = {
  boundary: 'Crossing the boundary line',
  fall: 'Falling down',
  'below-waist': 'Kick below the waist',
  'after-kalyeo': 'Attack after Kal-yeo',
  'fallen-opponent': 'Attacking a fallen opponent',
  'head-punch': 'Punch to the head',
};
/** Passive infractions: these score double in the last seconds of a round. */
const PASSIVE: PenaltyReason[] = ['boundary', 'fall'];

export interface RoundRecord {
  round: number;
  golden: boolean;
  stats: [FighterRoundStats, FighterRoundStats];
  winner: 0 | 1 | null;
  reason: string;
  detail?: string;
}

/**
 * WT-inspired point sparring on the shared combat engine. Stateful: create a
 * new instance per match (rematch calls onMatchStart, which resets it).
 *
 * Separation of concerns:
 *  - validation.ts: is a contact a valid technique on a valid target with
 *    enough delivered force?
 *  - scoring.ts:    how many points is it worth?
 *  - this class:    penalties (gam-jeom), stoppages, round/match flow
 *  - rounds.ts:     round decisions, tie-breaks, best-of-three / golden round
 */
export class CompetitiveRules implements Ruleset, RuleHooks {
  readonly id = 'competitive' as const;
  readonly label = 'Competitive';
  readonly usesHealth = false;
  readonly cfg: CompetitiveConfig;
  readonly hooks: RuleHooks = this;
  stats: [FighterRoundStats, FighterRoundStats] = [emptyStats(), emptyStats()];
  history: RoundRecord[] = [];
  golden = false;
  /** Fighters currently flagged out of bounds (penalized once per exit). */
  private out: [boolean, boolean] = [false, false];
  private seenEvents = 0;

  constructor(cfg: CompetitiveConfig = WT_2026) {
    this.cfg = cfg;
  }

  get roundSeconds() {
    return this.cfg.roundSeconds;
  }
  get roundsToWin() {
    return this.cfg.roundsToWin;
  }
  get boundary() {
    return this.cfg.boundary;
  }

  scoreHit(): HitOutcome {
    // Damage is irrelevant without health; points come from judgeContact.
    return { damage: 0, points: 0 };
  }
  decideTimeout(): 0 | 1 | null {
    return null; // superseded by hooks.decideTimeout
  }

  // ---- hooks --------------------------------------------------------------

  onMatchStart() {
    this.history = [];
    this.golden = false;
  }

  onRoundStart(world: CombatWorld) {
    this.stats = [emptyStats(), emptyStats()];
    this.out = [false, false];
    this.seenEvents = world.events.length;
  }

  roundLength(world: CombatWorld) {
    return world.round > this.cfg.roundsToWin * 2 - 1 ? this.cfg.goldenRoundSeconds : this.cfg.roundSeconds;
  }

  onAttackStart(world: CombatWorld, f: Fighter) {
    // Techniques launched after the referee's Kal-yeo (beyond a short grace
    // for attacks already on their way) are prohibited.
    if (world.phase !== 'break') return;
    if (world.tick - world.stoppageTick <= this.cfg.kalyeoGraceTicks) return;
    const opp = world.fighters[1 - f.id];
    this.penalize(world, f, opp.state === 'down' ? 'fallen-opponent' : 'after-kalyeo');
  }

  judgeContact(world: CombatWorld, c: ContactInfo): ContactVerdict {
    const st = this.stats[c.attacker.id];
    st.contacts++;
    const check = validateContact(c.attacker, c.attack, c.zone, world.phase === 'break', this.cfg);
    const kind = scoreKind(c.attack.move, c.zone, check.turning);
    if (!check.valid) {
      if (check.reason === 'Punch to the head') this.penalize(world, c.attacker, 'head-punch');
      return { points: 0, valid: false, reason: check.reason, label: SCORE_LABEL[kind], turning: check.turning };
    }
    const pts = pointsFor(kind, this.cfg);
    st.points += pts;
    st.scored[kind]++;
    if (check.turning) st.turningPoints += pts;
    if (!Number.isFinite(st.firstScoreTick)) st.firstScoreTick = world.tick;
    return { points: pts, valid: true, label: SCORE_LABEL[kind], turning: check.turning };
  }

  afterContact(world: CombatWorld, c: ContactInfo, v: ContactVerdict) {
    // A valid head or turning kick on an exhausted opponent knocks them down:
    // the referee stops the bout to count. No penalty for the fallen fighter
    // (the fall was caused by a valid technique).
    if (!v.valid || world.phase !== 'fight') return;
    if ((c.zone === 'head' || v.turning) && c.defender.stamina < this.cfg.knockdownStamina) {
      c.defender.knockDown(this.cfg.stoppageTicks.knockdown - 20, 'knockdown');
      world.events.push({ type: 'down', fighter: c.defender.id, cause: 'knockdown' });
      world.callStoppage('Knockdown', this.cfg.stoppageTicks.knockdown, false);
    }
  }

  onIllegalContact(world: CombatWorld, attacker: Fighter) {
    this.penalize(world, attacker, 'below-waist');
  }

  afterTick(world: CombatWorld) {
    // Contacts on the guard count towards initiative (superiority proxy).
    const ev = world.events;
    if (ev.length < this.seenEvents) this.seenEvents = 0;
    for (let i = this.seenEvents; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'block') this.stats[e.attacker].contacts++;
    }
    this.seenEvents = ev.length;

    for (const f of world.fighters) {
      // Self-inflicted fall: a stamina-starved turning or head kick that misses
      // throws the kicker off balance.
      const atk = f.attack;
      if (f.state === 'attack' && atk && !atk.hasHit && atk.tired && f.stateTick === atk.startup + atk.move.active && (atk.move.turning || atk.height === 'head')) {
        f.knockDown(this.cfg.stoppageTicks.fall - 20, 'fall');
        world.events.push({ type: 'down', fighter: f.id, cause: 'fall' });
        this.penalize(world, f, 'fall');
        if (world.phase === 'fight') world.callStoppage('Fall', this.cfg.stoppageTicks.fall, false);
      }
      // Boundary: any part of the foot over the line (once per exit).
      const out = isOutOfBounds(f, this.cfg);
      if (out && !this.out[f.id]) {
        this.out[f.id] = true;
        this.penalize(world, f, 'boundary');
        if (world.phase === 'fight') world.callStoppage('Out of bounds', this.cfg.stoppageTicks.boundary, true);
      } else if (!out) this.out[f.id] = false;
    }
    if (world.phase === 'round-over' || world.phase === 'match-over') return;

    const [a, b] = this.stats;
    world.points[0] = a.points;
    world.points[1] = b.points;
    // Golden round: the first point (including from a gam-jeom) wins.
    if (this.golden && a.points !== b.points) {
      world.endRound(a.points > b.points ? 0 : 1, 'golden', 'Golden round: first point');
      return;
    }
    // Point gap ends the round.
    if (this.cfg.pointGap > 0 && Math.abs(a.points - b.points) >= this.cfg.pointGap) {
      world.endRound(a.points > b.points ? 0 : 1, 'gap', `Point gap (${this.cfg.pointGap})`);
    }
  }

  /** Award a gam-jeom against `f` (points to the opponent). */
  penalize(world: CombatWorld, f: Fighter, reason: PenaltyReason) {
    if (world.phase === 'round-over' || world.phase === 'match-over') return;
    const opp = 1 - f.id;
    const st = this.stats[f.id];
    const late = world.roundTicksLeft <= this.cfg.passiveLateWindowSeconds * TICK_HZ;
    const pts = PASSIVE.includes(reason) && late ? this.cfg.passiveLateGamjeomPoints : this.cfg.gamjeomPoints;
    st.gamjeom++;
    st.gamjeomReasons.push(PENALTY_LABEL[reason]);
    const os = this.stats[opp];
    os.points += pts;
    if (!Number.isFinite(os.firstScoreTick)) os.firstScoreTick = world.tick;
    world.points[0] = this.stats[0].points;
    world.points[1] = this.stats[1].points;
    world.events.push({ type: 'penalty', fighter: f.id, reason, label: PENALTY_LABEL[reason], pointsToOpponent: pts, count: st.gamjeom });
    if (this.cfg.gamjeomRoundLimit > 0 && st.gamjeom >= this.cfg.gamjeomRoundLimit) {
      world.endRound(opp as 0 | 1, 'penalties', `${this.cfg.gamjeomRoundLimit} gam-jeom`);
      return;
    }
    if (!PASSIVE.includes(reason) && world.phase === 'fight') world.callStoppage('Gam-jeom', this.cfg.stoppageTicks.penalty, false);
  }

  decideRound(): RoundDecision {
    return decideRound(this.stats[0], this.stats[1]);
  }

  matchResult(world: CombatWorld) {
    let last: (typeof world.events)[number] | undefined;
    for (let i = world.events.length - 1; i >= 0 && !last; i--) if (world.events[i].type === 'round-end') last = world.events[i];
    this.history.push({
      round: world.round,
      golden: this.golden,
      stats: [structuredClone(this.stats[0]), structuredClone(this.stats[1])],
      winner: world.lastRoundWinner,
      reason: last && last.type === 'round-end' ? last.reason : 'time',
      detail: last && last.type === 'round-end' ? last.detail : undefined,
    });
    const r = matchResult(world.round, world.roundWins, this.cfg.roundsToWin);
    this.golden = r.golden;
    return { over: r.over, winner: r.winner };
  }
}
