import { describe, expect, it } from 'vitest';
import { FootPlanner } from '../src/game/anim/FootPlanner';
import { attackKeys, reactionEnvelope, sampleKeys, STANCE } from '../src/game/anim/poses';
import { MOVES, moveTotal, startupOf } from '../src/game/combat/moves';
import { ATTACK_KINDS } from '../src/game/input/actions';
import { pickWheel, WHEEL_HEAD_RADIUS } from '../src/ui/wheel';

const atkOf = (id: (typeof ATTACK_KINDS)[number], height: 'body' | 'head' = 'body') => {
  const move = MOVES[id];
  const h = move.heights.includes(height) ? height : 'body';
  return { move, height: h, startup: startupOf(move, h), total: moveTotal(move, h), hasHit: false, blocked: false, impact: move.impact[h], tired: false } as const;
};

describe('FootPlanner', () => {
  // Stance feet in the body frame (side, forward) for a body facing +Z.
  const stanceFeet = (x: number, z: number) => [
    { x: x + 0.05, z: z + 0.31, yaw: 0 },
    { x: x - 0.17, z: z - 0.3, yaw: -1.2 },
  ] as [{ x: number; z: number; yaw: number }, { x: number; z: number; yaw: number }];

  it('keeps planted feet perfectly still while the body is idle', () => {
    const fp = new FootPlanner();
    let first: { x: number; z: number }[] | null = null;
    for (let i = 0; i < 120; i++) {
      const out = fp.update(stanceFeet(0, 0), 0, 0, 1 / 60);
      const now = out.map((o) => ({ x: o.x, z: o.z }));
      if (!first) first = now;
      expect(now).toEqual(first);
    }
    expect(fp.steps).toBe(0);
  });

  it('walks with discrete steps: no sliding, one foot airborne at a time, feet keep up', () => {
    const fp = new FootPlanner();
    let x = 0;
    let z = 0;
    const v = 2.0; // m/s forward
    let prev = fp.update(stanceFeet(0, 0), 0, v, 1 / 60).map((o) => ({ ...o }));
    let bothAirborne = 0;
    let maxErr = 0;
    for (let i = 0; i < 120; i++) {
      z += v / 60;
      const targets = stanceFeet(x, z);
      const out = fp.update(targets, 0, v, 1 / 60);
      out.forEach((o, k) => {
        if (o.stepT === 0 && prev[k].stepT === 0) {
          // A planted foot must not move at all.
          expect(Math.hypot(o.x - prev[k].x, o.z - prev[k].z)).toBe(0);
        }
        maxErr = Math.max(maxErr, Math.hypot(o.x - targets[k].x, o.z - targets[k].z));
      });
      if (out[0].stepT > 0 && out[0].stepT < 0.5 && out[1].stepT > 0 && out[1].stepT < 0.5) bothAirborne++;
      prev = out.map((o) => ({ ...o }));
      void x;
    }
    expect(bothAirborne).toBe(0);
    expect(maxErr).toBeLessThan(0.45);
    // 2 m/s for 2 s: brisk TKD footwork, roughly 2.5-7 steps per second in total.
    expect(fp.steps).toBeGreaterThan(4);
    expect(fp.steps).toBeLessThan(15);
  });

  it('pivots the feet when the body turns in place', () => {
    const fp = new FootPlanner();
    fp.update(stanceFeet(0, 0), 0, 0, 1 / 60);
    // Rotate the stance 90° around the origin.
    const rot = (p: { x: number; z: number; yaw: number }) => ({ x: p.z, z: -p.x, yaw: p.yaw + Math.PI / 2 });
    const turned = stanceFeet(0, 0).map(rot) as ReturnType<typeof stanceFeet>;
    for (let i = 0; i < 90; i++) fp.update(turned, 0, 0, 1 / 60);
    expect(fp.steps).toBeGreaterThanOrEqual(2);
    fp.out.forEach((o, k) => expect(Math.hypot(o.x - turned[k].x, o.z - turned[k].z)).toBeLessThan(0.06));
  });

  it('freezes when dt is 0 (hit stop / pause)', () => {
    const fp = new FootPlanner();
    fp.update(stanceFeet(0, 0), 0, 0, 1 / 60);
    const before = fp.out.map((o) => ({ ...o }));
    fp.update(stanceFeet(0.5, 0.5), 0, 0, 0);
    // A step may be scheduled, but nothing moves with dt = 0.
    fp.out.forEach((o, k) => expect(Math.hypot(o.x - before[k].x, o.z - before[k].z)).toBeLessThan(1e-9));
  });
});

