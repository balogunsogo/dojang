import type { RoundDecision } from '../rules';
import type { ScoreKind } from './scoring';

/** Per-fighter statistics for one round. */
export interface FighterRoundStats {
  points: number;
  turningPoints: number;
  /** Points by target (Art. 15.5 b): head and trunk include turning kicks. */
  headPoints: number;
  trunkPoints: number;
  punchPoints: number;
  /** Points received from the opponent's gam-jeom. */
  gamjeomPoints: number;
  scored: Record<ScoreKind, number>;
  /** Gam-jeom received this round. */
  gamjeom: number;
  gamjeomReasons: string[];
  /**
   * Hits registered on the scoring zones (Art. 15.5 c): every clean contact
   * on the trunk protector or headgear, whether or not it carried enough
   * force to score. Blocked strikes land on the arms and are not registered.
   */
  registeredHits: number;
  /** Techniques that reached the opponent, including blocked ones (game superiority proxy). */
  delivered: number;
  /** Techniques thrown. */
  attempts: number;
  /** Tick of the first technique thrown (Infinity if none). */
  firstAttackTick: number;
}

export function emptyStats(): FighterRoundStats {
  return {
    points: 0,
    turningPoints: 0,
    headPoints: 0,
    trunkPoints: 0,
    punchPoints: 0,
    gamjeomPoints: 0,
    scored: { turningHead: 0, turningTrunk: 0, kickHead: 0, kickTrunk: 0, punchTrunk: 0 },
    gamjeom: 0,
    gamjeomReasons: [],
    registeredHits: 0,
    delivered: 0,
    attempts: 0,
    firstAttackTick: Infinity,
  };
}

/**
 * Decide a best-of-three round that went the distance. Always returns a
 * winner: a best-of-three round cannot be drawn.
 *
 *  0. More points.
 *  Article 15.5 (best of three, tied round):
 *  a. More points from turning (spinning) kicks.
 *  b. Higher-value scores, compared in order: head points, trunk points,
 *     punch points, points from the opponent's gam-jeom.
 *  c. More valid hits registered on the scoring zones.
 *  d. Where WT would rely on the referee's superiority decision, the game
 *     uses a documented deterministic fallback. It is NOT an official WT
 *     referee decision:
 *       d1. more techniques delivered to the opponent (including blocked),
 *       d2. more techniques thrown,
 *       d3. fewer gam-jeom,
 *       d4. threw the first technique of the round,
 *       d5. if neither fighter threw anything, the round goes to Hong (red),
 *           an arbitrary but fixed last resort.
 */
export function decideRound(a: FighterRoundStats, b: FighterRoundStats): RoundDecision {
  const pick = (x: number, y: number): 0 | 1 | null => (x > y ? 0 : y > x ? 1 : null);
  const steps: [number, number, RoundDecision['reason'], string][] = [
    [a.points, b.points, 'time', 'Points'],
    [a.turningPoints, b.turningPoints, 'superiority', 'Art. 15.5: turning-kick points'],
    [a.headPoints, b.headPoints, 'superiority', 'Art. 15.5: head points'],
    [a.trunkPoints, b.trunkPoints, 'superiority', 'Art. 15.5: trunk points'],
    [a.punchPoints, b.punchPoints, 'superiority', 'Art. 15.5: punch points'],
    [a.gamjeomPoints, b.gamjeomPoints, 'superiority', 'Art. 15.5: gam-jeom points'],
    [a.registeredHits, b.registeredHits, 'superiority', 'Art. 15.5: registered hits'],
    [a.delivered, b.delivered, 'decision', 'Game decision: techniques delivered'],
    [a.attempts, b.attempts, 'decision', 'Game decision: techniques thrown'],
    [b.gamjeom, a.gamjeom, 'decision', 'Game decision: fewer gam-jeom'],
    [b.firstAttackTick, a.firstAttackTick, 'decision', 'Game decision: attacked first'],
  ];
  for (const [x, y, reason, detail] of steps) {
    const w = pick(x, y);
    if (w !== null) return { winner: w, reason, detail };
  }
  return { winner: 1, reason: 'decision', detail: 'Game decision: no technique thrown (Hong by default)' };
}

/**
 * Best of three (Art. 7.1.2): the first fighter to win two rounds wins.
 * There is no golden round in this format. Rounds always produce a winner,
 * so the match is decided by the third round at the latest.
 */
export function matchResult(round: number, wins: [number, number], roundsToWin: number): { over: boolean; winner: 0 | 1 | null } {
  const lead: 0 | 1 | null = wins[0] > wins[1] ? 0 : wins[1] > wins[0] ? 1 : null;
  if (wins[0] >= roundsToWin || wins[1] >= roundsToWin) return { over: true, winner: lead };
  if (round >= roundsToWin * 2 - 1) return { over: true, winner: lead };
  return { over: false, winner: null };
}
