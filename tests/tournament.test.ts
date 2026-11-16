import { describe, expect, it } from 'vitest';
import { CHARACTERS, type CharacterId, ROSTER } from '../src/game/render/characterFactory';
import { fallbackOutcome, HeadlessBout, resolveFixture } from '../src/game/tournament/simulate';
import {
  type ActiveOpen,
  applyResult,
  type BoutId,
  createOpen,
  emptySave,
  enterOpen,
  finishOpen,
  fixturesDue,
  HISTORY_LIMIT,
  loadTournament,
  migrate,
  nextPlayerBout,
  opponentIn,
  playerResult,
  saveTournament,
  stageReached,
  TOURNAMENT_KEY,
  type TournamentSave,
  walkover,
} from '../src/game/tournament/tournament';

const open = (fighter: CharacterId = 'amara', seed = 4) => createOpen({ number: 4, seed, fighter, difficulty: 'normal', roundSeconds: 90, now: new Date(0) });
const win = (o: ActiveOpen, id: BoutId, who: 'a' | 'b') => {
  const b = o.bouts[id];
  const w = who === 'a' ? b.a! : b.b!;
  const r = applyResult(o, id, { winner: w, rounds: who === 'a' ? [[12, 9], [6, 8], [10, 4]] : [[9, 12], [8, 6], [4, 10]], score: who === 'a' ? [2, 1] : [1, 2], source: id === 'qf1' || id === 'sf1' || id === 'f' ? 'player' : 'sim' });
  expect(r).not.toBeNull();
  return r!;
};
/** The player's side of a player bout. */
const side = (o: ActiveOpen, id: BoutId): 'a' | 'b' => (o.bouts[id].a === o.fighter ? 'a' : 'b');
const other = (s: 'a' | 'b') => (s === 'a' ? 'b' : 'a');

