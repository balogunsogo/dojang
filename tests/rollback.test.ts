import { describe, expect, it } from 'vitest';
import { AIController } from '../src/game/ai/AIController';
import { CombatWorld } from '../src/game/combat/CombatWorld';
import { CHARACTERS } from '../src/game/render/characterFactory';
import { type NetMsg, Rollback } from '../src/game/netplay/Rollback';
import { checksum, snapshot } from '../src/game/netplay/snapshot';
import { CompetitiveRules } from '../src/game/rules/competitive/CompetitiveRules';

// Two peers over a fake network with latency, jitter, reordering and loss.
function run(corrupt: boolean) {
    let seed = 7;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    let now = 0;
    const queue: { at: number; to: 0 | 1; m: NetMsg }[] = [];
    const link = (to: 0 | 1) => (m: NetMsg) => {
      if (rand() < 0.1) return; // 10% loss
      queue.push({ at: now + 50 + rand() * 60, to, m: JSON.parse(JSON.stringify(m)) });
    };
    const world = () => new CombatWorld(new CompetitiveRules({ roundSeconds: 60 }), [CHARACTERS.jae.stats, CHARACTERS.hana.stats]);
    const w = [world(), world()];
    const rb = [new Rollback(w[0], 0, link(1), { host: true }), new Rollback(w[1], 1, link(0), { host: false })];
    const ai = [new AIController('hard', 11), new AIController('hard', 23)];
    const END = 60 * 40;
    while (rb[0].frame < END || rb[1].frame < END) {
      now += 1000 / 60;
      for (const q of queue.filter((q) => q.at <= now)) rb[q.to].receive(q.m);
      queue.splice(0, queue.length, ...queue.filter((q) => q.at > now));
      for (const i of [0, 1] as const) {
        if (rb[i].frame >= END) continue;
        const me = w[i].fighters[i];
        rb[i].tick(ai[i].think(w[i], me, w[i].fighters[1 - i]));
        rb[i].events.length = 0;
        if (corrupt && i === 1 && rb[1].frame >= 600) {
          // A desync on the guest: change the live state and the states a rollback could restore.
          w[1].fighters[0].health -= 7;
          const snaps = (rb[1] as unknown as { snaps: Map<number, { fighters: { health: number }[] }> }).snaps;
          for (const [f, s] of snaps) if (f > rb[1].remoteHead) s.fighters[0].health -= 7;
          corrupt = false;
        }
      }
    }
    // Deliver everything still in flight, then settle the final predictions.
    for (const q of queue) rb[q.to].receive(q.m);
    rb[0].settle();
    rb[1].settle();
    expect(rb[0].confirmed && rb[1].confirmed).toBe(true);
    expect(rb[0].rollbacks + rb[1].rollbacks).toBeGreaterThan(10);
    expect(w[0].tick).toBeGreaterThan(1000);
    expect(checksum(snapshot(w[0]))).toBe(checksum(snapshot(w[1])));
    return rb[1].desyncs;
}

describe('rollback netcode', () => {
  it('two peers end in the identical state', () => expect(run(false)).toBe(0));
  it("a desync is corrected to the host's state", () => expect(run(true)).toBeGreaterThan(0));
});
