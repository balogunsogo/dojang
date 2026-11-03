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

export type AttackOutcome = 'pending' | 'hit' | 'blocked' | 'whiff';

/** Deterministic small jitter so repeated techniques never look identical. */
function jitter(seed: number) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return (amp: number) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (((x >>> 0) / 4294967296) * 2 - 1) * amp;
  };
}

/** Landing settle: weight drops into the stance, then recovers. */
const settle = (yaw = STANCE.yaw) => pose(STANCE, { yaw, hips: v(0, 0.835, -0.02), pitch: 7 });

/**
 * Build the keyframes for a technique. Key times are placed relative to the
 * attack's actual startup/active/recovery ticks, so the visual extension is
 * synchronized with the active hit window. Only the recovery shape depends on
 * the outcome (landed, blocked, missed); timing never changes.
 *
 * Phases: anticipation (weight onto the support leg, heel lifts) → chamber →
 * snap extension → outcome-specific retraction → landing settle → stance.
 */
export function attackKeys(atk: AttackState, outcome: AttackOutcome = 'pending', seed = 0): Key[] {
  const S = atk.startup;
  const A = atk.move.active;
  const T = atk.total;
  const R = T - S - A;
  const s = (f: number) => S * f;
  const a = (f: number) => S + A * f;
  const r = (f: number) => S + A + R * f;
  const head = atk.height === 'head';
  const imp = atk.impact;
  const j = jitter(seed + 1);

  // Anticipation: shift weight onto the lead (support) leg, rear heel rises.
  const load = pose(STANCE, {
    hips: v(0.035, 0.85, 0.0),
    yaw: STANCE.yaw + 4,
    pitch: STANCE.pitch + 2,
    rLeg: { p: v(-0.16, ANKLE_H + 0.035, -0.28), point: 0.45 },
  });

  // Lead-leg anticipation: weight back onto the rear leg, lead heel rises.
  const loadRear = pose(STANCE, {
    hips: v(-0.05, 0.85, -0.07),
    yaw: STANCE.yaw - 4,
    pitch: STANCE.pitch - 1,
    lLeg: { p: v(0.05, ANKLE_H + 0.03, 0.29), point: 0.45 },
  });

  /** Shared recovery builder: crisp retract after a hit, rebound after a block, follow-through after a whiff. */
  const recover = (chamber: Pose, extend: Pose, follow: Pose, endYaw = STANCE.yaw): Key[] => {
    const end = pose(STANCE, { yaw: endYaw });
    switch (outcome) {
      case 'blocked':
        return [
          { t: r(0.14), pose: pose(chamber, { hips: [chamber.hips[0], chamber.hips[1], chamber.hips[2] - 0.07], pitch: chamber.pitch - 8 }), ease: 'snap' },
          { t: r(0.58), pose: settle(endYaw) },
          { t: T, pose: end },
        ];
      case 'whiff':
        return [
          { t: r(0.3), pose: follow },
          { t: r(0.62), pose: pose(chamber, { pitch: chamber.pitch + 4 }) },
          { t: r(0.88), pose: settle(endYaw) },
          { t: T, pose: end },
        ];
      default:
        return [
          { t: r(0.1), pose: extend },
          { t: r(0.36), pose: chamber },
          { t: r(0.72), pose: settle(endYaw) },
          { t: T, pose: end },
        ];
    }
  };

  switch (atk.move.id) {
    case 'punch': {
      const extend = pose(STANCE, {
        yaw: -8,
        twist: 18,
        pitch: 9,
        hips: v(0, 0.86, 0.06),
        rLeg: { yaw: -40, pole: dirYaw(-30), point: 0.3 },
        rArm: { p: [imp[0], imp[1], imp[2] - 0.04], pole: v(-0.3, -1, -0.6), world: 1 },
        lArm: { p: v(0.06, 0.2, 0.2), pole: v(0.6, -1, -0.2) },
      });
      const cock = pose(STANCE, { yaw: -50, hips: v(0.02, 0.855, -0.03), rArm: { p: v(-0.1, 0.12, 0.14) } });
      const over = pose(extend, { pitch: 16, hips: v(0, 0.85, 0.12), twist: 24 });
      const back: Key[] =
        outcome === 'whiff'
          ? [{ t: r(0.3), pose: over }, { t: r(0.75), pose: settle() }, { t: T, pose: STANCE }]
          : [{ t: r(0.45), pose: pose(STANCE, { twist: 12 }) }, { t: T, pose: STANCE }];
      return [{ t: 0, pose: STANCE }, { t: s(0.5), pose: cock }, { t: a(0.4), pose: extend, ease: 'snap' }, { t: a(1), pose: extend }, ...back];
    }
    case 'front': {
      const chamber = pose(STANCE, {
        hips: v(0, 0.89 + j(0.01), 0.04),
        yaw: -18 + j(5),
        pitch: -4 + j(2),
        twist: 6,
        lLeg: { yaw: -30, pole: dirYaw(-20), point: 0.15 },
        // Knee drives straight up toward the target; the foot tucks under it.
        rLeg: { p: v(-0.07, (head ? 0.78 : 0.66) + j(0.03), 0.2), pole: v(0, 0.65, 1), point: 0.75, yaw: -10 },
        rArm: { p: v(-0.16 + j(0.02), 0.1, 0.14) },
      });
      const extend = pose(chamber, {
        hips: v(0, 0.91, 0.1),
        pitch: head ? -16 : -11,
        lLeg: { point: 0.3 },
        rLeg: { p: ankleFor(imp, 0.11, 0.02), pole: v(0, 1, 0.3), point: 0.95 },
        rArm: { p: v(-0.22, 0.02, 0.0), pole: v(-0.8, -1, 0) },
      });
      // Missed: the leg drops forward and the body is carried over the lead foot.
      const follow = pose(extend, { pitch: 2, hips: v(0, 0.88, 0.16), rLeg: { p: v(-0.06, 0.5, imp[2] - 0.1), pole: v(0, 0.4, 1), point: 0.6 } });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.28), pose: load },
        { t: s(0.68), pose: chamber },
        { t: a(0.5), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        ...recover(chamber, extend, follow),
      ];
    }
    case 'round': {
      const chamber = pose(STANCE, {
        hips: v(0, 0.9 + j(0.01), 0.04),
        yaw: 20 + j(6),
        pitch: -2 + j(2),
        roll: -8 + j(3),
        twist: -10,
        lLeg: { yaw: 55, pole: dirYaw(45), point: 0.2 },
        rLeg: { p: v(-0.4, (head ? 1.08 : 0.92) + j(0.03), 0.22), pole: v(0.0, 0.3, 1), point: 0.8, yaw: 0 },
        rArm: { p: v(-0.2, 0.06, 0.1) },
      });
      const extend = pose(chamber, {
        hips: v(0.04, 0.92, 0.1),
        yaw: 78,
        pitch: head ? -14 : -8,
        roll: head ? -30 : -24,
        twist: -24,
        head: 0,
        lLeg: { yaw: 105, pole: dirYaw(95), point: 0.35 },
        rLeg: { p: ankleFor(imp, 0.1, 0.0), pole: v(0.7, 0.7, 0), point: 1 },
        lArm: { p: v(0.18, 0.12, 0.26) },
        rArm: { p: v(-0.3, -0.05, -0.1), pole: v(-1, -0.5, 0) },
      });
      // Knee rises in front first (still square), then turns over on the pivot.
      const knee = pose(STANCE, {
        hips: v(0.015, 0.885, 0.03),
        yaw: -12 + j(4),
        pitch: 0,
        twist: 0,
        lLeg: { yaw: 18, pole: dirYaw(12), point: 0.25 },
        rLeg: { p: v(-0.14, (head ? 0.74 : 0.66) + j(0.02), 0.2), pole: v(0, 0.45, 1), point: 0.65, yaw: -12 },
        rArm: { p: v(-0.16, 0.1, 0.14) },
      });
      // Missed: the kick sweeps on across the body and the hips over-rotate.
      const follow = pose(extend, {
        yaw: 118,
        roll: -14,
        twist: -30,
        lLeg: { yaw: 140, pole: dirYaw(130) },
        rLeg: { p: v(0.3, imp[1] - 0.25, imp[2] - 0.3), pole: v(0.6, 0.8, 0), point: 0.9 },
      });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.22), pose: load },
        { t: s(0.5), pose: knee },
        { t: s(0.8), pose: chamber },
        { t: a(0.5), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        ...recover(pose(chamber, { yaw: 40 }), extend, follow),
      ];
    }
    case 'side': {
      const pivot = pose(STANCE, {
        yaw: 30,
        hips: v(0.02, 0.86, 0.0),
        lLeg: { yaw: 70, pole: dirYaw(60), point: 0.2 },
        rLeg: { p: v(-0.1, 0.3, -0.05), pole: v(0, 0.6, 1), point: 0.3 },
      });
      const chamber = pose(STANCE, {
        hips: v(0.02, 0.89 + j(0.01), 0.0),
        yaw: 72 + j(4),
        pitch: 0,
        roll: -12 + j(3),
        twist: -18,
        lLeg: { yaw: 120, pole: dirYaw(110), point: 0.15 },
        // Knee pulled across the chest, foot blade and heel aimed at the target.
        rLeg: { p: v(0.01, (head ? 0.95 : 0.84) + j(0.03), 0.04), pole: v(0.7, 0.55, 0.45), point: 0.2, yaw: 90 },
        lArm: { p: v(0.18, 0.12, 0.26) },
        rArm: { p: v(-0.04, 0.2, 0.2) },
      });
      const extend = pose(chamber, {
        hips: v(0.1, 0.9, 0.12),
        yaw: 88,
        roll: head ? -42 : -34,
        lLeg: { p: v(0.08, ANKLE_H, 0.22), yaw: 150, pole: dirYaw(130), point: 0.25 },
        rLeg: { p: ankleFor(imp, 0.04, 0.03), pole: v(1, 0.15, 0), point: 0.25 },
        rArm: { p: v(-0.1, -0.12, 0.05), pole: v(-1, -0.5, 0) },
      });
      // Missed: over-commits forward, support leg hops after the kick.
      const follow = pose(extend, { hips: v(0.12, 0.88, 0.2), roll: -26, rLeg: { p: v(-0.02, imp[1] - 0.3, imp[2] - 0.15) } });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.35), pose: pivot },
        { t: s(0.8), pose: chamber },
        { t: a(0.6), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        ...recover(chamber, extend, follow),
      ];
    }
    // ---- Lead-leg techniques (front/left leg in orthodox) -------------------
    // Weight loads back onto the rear leg, the rear foot pivots, and the body
    // turns the opposite way to the rear-leg versions (clockwise from above),
    // so the lead hip, not the rear hip, drives the kick. Shorter hip drive
    // and a quicker re-plant of the lead foot.
    case 'leadFront': {
      const chamber = pose(STANCE, {
        hips: v(-0.03 + j(0.01), 0.88, -0.05),
        yaw: -32 + j(4),
        pitch: -5 + j(2),
        rLeg: { yaw: -62, pole: dirYaw(-52), point: 0.15 },
        lLeg: { p: v(0.06, (head ? 0.7 : 0.58) + j(0.03), 0.34), pole: v(0, 0.5, 1), point: 0.7, yaw: -10 },
        lArm: { p: v(0.18, 0.08, 0.2) },
      });
      const extend = pose(chamber, {
        hips: v(-0.02, 0.9, 0.0),
        pitch: head ? -15 : -10,
        rLeg: { point: 0.3 },
        lLeg: { p: ankleFor(imp, 0.11, 0.02), pole: v(0, 1, 0.3), point: 0.95 },
        lArm: { p: v(0.22, 0.0, 0.02), pole: v(0.8, -1, 0) },
      });
      const follow = pose(extend, { pitch: 2, hips: v(0, 0.87, 0.08), lLeg: { p: v(0.06, 0.5, imp[2] - 0.05), pole: v(0, 0.4, 1), point: 0.6 } });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.3), pose: loadRear },
        { t: s(0.7), pose: chamber },
        { t: a(0.5), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        ...recover(chamber, extend, follow),
      ];
    }
    case 'leadRound': {
      const chamber = pose(STANCE, {
        hips: v(-0.04, 0.9 + j(0.01), -0.03),
        yaw: -78 + j(5),
        pitch: -2 + j(2),
        roll: 8 + j(3),
        twist: 10,
        rLeg: { yaw: -115, pole: dirYaw(-105), point: 0.2 },
        lLeg: { p: v(0.32, (head ? 1.03 : 0.89) + j(0.03), 0.3), pole: v(0, 0.3, 1), point: 0.8, yaw: 0 },
        lArm: { p: v(0.2, 0.06, 0.12) },
      });
      const extend = pose(chamber, {
        hips: v(-0.06, 0.92, 0.02),
        yaw: -100,
        pitch: head ? -12 : -7,
        roll: head ? 28 : 22,
        twist: 18,
        rLeg: { yaw: -140, pole: dirYaw(-130), point: 0.35 },
        lLeg: { p: ankleFor(imp, 0.1, 0.0), pole: v(-0.7, 0.7, 0), point: 1 },
        rArm: { p: v(-0.18, 0.12, 0.26) },
        lArm: { p: v(0.3, -0.05, -0.1), pole: v(1, -0.5, 0) },
      });
      const follow = pose(extend, {
        yaw: -132,
        roll: 12,
        twist: 24,
        rLeg: { yaw: -165, pole: dirYaw(-150) },
        lLeg: { p: v(-0.28, imp[1] - 0.25, imp[2] - 0.3), pole: v(-0.6, 0.8, 0), point: 0.9 },
      });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.28), pose: loadRear },
        { t: s(0.72), pose: chamber },
        { t: a(0.5), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        ...recover(pose(chamber, { yaw: -60 }), extend, follow),
      ];
    }
    case 'leadSide': {
      const pivot = pose(STANCE, {
        yaw: -64,
        hips: v(-0.04, 0.86, -0.04),
        rLeg: { yaw: -110, pole: dirYaw(-100), point: 0.2 },
        lLeg: { p: v(0.06, 0.26, 0.3), pole: v(0, 0.6, 1), point: 0.3 },
      });
      const chamber = pose(STANCE, {
        hips: v(-0.04, 0.89 + j(0.01), -0.04),
        yaw: -86 + j(4),
        roll: 10 + j(3),
        twist: 14,
        rLeg: { yaw: -140, pole: dirYaw(-130), point: 0.15 },
        lLeg: { p: v(0.04, (head ? 0.92 : 0.82) + j(0.03), 0.18), pole: v(-0.6, 0.6, 0.6), point: 0.25, yaw: -90 },
        rArm: { p: v(-0.16, 0.12, 0.26) },
      });
      const extend = pose(chamber, {
        hips: v(-0.1, 0.9, -0.02),
        yaw: -90,
        roll: head ? 40 : 32,
        rLeg: { p: v(-0.1, ANKLE_H, -0.28), yaw: -160, pole: dirYaw(-140), point: 0.25 },
        lLeg: { p: ankleFor(imp, 0.04, 0.03), pole: v(-1, 0.15, 0), point: 0.25 },
        lArm: { p: v(0.1, -0.12, 0.05), pole: v(1, -0.5, 0) },
      });
      const follow = pose(extend, { hips: v(-0.08, 0.88, 0.06), roll: 24, lLeg: { p: v(0.02, imp[1] - 0.3, imp[2] - 0.15) } });
      return [
        { t: 0, pose: STANCE },
        { t: s(0.32), pose: pivot },
        { t: s(0.78), pose: chamber },
        { t: a(0.6), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        ...recover(chamber, extend, follow),
      ];
    }
    case 'back': {
      // Spin clockwise (seen from above), kick straight back, finish the turn.
      const turn = pose(STANCE, {
        yaw: -120,
        // Shoulders and head lead the hips through the turn.
        twist: -22,
        hips: v(0, 0.86, 0.0),
        look: 0.68,
        lLeg: { yaw: -150, pole: dirYaw(-150), point: 0.25 },
        rLeg: { p: v(-0.08, 0.2, -0.12), pole: v(0, 0.5, -1), point: 0.3 },
      });
      const chamber = pose(STANCE, {
        yaw: -178 + j(4),
        pitch: 18 + j(3),
        hips: v(0, 0.88, 0.02),
        look: 0.75,
        lLeg: { p: v(0.02, ANKLE_H, 0.2), yaw: -185, pole: dirYaw(-185), point: 0.15 },
        rLeg: { p: v(-0.02, 0.6 + j(0.03), 0.02), pole: v(0, 0.3, -1), point: 0.2, yaw: 180 },
        lArm: { p: v(0.16, 0.14, 0.24) },
        rArm: { p: v(-0.16, 0.1, 0.2) },
      });
      const extend = pose(chamber, {
        pitch: 34,
        hips: v(0, 0.9, 0.06),
        rLeg: { p: ankleFor(imp, 0.02, -0.06), pole: v(0, -1, -0.4), point: 0.05 },
      });
      const rechamber = pose(chamber, { yaw: -230, pitch: 8 });
      const follow = pose(extend, { yaw: -205, pitch: 26, hips: v(0, 0.88, 0.12) });
      // The spin always completes; the recovery ends a full turn later (-360°).
      return [
        { t: 0, pose: STANCE },
        { t: s(0.18), pose: pose(load, { yaw: STANCE.yaw - 10 }) },
        { t: s(0.45), pose: turn },
        { t: s(0.85), pose: chamber },
        { t: a(0.6), pose: extend, ease: 'snap' },
        { t: a(1), pose: extend },
        ...recover(rechamber, extend, follow, STANCE.yaw - 360),
      ];
    }
  }
}

