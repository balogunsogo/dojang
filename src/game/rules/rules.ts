import type { CombatWorld } from '../combat/CombatWorld';
import type { AttackState, Fighter } from '../combat/Fighter';
import type { HitZone } from '../combat/hit';
import { HEAD_DAMAGE_MULT, type MoveDef } from '../combat/moves';

export interface HitContext {
  attacker: Fighter;
  defender: Fighter;
  move: MoveDef;
  zone: HitZone;
  counter: boolean;
  tired: boolean;
}

export interface HitOutcome {
  damage: number;
  points: number;
}

/** A clean (unblocked) contact as measured by the simulation. */
export interface ContactInfo {
  attacker: Fighter;
  defender: Fighter;
  attack: AttackState;
  zone: HitZone;
  /** Counter hit (defender was in attack startup). */
  counter: boolean;
}

/** What the ruleset decided about a contact. */
export interface ContactVerdict {
  points: number;
  /** False when the contact does not score (reason says why). */
  valid: boolean;
  reason?: string;
  /** Short label for feedback, e.g. "Turning head kick". */
  label: string;
  turning: boolean;
}

export type RoundEndReason = 'ko' | 'time' | 'gap' | 'penalties' | 'superiority' | 'golden';

export interface RoundDecision {
  winner: 0 | 1 | null;
  reason: RoundEndReason;
  /** Human-readable explanation (tie-break step etc.). */
  detail?: string;
}

/**
 * Optional simulation hooks for stateful rulesets (Competitive). The combat
 * engine calls them; Arcade does not implement them, so its behaviour is
 * unchanged.
 */
export interface RuleHooks {
  onMatchStart(world: CombatWorld): void;
  onRoundStart(world: CombatWorld): void;
  /** A technique started (detects attacks after Kal-yeo / on a fallen opponent). */
  onAttackStart(world: CombatWorld, f: Fighter): void;
  /** Judge a clean contact: validity and points. */
  judgeContact(world: CombatWorld, c: ContactInfo): ContactVerdict;
  /** Contact with a prohibited target (below the waist). */
  onIllegalContact(world: CombatWorld, attacker: Fighter, reason: 'below-waist'): void;
  /** Contact that knocked the defender down (decides whether it was a knockdown). */
  afterContact(world: CombatWorld, c: ContactInfo, verdict: ContactVerdict): void;
  /** After every simulated fight tick: boundaries, falls, point gap, penalties. */
  afterTick(world: CombatWorld): void;
  /** Decide a round whose clock ran out. */
  decideRound(world: CombatWorld): RoundDecision;
  /** After a round ends: is the match over, and who won? */
  matchResult(world: CombatWorld): { over: boolean; winner: 0 | 1 | null };
  /** Length of the next round in seconds (a golden round can be shorter). */
  roundLength(world: CombatWorld): number;
}

/**
 * A ruleset decides what a landed technique is worth and how a round is
 * decided. Both rulesets share the same combat engine.
 */
export interface Ruleset {
  readonly id: 'arcade' | 'competitive';
  readonly label: string;
  readonly roundSeconds: number;
  readonly roundsToWin: number;
  readonly usesHealth: boolean;
  scoreHit(ctx: HitContext): HitOutcome;
  /** Decide a round that ended on time. Returns winner id or null for a draw. */
  decideTimeout(f: [Fighter, Fighter], points: [number, number]): 0 | 1 | null;
  /** Half-size of the competition area (boundary line). Undefined: fighters stay on the mat. */
  readonly boundary?: number;
  /** Stateful hooks (Competitive). */
  readonly hooks?: RuleHooks;
}

/** Arcade: health-based, knockout or timeout (more health remaining wins). */
export const ArcadeRules: Ruleset = {
  id: 'arcade',
  label: 'Arcade',
  roundSeconds: 60,
  roundsToWin: 2,
  usesHealth: true,
  scoreHit({ attacker, move, zone, counter, tired }) {
    let dmg = move.damage * attacker.stats.power;
    if (zone === 'head') dmg *= HEAD_DAMAGE_MULT;
    if (counter) dmg *= 1.25;
    if (tired) dmg *= 0.7;
    return { damage: Math.round(dmg), points: 0 };
  },
  decideTimeout(f) {
    const a = f[0].health / f[0].stats.maxHealth;
    const b = f[1].health / f[1].stats.maxHealth;
    if (Math.abs(a - b) < 0.005) return null;
    return a > b ? 0 : 1;
  },
};

// Competitive (WT-inspired point scoring) lives in ./competitive/.
