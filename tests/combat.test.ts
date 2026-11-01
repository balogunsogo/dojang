import { describe, expect, it } from 'vitest';
import { AIController } from '../src/game/ai/AIController';
import { CombatWorld } from '../src/game/combat/CombatWorld';
import type { FighterStats } from '../src/game/combat/Fighter';
import { inGuardArc, testStrike } from '../src/game/combat/hit';
import { MOVES, moveTotal } from '../src/game/combat/moves';
import { type AttackKind, emptyIntent, type FighterIntent, type TargetHeight } from '../src/game/input/actions';
import { ArcadeRules } from '../src/game/rules/rules';

const STATS: FighterStats = { speed: 1, power: 1, staminaRegen: 1, maxHealth: 100 };

function makeWorld(gap = 1.0) {
  const w = new CombatWorld(ArcadeRules, [STATS, STATS]);
  w.skipIntro = true;
  w.resetMatch();
  w.events.length = 0;
  const [a, b] = w.fighters;
  a.x = 0;
  a.z = 0;
  a.yaw = 0;
  b.x = 0;
  b.z = gap;
  b.yaw = Math.PI;
  return w;
}

const idle = (): FighterIntent => emptyIntent();
function attack(kind: AttackKind, height: TargetHeight = 'body'): FighterIntent {
  return { ...emptyIntent(), attack: kind, height };
}
function guard(): FighterIntent {
  return { ...emptyIntent(), guard: true };
}
function run(w: CombatWorld, ticks: number, a: () => FighterIntent = idle, b: () => FighterIntent = idle) {
  for (let i = 0; i < ticks; i++) w.step([a(), b()]);
}

describe('frame data', () => {
  it('every move has positive startup/active/recovery and reachable geometry', () => {
    for (const m of Object.values(MOVES)) {
      expect(m.startup).toBeGreaterThan(0);
      expect(m.active).toBeGreaterThan(0);
      expect(m.recovery).toBeGreaterThan(0);
      for (const h of m.heights) expect(m.impact[h][2]).toBeGreaterThan(m.chamber[2]);
    }
    // Speed ordering: punch < front < round < side < back.
    const order: AttackKind[] = ['punch', 'front', 'round', 'side', 'back'];
    for (let i = 1; i < order.length; i++) expect(MOVES[order[i]].startup).toBeGreaterThan(MOVES[order[i - 1]].startup);
  });
});

describe('attack state machine', () => {
  it('runs startup -> active -> recovery -> idle with exact tick counts', () => {
    const w = makeWorld(3); // out of range
    const f = w.fighters[0];
    w.step([attack('front'), idle()]);
    const m = MOVES.front;
    expect(f.state).toBe('attack');
    expect(f.attackPhase).toBe('startup');
    run(w, m.startup - 1);
    expect(f.attackPhase).toBe('startup');
    run(w, 1);
    expect(f.attackPhase).toBe('active');
    run(w, m.active);
    expect(f.attackPhase).toBe('recovery');
    run(w, m.recovery);
    expect(f.state).toBe('idle');
    expect(moveTotal(m, 'body')).toBe(m.startup + m.active + m.recovery);
  });

  it('spends stamina and refuses to attack when exhausted', () => {
    const w = makeWorld(3);
    const f = w.fighters[0];
    w.step([attack('side'), idle()]);
    expect(f.stamina).toBeLessThan(100);
    run(w, 60);
    f.stamina = 2;
    w.step([attack('round'), idle()]);
    expect(f.state).not.toBe('attack');
  });

  it('regenerates stamina while idle', () => {
    const w = makeWorld(3);
    const f = w.fighters[0];
    f.stamina = 40;
    run(w, 120);
    expect(f.stamina).toBeGreaterThan(55);
  });

  it('buffers an attack pressed during recovery', () => {
    const w = makeWorld(3);
    const f = w.fighters[0];
    w.step([attack('punch'), idle()]);
    const m = MOVES.punch;
    run(w, m.startup + m.active + m.recovery - 4);
    w.step([attack('front'), idle()]);
    run(w, 4);
    expect(f.state).toBe('attack');
    expect(f.attack?.move.id).toBe('front');
  });
});

