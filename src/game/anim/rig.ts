import * as THREE from 'three';

/** Bone names after GLTFLoader sanitization ("DEF-thigh.L" -> "DEF-thighL"). */
export const BONE = {
  root: 'root',
  hips: 'DEF-hips',
  spine1: 'DEF-spine001',
  spine2: 'DEF-spine002',
  spine3: 'DEF-spine003',
  neck: 'DEF-neck',
  head: 'DEF-head',
  thighL: 'DEF-thighL',
  shinL: 'DEF-shinL',
  footL: 'DEF-footL',
  thighR: 'DEF-thighR',
  shinR: 'DEF-shinR',
  footR: 'DEF-footR',
  upperArmL: 'DEF-upper_armL',
  forearmL: 'DEF-forearmL',
  handL: 'DEF-handL',
  upperArmR: 'DEF-upper_armR',
  forearmR: 'DEF-forearmR',
  handR: 'DEF-handR',
} as const;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _k = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _t = new THREE.Vector3();

export function parentWorldQuat(bone: THREE.Object3D, out: THREE.Quaternion) {
  if (bone.parent) bone.parent.getWorldQuaternion(out);
  else out.identity();
  return out;
}

/** Set a bone's orientation from a world-space quaternion. Parent matrices must be current. */
export function setWorldQuat(bone: THREE.Object3D, world: THREE.Quaternion) {
  parentWorldQuat(bone, _q).invert();
  bone.quaternion.copy(_q.multiply(world));
  bone.updateMatrixWorld(true);
}

/** Pre-multiply a world-space rotation onto a bone. */
export function rotateWorld(bone: THREE.Object3D, delta: THREE.Quaternion) {
  bone.getWorldQuaternion(_q2);
  _q2.premultiply(delta);
  setWorldQuat(bone, _q2);
}

/** Set a bone's position from a world-space point. */
export function setWorldPos(bone: THREE.Object3D, world: THREE.Vector3) {
  if (bone.parent) {
    bone.parent.updateWorldMatrix(true, false);
    bone.position.copy(bone.parent.worldToLocal(_t.copy(world)));
  } else bone.position.copy(world);
}

/**
 * Analytic two-bone IK for a Blender-style chain where each bone points along
 * its local +Y and bends about its local X (true for this rig's arms and legs).
 * `hingeSign` is measured from the bind pose so the joint never bends backwards.
 */
export class TwoBoneIK {
  readonly upper: THREE.Bone;
  readonly lower: THREE.Bone;
  readonly end: THREE.Bone;
  readonly l1: number;
  readonly l2: number;
  readonly hingeSign: number;

  constructor(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Bone) {
    this.upper = upper;
    this.lower = lower;
    this.end = end;
    this.l1 = lower.position.length() * upper.getWorldScale(_t).y;
    this.l2 = end.position.length() * lower.getWorldScale(_t).y;
    // Bind-pose hinge sign: compare the upper bone's X axis with the bend normal.
    upper.updateWorldMatrix(true, true);
    const pa = upper.getWorldPosition(new THREE.Vector3());
    const pk = lower.getWorldPosition(new THREE.Vector3());
    const pe = end.getWorldPosition(new THREE.Vector3());
    const d1 = pk.clone().sub(pa);
    const d2 = pe.clone().sub(pk);
    const bend = d1.clone().cross(d2);
    const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()));
    this.hingeSign = Math.sign(xAxis.dot(bend)) || 1;
  }

  /**
   * Place the end joint at `target` (world) with the middle joint bending
   * towards `poleDir` (world direction, need not be normalized).
   */
  solve(target: THREE.Vector3, poleDir: THREE.Vector3) {
    const { l1, l2 } = this;
    this.upper.updateWorldMatrix(true, false);
    this.upper.getWorldPosition(_a);
    _n.subVectors(target, _a);
    let d = _n.length();
    if (d < 1e-5) return;
    _n.divideScalar(d);
    d = Math.min(d, (l1 + l2) * 0.9995);
    d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
    const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    // Bend direction: pole projected perpendicular to the chain axis.
    _b.copy(poleDir).addScaledVector(_n, -poleDir.dot(_n));
    if (_b.lengthSq() < 1e-8) _b.set(0, 0, 1).addScaledVector(_n, -_n.z);
    _b.normalize();
    _k.copy(_a).addScaledVector(_n, l1 * cosA).addScaledVector(_b, l1 * sinA);
    const endPos = _t.copy(_a).addScaledVector(_n, d);

    // Shared hinge axis for both bones.
    _x.crossVectors(_b, _n).multiplyScalar(this.hingeSign).normalize();

    // Upper bone basis.
    _y.subVectors(_k, _a).normalize();
    _z.crossVectors(_x, _y).normalize();
    const xo = _x.clone().crossVectors(_y, _z);
    _m.makeBasis(xo, _y, _z);
    _q2.setFromRotationMatrix(_m);
    setWorldQuat(this.upper, _q2);

    // Lower bone basis.
    _y.subVectors(endPos, _k).normalize();
    _z.crossVectors(_x, _y).normalize();
    xo.crossVectors(_y, _z);
    _m.makeBasis(xo, _y, _z);
    _q2.setFromRotationMatrix(_m);
    setWorldQuat(this.lower, _q2);
  }
}

export function findBone(root: THREE.Object3D, name: string): THREE.Bone {
  const b = root.getObjectByName(name);
  if (!b) throw new Error(`Bone not found: ${name}`);
  return b as THREE.Bone;
}
