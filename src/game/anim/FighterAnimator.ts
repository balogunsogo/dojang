import * as THREE from 'three';
import type { Fighter } from '../combat/Fighter';
import { clamp, DEG, smoothstep } from '../math';
import { attackKeys, GUARD, mirrorPose, type Pose, pose as derive, sampleKeys, STANCE } from './poses';
import { BONE, findBone, rotateWorld, setWorldPos, setWorldQuat, TwoBoneIK } from './rig';

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const POINT_ANGLE = 58 * DEG;

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

type Source =
  | { kind: 'pose'; key: string; pose: Pose }
  | { kind: 'clip'; key: string; clip: string; time: number; loop: boolean };

/**
 * Drives one fighter's skeleton from simulation state. Sourced CC0 clips are
 * used for hit reactions, knockdown and idle; Taekwondo techniques and
 * footwork are procedural IK key poses. Every source change is cross-faded
 * from a snapshot of the previously displayed pose.
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
  private fadeTicks = 0;
  private fadeLen = 1;
  private readonly snapQ: THREE.Quaternion[] = [];
  private readonly snapHips = new THREE.Vector3();
  private bounce = 0;

  /** Debug: force a pose (pose lab). */
  overridePose: Pose | null = null;

  constructor(group: THREE.Group, model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.group = group;
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
   */
  update(f: Fighter, alpha: number, x: number, z: number, yaw: number) {
    this.group.position.set(x, 0, z);
    this.group.rotation.set(0, yaw, 0);
    this.group.updateMatrixWorld(true);

    const src = this.overridePose ? { kind: 'pose' as const, key: 'override', pose: this.overridePose } : this.pickSource(f, alpha);
    if (src.key !== this.sourceKey) {
      this.snapshot();
      this.fadeLen = this.fadeFor(f, src);
      this.fadeTicks = 0;
      this.sourceKey = src.key;
    }

    if (src.kind === 'clip') this.applyClip(src.clip, src.time, src.loop);
    else this.applyPose(src.pose);

    this.fadeTicks += 1;
    if (this.fadeTicks < this.fadeLen) this.blendFromSnapshot(smoothstep(this.fadeTicks / this.fadeLen));
  }

  /** Frames over which to cross-fade into a new source (render frames ~ ticks). */
  private fadeFor(f: Fighter, src: Source): number {
    if (src.key.startsWith('attack')) return 3;
    if (src.key.startsWith('hit')) return 3;
    if (src.key.startsWith('ko')) return 6;
    if (f.state === 'switch') return 9;
    return 7;
  }

  private pickSource(f: Fighter, alpha: number): Source {
    const t = f.stateTick + alpha;
    const mirror = f.stance === 'southpaw';
    const m = (p: Pose) => (mirror ? mirrorPose(p) : p);
    switch (f.state) {
      case 'attack': {
        const atk = f.attack!;
        return { kind: 'pose', key: `attack-${f.attackSerial}`, pose: m(sampleKeys(attackKeys(atk), t)) };
      }
      case 'hitstun': {
        const r = f.hitReaction;
        const clip = r?.zone === 'head' ? 'Hit_Head' : 'Hit_Chest';
        const dur = this.actions.get(clip)?.getClip().duration ?? 0.4;
        const prog = clamp(t / Math.max(1, f.stunTicks), 0, 1);
        return { kind: 'clip', key: `hit-${clip}`, clip, time: Math.min(dur * 0.98, prog * dur * 1.1), loop: false };
      }
      case 'ko': {
        const dur = this.actions.get('Death01')?.getClip().duration ?? 2;
        return { kind: 'clip', key: 'ko', clip: 'Death01', time: Math.min(dur - 0.01, t / 60), loop: false };
      }
      case 'victory': {
        const dur = this.actions.get('Idle_Loop')?.getClip().duration ?? 2.5;
        return { kind: 'clip', key: 'victory', clip: 'Idle_Loop', time: (t / 60) % dur, loop: true };
      }
      case 'blockstun': {
        const k = 1 - clamp(t / Math.max(1, f.stunTicks), 0, 1);
        return { kind: 'pose', key: `block-${f.stance}`, pose: m(derive(GUARD, { pitch: GUARD.pitch - 10 * k, hips: [0, 0.83, -0.06 - 0.05 * k] })) };
      }
      default:
        return { kind: 'pose', key: `loco-${f.stance}-${f.state === 'guard' ? 'g' : 'n'}`, pose: m(this.locomotion(f, t)) };
    }
  }

  /** Bouncing Taekwondo footwork built on the stance pose. */
  private locomotion(f: Fighter, t: number): Pose {
    const base = f.state === 'guard' ? GUARD : STANCE;
    // Velocity in the fighter's local frame (side, forward), orthodox-normalized.
    const cs = Math.cos(f.yaw);
    const sn = Math.sin(f.yaw);
    const mir = f.mirror;
    const vf = f.vx * sn + f.vz * cs;
    const vs = (f.vx * cs - f.vz * sn) * mir;
    const speed = Math.hypot(vf, vs);
    const ph = f.stepPhase;
    const bounceAmp = f.state === 'guard' ? 0.008 : 0.02;
    this.bounce = Math.abs(Math.sin(ph)) * bounceAmp;
    const out = derive(base, {});
    out.hips[1] += this.bounce - 0.01;
    // Lean into movement.
    out.pitch += clamp(vf * 3, -6, 6);
    out.roll += clamp(-vs * 3, -5, 5);
    // Stepping: feet trail/lead with an alternating phase, lifting slightly.
    const amp = clamp(speed * 0.07, 0, 0.12);
    if (amp > 0.002) {
      const sL = Math.sin(ph);
      const sR = Math.sin(ph + Math.PI);
      const dirS = speed > 1e-4 ? vs / speed : 0;
      const dirF = speed > 1e-4 ? vf / speed : 0;
      out.lLeg.p[0] += dirS * amp * sL;
      out.lLeg.p[2] += dirF * amp * sL;
      out.lLeg.p[1] += Math.max(0, Math.cos(ph)) * amp * 0.5;
      out.rLeg.p[0] += dirS * amp * sR;
      out.rLeg.p[2] += dirF * amp * sR;
      out.rLeg.p[1] += Math.max(0, -Math.cos(ph)) * amp * 0.5;
    }
    if (f.state === 'dash') {
      const k = 1 - clamp(t / 12, 0, 1);
      out.pitch += clamp(vf * 2.5, -10, 10) * k;
      out.hips[1] -= 0.03 * k;
    }
    if (f.state === 'switch') {
      const k = clamp(t / 10, 0, 1);
      out.hips[1] += Math.sin(k * Math.PI) * 0.06;
      out.lLeg.p[1] += Math.sin(k * Math.PI) * 0.06;
      out.rLeg.p[1] += Math.sin(k * Math.PI) * 0.06;
    }
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