describe('hit detection', () => {
  it('lands a body roundhouse in range and misses out of range', () => {
    for (const [gap, expectHit] of [
      [1.0, true],
      [2.2, false],
    ] as const) {
      const w = makeWorld(gap);
      const d = w.fighters[1];
      w.step([attack('round'), idle()]);
      run(w, 40);
      expect(d.health < 100).toBe(expectHit);
    }
  });

  it('head kicks register as head hits and deal more damage', () => {
    const body = makeWorld(1.0);
    body.step([attack('round', 'body'), idle()]);
    run(body, 40);
    const head = makeWorld(1.0);
    head.step([attack('round', 'head'), idle()]);
    run(head, 40);
    const zoneOf = (w: CombatWorld) => (w.events.find((e) => e.type === 'hit') as { zone: string } | undefined)?.zone;
    expect(zoneOf(body)).toBe('body');
    expect(zoneOf(head)).toBe('head');
    expect(100 - head.fighters[1].health).toBeGreaterThan(100 - body.fighters[1].health);
  });

  it('punches cannot target the head (falls back to body)', () => {
    const w = makeWorld(0.8);
    w.step([attack('punch', 'head'), idle()]);
    expect(w.fighters[0].attack?.height).toBe('body');
  });

  it('each technique hits at most once', () => {
    const w = makeWorld(1.0);
    w.step([attack('side'), idle()]);
    run(w, 60);
    expect(w.events.filter((e) => e.type === 'hit').length).toBe(1);
  });

  it('testStrike geometry: head sphere and body capsule', () => {
    expect(testStrike([0, 1.6, 0.5], [0, 1.6, 1.0], 0.1, 0, 1.0)).toBe('head');
    expect(testStrike([0, 1.15, 0.5], [0, 1.15, 1.0], 0.1, 0, 1.0)).toBe('body');
    expect(testStrike([0, 0.3, 0.5], [0, 0.3, 1.0], 0.1, 0, 1.0)).toBeNull();
  });
});

describe('defense', () => {
  it('guard blocks a frontal attack: no health damage beyond chip, stamina drained', () => {
    const w = makeWorld(1.0);
    const d = w.fighters[1];
    w.step([attack('round'), guard()]);
    run(w, 40, idle, guard);
    expect(w.events.some((e) => e.type === 'block')).toBe(true);
    expect(d.health).toBeGreaterThan(97);
    expect(d.stamina).toBeLessThan(100);
  });

  it('guard does not cover attacks from behind', () => {
    expect(inGuardArc(0, 0, 0, 0, 1)).toBe(true);
    expect(inGuardArc(0, 0, 0, 0, -1)).toBe(false);
  });

  it('a hit during startup interrupts the attack (counter hit)', () => {
    const w = makeWorld(0.9);
    const [a, b] = w.fighters;
    // B starts a slow back kick; A punches right after.
    w.step([idle(), attack('back')]);
    w.step([attack('punch'), idle()]);
    run(w, 12);
    expect(b.state).toBe('hitstun');
    expect(w.events.some((e) => e.type === 'hit' && e.counter)).toBe(true);
    expect(a.health).toBe(100);
  });
});

describe('match flow', () => {
  it('KO ends the round and the match after enough round wins', () => {
    const w = makeWorld(1.0);
    for (let r = 0; r < ArcadeRules.roundsToWin; r++) {
      w.fighters[1].health = 5;
      w.fighters[0].x = 0;
      w.fighters[0].z = 0;
      w.fighters[1].x = 0;
      w.fighters[1].z = 1.0;
      w.step([attack('front'), idle()]);
      run(w, 40);
      expect(w.fighters[1].state).toBe('ko');
      if (w.phase === 'round-over') run(w, 200);
    }
    expect(w.phase).toBe('match-over');
    expect(w.matchWinner).toBe(0);
  });

  it('timeout decides by remaining health', () => {
    const w = makeWorld(3);
    w.fighters[0].health = 60;
    w.roundTicksLeft = 2;
    run(w, 3);
    expect(w.lastRoundWinner).toBe(1);
  });
});

describe('AI', () => {
  it('produces fights where both sides land techniques (deterministic seed)', () => {
    const w = new CombatWorld(ArcadeRules, [STATS, STATS]);
    w.skipIntro = true;
    w.resetMatch();
    const a = new AIController('hard', 1);
    const b = new AIController('normal', 2);
    let hits = [0, 0];
    for (let i = 0; i < 60 * 60 && w.phase !== 'match-over'; i++) {
      w.step([a.think(w, w.fighters[0], w.fighters[1]), b.think(w, w.fighters[1], w.fighters[0])]);
      for (const e of w.events) if (e.type === 'hit') hits[e.attacker]++;
      w.events.length = 0;
    }
    expect(hits[0]).toBeGreaterThan(0);
    expect(hits[1]).toBeGreaterThan(0);
    hits = [0, 0];
  });

  it('harder AI blocks more often than easy AI against the same attacker', () => {
    const blockRate = (diff: 'easy' | 'hard') => {
      let blocks = 0;
      let attempts = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const w = makeWorld(1.05);
        const ai = new AIController(diff, seed);
        for (let i = 0; i < 1200; i++) {
          const atk = w.fighters[0].actionable && i % 50 === 0 ? attack('round') : idle();
          w.fighters[0].stamina = 100;
          w.fighters[0].x = 0;
          w.fighters[0].z = 0;
          w.step([atk, ai.think(w, w.fighters[1], w.fighters[0])]);
          w.fighters[1].health = 100;
          for (const e of w.events) {
            if (e.type === 'block' && e.defender === 1) blocks++;
            if ((e.type === 'hit' || e.type === 'block') && e.attacker === 0) attempts++;
          }
          w.events.length = 0;
        }
      }
      return attempts ? blocks / attempts : 0;
    };
    expect(blockRate('hard')).toBeGreaterThan(blockRate('easy'));
  });
});
