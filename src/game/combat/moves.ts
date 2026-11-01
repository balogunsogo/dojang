import type { AttackKind, TargetHeight } from '../input/actions';
import type { V3 } from '../math';

/**
 * Frame data and strike geometry for every technique. Times are in 60 Hz
 * ticks. Geometry is in the attacker's local frame [side(+left), up, forward]
 * for an ORTHODOX stance (left foot forward, kicks thrown with the rear/right
 * leg). Southpaw mirrors the side axis.
 *
 * The same data drives hit detection (sim) and the kick keyframes (animation),
 * so what you see is what is tested.
 */
export interface MoveDef {
  id: AttackKind;
  name: string;
  korean: string;
  limb: 'rearFoot' | 'leadFoot' | 'rearHand';
  startup: number;
  active: number;
  recovery: number;
  stamina: number;
  /** Arcade damage (body). Head hits multiply by HEAD_DAMAGE_MULT. */
  damage: number;
  heights: TargetHeight[];
  /** Strike point at the start of the active window (end of chamber). */
  chamber: V3;
  impact: Record<TargetHeight, V3>;
  /** Strike sphere radius. */
  radius: number;
  hitstun: number;
  blockstun: number;
  /** Knock-back speed applied to the defender on hit (m/s). */
  pushback: number;
  /** Forward travel of the attacker over startup+active (m). */
  advance: number;
  /** Spinning technique (WT awards bonus points for turning kicks). */
  turning: boolean;
  /**
   * How far the body rotates away from the opponent before the strike lands
   * (degrees). Turning-kick eligibility requires >= 180 (back turned to the
   * opponent during delivery); the hip turnover of a roundhouse does not count.
   */
  turnDegrees: number;
  /** Ticks into recovery after which a successful hit can be chained. */
  cancelAfter: number;
}

export const HEAD_DAMAGE_MULT = 1.35;
/** Extra startup ticks for head-height variants (higher chamber). */
export const HEAD_STARTUP_EXTRA = 2;
export const HEAD_STAMINA_EXTRA = 2;

