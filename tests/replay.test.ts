import { describe, expect, it } from 'vitest';
import { AIController } from '../src/game/ai/AIController';
import { CombatWorld } from '../src/game/combat/CombatWorld';
import { emptyIntent, type FighterIntent } from '../src/game/input/actions';
import { decodeIntent } from '../src/game/netplay/inputCodec';
import { type NetMsg, Rollback } from '../src/game/netplay/Rollback';
import { checksum, snapshot } from '../src/game/netplay/snapshot';
import { CHARACTERS } from '../src/game/render/characterFactory';
import { FighterView, ROW, STATES, writeRow } from '../src/game/replay/format';
import { MIN_SEPARATION_TICKS, scoreHit, selectHighlights } from '../src/game/replay/highlights';
import { POST_TICKS, PRE_TICKS, type ReplayEvent, ReplayRecorder } from '../src/game/replay/recorder';
import { ArcadeRules } from '../src/game/rules/rules';
import { CompetitiveRules } from '../src/game/rules/competitive/CompetitiveRules';

const meta = { ids: ['jae', 'hana'] as [string, string], belts: ['white', 'red'] as [string, string], names: ['Jae', 'Ha-na'] as [string, string], me: 0 as const, mode: 'competitive' as const, online: false, couch: false };
const comp = () => new CombatWorld(new CompetitiveRules({ roundSeconds: 60 }), [CHARACTERS.jae.stats, CHARACTERS.hana.stats]);

/** AI v AI with a recorder; also keeps every row as ground truth. */
function playOffline(world: CombatWorld, diffs: ['easy' | 'normal' | 'hard', 'easy' | 'normal' | 'hard'], seed: number, after = 600) {
  world.skipIntro = true;
  world.resetMatch();
  const rec = new ReplayRecorder(meta);
  const ai = [new AIController(diffs[0], seed), new AIController(diffs[1], seed + 7)];
  const truth: Float32Array[] = [];
  let maxBytes = 0;
  let winner: 0 | 1 | null = null;
  let endTick = -1;
  for (let i = 0; i < 60 * 60 * 6; i++) {
    world.step([ai[0].think(world, world.fighters[0], world.fighters[1]), ai[1].think(world, world.fighters[1], world.fighters[0])]);
    const row = new Float32Array(ROW);
    writeRow(row, 0, world);
    truth.push(row);
    rec.tick(world, world.events);
    for (const e of world.events) if (e.type === 'match-end') ((winner = e.winner), (endTick = rec.count - 1), rec.complete(e.winner));
    world.events.length = 0;
    maxBytes = Math.max(maxBytes, rec.bytes());
    if (endTick >= 0 && rec.count - 1 >= endTick + after) break;
  }
  return { rec, truth, winner, endTick, maxBytes };
}

describe('highlight scoring', () => {
  it('labels what actually happened', () => {
    expect(scoreHit({ attacker: 0, move: 'round', zone: 'head', counter: false, turning: false, points: 0 }).label).toBe('Roundhouse kick · Head kick');
    expect(scoreHit({ attacker: 1, move: 'back', zone: 'body', counter: false, turning: true, valid: true, points: 4 }).label).toBe('Back kick · 4 points');
    expect(scoreHit({ attacker: 0, move: 'front', zone: 'body', counter: true, turning: false, points: 0 }).label).toBe('Counterattack · Front kick');
    expect(scoreHit({ attacker: 0, move: 'round', zone: 'body', counter: false, turning: false, points: 0, combo: 'front' }).label).toBe('Combination · Front kick → Roundhouse kick');
    expect(scoreHit({ attacker: 0, move: 'round', zone: 'head', counter: false, turning: false, valid: false, points: 0 }).score).toBe(0);
    // An ordinary arcade body kick is not a highlight on its own.
    expect(scoreHit({ attacker: 0, move: 'front', zone: 'body', counter: false, turning: false, points: 0 }).score).toBeLessThan(12);
  });
  it('selects at most three, apart in time, varied, in match order; never fabricates', () => {
    const c = (tick: number, score: number, kind = 'head') => ({ tick, score, kind, label: kind, by: 0 as const });
    const picks = selectHighlights([c(100, 40), c(150, 90), c(900, 30), c(1500, 31), c(1600, 35, 'ko'), c(2400, 30)]);
    expect(picks.length).toBe(3);
    for (let i = 1; i < picks.length; i++) expect(picks[i].tick - picks[i - 1].tick).toBeGreaterThanOrEqual(MIN_SEPARATION_TICKS);
    expect(picks.map((p) => p.tick)).toEqual([...picks.map((p) => p.tick)].sort((a, b) => a - b));
    expect(picks.some((p) => p.tick === 150)).toBe(true); // the best moment wins its overlap
    expect(picks.some((p) => p.tick === 100)).toBe(false);
    expect(selectHighlights([c(10, 5), c(400, 11)])).toEqual([]);
    expect(selectHighlights([])).toEqual([]);
  });
});

