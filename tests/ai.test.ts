import { describe, expect, it } from 'vitest';
import { AI_PROFILES, AIController, type Difficulty } from '../src/game/ai/AIController';
import { CombatWorld } from '../src/game/combat/CombatWorld';
import type { FighterStats } from '../src/game/combat/Fighter';
import { MOVES } from '../src/game/combat/moves';
import { type AttackKind, emptyIntent, type FighterIntent } from '../src/game/input/actions';
import { CompetitiveRules } from '../src/game/rules/competitive/CompetitiveRules';
import { ArcadeRules, type Ruleset } from '../src/game/rules/rules';

// Seeded, reproducible AI scenarios. Each runs the real simulation; the AI
// sees only what the player would (delayed) and acts through FighterIntent.

const STATS: FighterStats = { speed: 1, power: 1, staminaRegen: 1, maxHealth: 100 };
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

function world(rules: Ruleset = ArcadeRules, gap = 2.4) {
  const w = new CombatWorld(rules, [STATS, STATS]);
  w.skipIntro = true;
  w.resetMatch();
  w.fighters[1].z = gap / 2;
  w.fighters[0].z = -gap / 2;
  w.events.length = 0;
  return w;
}

/** Scripted human-like attacker: walks in and throws `kind` every `every` ticks. */
function scriptedAttacker(w: CombatWorld, kind: AttackKind, every: number, keepRange = 1.05) {
  let t = 0;
  return (): FighterIntent => {
    t++;
    const [a, b] = w.fighters;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const i = emptyIntent();
    a.stamina = 100;
    if (d > keepRange + 0.1) {
      i.moveX = (b.x - a.x) / d;
      i.moveZ = (b.z - a.z) / d;
    }
    if (t % every === 0) i.attack = kind;
    return i;
  };
}

function duel(rules: () => Ruleset, d0: Difficulty, d1: Difficulty, seed: number) {
  const w = world(rules());
  const a = new AIController(d0, seed * 7 + 1);
  const b = new AIController(d1, seed * 13 + 5);
  for (let i = 0; i < 60 * 60 * 6 && w.phase !== 'match-over'; i++) {
    w.step([a.think(w, w.fighters[0], w.fighters[1]), b.think(w, w.fighters[1], w.fighters[0])]);
    w.events.length = 0;
  }
  return { w, a, b };
}

