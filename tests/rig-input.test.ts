import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TwoBoneIK } from '../src/game/anim/rig';
import { attackKeys, mirrorPose, sampleKeys, STANCE } from '../src/game/anim/poses';
import { MOVES, moveTotal, startupOf } from '../src/game/combat/moves';
import { InputManager } from '../src/game/input/InputManager';

function makeLeg() {
  // Blender-style chain: bones along +Y (pointing down via a 180° root), slight knee bend about X.
  const root = new THREE.Bone();
  root.rotation.x = Math.PI;
  root.position.set(0, 1, 0);
  const thigh = new THREE.Bone();
  root.add(thigh);
  const shin = new THREE.Bone();
  shin.position.set(0, 0.4, 0);
  shin.rotation.x = 0.07;
  thigh.add(shin);
  const foot = new THREE.Bone();
  foot.position.set(0, 0.43, 0);
  shin.add(foot);
  root.updateMatrixWorld(true);
  return { root, thigh, shin, foot };
}

describe('TwoBoneIK', () => {
  it('places the end joint on reachable targets', () => {
    const { thigh, shin, foot } = makeLeg();
    const ik = new TwoBoneIK(thigh, shin, foot);
    const targets = [
      new THREE.Vector3(0, 0.3, 0.3),
      new THREE.Vector3(0.2, 0.6, 0.5),
      new THREE.Vector3(-0.1, 0.9, 0.7),
    ];
    for (const t of targets) {
      ik.solve(t, new THREE.Vector3(0, 0, 1));
      const p = foot.getWorldPosition(new THREE.Vector3());
      expect(p.distanceTo(t)).toBeLessThan(1e-3);
    }
  });

  it('bends toward the pole and never folds backwards', () => {
    const { thigh, shin, foot } = makeLeg();
    const ik = new TwoBoneIK(thigh, shin, foot);
    ik.solve(new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(0, 0, 1));
    const knee = shin.getWorldPosition(new THREE.Vector3());
    expect(knee.z).toBeGreaterThan(0.1);
  });

  it('clamps unreachable targets to full extension along the target direction', () => {
    const { thigh, shin, foot } = makeLeg();
    const ik = new TwoBoneIK(thigh, shin, foot);
    ik.solve(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 1, 0));
    const hip = thigh.getWorldPosition(new THREE.Vector3());
    const p = foot.getWorldPosition(new THREE.Vector3());
    expect(p.distanceTo(hip)).toBeGreaterThan(0.82);
    expect(p.z).toBeGreaterThan(0.8);
  });
});

describe('pose keys', () => {
  it('kick extension reaches the move impact point during the active window', () => {
    for (const id of ['front', 'round', 'side', 'back'] as const) {
      const move = MOVES[id];
      const atk = { move, height: 'body' as const, startup: startupOf(move, 'body'), total: moveTotal(move, 'body'), hasHit: false, blocked: false, impact: move.impact.body, tired: false };
      const p = sampleKeys(attackKeys(atk), atk.startup + move.active * 0.9);
      const foot = p.rLeg.p;
      const d = Math.hypot(foot[0] - move.impact.body[0], foot[1] - move.impact.body[1], foot[2] - move.impact.body[2]);
      expect(d, id).toBeLessThan(0.16);
    }
  });

  it('mirroring twice is identity', () => {
    const m = mirrorPose(mirrorPose(STANCE));
    expect(m.lLeg.p).toEqual(STANCE.lLeg.p);
    expect(m.yaw).toBeCloseTo(STANCE.yaw);
  });
});

describe('InputManager', () => {
  it('latches edge actions until consumed', () => {
    const im = new InputManager();
    im.press('front');
    expect(im.poll().attack).toBe('front');
    expect(im.poll().attack).toBe('front');
    im.consumeEdges();
    expect(im.poll().attack).toBeNull();
  });

  it('merges touch stick and height from gesture-style presses', () => {
    const im = new InputManager();
    im.touch.moveX = 0.5;
    im.touch.moveY = 0.5;
    im.press('round', 'head');
    const a = im.poll();
    expect(a.moveX).toBeCloseTo(0.5);
    expect(a.attackHeight).toBe('head');
    expect(im.lastDevice).toBe('touch');
  });
});