export const MOVES: Record<AttackKind, MoveDef> = {
  punch: {
    id: 'punch',
    name: 'Straight punch',
    korean: 'Jireugi',
    limb: 'rearHand',
    startup: 6,
    active: 3,
    recovery: 12,
    stamina: 5,
    damage: 5,
    heights: ['body'],
    chamber: [-0.16, 1.24, 0.28],
    impact: { body: [-0.04, 1.2, 0.8], head: [-0.04, 1.2, 0.8] },
    radius: 0.08,
    hitstun: 14,
    blockstun: 8,
    pushback: 1.2,
    advance: 0.12,
    turning: false,
    turnDegrees: 0,
    cancelAfter: 4,
  },
  front: {
    id: 'front',
    name: 'Front kick',
    korean: 'Ap chagi',
    limb: 'rearFoot',
    startup: 10,
    active: 4,
    recovery: 16,
    stamina: 10,
    damage: 9,
    heights: ['body', 'head'],
    chamber: [-0.08, 0.78, 0.38],
    impact: { body: [-0.05, 1.12, 1.0], head: [-0.05, 1.5, 0.86] },
    radius: 0.11,
    hitstun: 20,
    blockstun: 10,
    pushback: 2.2,
    advance: 0.15,
    turning: false,
    turnDegrees: 0,
    cancelAfter: 8,
  },
  round: {
    id: 'round',
    name: 'Roundhouse kick',
    korean: 'Dollyeo chagi',
    limb: 'rearFoot',
    startup: 11,
    active: 4,
    recovery: 17,
    stamina: 12,
    damage: 11,
    heights: ['body', 'head'],
    chamber: [-0.42, 1.0, 0.36],
    impact: { body: [0.02, 1.12, 1.02], head: [0.02, 1.52, 0.9] },
    radius: 0.12,
    hitstun: 22,
    blockstun: 11,
    pushback: 2.0,
    advance: 0.1,
    turning: false,
    turnDegrees: 0,
    cancelAfter: 8,
  },
  side: {
    id: 'side',
    name: 'Side kick',
    korean: 'Yeop chagi',
    limb: 'rearFoot',
    startup: 14,
    active: 5,
    recovery: 21,
    stamina: 15,
    damage: 14,
    heights: ['body', 'head'],
    chamber: [-0.04, 0.98, 0.32],
    impact: { body: [0.0, 1.12, 1.2], head: [0.0, 1.48, 1.06] },
    radius: 0.12,
    hitstun: 26,
    blockstun: 13,
    pushback: 3.6,
    advance: 0.2,
    turning: false,
    turnDegrees: 0,
    cancelAfter: 12,
  },
  back: {
    id: 'back',
    name: 'Back kick',
    korean: 'Dwi chagi',
    limb: 'rearFoot',
    startup: 17,
    active: 5,
    recovery: 24,
    stamina: 18,
    damage: 17,
    heights: ['body', 'head'],
    chamber: [0.0, 0.88, 0.28],
    impact: { body: [0.0, 1.1, 1.12], head: [0.0, 1.5, 1.02] },
    radius: 0.13,
    hitstun: 30,
    blockstun: 14,
    pushback: 4.2,
    advance: 0.15,
    turning: true,
    turnDegrees: 180,
    cancelAfter: 99,
  },
  // Lead-leg techniques: thrown with the front leg, weight loaded onto the
  // rear (support) leg. Faster and cheaper than their rear-leg versions,
  // shorter hip drive (less pushback/damage), quicker recovery but a smaller
  // cancel window. Geometry is on the lead (+side) half for orthodox.
  leadFront: {
    id: 'leadFront',
    name: 'Lead front kick',
    korean: 'Apbal ap chagi',
    limb: 'leadFoot',
    startup: 8,
    active: 3,
    recovery: 14,
    stamina: 7,
    damage: 6,
    heights: ['body', 'head'],
    chamber: [0.08, 0.74, 0.46],
    impact: { body: [0.06, 1.1, 1.06], head: [0.06, 1.48, 0.94] },
    radius: 0.1,
    hitstun: 16,
    blockstun: 8,
    pushback: 1.7,
    advance: 0.1,
    turning: false,
    turnDegrees: 0,
    cancelAfter: 6,
  },
  leadRound: {
    id: 'leadRound',
    name: 'Lead roundhouse',
    korean: 'Apbal dollyeo chagi',
    limb: 'leadFoot',
    startup: 7,
    active: 3,
    recovery: 14,
    stamina: 8,
    damage: 7,
    heights: ['body', 'head'],
    chamber: [0.34, 0.96, 0.46],
    impact: { body: [0.0, 1.12, 1.08], head: [0.0, 1.52, 0.96] },
    radius: 0.11,
    hitstun: 16,
    blockstun: 9,
    pushback: 1.4,
    advance: 0.16,
    turning: false,
    turnDegrees: 0,
    cancelAfter: 6,
  },
  leadSide: {
    id: 'leadSide',
    name: 'Lead side kick (cut kick)',
    korean: 'Apbal yeop chagi',
    limb: 'leadFoot',
    startup: 9,
    active: 4,
    recovery: 16,
    stamina: 9,
    damage: 8,
    heights: ['body', 'head'],
    chamber: [0.06, 0.9, 0.4],
    impact: { body: [0.0, 1.1, 1.24], head: [0.0, 1.45, 1.1] },
    radius: 0.11,
    hitstun: 18,
    blockstun: 10,
    pushback: 3.0,
    advance: 0.06,
    turning: false,
    turnDegrees: 0,
    cancelAfter: 8,
  },
};

export function moveTotal(m: MoveDef, height: TargetHeight): number {
  return startupOf(m, height) + m.active + m.recovery;
}
export function startupOf(m: MoveDef, height: TargetHeight): number {
  return m.startup + (height === 'head' ? HEAD_STARTUP_EXTRA : 0);
}
export function staminaCost(m: MoveDef, height: TargetHeight): number {
  return m.stamina + (height === 'head' ? HEAD_STAMINA_EXTRA : 0);
}
/** Heights a move can actually target: unsupported head requests fall back to body. */
export function resolveHeight(m: MoveDef, h: TargetHeight): TargetHeight {
  return m.heights.includes(h) ? h : 'body';
}
