import type { AttackState } from '../combat/Fighter';
import type { V3 } from '../math';
import { clamp, lerp, smoothstep } from '../math';

/**
 * Procedural pose description, authored for an ORTHODOX stance (left foot
 * forward). Coordinates are metres in the fighter frame [side(+left), up,
 * forward(+towards opponent)]. Angles are degrees.
 *
 * These are hand-authored Taekwondo key poses solved onto the CC0 rig with
 * analytic IK. See docs/ASSET_MANIFEST.md (animation provenance).
 */
export interface LegPose {
  /** Ankle target. */
  p: V3;
  /** Knee direction hint. */
  pole: V3;
  /** 0 = foot flat on the floor with `yaw`, 1 = foot follows the shin, toes pointed. */
  point: number;
  /** Foot yaw when flat (deg, + = turned left). */
  yaw: number;
}
export interface ArmPose {
  /** Wrist target. Chest frame when world = 0; fighter frame when world = 1. */
  p: V3;
  /** Elbow direction hint (chest frame). */
  pole: V3;
  world: number;
}
export interface Pose {
  hips: V3;
  /** Body yaw relative to facing (deg, + = counter-clockwise from above). */
  yaw: number;
  /** Forward lean (deg). */
  pitch: number;
  /** Sideways lean (deg, + = towards the fighter's right). */
  roll: number;
  /** Chest twist relative to hips (deg). */
  twist: number;
  /** Extra head yaw on top of automatic look-at (deg). */
  head: number;
  /** How strongly the head keeps looking at the opponent (0..1). */
  look: number;
  lLeg: LegPose;
  rLeg: LegPose;
  lArm: ArmPose;
  rArm: ArmPose;
}

export const ANKLE_H = 0.104;

const v = (x: number, y: number, z: number): V3 => [x, y, z];
const dirYaw = (deg: number, up = 0): V3 => [Math.sin((deg * Math.PI) / 180), up, Math.cos((deg * Math.PI) / 180)];

export const STANCE: Pose = {
  hips: v(0, 0.865, -0.02),
  yaw: -42,
  pitch: 5,
  roll: 0,
  twist: 8,
  head: 0,
  look: 0.9,
  lLeg: { p: v(0.05, ANKLE_H, 0.31), pole: dirYaw(-10), point: 0, yaw: -12 },
  rLeg: { p: v(-0.17, ANKLE_H, -0.3), pole: dirYaw(-65), point: 0, yaw: -70 },
  lArm: { p: v(0.16, 0.1, 0.3), pole: v(0.6, -1, -0.3), world: 0 },
  rArm: { p: v(-0.07, 0.17, 0.24), pole: v(-0.6, -1, -0.4), world: 0 },
};

export const GUARD: Pose = {
  ...STANCE,
  hips: v(0, 0.84, -0.04),
  pitch: 9,
  twist: 14,
  lArm: { p: v(0.1, 0.2, 0.25), pole: v(0.4, -1, -0.1), world: 0 },
  rArm: { p: v(-0.06, 0.23, 0.21), pole: v(-0.4, -1, -0.1), world: 0 },
};

function copyPose(p: Pose): Pose {
  return {
    ...p,
    hips: [...p.hips] as V3,
    lLeg: { ...p.lLeg, p: [...p.lLeg.p] as V3, pole: [...p.lLeg.pole] as V3 },
    rLeg: { ...p.rLeg, p: [...p.rLeg.p] as V3, pole: [...p.rLeg.pole] as V3 },
    lArm: { ...p.lArm, p: [...p.lArm.p] as V3, pole: [...p.lArm.pole] as V3 },
    rArm: { ...p.rArm, p: [...p.rArm.p] as V3, pole: [...p.rArm.pole] as V3 },
  };
}

type PosePatch = {
  [K in keyof Pose]?: Pose[K] extends object ? Partial<Pose[K]> : Pose[K];
};
/** Derive a pose from a base with partial overrides. */
export function pose(base: Pose, patch: PosePatch): Pose {
  const out = copyPose(base);
  for (const k of Object.keys(patch) as (keyof Pose)[]) {
    const val = patch[k];
    if (val === undefined) continue;
    if (typeof val === 'object' && !Array.isArray(val)) Object.assign(out[k] as object, val);
    else (out as unknown as Record<string, unknown>)[k] = Array.isArray(val) ? [...val] : val;
  }
  return out;
}