describe('replay recorder (offline)', () => {
  const run = playOffline(comp(), ['hard', 'normal'], 3);
  const set = run.rec.seal()!;

  it('keeps memory bounded (ring, staging and at most 8 live clips)', () => {
    expect(run.maxBytes).toBeLessThan(1.6 * 1024 * 1024);
    expect(set.clips.length).toBeGreaterThan(0);
    expect(set.clips.length).toBeLessThanOrEqual(3);
  });

  it('extracts about 6 s before and 4 s after each highlight, matching the match exactly', () => {
    for (const c of set.clips) {
      expect(c.len).toBeLessThanOrEqual(PRE_TICKS + POST_TICKS + 1);
      expect(c.eventTick).toBe(Math.min(PRE_TICKS, c.start + c.eventTick));
      expect(c.len - c.eventTick - 1).toBeLessThanOrEqual(POST_TICKS);
      // Every recorded row equals the world's state at that tick.
      for (let r = 0; r < Math.min(c.len, c.synthFrom); r++) expect(Array.from(c.rows.subarray(r * ROW, r * ROW + ROW))).toEqual(Array.from(run.truth[c.start + r]));
      // The moment itself is a real contact (or the KO) at that tick.
      const at = c.events.filter((e) => e.t === c.eventTick).map((e) => e.k);
      expect(at.some((k) => k === 'hit' || k === 'ko' || k === 'block')).toBe(true);
    }
    for (let i = 1; i < set.clips.length; i++) expect(set.clips[i].start + set.clips[i].eventTick - (set.clips[i - 1].start + set.clips[i - 1].eventTick)).toBeGreaterThanOrEqual(MIN_SEPARATION_TICKS);
  });

  it('rows read back into the fields the animator uses', () => {
    const c = set.clips[0];
    const v = new FighterView(0).read(c.rows, c.eventTick);
    const t = new FighterView(0).read(run.truth[c.start + c.eventTick], 0);
    expect({ ...v, atkObj: 0, hitObj: 0 }).toEqual({ ...t, atkObj: 0, hitObj: 0 });
    expect(STATES).toContain(v.state);
  });

  it('dispose releases the clips', () => {
    const r = playOffline(comp(), ['normal', 'normal'], 9, 10);
    r.rec.dispose();
    expect(r.rec.seal()).toBeNull();
  });
});

describe('replay recorder: knockout continuation', () => {
  it('a KO clip sealed at the final whistle continues the fall for display only', () => {
    // Arcade until a KO; seal immediately (as when the Champion screen follows at once).
    let found = false;
    for (let s = 1; s < 30 && !found; s++) {
      const r = playOffline(new CombatWorld(ArcadeRules, [CHARACTERS.tunde.stats, CHARACTERS.hana.stats]), ['hard', 'easy'], s, 0);
      const set = r.rec.seal();
      const ko = set?.clips.find((c) => c.label.startsWith('Knockout') && c.synthFrom < c.len);
      if (!ko) continue;
      found = true;
      expect(ko.synthFrom).toBeLessThan(ko.len);
      const loser = ko.events.find((e) => e.k === 'ko') as Extract<ReplayEvent, { k: 'ko' }>;
      const a = new FighterView(loser.who).read(ko.rows, ko.synthFrom - 1);
      const b = new FighterView(loser.who).read(ko.rows, ko.len - 1);
      expect(b.state).toBe('ko');
      expect(b.stateTick - a.stateTick).toBe(ko.len - ko.synthFrom);
      expect([b.x, b.z]).toEqual([a.x, a.z]);
      // No event is invented after the real end.
      expect(ko.events.every((e) => e.t < ko.synthFrom)).toBe(true);
    }
    expect(found).toBe(true);
  });
});

