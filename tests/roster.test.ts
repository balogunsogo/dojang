import { describe, expect, it } from 'vitest';
import { defaultProgress, loadProgress, migrate, PROGRESS_KEY } from '../src/game/progress/progress';
import { CHARACTERS, type CharacterId, isCharacterId, nextFighter, ROSTER } from '../src/game/render/characterFactory';
import { FACES } from '../src/game/render/face';

describe('Phase 10 roster', () => {
  it('has the six approved fighters in order, each with a face', () => {
    expect(ROSTER).toEqual(['jae', 'hana', 'tunde', 'sofia', 'minjun', 'amara']);
    expect(Object.keys(CHARACTERS).sort()).toEqual([...ROSTER].sort());
    expect(Object.keys(FACES).sort()).toEqual([...ROSTER].sort());
    for (const id of ROSTER) expect(CHARACTERS[id].id).toBe(id);
  });

  it('uses the approved stats (displayed x100)', () => {
    const shown = Object.fromEntries(ROSTER.map((id) => [id, [CHARACTERS[id].stats.power, CHARACTERS[id].stats.speed, CHARACTERS[id].stats.staminaRegen].map((v) => Math.round(v * 100))]));
    expect(shown).toEqual({ jae: [108, 102, 103], hana: [94, 109, 110], tunde: [106, 98, 105], sofia: [103, 104, 104], minjun: [96, 112, 107], amara: [99, 108, 106] });
    for (const id of ROSTER) expect(CHARACTERS[id].stats.maxHealth).toBe(100);
  });

  it('picks the opponent as the next fighter in roster order, wrapping', () => {
    expect(ROSTER.map(nextFighter)).toEqual(['hana', 'tunde', 'sofia', 'minjun', 'amara', 'jae']);
  });

  it('validates fighter ids', () => {
    for (const id of ROSTER) expect(isCharacterId(id)).toBe(true);
    for (const v of ['zed', '', 'JAE', null, undefined, 3, {}, 'constructor', 'toString']) expect(isCharacterId(v)).toBe(false);
  });
});

describe('Phase 10 save compatibility', () => {
  const mem = (v: unknown) => {
    const m = new Map<string, string>([[PROGRESS_KEY, JSON.stringify(v)]]);
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, s: string) => void m.set(k, s) };
  };
  it('keeps existing Jae and Ha-na saves, belts and records', () => {
    for (const fighter of ['jae', 'hana'] as CharacterId[]) {
      const p = loadProgress(mem({ version: 1, fighter, belt: 'yellow', completed: ['practice'], records: { practice: { completions: 2, attempts: 3, bestAccuracy: 0.8, bestScore: 10, bestTime: null, bestCombo: 2 } }, landed: { front: 4 }, matches: { played: 5, won: 3, wins: { easy: 1, normal: 2, hard: 0 }, friendWins: 1 } }));
      expect(p.fighter).toBe(fighter);
      expect(p.belt).toBe('yellow');
      expect(p.completed).toEqual(['practice']);
      expect(p.records.practice.completions).toBe(2);
      expect(p.matches.won).toBe(3);
    }
  });
  it('keeps a saved new fighter', () => {
    expect(migrate({ ...defaultProgress(), fighter: 'amara' }).fighter).toBe('amara');
  });
  it('falls back to a valid fighter for an unknown or corrupt id, keeping everything else', () => {
    for (const fighter of ['zed', 42, null, '__proto__']) {
      const p = migrate({ ...defaultProgress(), fighter, belt: 'yellow', completed: ['practice'] });
      expect(isCharacterId(p.fighter)).toBe(true);
      expect(p.fighter).toBe('jae');
      expect(p.belt).toBe('yellow');
      expect(p.completed).toEqual(['practice']);
    }
  });
});
