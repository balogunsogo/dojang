import { HURT } from '../config';
import { distPointSegmentSq, distSegmentSegmentSq, type V3 } from '../math';

export type HitZone = 'body' | 'head';

/**
 * Test a swept strike sphere (segment a->b, radius r) against the defender's
 * hurt volumes. Returns the zone hit, preferring the head when both overlap
 * (the strike is tested at the height it was aimed).
 */
export function testStrike(a: V3, b: V3, r: number, defX: number, defZ: number): HitZone | null {
  const head: V3 = [defX, HURT.headHeight, defZ];
  const hr = r + HURT.headRadius;
  if (distPointSegmentSq(head, a, b) <= hr * hr) return 'head';
  const b0: V3 = [defX, HURT.bodyBottom, defZ];
  const b1: V3 = [defX, HURT.bodyTop, defZ];
  const br = r + HURT.bodyRadius;
  if (distSegmentSegmentSq(a, b, b0, b1) <= br * br) return 'body';
  return null;
}

/** Is the attacker within the defender's frontal guard arc? */
export function inGuardArc(defYaw: number, defX: number, defZ: number, attX: number, attZ: number, arcDeg = 75): boolean {
  const dx = attX - defX;
  const dz = attZ - defZ;
  const m = Math.hypot(dx, dz);
  if (m < 1e-6) return true;
  const dot = (Math.sin(defYaw) * dx + Math.cos(defYaw) * dz) / m;
  return dot >= Math.cos((arcDeg * Math.PI) / 180);
}

/** Legs below the trunk protector (prohibited target in Competitive). */
export const LEGS = { bottom: 0.15, top: 0.92, radius: 0.17 } as const;

/** Does a swept strike touch the defender's legs (below the waist)? */
export function testLegs(a: V3, b: V3, r: number, defX: number, defZ: number): boolean {
  const l0: V3 = [defX, LEGS.bottom, defZ];
  const l1: V3 = [defX, LEGS.top, defZ];
  const rr = r + LEGS.radius;
  return distSegmentSegmentSq(a, b, l0, l1) <= rr * rr;
}