/**
 * Impulse envelope for reactions: fast rise (about 3 ticks), then an eased
 * decay over the stun. Returns 0..1.
 */
export function reactionEnvelope(t: number, stun: number): number {
  const rise = 3;
  if (t <= 0) return 0;
  if (t < rise) return smoothstep(t / rise);
  const k = clamp((t - rise) / Math.max(1, stun - rise), 0, 1);
  // Late in the recovery the body rocks slightly past neutral and settles:
  // a small balance correction instead of a flat return (0 at k = 0.6 and 1).
  const correct = k > 0.6 ? 0.16 * Math.sin((Math.PI * (k - 0.6)) / 0.4) : 0;
  return 1 - smoothstep(k) - correct;
}

export interface ReactionInfo {
  zone: 'body' | 'head';
  heavy: boolean;
  /** +1 from the defender's left, -1 from the right, 0 straight on. */
  side: number;
}

/**
 * Procedural hit reaction layered on the fighting stance (orthodox frame):
 * body shots fold the trunk and drive the hips back; head shots snap the head
 * and torso away from the strike. The guard is disturbed but kept, so the
 * fighter reads as a fighter rather than a ragdoll.
 */
export function hitPose(base: Pose, r: ReactionInfo, e: number): Pose {
  const k = e * (r.heavy ? 1.45 : 1);
  const sd = r.side;
  if (r.zone === 'body') {
    return pose(base, {
      hips: v(base.hips[0] - sd * 0.03 * k, base.hips[1] - 0.05 * k, base.hips[2] - 0.09 * k),
      pitch: base.pitch + 20 * k,
      roll: base.roll + sd * 6 * k,
      twist: base.twist - sd * 10 * k,
      head: base.head + sd * 8 * k,
      lArm: { p: v(base.lArm.p[0] - 0.04 * k, base.lArm.p[1] - 0.12 * k, base.lArm.p[2] - 0.08 * k) },
      rArm: { p: v(base.rArm.p[0] + 0.04 * k, base.rArm.p[1] - 0.1 * k, base.rArm.p[2] - 0.06 * k) },
    });
  }
  return pose(base, {
    hips: v(base.hips[0] - sd * 0.04 * k, base.hips[1] - 0.03 * k, base.hips[2] - 0.07 * k),
    pitch: base.pitch - 16 * k,
    roll: base.roll + sd * 10 * k,
    twist: base.twist - sd * 18 * k,
    head: base.head - sd * 28 * k,
    look: base.look * (1 - 0.6 * k),
    lArm: { p: v(base.lArm.p[0] + 0.05 * k, base.lArm.p[1] + 0.06 * k, base.lArm.p[2] - 0.1 * k) },
    rArm: { p: v(base.rArm.p[0] - 0.05 * k, base.rArm.p[1] + 0.05 * k, base.rArm.p[2] - 0.1 * k) },
  });
}

/** Blocked strike: forearms driven back into the guard, torso absorbs it. */
export function blockPose(base: Pose, r: ReactionInfo | null, e: number): Pose {
  const sd = r?.side ?? 0;
  return pose(base, {
    hips: v(base.hips[0], base.hips[1] - 0.025 * e, base.hips[2] - 0.06 * e),
    pitch: base.pitch - 9 * e,
    twist: base.twist - sd * 9 * e,
    lArm: { p: v(base.lArm.p[0] - 0.02 * e, base.lArm.p[1] + 0.02 * e, base.lArm.p[2] - 0.07 * e) },
    rArm: { p: v(base.rArm.p[0] + 0.02 * e, base.rArm.p[1] + 0.02 * e, base.rArm.p[2] - 0.06 * e) },
  });
}