const lv = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function lerpLeg(a: LegPose, b: LegPose, t: number): LegPose {
  return { p: lv(a.p, b.p, t), pole: lv(a.pole, b.pole, t), point: lerp(a.point, b.point, t), yaw: lerp(a.yaw, b.yaw, t) };
}
function lerpArm(a: ArmPose, b: ArmPose, t: number): ArmPose {
  return { p: lv(a.p, b.p, t), pole: lv(a.pole, b.pole, t), world: lerp(a.world, b.world, t) };
}
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    hips: lv(a.hips, b.hips, t),
    yaw: lerp(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
    roll: lerp(a.roll, b.roll, t),
    twist: lerp(a.twist, b.twist, t),
    head: lerp(a.head, b.head, t),
    look: lerp(a.look, b.look, t),
    lLeg: lerpLeg(a.lLeg, b.lLeg, t),
    rLeg: lerpLeg(a.rLeg, b.rLeg, t),
    lArm: lerpArm(a.lArm, b.lArm, t),
    rArm: lerpArm(a.rArm, b.rArm, t),
  };
}

/** Mirror an orthodox pose into southpaw (swap sides, negate side axis and yaws). */
export function mirrorPose(p: Pose): Pose {
  const mv = (a: V3): V3 => [-a[0], a[1], a[2]];
  const leg = (l: LegPose): LegPose => ({ p: mv(l.p), pole: mv(l.pole), point: l.point, yaw: -l.yaw });
  const arm = (a: ArmPose): ArmPose => ({ p: mv(a.p), pole: mv(a.pole), world: a.world });
  return {
    hips: mv(p.hips),
    yaw: -p.yaw,
    pitch: p.pitch,
    roll: -p.roll,
    twist: -p.twist,
    head: -p.head,
    look: p.look,
    lLeg: leg(p.rLeg),
    rLeg: leg(p.lLeg),
    lArm: arm(p.rArm),
    rArm: arm(p.lArm),
  };
}

export interface Key {
  t: number;
  pose: Pose;
  /** Easing into this key: 'smooth' (default), 'snap' (fast-in, used for strikes), 'linear'. */
  ease?: 'smooth' | 'snap' | 'linear';
}

export function sampleKeys(keys: Key[], t: number): Pose {
  if (t <= keys[0].t) return keys[0].pose;
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (t <= k.t) {
      const prev = keys[i - 1];
      let u = clamp((t - prev.t) / Math.max(1e-6, k.t - prev.t), 0, 1);
      if (k.ease === 'snap') u = 1 - (1 - u) * (1 - u) * (1 - u);
      else if (k.ease !== 'linear') u = smoothstep(u);
      return lerpPose(prev.pose, k.pose, u);
    }
  }
  return keys[keys.length - 1].pose;
}

/** Ankle target for an impact point: the striking surface sits ahead of the ankle. */
function ankleFor(impact: V3, back: number, drop = 0): V3 {
  return [impact[0], impact[1] - drop, impact[2] - back];
}

/**
 * Build the keyframes for a technique. Key times are placed relative to the
 * attack's actual startup/active/recovery ticks, so the visual extension is
 * synchronized with the active hit window.
 */
