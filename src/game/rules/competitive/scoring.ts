import type { HitZone } from '../../combat/hit';
import type { MoveDef } from '../../combat/moves';
import type { CompetitiveConfig } from './config';

/** Value categories, highest first (used by the technical-value tie-break). */
export const SCORE_KINDS = ['turningHead', 'turningTrunk', 'kickHead', 'kickTrunk', 'punchTrunk'] as const;
export type ScoreKind = (typeof SCORE_KINDS)[number];

export const SCORE_LABEL: Record<ScoreKind, string> = {
  turningHead: 'Turning head kick',
  turningTrunk: 'Turning body kick',
  kickHead: 'Head kick',
  kickTrunk: 'Body kick',
  punchTrunk: 'Punch',
};

export function scoreKind(move: MoveDef, zone: HitZone, turning: boolean): ScoreKind {
  if (move.limb === 'rearHand') return 'punchTrunk';
  if (turning) return zone === 'head' ? 'turningHead' : 'turningTrunk';
  return zone === 'head' ? 'kickHead' : 'kickTrunk';
}

export function pointsFor(kind: ScoreKind, cfg: CompetitiveConfig): number {
  return cfg.points[kind];
}