describe('technique keyframes', () => {
  it('extension is identical for every outcome and every variation seed (hit timing preserved)', () => {
    for (const id of ATTACK_KINDS) {
      const atk = atkOf(id);
      const tImpact = atk.startup + atk.move.active * 0.9;
      const ref = sampleKeys(attackKeys(atk, 'pending', 0), tImpact);
      for (const outcome of ['hit', 'blocked', 'whiff'] as const) {
        for (const seed of [1, 7, 99]) {
          const p = sampleKeys(attackKeys(atk, outcome, seed), tImpact);
          const limb = atk.move.limb === 'rearFoot' ? 'rLeg' : atk.move.limb === 'leadFoot' ? 'lLeg' : 'rArm';
          expect(p[limb].p[0], `${id} ${outcome} ${seed}`).toBeCloseTo(ref[limb].p[0], 6);
          expect(p[limb].p[1], `${id} ${outcome} ${seed}`).toBeCloseTo(ref[limb].p[1], 6);
          expect(p[limb].p[2], `${id} ${outcome} ${seed}`).toBeCloseTo(ref[limb].p[2], 6);
        }
      }
    }
  });

  it('every outcome returns to the fighting stance by the end of recovery', () => {
    for (const id of ATTACK_KINDS) {
      const atk = atkOf(id);
      for (const outcome of ['hit', 'blocked', 'whiff'] as const) {
        const end = sampleKeys(attackKeys(atk, outcome, 3), atk.total);
        expect(end.rLeg.p, `${id} ${outcome}`).toEqual(STANCE.rLeg.p);
        expect(end.lLeg.p).toEqual(STANCE.lLeg.p);
        expect(((end.yaw - STANCE.yaw) % 360 + 360) % 360).toBeCloseTo(0, 6);
      }
    }
  });

  it('outcomes produce visibly different recoveries', () => {
    const atk = atkOf('round');
    const t = atk.startup + atk.move.active + (atk.total - atk.startup - atk.move.active) * 0.3;
    const hit = sampleKeys(attackKeys(atk, 'hit', 1), t);
    const whiff = sampleKeys(attackKeys(atk, 'whiff', 1), t);
    const blocked = sampleKeys(attackKeys(atk, 'blocked', 1), t);
    expect(Math.abs(whiff.yaw - hit.yaw)).toBeGreaterThan(10);
    expect(Math.abs(blocked.hips[2] - hit.hips[2])).toBeGreaterThan(0.03);
  });

  it('variation changes chamber shape between repetitions', () => {
    const atk = atkOf('front');
    const t = atk.startup * 0.68;
    const a = sampleKeys(attackKeys(atk, 'pending', 1), t);
    const b = sampleKeys(attackKeys(atk, 'pending', 2), t);
    expect(a.rLeg.p[1]).not.toBeCloseTo(b.rLeg.p[1], 4);
  });

  it('reaction envelope rises fast and decays to zero by the end of stun', () => {
    expect(reactionEnvelope(0, 20)).toBe(0);
    expect(reactionEnvelope(3, 20)).toBeCloseTo(1, 5);
    expect(reactionEnvelope(20, 20)).toBeCloseTo(0, 5);
  });
});

describe('technique wheel', () => {
  it('outer ring maps drag directions to rear-leg techniques', () => {
    expect(pickWheel(0, -110)?.kind).toBe('front'); // up
    expect(pickWheel(-80, -80)?.kind).toBe('round'); // up-left
    expect(pickWheel(-110, -36)?.kind).toBe('side'); // left
    expect(pickWheel(-110, 25)?.kind).toBe('back'); // left, slightly down
  });
  it('inner ring maps to lead-leg techniques', () => {
    expect(pickWheel(0, -60)?.kind).toBe('leadFront');
    expect(pickWheel(-42, -42)?.kind).toBe('leadRound');
    expect(pickWheel(-60, 4)?.kind).toBe('leadSide');
    expect(pickWheel(-42, -42)?.head).toBe(false);
  });
  it('ignores tiny drags and directions with no technique', () => {
    expect(pickWheel(5, -5)).toBeNull();
    expect(pickWheel(110, 0)).toBeNull(); // right: off the wheel
    expect(pickWheel(0, 110)).toBeNull(); // down: off the wheel
  });
  it('past the outer ring selects head height', () => {
    expect(pickWheel(0, -110)?.head).toBe(false);
    expect(pickWheel(0, -(WHEEL_HEAD_RADIUS + 5))).toEqual({ kind: 'front', head: true });
  });
});