describe('AI difficulty ladder (seeded AI-vs-AI matches)', () => {
  for (const mode of ['arcade', 'competitive'] as const) {
    it(`black belt beats white belt in most ${mode} matches`, () => {
      let wins = 0;
      const N = 8;
      for (let s = 1; s <= N; s++) {
        // Alternate corners so neither side has an advantage.
        const hardFirst = s % 2 === 0;
        const { w } = duel(() => (mode === 'arcade' ? ArcadeRules : new CompetitiveRules()), hardFirst ? 'hard' : 'easy', hardFirst ? 'easy' : 'hard', s);
        if (w.matchWinner === (hardFirst ? 0 : 1)) wins++;
      }
      expect(wins).toBeGreaterThanOrEqual(6);
    });
  }

  it('red belt beats white belt more often than not', () => {
    let wins = 0;
    for (let s = 1; s <= 8; s++) {
      const redFirst = s % 2 === 0;
      const { w } = duel(() => new CompetitiveRules(), redFirst ? 'normal' : 'easy', redFirst ? 'easy' : 'normal', s + 40);
      if (w.matchWinner === (redFirst ? 0 : 1)) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  });
});

describe('defense and fairness', () => {
  function defend(d: Difficulty, kind: AttackKind = 'round', seeds = 6) {
    let blocks = 0;
    let hits = 0;
    let fastest = Infinity;
    for (let s = 1; s <= seeds; s++) {
      const w = world(ArcadeRules, 1.2);
      const ai = new AIController(d, s);
      const atk = scriptedAttacker(w, kind, 45);
      let attackStart = -1;
      for (let i = 0; i < 1200; i++) {
        const before = w.fighters[1].state;
        w.step([atk(), ai.think(w, w.fighters[1], w.fighters[0])]);
        w.fighters[1].health = 100;
        for (const e of w.events) {
          if (e.type === 'attack' && e.fighter === 0) attackStart = w.tick - 1;
          if (e.type === 'block' && e.defender === 1) blocks++;
          if (e.type === 'hit' && e.defender === 1) hits++;
        }
        // Guard reaction time: ticks from the attacker's first frame to the AI's guard.
        if (before !== 'guard' && w.fighters[1].state === 'guard' && attackStart >= 0) fastest = Math.min(fastest, w.tick - attackStart);
        w.events.length = 0;
      }
    }
    return { rate: blocks / Math.max(1, blocks + hits), fastest };
  }

  it('block rate rises with difficulty', () => {
    const e = defend('easy').rate;
    const n = defend('normal').rate;
    const h = defend('hard').rate;
    expect(h).toBeGreaterThan(e);
    expect(n).toBeGreaterThan(e);
  });

  it('never reacts faster than its perception delay allows (no impossible reactions)', () => {
    for (const d of DIFFS) {
      const w = world(ArcadeRules, 1.2);
      const ai = new AIController(d, 11);
      const atk = scriptedAttacker(w, 'side', 45);
      for (let i = 0; i < 4000; i++) {
        w.step([atk(), ai.think(w, w.fighters[1], w.fighters[0])]);
        w.fighters[1].health = 100;
        w.events.length = 0;
      }
      expect(ai.stats.reactionDelays.length, d).toBeGreaterThan(0);
      expect(Math.min(...ai.stats.reactionDelays), d).toBeGreaterThanOrEqual(AI_PROFILES[d].reaction);
    }
  });

  it('punishes missed attacks more at higher difficulty', () => {
    const punishes = (d: Difficulty) => {
      let n = 0;
      for (let s = 1; s <= 4; s++) {
        const w = world(ArcadeRules, 1.7);
        const ai = new AIController(d, s);
        let t = 0;
        for (let i = 0; i < 900; i++) {
          t++;
          // The scripted player whiffs a slow side kick from just outside range.
          const a = w.fighters[0];
          a.stamina = 100;
          const i0 = emptyIntent();
          if (t % 50 === 0) i0.attack = 'back';
          w.step([i0, ai.think(w, w.fighters[1], w.fighters[0])]);
          w.fighters[0].health = 100;
          // Keep the player at the same spot.
          w.fighters[0].x = 0;
          w.fighters[0].z = -0.85;
        }
        n += ai.stats.punishes;
      }
      return n;
    };
    expect(punishes('hard')).toBeGreaterThan(punishes('easy'));
  });

  it('recognises a repeated technique (black belt), white belt does not adapt', () => {
    for (const [d, expectHabit] of [
      ['hard', true],
      ['easy', false],
    ] as const) {
      const w = world(ArcadeRules, 1.2);
      const ai = new AIController(d, 3);
      const atk = scriptedAttacker(w, 'round', 40);
      for (let i = 0; i < 400; i++) {
        w.step([atk(), ai.think(w, w.fighters[1], w.fighters[0])]);
        w.fighters[1].health = 100;
        w.events.length = 0;
      }
      expect(ai.predictedHabit() === 'round', d).toBe(expectHabit);
    }
  });
});

describe('distance, boundary and tactics', () => {
  it('manages distance: stays around kicking range against a passive opponent', () => {
    for (const d of ['normal', 'hard'] as const) {
      const w = world(ArcadeRules, 3);
      const ai = new AIController(d, 9);
      let inBand = 0;
      let n = 0;
      for (let i = 0; i < 1800; i++) {
        w.step([emptyIntent(), ai.think(w, w.fighters[1], w.fighters[0])]);
        w.fighters[0].health = 100;
        w.events.length = 0;
        if (i > 180) {
          const dist = Math.hypot(w.fighters[0].x - w.fighters[1].x, w.fighters[0].z - w.fighters[1].z);
          n++;
          if (dist > 0.75 && dist < 1.75) inBand++;
        }
      }
      expect(inBand / n, d).toBeGreaterThan(0.6);
    }
  });

  it('never walks out voluntarily (black/red belt); being kicked out is counted separately', () => {
    const voluntaryOuts = (d: Difficulty) => {
      let n = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const w = world(new CompetitiveRules());
        const ai = new AIController(d, seed);
        const opp = new AIController('normal', seed + 100);
        w.fighters[1].x = 3.2;
        let prevState = w.fighters[1].state;
        for (let i = 0; i < 60 * 60 && w.phase !== 'match-over'; i++) {
          prevState = w.fighters[1].state;
          w.step([opp.think(w, w.fighters[0], w.fighters[1]), ai.think(w, w.fighters[1], w.fighters[0])]);
          for (const e of w.events) {
            const pushed = prevState === 'hitstun' || prevState === 'blockstun' || prevState === 'attack' || prevState === 'dash';
            if (e.type === 'penalty' && e.fighter === 1 && e.reason === 'boundary' && !pushed) n++;
          }
          w.events.length = 0;
        }
      }
      return n;
    };
    expect(voluntaryOuts('hard')).toBe(0);
    expect(voluntaryOuts('normal')).toBe(0);
  });

  it('escapes the boundary when trapped near the line', () => {
    for (const d of ['normal', 'hard'] as const) {
      const w = world(new CompetitiveRules());
      const ai = new AIController(d, 4);
      // AI with its back to the +z line, opponent pressing in.
      w.fighters[1].x = 0;
      w.fighters[1].z = 3.4;
      w.fighters[0].x = 0;
      w.fighters[0].z = 2.0;
      let minEdge = Infinity;
      for (let i = 0; i < 150; i++) {
        w.step([emptyIntent(), ai.think(w, w.fighters[1], w.fighters[0])]);
        w.events.length = 0;
        if (i > 90) minEdge = Math.min(minEdge, 4 - Math.max(Math.abs(w.fighters[1].x), Math.abs(w.fighters[1].z)));
      }
      expect(minEdge, d).toBeGreaterThan(0.75);
    }
  });

  it('is score- and clock-aware: protects a late lead, presses when trailing', () => {
    const attacks = (lead: number) => {
      let n = 0;
      for (let s = 1; s <= 6; s++) {
        const rules = new CompetitiveRules();
        const w = world(rules, 1.6);
        const ai = new AIController('hard', s);
        for (let i = 0; i < 600; i++) {
          rules.stats[1].points = Math.max(0, lead);
          rules.stats[0].points = Math.max(0, -lead);
          w.roundTicksLeft = 15 * 60;
          w.step([emptyIntent(), ai.think(w, w.fighters[1], w.fighters[0])]);
          for (const e of w.events) if (e.type === 'attack' && e.fighter === 1) n++;
          w.events.length = 0;
          // Keep the dummy in range and the score fixed.
          w.fighters[0].x = w.fighters[1].x;
          w.fighters[0].z = w.fighters[1].z - 1.1;
        }
      }
      return n;
    };
    expect(attacks(-8)).toBeGreaterThan(attacks(8));
  });

  it('uses lead-leg techniques to probe (black belt) and respects Kal-yeo', () => {
    const rules = new CompetitiveRules();
    const w = world(rules, 1.5);
    const ai = new AIController('hard', 5);
    const used: Record<string, number> = {};
    let duringBreak = 0;
    for (let i = 0; i < 3000; i++) {
      if (i === 1000) w.callStoppage('Test', 200, false);
      w.step([emptyIntent(), ai.think(w, w.fighters[1], w.fighters[0])]);
      for (const e of w.events) {
        if (e.type === 'attack' && e.fighter === 1) {
          used[e.move.id] = (used[e.move.id] ?? 0) + 1;
          if (w.phase === 'break') duringBreak++;
        }
      }
      w.events.length = 0;
      if (w.phase === 'round-over' || w.phase === 'match-over') break;
    }
    const lead = (used.leadRound ?? 0) + (used.leadFront ?? 0) + (used.leadSide ?? 0);
    const total = Object.values(used).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(5);
    expect(lead / total).toBeGreaterThan(0.2);
    expect(duringBreak).toBe(0);
    void MOVES;
  });
});