export function attackKeys(atk: AttackState): Key[] {
  const S = atk.startup;
  const A = atk.move.active;
  const T = atk.total;
  const R = T - S - A;
  const s = (f: number) => S * f;
  const a = (f: number) => S + A * f;
  const r = (f: number) => S + A + R * f;
  const head = atk.height === 'head';
  const imp = atk.impact;

  switch (atk.move.id) {
    case 'punch': {
      const extend = pose(STANCE, {
        yaw: -8,
        twist: 18,
        pitch: 9,
        hips: v(0, 0.86, 0.06),
        rLeg: { yaw: -40, pole: dirYaw(-30) },
        rArm: { p: [imp[0], imp[1], imp[2] - 0.04], pole: v(-0.3, -1, -0.6), world: 1 },
        lArm: { p: v(0.06, 0.2, 0.2), pole: v(0.6, -1, -0.2) },
      });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.5), pose: pose(STANCE, { yaw: -48, rArm: { p: v(-0.1, 0.12, 0.16) } }) },
        { t: a(0.4), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        { t: r(0.6), pose: STANCE },
        { t: T, pose: STANCE },
      ];
    }
    case 'front': {
      const chamber = pose(STANCE, {
        hips: v(0, 0.89, 0.04),
        yaw: -18,
        pitch: -4,
        twist: 6,
        lLeg: { yaw: -30, pole: dirYaw(-20) },
        rLeg: { p: v(-0.08, head ? 0.74 : 0.62, 0.26), pole: v(0, 0.5, 1), point: 0.7, yaw: -10 },
        rArm: { p: v(-0.16, 0.1, 0.14) },
      });
      const extend = pose(chamber, {
        hips: v(0, 0.91, 0.1),
        pitch: head ? -16 : -11,
        rLeg: { p: ankleFor(imp, 0.11, 0.02), pole: v(0, 1, 0.3), point: 0.95 },
        rArm: { p: v(-0.22, 0.02, 0.0), pole: v(-0.8, -1, 0) },
      });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.65), pose: chamber },
        { t: a(0.5), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        { t: r(0.35), pose: chamber },
        { t: r(0.8), pose: STANCE },
        { t: T, pose: STANCE },
      ];
    }
    case 'round': {
      const chamber = pose(STANCE, {
        hips: v(0, 0.9, 0.04),
        yaw: 20,
        pitch: -2,
        roll: -8,
        twist: -10,
        lLeg: { yaw: 55, pole: dirYaw(45) },
        rLeg: { p: v(-0.4, head ? 1.08 : 0.92, 0.22), pole: v(0.0, 0.3, 1), point: 0.8, yaw: 0 },
        rArm: { p: v(-0.2, 0.06, 0.1) },
      });
      const extend = pose(chamber, {
        hips: v(0.04, 0.92, 0.1),
        yaw: 78,
        pitch: head ? -14 : -8,
        roll: head ? -30 : -24,
        twist: -24,
        head: 0,
        lLeg: { yaw: 105, pole: dirYaw(95) },
        rLeg: { p: ankleFor(imp, 0.1, 0.0), pole: v(0.7, 0.7, 0), point: 1 },
        lArm: { p: v(0.18, 0.12, 0.26) },
        rArm: { p: v(-0.3, -0.05, -0.1), pole: v(-1, -0.5, 0) },
      });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.7), pose: chamber },
        { t: a(0.5), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        { t: r(0.35), pose: pose(chamber, { yaw: 40 }) },
        { t: r(0.85), pose: STANCE },
        { t: T, pose: STANCE },
      ];
    }
    case 'side': {
      const pivot = pose(STANCE, {
        yaw: 30,
        hips: v(0, 0.87, 0.0),
        lLeg: { yaw: 70, pole: dirYaw(60) },
        rLeg: { p: v(-0.1, 0.3, -0.05), pole: v(0, 0.6, 1), point: 0.3 },
      });
      const chamber = pose(STANCE, {
        hips: v(0.02, 0.89, 0.0),
        yaw: 72,
        pitch: 0,
        roll: -12,
        twist: -18,
        lLeg: { yaw: 120, pole: dirYaw(110) },
        rLeg: { p: v(-0.02, head ? 0.92 : 0.8, 0.08), pole: v(0.6, 0.6, 0.6), point: 0.25, yaw: 90 },
        lArm: { p: v(0.18, 0.12, 0.26) },
        rArm: { p: v(-0.04, 0.2, 0.2) },
      });
      const extend = pose(chamber, {
        hips: v(0.1, 0.9, 0.12),
        yaw: 88,
        roll: head ? -42 : -34,
        lLeg: { p: v(0.08, ANKLE_H, 0.22), yaw: 150, pole: dirYaw(130) },
        rLeg: { p: ankleFor(imp, 0.04, 0.03), pole: v(1, 0.15, 0), point: 0.25 },
        rArm: { p: v(-0.1, -0.12, 0.05), pole: v(-1, -0.5, 0) },
      });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.35), pose: pivot },
        { t: s(0.8), pose: chamber },
        { t: a(0.6), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        { t: r(0.35), pose: chamber },
        { t: r(0.85), pose: STANCE },
        { t: T, pose: STANCE },
      ];
    }
    case 'back': {
      // Spin clockwise (seen from above), kick straight back, finish the turn.
      const turn = pose(STANCE, {
        yaw: -120,
        hips: v(0, 0.87, 0.0),
        look: 0.6,
        lLeg: { yaw: -150, pole: dirYaw(-150) },
        rLeg: { p: v(-0.08, 0.2, -0.12), pole: v(0, 0.5, -1), point: 0.3 },
      });
      const chamber = pose(STANCE, {
        yaw: -178,
        pitch: 18,
        hips: v(0, 0.88, 0.02),
        look: 0.75,
        lLeg: { p: v(0.02, ANKLE_H, 0.2), yaw: -185, pole: dirYaw(-185) },
        rLeg: { p: v(-0.02, 0.6, 0.02), pole: v(0, 0.3, -1), point: 0.2, yaw: 180 },
        lArm: { p: v(0.16, 0.14, 0.24) },
        rArm: { p: v(-0.16, 0.1, 0.2) },
      });
      const extend = pose(chamber, {
        pitch: 34,
        hips: v(0, 0.9, 0.06),
        rLeg: { p: ankleFor(imp, 0.02, -0.06), pole: v(0, -1, -0.4), point: 0.05 },
      });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.4), pose: turn },
        { t: s(0.85), pose: chamber },
        { t: a(0.6), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        { t: r(0.35), pose: pose(chamber, { yaw: -230, pitch: 8 }) },
        { t: r(0.85), pose: pose(STANCE, { yaw: -400 }) },
        { t: T, pose: pose(STANCE, { yaw: -402 }) },
      ];
    }
  }
}
