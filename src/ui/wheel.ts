import type { AttackKind } from '../game/input/actions';

export type WheelKick = Exclude<AttackKind, 'punch'>;

/**
 * Technique wheel geometry (compact touch scheme). The wheel fans out up and
 * to the left of the Kick button (it sits in the bottom-right corner, so
 * those are the directions with screen space). Angles are degrees with
 * 0 = right and 90 = up.
 *
 * Two rings by drag distance:
 *  - inner ring: lead-leg kicks (fast techniques, short thumb travel)
 *  - outer ring: rear-leg kicks
 *  - past the dashed head ring: the outer-ring technique at head height
 */
export interface WheelItem {
  kind: WheelKick;
  angle: number;
  label: string;
  korean: string;
  ring: 'lead' | 'rear';
}
export const WHEEL_ITEMS: WheelItem[] = [
  { kind: 'leadFront', angle: 95, label: 'L·Front', korean: 'lead', ring: 'lead' },
  { kind: 'leadRound', angle: 140, label: 'L·Round', korean: 'lead', ring: 'lead' },
  { kind: 'leadSide', angle: 185, label: 'L·Side', korean: 'cut', ring: 'lead' },
  { kind: 'front', angle: 92, label: 'Front', korean: 'Ap', ring: 'rear' },
  { kind: 'round', angle: 127, label: 'Round', korean: 'Dollyeo', ring: 'rear' },
  { kind: 'side', angle: 162, label: 'Side', korean: 'Yeop', ring: 'rear' },
  { kind: 'back', angle: 197, label: 'Back', korean: 'Dwi', ring: 'rear' },
];
/** Drag distance (px) before a direction counts. */
export const WHEEL_DEADZONE = 26;
/** Inner (lead) ring item radius and its outer edge (px). */
export const WHEEL_LEAD_RADIUS = 58;
export const WHEEL_LEAD_EDGE = 86;
/** Outer (rear) ring item radius (px). */
export const WHEEL_RADIUS = 118;
/** Dragging past this radius (px) picks the head-height variant of a rear kick. */
export const WHEEL_HEAD_RADIUS = 160;
const HALF_SECTOR = 22;

export interface WheelPick {
  kind: WheelKick;
  head: boolean;
}

/** Map a drag vector from the Kick button centre (screen px, y down) to a technique. */
export function pickWheel(dx: number, dy: number): WheelPick | null {
  const r = Math.hypot(dx, dy);
  if (r < WHEEL_DEADZONE) return null;
  let ang = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if (ang < -60) ang += 360; // keep the lower-left quadrant continuous with "back"
  const ring = r < WHEEL_LEAD_EDGE ? 'lead' : 'rear';
  let best: WheelItem | null = null;
  let bestD = Infinity;
  for (const it of WHEEL_ITEMS) {
    if (it.ring !== ring) continue;
    const d = Math.abs(ang - it.angle);
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  if (!best || bestD > HALF_SECTOR + 8) return null;
  return { kind: best.kind, head: ring === 'rear' && r >= WHEEL_HEAD_RADIUS };
}

export const KICK_LABEL: Record<WheelKick, [string, string]> = {
  front: ['Front', 'Ap'],
  round: ['Round', 'Dollyeo'],
  side: ['Side', 'Yeop'],
  back: ['Back', 'Dwi'],
  leadFront: ['L·Front', 'lead leg'],
  leadRound: ['L·Round', 'lead leg'],
  leadSide: ['L·Side', 'cut kick'],
};
