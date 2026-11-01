export interface Vec2 {
  x: number;
  z: number;
}
export type V3 = [number, number, number];

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => t * t * (3 - 2 * t);
export const len2 = (x: number, z: number) => Math.hypot(x, z);
export const DEG = Math.PI / 180;

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Move angle `a` towards `b` by at most `maxStep` radians (shortest path). */
export function approachAngle(a: number, b: number, maxStep: number): number {
  const d = wrapAngle(b - a);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

/** Yaw (around +Y) of a world direction, with yaw 0 facing +Z. */
export const yawOf = (x: number, z: number) => Math.atan2(x, z);

/**
 * Convert a point in a fighter's local frame [side(+left), up, forward] to world
 * coordinates, given the fighter's ground position and yaw.
 */
export function localToWorld(px: number, pz: number, yaw: number, p: V3): V3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // R_y(yaw) * (x, y, z) with x = side, z = forward
  return [px + p[0] * c + p[2] * s, p[1], pz - p[0] * s + p[2] * c];
}

/** Squared distance from point p to segment ab (3D). */
export function distPointSegmentSq(p: V3, a: V3, b: V3): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const apz = p[2] - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  const t = ab2 > 1e-12 ? clamp((apx * abx + apy * aby + apz * abz) / ab2, 0, 1) : 0;
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

/** Squared distance between segments p1q1 and p2q2 (3D). Ericson, RTCD 5.1.9. */
export function distSegmentSegmentSq(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]];
  const d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
  const r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  let s: number;
  let t: number;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const cx = p1[0] + d1[0] * s - (p2[0] + d2[0] * t);
  const cy = p1[1] + d1[1] * s - (p2[1] + d2[1] * t);
  const cz = p1[2] + d1[2] * s - (p2[2] + d2[2] * t);
  return cx * cx + cy * cy + cz * cz;
}

/** Small deterministic PRNG (mulberry32) for AI decisions and drills. */
export function createRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = ReturnType<typeof createRng>;