describe('Dojang Open draw', () => {
  it('six distinct fighters; the player is never seeded and always fights QF1', () => {
    for (const fighter of ROSTER)
      for (let seed = 1; seed < 400; seed++) {
        const o = open(fighter, seed);
        const field = [o.bouts.qf1.a, o.bouts.qf1.b, o.bouts.qf2.a, o.bouts.qf2.b, ...o.seeds];
        expect(new Set(field).size).toBe(6);
        expect(field.sort()).toEqual([...ROSTER].sort());
        expect(o.bouts.qf1.a).toBe(fighter);
        expect(o.seeds).not.toContain(fighter);
        expect(o.bouts.sf1.a).toBe(o.seeds[0]);
        expect(o.bouts.sf2.a).toBe(o.seeds[1]);
        expect([o.bouts.sf1.b, o.bouts.sf2.b, o.bouts.f.a, o.bouts.f.b]).toEqual([null, null, null, null]);
      }
  });
  it('is reproducible from its seed and varies between seeds', () => {
    expect(open('jae', 77)).toEqual(open('jae', 77));
    const draws = new Set(Array.from({ length: 200 }, (_, i) => JSON.stringify(open('jae', i + 1).seeds.concat(open('jae', i + 1).bouts.qf1.b!))));
    expect(draws.size).toBeGreaterThan(15);
  });
  it('every fighter is drawn into every slot over many seeds (uniform shuffle)', () => {
    const seen = new Map<string, Set<CharacterId>>();
    for (let s = 1; s < 3000; s++) {
      const o = open('jae', s);
      const slots: [string, CharacterId][] = [['seed1', o.seeds[0]], ['seed2', o.seeds[1]], ['qf1', o.bouts.qf1.b!], ['qf2a', o.bouts.qf2.a!], ['qf2b', o.bouts.qf2.b!]];
      for (const [k, v] of slots) (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(v);
    }
    for (const v of seen.values()) expect(v.size).toBe(5);
  });
});

describe('Dojang Open progression', () => {
  it('champion path: QF1, QF2 due, SF1 vs seed 1, SF2 due, final', () => {
    let o = open();
    expect(nextPlayerBout(o)!.id).toBe('qf1');
    expect(fixturesDue(o)).toEqual([]);
    o = win(o, 'qf1', 'a');
    expect(fixturesDue(o)).toEqual(['qf2']);
    expect(o.bouts.sf1.b).toBe(o.fighter);
    expect(nextPlayerBout(o)!.id).toBe('sf1');
    expect(opponentIn(o, o.bouts.sf1)).toBe(o.seeds[0]);
    o = win(o, 'qf2', 'b');
    expect(o.bouts.sf2.b).toBe(o.bouts.qf2.b);
    expect(fixturesDue(o)).toEqual([]);
    expect(stageReached(o)).toBe('sf');
    o = win(o, 'sf1', side(o, 'sf1'));
    expect(fixturesDue(o)).toEqual(['sf2']);
    // The final needs SF2 decided first.
    expect(nextPlayerBout(o)).toBeNull();
    o = win(o, 'sf2', 'a');
    expect(nextPlayerBout(o)!.id).toBe('f');
    expect(o.bouts.f.b).toBe(o.seeds[1]);
    o = win(o, 'f', side(o, 'f'));
    expect(playerResult(o)).toBe('champion');
    expect(fixturesDue(o)).toEqual([]);
  });

  for (const [lose, result, due] of [
    ['qf1', 'quarterfinalist', ['qf2', 'sf2', 'sf1', 'f']],
    ['sf1', 'semifinalist', ['sf2', 'f']],
    ['f', 'runner-up', []],
  ] as const)
    it(`eliminated in ${lose}: ${result}; remaining fixtures resolve in dependency order`, () => {
      let o = open();
      for (const id of ['qf1', 'qf2', 'sf1', 'sf2', 'f'] as BoutId[]) {
        if (id === lose) break;
        o = win(o, id, id === 'qf1' || id === 'sf1' || id === 'f' ? side(o, id) : 'a');
      }
      o = win(o, lose, other(side(o, lose)));
      expect(nextPlayerBout(o)).toBeNull();
      expect(playerResult(o)).toBe(result);
      expect(fixturesDue(o)).toEqual(due);
      // Resolve in order, re-checking what's due each time: always ends with a champion.
      let guard = 0;
      while (fixturesDue(o).length && guard++ < 10) {
        const id = fixturesDue(o)[0];
        o = win(o, id, 'a');
      }
      expect(o.bouts.f.winner).not.toBeNull();
      expect(o.bouts.f.winner).not.toBe(o.fighter);
    });

  it('a result applies once: duplicates and impossible winners are refused', () => {
    const o = win(open(), 'qf1', 'a');
    expect(applyResult(o, 'qf1', { winner: o.bouts.qf1.b!, rounds: [], score: [0, 2], source: 'player' })).toBeNull();
    expect(applyResult(o, 'qf2', { winner: o.fighter, rounds: [], score: [2, 0], source: 'sim' })).toBeNull();
    expect(applyResult(open(), 'f', { winner: 'jae', rounds: [], score: [2, 0], source: 'player' })).toBeNull();
  });

  it('abandon: walkover to the opponent, the rest resolves, best round kept', () => {
    let o = win(win(open(), 'qf1', 'a'), 'qf2', 'a');
    o = walkover(o);
    expect(o.bouts.sf1.source).toBe('walkover');
    expect(o.bouts.sf1.winner).toBe(o.seeds[0]);
    expect(playerResult(o)).toBe('semifinalist');
    expect(fixturesDue(o)).toEqual(['sf2', 'f']);
  });
});

describe('Dojang Open history and persistence', () => {
  const finished = (s: TournamentSave, champ: boolean): TournamentSave => {
    let o = s.active!;
    o = win(o, 'qf1', champ ? 'a' : 'b');
    while (fixturesDue(o).length || nextPlayerBout(o)) {
      const pb = nextPlayerBout(o);
      if (pb) o = win(o, pb.id, side(o, pb.id));
      else o = win(o, fixturesDue(o)[0], 'a');
    }
    return finishOpen({ ...s, active: o }, false, new Date(0));
  };
  const enter = (s: TournamentSave, seed: number) => enterOpen(s, { seed, fighter: 'amara', difficulty: 'normal', roundSeconds: 90, now: new Date(0) });

  it('numbers Opens, records results and totals, keeps the final bracket', () => {
    let s = enter(emptySave(), 1);
    expect(s.active!.number).toBe(1);
    expect(enter(s, 2)).toBe(s); // one Open at a time
    s = finished(s, true);
    expect(s.active).toBeNull();
    expect(s.history[0]).toMatchObject({ number: 1, result: 'champion', champion: 'amara', abandoned: false });
    expect(s.history[0].bouts.f.winner).toBe('amara');
    s = finished(enter(s, 3), false);
    expect(s.history.map((h) => h.number)).toEqual([2, 1]);
    expect(s.totals).toEqual({ entered: 2, titles: 1, best: 'champion' });
    expect(s.nextNumber).toBe(3);
  });

  it('caps history at 20 but never the totals', () => {
    let s = emptySave();
    for (let i = 0; i < 25; i++) s = finished(enter(s, i + 1), i % 5 === 0);
    expect(s.history.length).toBe(HISTORY_LIMIT);
    expect(s.totals.entered).toBe(25);
    expect(s.totals.titles).toBe(5);
    expect(migrate(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('round-trips through storage and survives refusal', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const s = win(enter(emptySave(), 9).active!, 'qf1', 'a');
    const save = { ...enter(emptySave(), 9), active: s };
    expect(saveTournament(save, store)).toBe(true);
    expect(loadTournament(store)).toEqual(save);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    expect(saveTournament(save, broken)).toBe(false);
    expect(loadTournament(broken)).toEqual(emptySave());
    expect(loadTournament(null)).toEqual(emptySave());
    m.set(TOURNAMENT_KEY, '{not json');
    expect(loadTournament(store)).toEqual(emptySave());
  });

  it('discards a corrupt or unknown active Open, keeping history and totals', () => {
    let s = finished(enter(emptySave(), 1), true);
    s = enter(s, 2);
    const raw = JSON.parse(JSON.stringify(s));
    raw.active.bouts.qf2.a = 'zed'; // a fighter this build doesn't have
    const m = migrate(raw);
    expect(m.active).toBeNull();
    expect(m.history.length).toBe(1);
    expect(m.totals.titles).toBe(1);
    expect(m.nextNumber).toBe(3);
    const raw2 = JSON.parse(JSON.stringify(s));
    raw2.active.bouts.sf1.b = 'jae'; // a slot that doesn't match its feeder
    expect(migrate(raw2).active).toBeNull();
    const raw3 = JSON.parse(JSON.stringify(s));
    raw3.history[0].champion = 'zed';
    expect(migrate(raw3).history).toEqual([]);
    expect(migrate(raw3).totals.titles).toBe(1);
    for (const junk of [null, 3, 'x', [], { active: 5, history: 'no' }]) expect(migrate(junk).active).toBeNull();
  });
});

describe('Dojang Open background fixtures', () => {
  const stats = (id: CharacterId) => CHARACTERS[id].stats;
  it('a headless Competitive match produces a winner, round points and rounds won', () => {
    const sim = new HeadlessBout([stats('tunde'), stats('sofia')], 'normal', 60, 123);
    while (!sim.step(600));
    const r = sim.result()!;
    expect(r.winner === 0 || r.winner === 1).toBe(true);
    expect(r.score[r.winner]).toBeGreaterThanOrEqual(r.score[1 - r.winner]);
    expect(r.rounds.length).toBeGreaterThanOrEqual(1);
    expect(r.rounds.length).toBeLessThanOrEqual(3);
  });
  it('is deterministic for a given Open seed', async () => {
    const o = win(open('jae', 5), 'qf1', 'a');
    const opts = { stats, yieldFn: async () => {} };
    const x = await resolveFixture(o, 'qf2', Infinity, opts);
    const y = await resolveFixture(o, 'qf2', Infinity, opts);
    expect(x.source).toBe('sim');
    expect({ ...x, ms: 0 }).toEqual({ ...y, ms: 0 });
  });
  it('falls back (seeded, consistent scores) when the budget runs out', async () => {
    const o = win(open('jae', 5), 'qf1', 'a');
    let t = 0;
    const r = await resolveFixture(o, 'qf2', 5, { stats, sliceMs: 1, now: () => (t += 3), yieldFn: async () => {} });
    expect(r.source).toBe('fallback');
    expect(r.reason).toBe('budget');
    expect(r.score[r.winner]).toBe(2);
    const won = r.rounds.filter(([p, q]) => (r.winner === 0 ? p > q : q > p)).length;
    expect(won).toBe(2);
    expect(r.rounds.length).toBe(r.score[0] + r.score[1]);
  });
  it('fallback outcomes are seeded and follow the measured head-to-head rates', () => {
    expect(fallbackOutcome('jae', 'sofia', 90, 7)).toEqual(fallbackOutcome('jae', 'sofia', 90, 7));
    let w = 0;
    for (let s = 1; s <= 4000; s++) if (fallbackOutcome('jae', 'sofia', 90, s).winner === 0) w++;
    expect(w / 4000).toBeGreaterThan(0.5);
    expect(w / 4000).toBeLessThan(0.57);
  });
});
