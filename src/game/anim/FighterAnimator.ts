import * as THREE from 'three';
import type { Fighter } from '../combat/Fighter';
import { clamp, DEG, lerp, smoothstep } from '../math';
import { FootPlanner, type FootTarget } from './FootPlanner';
import {
  ANKLE_H,
  type AttackOutcome,
  attackKeys,
  blockPose,
  GUARD,
  hitPose,
  lerpPose,
  mirrorPose,
  type Pose,
  pose as derive,
  reactionEnvelope,
  sampleKeys,
  STANCE,
} from './poses';
import { BONE, findBone, rotateWorld, setWorldPos, setWorldQuat, TwoBoneIK } from './rig';

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const POINT_ANGLE = 58 * DEG;
const TICK = 1 / 60;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _bodyQ = new THREE.Quaternion();
const _chestQ = new THREE.Quaternion();
const _groupQ = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _w = new THREE.Vector3();

type Source =
  | { kind: 'pose'; key: string; pose: Pose; planted: boolean }
  | { kind: 'clip'; key: string; clip: string; time: number; loop: boolean };

/** Smooth, non-repeating noise in about [-1, 1] (sum of incommensurate sines). */
const noise = (t: number, seed: number) =>
  Math.sin(t * 1.13 + seed) * 0.5 + Math.sin(t * 0.61 + seed * 2.3) * 0.32 + Math.sin(t * 2.07 + seed * 0.7) * 0.18;

/**
 * Drives one fighter's skeleton from simulation state.
 *
 * Layers (all presentation only; the simulation never reads them):
 *  1. Base pose from state: stance/guard footwork, technique keyframes timed
 *     to frame data, or procedural hit/block reactions. CC0 clips are used
 *     for the knockdown and the victory idle.
 *  2. Life: breathing, slow weight shifts, guard drift and a TKD bounce whose
 *     rhythm and amplitude wander, with a per-fighter seed.
 *  3. Foot planting: feet stay put and take discrete steps (FootPlanner).
 *  4. Analytic IK solve, fists, head look-at.
 *  5. Time-based cross-fade from a snapshot when the source changes.
 */
export class FighterAnimator {
  readonly group: THREE.Group;
  private readonly bones: THREE.Bone[] = [];
  private readonly rest = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly restPos = new Map<THREE.Bone, THREE.Vector3>();
  private readonly b: Record<keyof typeof BONE, THREE.Bone>;
  private readonly ikLegL: TwoBoneIK;
  private readonly ikLegR: TwoBoneIK;
  private readonly ikArmL: TwoBoneIK;
  private readonly ikArmR: TwoBoneIK;
  private readonly restHipsModelQ = new THREE.Quaternion();
  private readonly restFootModelQ = new THREE.Quaternion();
  private readonly restFootLocalL = new THREE.Quaternion();
  private readonly restFootLocalR = new THREE.Quaternion();
  private readonly fingers: { bone: THREE.Bone; fist: THREE.Quaternion }[] = [];
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private activeClip: string | null = null;

  private sourceKey = '';
  private fadeT = 1;
  private fadeLen = 0.1;
  private first = true;
  private readonly snapQ: THREE.Quaternion[] = [];
  private readonly snapHips = new THREE.Vector3();

  private readonly planner = new FootPlanner();
  private readonly seed: number;
  private time = 0;
  /** Smoothed guard weight (0 = open stance, 1 = high guard). */
  private guardW = 0;
  /** Smoothed local velocity (forward, side) for leaning into motion. */
  private velF = 0;
  private velS = 0;
  private accF = 0;
  private accS = 0;
  /** Smoothed bounce amplitude (wanders between lively and settled). */
  private bounceAmp = 0.018;

  /** Debug: force a pose (pose lab). */
  overridePose: Pose | null = null;