describe('replay recorder: online rollback', () => {
  /**
   * Two peers, 10-tick latency. Peer 1 (Hong) guards, then drops the guard
   * and walks in. Peer 0 (Chung) walks forward and kicks. Peer 0 predicts the
   * guard continues, so its first simulation of the kick is blocked; the real
   * input corrects it to a clean hit. The replay must hold only the hit.
   */
  function scenario(release: number, kickAt: number) {
    let now = 0;
    const queue: { at: number; to: 0 | 1; m: NetMsg }[] = [];
    const link = (to: 0 | 1) => (m: NetMsg) => queue.push({ at: now + 10, to, m: JSON.parse(JSON.stringify(m)) });
    const w = [comp(), comp()];
    for (const x of w) {
      x.skipIntro = true;
      x.resetMatch();
    }
    const rb = [new Rollback(w[0], 0, link(1), { host: true, maxPrediction: 14 }), new Rollback(w[1], 1, link(0), { host: false, maxPrediction: 14 })];
    const rec = new ReplayRecorder({ ...meta, online: true });
    const firstStaged = new Map<number, { row: Float32Array; kinds: string[] }>();
    rb[0].onSim = (f, world) => {
      if (!firstStaged.has(f)) {
        const row = new Float32Array(ROW);
        writeRow(row, 0, world);
        firstStaged.set(f, { row, kinds: world.events.map((e) => e.type) });
      }
      rec.stage(f, world);
    };
    const intent = (i: 0 | 1, f: number): FighterIntent => {
      const it = emptyIntent();
      if (i === 0) {
        if (f < kickAt) it.moveZ = 1;
        if (f === kickAt) ((it.attack = 'round'), (it.height = 'body'));
      } else {
        it.guard = f < release;
        if (f >= release && f < release + 30) it.moveZ = -0.3;
      }
      return it;
    };
    const END = 600;
    while (rb[0].frame < END || rb[1].frame < END) {
      now++;
      for (const q of queue.filter((q) => q.at <= now)) rb[q.to].receive(q.m);
      queue.splice(0, queue.length, ...queue.filter((q) => q.at > now));
      for (const i of [0, 1] as const) {
        if (rb[i].frame >= END) continue;
        rb[i].tick(intent(i, rb[i].frame));
        rb[i].flush();
        rb[i].events.length = 0;
        if (i === 0) rec.commitThrough(rb[0].pending ? -1 : Math.min(rb[0].remoteHead, rb[0].frame - 1));
      }
    }
    for (const q of queue) rb[q.to].receive(q.m);
    rb[0].settle();
    rb[1].settle();
    rec.commitThrough(Math.min(rb[0].remoteHead, rb[0].frame - 1));
    // Ground truth: an offline world fed the confirmed inputs.
    const pr = rb[0] as unknown as { local: number[]; remote: number[] };
    const truthWorld = comp();
    truthWorld.skipIntro = true;
    truthWorld.resetMatch();
    const truth: Float32Array[] = [];
    const truthEvents: string[] = [];
    const ins: [FighterIntent, FighterIntent] = [emptyIntent(), emptyIntent()];
    for (let f = 0; f < rec.count; f++) {
      decodeIntent(pr.local[f], ins[0]);
      decodeIntent(pr.remote[f], ins[1]);
      truthWorld.step(ins);
      const row = new Float32Array(ROW);
      writeRow(row, 0, truthWorld);
      truth.push(row);
      for (const e of truthWorld.events) truthEvents.push(`${f}:${e.type}`);
      truthWorld.events.length = 0;
    }
    return { rb, w, rec, firstStaged, truth, truthEvents };
  }

  it('records only confirmed history: a predicted block corrected to a hit leaves just the hit', () => {
    let hit: ReturnType<typeof scenario> | null = null;
    let corrected = -1;
    for (let rel = 30; rel <= 80 && !hit; rel += 2) {
      for (let kick = 20; kick <= 70 && !hit; kick += 5) {
        const s = scenario(rel, kick);
        for (const [f, st] of s.firstStaged) {
          const committed = s.truthEvents.filter((x) => x.startsWith(`${f}:`)).map((x) => x.split(':')[1]);
          if (st.kinds.includes('block') && committed.includes('hit')) {
            hit = s;
            corrected = f;
            break;
          }
        }
      }
    }
    expect(hit, 'found a predicted block that the real input turned into a hit').not.toBeNull();
    const s = hit!;
    // 1. The prediction was corrected by a rollback.
    expect(s.rb[0].rollbacks).toBeGreaterThan(0);
    // 2–3. Every committed tick equals the confirmed truth; the predicted block never survives.
    expect(s.rec.count).toBe(s.truth.length);
    for (let t = Math.max(0, s.rec.count - 12 * 60); t < s.rec.count; t++) expect(Array.from(s.rec.rowAt(t)!)).toEqual(Array.from(s.truth[t]));
    const kindsAt = (f: number) => s.rec.recentEvents.filter((e) => e.t === f).map((e) => e.k);
    expect(kindsAt(corrected)).toContain('hit');
    expect(kindsAt(corrected)).not.toContain('block');
    // 4. No duplicated hits or blocks from the re-simulation.
    const count = (k: string) => s.rec.recentEvents.filter((e) => e.k === k).length;
    expect(count('hit')).toBe(s.truthEvents.filter((x) => x.endsWith(':hit')).length);
    expect(count('block')).toBe(s.truthEvents.filter((x) => x.endsWith(':block')).length);
    // 5. The match itself is unchanged: both peers agree, and with the truth.
    expect(checksum(snapshot(s.w[0]))).toBe(checksum(snapshot(s.w[1])));
    expect(s.w[0].points).toEqual(s.w[1].points);
  });

  it('never commits a frame before it is confirmed', () => {
    const s = scenario(40, 40);
    // Every frame the recorder holds was confirmed (it never ran ahead of the remote head).
    expect(s.rec.count).toBeLessThanOrEqual(s.rb[0].remoteHead + 1);
  });
});
