import type { AttackKind } from '../game/input/actions';

export type WheelKick = Exclude<AttackKind, 'punch'>;

/**
 * Technique wheel geometry (compact touch scheme). The wheel fans out up and
 * to the left of the Kick button (it sits in the bottom-right corner, so
 * those are the directions with screen space). Angles are degrees with
 * 0 = right and 90 = up.
 */
export const WHEEL_ITEMS: { kind: WheelKick; angle: number; label: string; korean: string }[] = [
  { kind: 'front', angle: 92, label: 'Front', korean: 'Ap' },
  { kind: 'round', angle: 127, label: 'Round', korean: 'Dollyeo' },
  { kind: 'side', angle: 162, label: 'Side', korean: 'Yeop' },
  { kind: 'back', angle: 197, label: 'Back', korean: 'Dwi' },
];
/** Drag distance (px) before a direction counts. */
export const WHEEL_DEADZONE = 30;
/** Radius of the item ring (px). */
export const WHEEL_RADIUS = 100;
/** Dragging past this radius (px) picks the head-height variant. */
export const WHEEL_HEAD_RADIUS = 142;
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
  let best: (typeof WHEEL_ITEMS)[number] | null = null;
  let bestD = Infinity;
  for (const it of WHEEL_ITEMS) {
    const d = Math.abs(ang - it.angle);
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  if (!best || bestD > HALF_SECTOR + 8) return null;
  return { kind: best.kind, head: r >= WHEEL_HEAD_RADIUS };
}