  constructor(group: THREE.Group, model: THREE.Object3D, clips: THREE.AnimationClip[], seed = 1) {
    this.group = group;
    this.seed = seed * 12.9898;
    const b = {} as Record<keyof typeof BONE, THREE.Bone>;
    for (const k of Object.keys(BONE) as (keyof typeof BONE)[]) b[k] = findBone(model, BONE[k]);
    this.b = b;
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const bone = o as THREE.Bone;
        this.bones.push(bone);
        this.rest.set(bone, bone.quaternion.clone());
        this.restPos.set(bone, bone.position.clone());
        this.snapQ.push(new THREE.Quaternion());
      }
    });
    group.updateMatrixWorld(true);
    // Bind-pose orientations relative to the fighter group.
    group.getWorldQuaternion(_groupQ).invert();
    b.hips.getWorldQuaternion(this.restHipsModelQ).premultiply(_groupQ);
    b.footL.getWorldQuaternion(this.restFootModelQ).premultiply(_groupQ);
    this.restFootLocalL.copy(b.footL.quaternion);
    this.restFootLocalR.copy(b.footR.quaternion);

    this.ikLegL = new TwoBoneIK(b.thighL, b.shinL, b.footL);
    this.ikLegR = new TwoBoneIK(b.thighR, b.shinR, b.footR);
    this.ikArmL = new TwoBoneIK(b.upperArmL, b.forearmL, b.handL);
    this.ikArmR = new TwoBoneIK(b.upperArmR, b.forearmR, b.handR);

    // Closed fists: curl every finger segment about its hinge (local X).
    for (const bone of this.bones) {
      const m = /DEF-(f_\w+|thumb)0([123])[LR]/.exec(bone.name);
      if (!m) continue;
      const thumb = m[1] === 'thumb';
      const seg = Number(m[2]);
      const ang = thumb ? (seg === 1 ? 0.25 : 0.55) : seg === 1 ? 1.35 : 1.45;
      this.fingers.push({ bone, fist: bone.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, ang)) });
    }

    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      action.play();
      action.paused = true;
      action.enabled = false;
      this.actions.set(clip.name, action);
    }
  }

  /**
   * Update the skeleton for this render frame.
   * @param f simulation fighter
   * @param alpha interpolation fraction between sim ticks (0 during hitstop)
   * @param x,z,yaw interpolated ground transform
   * @param dt render seconds since the last update (0 freezes secondary motion)
   */
  update(f: Fighter, alpha: number, x: number, z: number, yaw: number, dt = TICK) {
    this.group.position.set(x, 0, z);
    this.group.rotation.set(0, yaw, 0);
    this.group.updateMatrixWorld(true);
    this.time += dt;

    const src: Source = this.overridePose
      ? { kind: 'pose', key: 'override', pose: this.overridePose, planted: false }
      : this.pickSource(f, alpha, dt);
    if (src.key !== this.sourceKey) {
      if (!this.first) {
        this.snapshot();
        this.fadeLen = this.fadeFor(src.key);
        this.fadeT = 0;
      }
      this.sourceKey = src.key;
    }
    this.first = false;

    if (src.kind === 'clip') {
      this.planner.deactivate();
      this.applyClip(src.clip, src.time, src.loop);
    } else {
      const p = src.planted ? this.plantFeet(src.pose, f, dt) : (this.planner.deactivate(), src.pose);
      this.applyPose(p);
    }

    if (this.fadeT < 1) {
      this.fadeT = Math.min(1, this.fadeT + dt / this.fadeLen);
      // Ease-out: most of the change happens early, so inputs feel immediate.
      const w = 1 - (1 - this.fadeT) * (1 - this.fadeT);
      this.blendFromSnapshot(w);
    }
  }

  /** Cross-fade length in seconds for a new source. */
  private fadeFor(key: string): number {
    if (key.startsWith('attack')) return 0.06;
    if (key.startsWith('hit')) return 0.05;
    if (key.startsWith('block')) return 0.05;
    if (key.startsWith('ko')) return 0.12;
    if (key.startsWith('victory')) return 0.35;
    return 0.14;
  }

  private pickSource(f: Fighter, alpha: number, dt: number): Source {
    const t = f.stateTick + alpha;
    const mirror = f.stance === 'southpaw';
    const m = (p: Pose) => (mirror ? mirrorPose(p) : p);
    this.updateMotionState(f, dt);
    switch (f.state) {
      case 'attack': {
        const atk = f.attack!;
        let outcome: AttackOutcome = 'pending';
        if (atk.blocked) outcome = 'blocked';
        else if (atk.hasHit) outcome = 'hit';
        else if (f.stateTick >= atk.startup + atk.move.active) outcome = 'whiff';
        const keys = attackKeys(atk, outcome, f.attackSerial * 31 + f.id);
        return { kind: 'pose', key: `attack-${f.attackSerial}`, pose: m(sampleKeys(keys, t)), planted: false };
      }
      case 'hitstun': {
        const r = f.hitReaction;
        const e = reactionEnvelope(t, f.stunTicks);
        const base = this.stanceLife(f, 0);
        const info = { zone: r?.zone ?? 'body', heavy: r?.heavy ?? false, side: (r?.side ?? 0) * f.mirror };
        return { kind: 'pose', key: 'hit', pose: m(hitPose(base, info, e)), planted: true };
      }
      case 'blockstun': {
        const r = f.hitReaction;
        const e = reactionEnvelope(t, f.stunTicks);
        const base = this.stanceLife(f, 1);
        const info = r ? { zone: r.zone, heavy: r.heavy, side: r.side * f.mirror } : null;
        return { kind: 'pose', key: 'block', pose: m(blockPose(base, info, e)), planted: true };
      }
      case 'ko': {
        const dur = this.actions.get('Death01')?.getClip().duration ?? 2;
        return { kind: 'clip', key: 'ko', clip: 'Death01', time: Math.min(dur - 0.01, t / 60), loop: false };
      }
      case 'victory': {
        const dur = this.actions.get('Idle_Loop')?.getClip().duration ?? 2.5;
        return { kind: 'clip', key: 'victory', clip: 'Idle_Loop', time: (t / 60) % dur, loop: true };
      }
      case 'switch': {
        // Jump-switch: blend between the two mirrored stances with a hop.
        const k = smoothstep(clamp(t / 10, 0, 1));
        const from = f.stateTick < 5 ? f.stance : f.stance === 'orthodox' ? 'southpaw' : 'orthodox';
        const a = this.stanceLife(f, this.guardW);
        const pa = from === 'southpaw' ? mirrorPose(a) : a;
        const pb = from === 'southpaw' ? a : mirrorPose(a);
        const out = lerpPose(pa, pb, k);
        const hop = Math.sin(k * Math.PI);
        out.hips[1] += hop * 0.05;
        out.lLeg.p[1] += hop * 0.07;
        out.rLeg.p[1] += hop * 0.07;
        return { kind: 'pose', key: 'loco', pose: out, planted: false };
      }
      case 'dash': {
        const out = this.stanceLife(f, this.guardW);
        // Slide-step: lean into the burst, stay low, feet glide.
        const k = 1 - clamp(t / 12, 0, 1);
        out.pitch += clamp(this.velF * 2.2, -12, 12) * k;
        out.roll += clamp(-this.velS * 2, -8, 8) * k;
        out.hips[1] -= 0.035 * k;
        out.lLeg.p[1] += 0.02 * k;
        return { kind: 'pose', key: 'loco', pose: m(out), planted: false };
      }
      default: {
        return { kind: 'pose', key: 'loco', pose: m(this.stanceLife(f, 0)), planted: true };
      }
    }
  }

  /** Track smoothed local velocity/acceleration and the guard weight. */
  private updateMotionState(f: Fighter, dt: number) {
    if (dt <= 0) return;
    const cs = Math.cos(f.yaw);
    const sn = Math.sin(f.yaw);
    const vf = f.vx * sn + f.vz * cs;
    const vs = (f.vx * cs - f.vz * sn) * f.mirror;
    const k = 1 - Math.exp(-dt * 10);
    const nf = this.velF + (vf - this.velF) * k;
    const ns = this.velS + (vs - this.velS) * k;
    const ka = 1 - Math.exp(-dt * 6);
    this.accF += ((nf - this.velF) / dt - this.accF) * ka;
    this.accS += ((ns - this.velS) / dt - this.accS) * ka;
    this.velF = nf;
    this.velS = ns;
    const gTarget = f.state === 'guard' || f.state === 'blockstun' ? 1 : 0;
    this.guardW += (gTarget - this.guardW) * (1 - Math.exp(-dt * 18));
  }

  /**
   * Fighting stance with life: guard blend, breathing, weight shifts, a
   * wandering bounce, hand drift and leaning into acceleration.
   */
  private stanceLife(f: Fighter, minGuard: number): Pose {
    const g = Math.max(this.guardW, minGuard);
    const out = lerpPose(STANCE, GUARD, g);
    const t = this.time;
    const sd = this.seed;
    const speed = Math.hypot(this.velF, this.velS);
    // Bounce: TKD fighters bounce on the balls of the feet; the rhythm and
    // depth drift so it never reads as a loop.
    const liveliness = 0.5 + 0.5 * noise(t * 0.35, sd + 4);
    const ampTarget = (g > 0.5 ? 0.007 : 0.012 + 0.012 * liveliness) * (f.stamina < 25 ? 0.6 : 1);
    this.bounceAmp += (ampTarget - this.bounceAmp) * 0.05;
    const ph = f.stepPhase * (0.92 + 0.08 * noise(t * 0.2, sd));
    const b = Math.abs(Math.sin(ph));
    out.hips[1] += b * this.bounceAmp - 0.008;
    // Heels lift slightly at the top of each bounce.
    const heel = b * clamp(this.bounceAmp * 14, 0, 0.25);
    out.lLeg.point = Math.max(out.lLeg.point, heel);
    out.rLeg.point = Math.max(out.rLeg.point, heel * 1.2);
    // Breathing (faster when tired) and slow weight shift between the feet.
    const tired = f.stamina < 30 ? 1 : 0;
    const breath = Math.sin(t * (1.6 + tired * 1.6) + sd);
    out.pitch += breath * (0.8 + tired * 1.6);
    out.hips[1] -= tired * 0.015;
    const shift = noise(t * 0.45, sd + 1);
    out.hips[0] += shift * 0.025 * (1 - g * 0.5);
    out.hips[2] += noise(t * 0.38, sd + 2) * 0.015;
    out.roll += shift * 1.5;
    out.twist += noise(t * 0.5, sd + 3) * 3;
    // Guard hands drift independently.
    out.lArm.p = [out.lArm.p[0] + noise(t * 0.9, sd + 5) * 0.012, out.lArm.p[1] + noise(t * 0.7, sd + 6) * 0.018, out.lArm.p[2] + noise(t * 1.1, sd + 7) * 0.015];
    out.rArm.p = [out.rArm.p[0] + noise(t * 0.8, sd + 8) * 0.01, out.rArm.p[1] + noise(t * 0.75, sd + 9) * 0.015, out.rArm.p[2]];
    out.head += noise(t * 0.6, sd + 10) * 4;
    // Lean into motion and into acceleration (direction changes read clearly).
    out.pitch += clamp(this.velF * 2.5 + this.accF * 0.6, -9, 9);
    out.roll += clamp(-this.velS * 2.5 - this.accS * 0.5, -7, 7);
    out.hips[1] -= clamp(speed * 0.008, 0, 0.02);
    return out;
  }

  /**
   * Replace the pose's foot targets with planted feet that step when needed,
   * and shift the hips over the support foot during a step.
   */
  private plantFeet(p: Pose, f: Fighter, dt: number): Pose {
    const g = this.group;
    const yawW = g.rotation.y;
    const toTarget = (leg: Pose['lLeg']): FootTarget => {
      g.localToWorld(_w.set(leg.p[0], leg.p[1], leg.p[2]));
      return { x: _w.x, z: _w.z, yaw: yawW + leg.yaw * DEG };
    };
    if (!this.planner.active) {
      // Start from where the feet are currently displayed (no pop).
      const cur = (bone: THREE.Bone, leg: Pose['lLeg']): FootTarget => {
        bone.getWorldPosition(_w);
        return { x: _w.x, z: _w.z, yaw: yawW + leg.yaw * DEG };
      };
      this.planner.reset(cur(this.b.footL, p.lLeg), cur(this.b.footR, p.rLeg));
    }
    const [lo, ro] = this.planner.update([toTarget(p.lLeg), toTarget(p.rLeg)], f.vx, f.vz, dt);
    const out = derive(p, {});
    const apply = (leg: Pose['lLeg'], o: typeof lo) => {
      g.worldToLocal(_w.set(o.x, 0, o.z));
      leg.p = [_w.x, Math.max(leg.p[1], ANKLE_H) + o.lift, _w.z];
      leg.yaw = ((o.yaw - yawW) * 180) / Math.PI;
      if (o.stepT > 0) leg.point = Math.max(leg.point, 0.35 * Math.sin(Math.PI * o.stepT));
    };
    apply(out.lLeg, lo);
    apply(out.rLeg, ro);
    // Weight over the support foot while the other one steps.
    const support = lo.stepT > 0 ? out.rLeg.p : ro.stepT > 0 ? out.lLeg.p : null;
    const mid: [number, number] = [(out.lLeg.p[0] + out.rLeg.p[0]) / 2, (out.lLeg.p[2] + out.rLeg.p[2]) / 2];
    const tx = support ? lerp(mid[0], support[0], 0.25) : mid[0];
    const tz = support ? lerp(mid[1], support[2], 0.25) : mid[1];
    const sMid: [number, number] = [(p.lLeg.p[0] + p.rLeg.p[0]) / 2, (p.lLeg.p[2] + p.rLeg.p[2]) / 2];
    out.hips[0] += (tx - sMid[0]) * 0.6;
    out.hips[2] += (tz - sMid[1]) * 0.6;
    return out;
  }

  private applyClip(name: string, time: number, loop: boolean) {
    if (this.activeClip !== name) {
      for (const [n, a] of this.actions) {
        a.enabled = n === name;
        a.setEffectiveWeight(n === name ? 1 : 0);
      }
      this.activeClip = name;
    }
    const a = this.actions.get(name);
    if (!a) return;
    a.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
    a.clampWhenFinished = true;
    a.time = time;
    this.mixer.update(0);
    this.applyFists();
  }

  private disableClips() {
    if (this.activeClip === null) return;
    for (const a of this.actions.values()) {
      a.enabled = false;
      a.setEffectiveWeight(0);
    }
    this.activeClip = null;
  }

  /** Solve a procedural pose onto the skeleton. */
  applyPose(p: Pose) {
    this.disableClips();
    const g = this.group;
    const b = this.b;
    for (const bone of this.bones) {
      bone.quaternion.copy(this.rest.get(bone)!);
      bone.position.copy(this.restPos.get(bone)!);
    }
    g.getWorldQuaternion(_groupQ);
    g.updateMatrixWorld(true);

    // Hips: position and orientation (yaw + half of the lean).
    _bodyQ.copy(_groupQ).multiply(_q.setFromAxisAngle(Y, p.yaw * DEG));
    _q2.copy(_bodyQ).multiply(_qa.setFromAxisAngle(X, p.pitch * 0.5 * DEG)).multiply(_qb.setFromAxisAngle(Z, p.roll * 0.5 * DEG));
    setWorldPos(b.hips, g.localToWorld(_v.set(p.hips[0], p.hips[1], p.hips[2])));
    b.hips.updateMatrixWorld(true);
    setWorldQuat(b.hips, _q.copy(_q2).multiply(this.restHipsModelQ));

    // Spine: distribute twist and the other half of the lean.
    const spines = [b.spine1, b.spine2, b.spine3];
    const bodyX = _v.copy(X).applyQuaternion(_bodyQ);
    const bodyZ = _v2.copy(Z).applyQuaternion(_bodyQ);
    for (const s of spines) {
      _q.setFromAxisAngle(Y, ((p.twist / 3) * DEG));
      _q.multiply(_qa.setFromAxisAngle(bodyX, (p.pitch * 0.5 * DEG) / 3));
      _q.multiply(_qb.setFromAxisAngle(bodyZ, (p.roll * 0.5 * DEG) / 3));
      rotateWorld(s, _q);
    }

    // Head keeps watching the opponent (fighter forward).
    const look = -(p.yaw + p.twist) * p.look + p.head;
    rotateWorld(b.neck, _q.setFromAxisAngle(Y, look * 0.4 * DEG));
    rotateWorld(b.head, _q.setFromAxisAngle(Y, look * 0.6 * DEG));
    const levelPitch = -(p.pitch * 0.6 + 0) * DEG;
    b.head.getWorldQuaternion(_q2);
    _axis.copy(X).applyQuaternion(_q2);
    rotateWorld(b.head, _q.setFromAxisAngle(_axis, levelPitch));

    // Legs.
    this.solveLeg(this.ikLegL, b.footL, this.restFootLocalL, p.lLeg);
    this.solveLeg(this.ikLegR, b.footR, this.restFootLocalR, p.rLeg);

    // Arms in the chest frame (follows torso yaw/lean) or the fighter frame.
    _chestQ
      .copy(_groupQ)
      .multiply(_q.setFromAxisAngle(Y, (p.yaw + p.twist) * DEG))
      .multiply(_qa.setFromAxisAngle(X, p.pitch * DEG))
      .multiply(_qb.setFromAxisAngle(Z, p.roll * DEG));
    const chest = b.spine3.getWorldPosition(new THREE.Vector3());
    this.solveArm(this.ikArmL, chest, p.lArm);
    this.solveArm(this.ikArmR, chest, p.rArm);
    this.applyFists();
  }

  private solveLeg(ik: TwoBoneIK, foot: THREE.Bone, restLocal: THREE.Quaternion, leg: Pose['lLeg']) {
    const g = this.group;
    const target = g.localToWorld(_v.set(leg.p[0], leg.p[1], leg.p[2]));
    _pole.set(leg.pole[0], leg.pole[1], leg.pole[2]).applyQuaternion(_groupQ);
    ik.solve(target, _pole);
    // Foot: blend between flat-on-floor and pointed along the shin.
    _qa.copy(_groupQ).multiply(_q.setFromAxisAngle(Y, leg.yaw * DEG)).multiply(this.restFootModelQ);
    ik.lower.getWorldQuaternion(_qb);
    _qb.multiply(restLocal).multiply(_q.setFromAxisAngle(X, POINT_ANGLE * clamp(leg.point, 0, 1)));
    const w = smoothstep(clamp(leg.point * 1.6, 0, 1));
    _qa.slerp(_qb, w);
    setWorldQuat(foot, _qa);
  }

  private solveArm(ik: TwoBoneIK, chest: THREE.Vector3, arm: Pose['lArm']) {
    const local = _v.set(arm.p[0], arm.p[1], arm.p[2]);
    const inChest = _v2.copy(local).multiplyScalar(this.group.scale.x).applyQuaternion(_chestQ).add(chest);
    if (arm.world > 0) {
      const inWorld = this.group.localToWorld(local.clone());
      inChest.lerp(inWorld, clamp(arm.world, 0, 1));
    }
    _pole.set(arm.pole[0], arm.pole[1], arm.pole[2]).applyQuaternion(_chestQ);
    ik.solve(inChest, _pole);
  }

  private applyFists() {
    for (const f of this.fingers) f.bone.quaternion.copy(f.fist);
  }

  private snapshot() {
    for (let i = 0; i < this.bones.length; i++) this.snapQ[i].copy(this.bones[i].quaternion);
    this.snapHips.copy(this.b.hips.position);
  }

  private blendFromSnapshot(w: number) {
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i];
      _q.copy(this.snapQ[i]).slerp(bone.quaternion, w);
      bone.quaternion.copy(_q);
    }
    this.b.hips.position.lerpVectors(this.snapHips, this.b.hips.position, w);
  }

  /** Current world position of a named bone (FX, camera, debug). */
  boneWorld(name: keyof typeof BONE, out: THREE.Vector3) {
    return this.b[name].getWorldPosition(out);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
