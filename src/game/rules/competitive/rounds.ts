import type { RoundDecision } from '../rules';
import { SCORE_KINDS, type ScoreKind } from './scoring';

/** Per-fighter statistics for one round. */
export interface FighterRoundStats {
  points: number;
  turningPoints: number;
  scored: Record<ScoreKind, number>;
  gamjeom: number;
  gamjeomReasons: string[];
  /** Techniques that reached the opponent (scored, blocked or not scoring): initiative. */
  contacts: number;
  /** Tick of the first point scored (Infinity if none). */
  firstScoreTick: number;
}

export function emptyStats(): FighterRoundStats {
  return {
    points: 0,
    turningPoints: 0,
    scored: { turningHead: 0, turningTrunk: 0, kickHead: 0, kickTrunk: 0, punchTrunk: 0 },
    gamjeom: 0,
    gamjeomReasons: [],
    contacts: 0,
    firstScoreTick: Infinity,
  };
}

/**
 * Decide a round that went the distance.
 * Order (WT-inspired; steps 1-4 follow federation summaries of the 2026
 * rules, steps 5-6 replace the referee's superiority decision with objective
 * measurements because a referee's judgement cannot be simulated fairly):
 *  1. More points
 *  2. More points from turning kicks
 *  3. Higher technical value (compare counts from the highest value down)
 *  4. Fewer gam-jeom
 *  5. Superiority proxy: more techniques that reached the opponent
 *  6. Scored first
 *  7. Otherwise the round is drawn
 */
export function decideRound(a: FighterRoundStats, b: FighterRoundStats): RoundDecision {
  const pick = (x: number, y: number): 0 | 1 | null => (x > y ? 0 : y > x ? 1 : null);
  let w = pick(a.points, b.points);
  if (w !== null) return { winner: w, reason: 'time', detail: 'Points' };
  w = pick(a.turningPoints, b.turningPoints);
  if (w !== null) return { winner: w, reason: 'superiority', detail: 'Tie-break: turning-kick points' };
  for (const k of SCORE_KINDS) {
    w = pick(a.scored[k], b.scored[k]);
    if (w !== null) return { winner: w, reason: 'superiority', detail: 'Tie-break: technical value' };
  }
  w = pick(b.gamjeom, a.gamjeom);
  if (w !== null) return { winner: w, reason: 'superiority', detail: 'Tie-break: fewer gam-jeom' };
  w = pick(a.contacts, b.contacts);
  if (w !== null) return { winner: w, reason: 'superiority', detail: 'Superiority: more techniques delivered' };
  w = pick(b.firstScoreTick, a.firstScoreTick);
  if (w !== null && Number.isFinite(Math.min(a.firstScoreTick, b.firstScoreTick))) return { winner: w, reason: 'superiority', detail: 'Superiority: scored first' };
  return { winner: null, reason: 'time', detail: 'Drawn round' };
}

/**
 * Best of three. If the fighters are level after three rounds (possible when
 * a round is drawn) a golden round is fought; if that is also level the
 * match is a draw.
 */
export function matchResult(round: number, wins: [number, number], roundsToWin: number): { over: boolean; winner: 0 | 1 | null; golden: boolean } {
  const lead: 0 | 1 | null = wins[0] > wins[1] ? 0 : wins[1] > wins[0] ? 1 : null;
  if (wins[0] >= roundsToWin || wins[1] >= roundsToWin) return { over: true, winner: lead, golden: false };
  const regular = roundsToWin * 2 - 1;
  if (round < regular) return { over: false, winner: null, golden: false };
  if (round === regular) {
    if (lead !== null) return { over: true, winner: lead, golden: false };
    return { over: false, winner: null, golden: true };
  }
  return { over: true, winner: lead, golden: false };
}
