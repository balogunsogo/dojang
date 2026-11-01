import { describe, expect, it } from 'vitest';
import { CombatWorld, type CombatEvent } from '../src/game/combat/CombatWorld';
import type { FighterStats } from '../src/game/combat/Fighter';
import { testLegs } from '../src/game/combat/hit';
import { MOVES, startupOf } from '../src/game/combat/moves';
import { type AttackKind, emptyIntent, type FighterIntent, type TargetHeight } from '../src/game/input/actions';
import { CompetitiveRules } from '../src/game/rules/competitive/CompetitiveRules';
import { ROUND_DURATIONS, SENIOR_ROUND_SECONDS, WT_2026 } from '../src/game/rules/competitive/config';
import { decideRound, emptyStats, matchResult } from '../src/game/rules/competitive/rounds';
import { extensionAtContact, isTurningTechnique } from '../src/game/rules/competitive/validation';
import { ArcadeRules } from '../src/game/rules/rules';

const STATS: FighterStats = { speed: 1, power: 1, staminaRegen: 1, maxHealth: 100 };

function comp(gap = 1.0, cfg = WT_2026) {
  const rules = new CompetitiveRules(cfg);
  const w = new CombatWorld(rules, [STATS, STATS]);
  w.skipIntro = true;
  w.resetMatch();
  w.events.length = 0;
  place(w, gap);
  return { w, rules };
}
function place(w: CombatWorld, gap: number) {
  const [a, b] = w.fighters;
  a.x = 0;
  a.z = 0;
  a.yaw = 0;
  b.x = 0;
  b.z = gap;
  b.yaw = Math.PI;
}
const idle = (): FighterIntent => emptyIntent();
const atk = (kind: AttackKind, height: TargetHeight = 'body'): FighterIntent => ({ ...emptyIntent(), attack: kind, height });
function run(w: CombatWorld, n: number, a: () => FighterIntent = idle, b: () => FighterIntent = idle) {
  for (let i = 0; i < n; i++) w.step([a(), b()]);
}
const of = <T extends CombatEvent['type']>(w: CombatWorld, t: T) => w.events.filter((e) => e.type === t) as Extract<CombatEvent, { type: T }>[];

describe('competitive scoring', () => {
  const cases: [AttackKind, TargetHeight, number, number][] = [
    ['punch', 'body', 0.85, 1],
    ['front', 'body', 1.0, 2],
    ['round', 'body', 1.0, 2],
    ['side', 'body', 1.15, 2],
    ['leadRound', 'body', 1.05, 2],
    ['leadFront', 'body', 1.05, 2],
    ['leadSide', 'body', 1.15, 2],
    ['front', 'head', 0.95, 3],
    ['round', 'head', 0.95, 3],
    ['leadRound', 'head', 0.95, 3],
    ['back', 'body', 1.05, 4],
    ['back', 'head', 1.0, 6],
  ];
  for (const [kind, h, gap, pts] of cases) {
    it(`${kind} to the ${h} scores ${pts}`, () => {
      const { w } = comp(gap);
      w.step([atk(kind, h), idle()]);
      run(w, 50);
      const hit = of(w, 'hit')[0];
      expect(hit, 'no contact').toBeTruthy();
      expect(hit.valid, hit.reason).toBe(true);
      expect(hit.points).toBe(pts);
      expect(w.points[0]).toBe(pts);
    });
  }

  it('turning bonus comes from the technique, not hip rotation: roundhouse never qualifies', () => {
    expect(isTurningTechnique(MOVES.round, WT_2026)).toBe(false);
    expect(isTurningTechnique(MOVES.leadRound, WT_2026)).toBe(false);
    expect(isTurningTechnique(MOVES.back, WT_2026)).toBe(true);
    const { w } = comp(0.95);
    w.step([atk('round', 'head'), idle()]);
    run(w, 50);
    expect(of(w, 'hit')[0].turning).toBe(false);
    expect(w.points[0]).toBe(3);
  });

  it('a jammed kick (opponent too close for extension) does not score', () => {
    const { w } = comp(0.7);
    w.step([atk('front'), idle()]);
    run(w, 50);
    const hit = of(w, 'hit')[0];
    expect(hit).toBeTruthy();
    expect(hit.valid).toBe(false);
    expect(hit.reason).toBe('Insufficient impact');
    expect(w.points[0]).toBe(0);
  });

  it('extension is measured from the latched impact point', () => {
    const { w } = comp(0.7);
    w.step([atk('front'), idle()]);
    run(w, MOVES.front.startup + 1);
    expect(extensionAtContact(w.fighters[0].attack!)).toBeLessThan(0.45);
  });

  it('blocked techniques score nothing', () => {
    const { w } = comp(1.0);
    const guard = () => ({ ...emptyIntent(), guard: true });
    w.step([atk('round'), guard()]);
    run(w, 50, idle, guard);
    expect(of(w, 'block').length).toBe(1);
    expect(w.points).toEqual([0, 0]);
  });

  it('whiffs and out-of-range attacks score nothing', () => {
    const { w } = comp(2.2);
    w.step([atk('side'), idle()]);
    run(w, 50);
    expect(of(w, 'hit').length).toBe(0);
    expect(w.points).toEqual([0, 0]);
  });

  it('competitive ignores health: no damage, no knockouts', () => {
    const { w } = comp(1.0);
    w.step([atk('side'), idle()]);
    run(w, 50);
    expect(w.fighters[1].health).toBe(100);
  });
});

describe('gam-jeom', () => {
  it('crossing the boundary: +1 to the opponent, Kal-yeo, fighters return to their marks', () => {
    const { w, rules } = comp(2);
    w.fighters[0].z = -WT_2026.boundary + 0.2;
    const back = () => ({ ...emptyIntent(), moveZ: -1 });
    run(w, 40, back);
    const p = of(w, 'penalty');
    expect(p.length).toBe(1);
    expect(p[0].fighter).toBe(0);
    expect(p[0].pointsToOpponent).toBe(1);
    expect(w.points).toEqual([0, 1]);
    expect(rules.stats[0].gamjeom).toBe(1);
    expect(of(w, 'stoppage')[0].reason).toBe('Out of bounds');
    run(w, WT_2026.stoppageTicks.boundary + 5);
    expect(w.phase).toBe('fight');
    expect(w.fighters[0].z).toBeCloseTo(-1.2, 1);
  });

  it('passive gam-jeom in the last 10 seconds gives 2 points', () => {
    const { w } = comp(2);
    w.roundTicksLeft = 5 * 60;
    w.fighters[0].z = -WT_2026.boundary + 0.05;
    run(w, 30, () => ({ ...emptyIntent(), moveZ: -1 }));
    expect(of(w, 'penalty')[0].pointsToOpponent).toBe(2);
    expect(w.points[1]).toBe(2);
  });

  it('retreating inside the area is never penalized', () => {
    const { w } = comp(2);
    run(w, 60, () => ({ ...emptyIntent(), moveZ: -1 }));
    expect(w.fighters[0].z).toBeLessThan(-0.5);
    expect(of(w, 'penalty').length).toBe(0);
  });

  it('attacking after Kal-yeo is penalized; techniques already in flight are not', () => {
    const { w } = comp(1.0);
    w.callStoppage('Test', 80, false);
    w.step([atk('round'), idle()]); // within grace
    run(w, 2);
    expect(of(w, 'penalty').length).toBe(0);
    run(w, WT_2026.kalyeoGraceTicks + 30);
    w.step([atk('front'), idle()]);
    run(w, 2);
    const p = of(w, 'penalty');
    expect(p.length).toBe(1);
    expect(p[0].reason).toBe('after-kalyeo');
  });

  it('contact during a stoppage never scores', () => {
    const { w } = comp(1.0);
    w.step([atk('round'), idle()]);
    w.callStoppage('Test', 80, false);
    run(w, 40);
    const hit = of(w, 'hit')[0];
    expect(hit?.valid).toBe(false);
    expect(w.points[0]).toBe(0);
  });

  it('attacking a fallen opponent is penalized', () => {
    const { w } = comp(1.0);
    w.fighters[1].knockDown(200, 'knockdown');
    w.callStoppage('Knockdown', 200, false);
    run(w, 40);
    w.step([atk('round'), idle()]);
    run(w, 2);
    expect(of(w, 'penalty')[0].reason).toBe('fallen-opponent');
  });

  it('below-the-waist contact is detected geometrically', () => {
    expect(testLegs([0, 0.5, 0.2], [0, 0.6, 1.0], 0.1, 0, 1.0)).toBe(true);
    expect(testLegs([0, 1.2, 0.2], [0, 1.2, 1.0], 0.1, 0, 1.0)).toBe(false);
    const { w, rules } = comp(1.0);
    rules.onIllegalContact(w, w.fighters[0]);
    expect(of(w, 'penalty')[0].reason).toBe('below-waist');
    expect(w.points[1]).toBe(1);
  });

  it('reaching the gam-jeom limit loses the round', () => {
    const { w, rules } = comp(1.0);
    for (let i = 0; i < WT_2026.gamjeomRoundLimit; i++) rules.penalize(w, w.fighters[1], 'below-waist');
    expect(w.roundWins).toEqual([1, 0]);
    expect(of(w, 'round-end')[0].reason).toBe('penalties');
  });

  it('a self-inflicted fall (exhausted turning kick that misses) is a gam-jeom', () => {
    const { w } = comp(2.4);
    w.fighters[0].stamina = 6;
    w.step([atk('back'), idle()]);
    run(w, MOVES.back.startup + MOVES.back.active + 5);
    expect(of(w, 'down')[0]).toMatchObject({ fighter: 0, cause: 'fall' });
    expect(of(w, 'penalty')[0].reason).toBe('fall');
  });

  it('a knockdown by a valid head kick is not penalized', () => {
    const { w } = comp(0.95);
    w.fighters[1].stamina = 5;
    w.step([atk('round', 'head'), idle()]);
    run(w, 40);
    expect(of(w, 'down')[0]).toMatchObject({ fighter: 1, cause: 'knockdown' });
    expect(of(w, 'penalty').length).toBe(0);
    expect(w.phase).toBe('break');
    expect(w.points[0]).toBe(3);
  });
});

describe('round and match outcomes', () => {
  it('point gap ends the round', () => {
    const { w, rules } = comp(1.0);
    rules.stats[0].points = WT_2026.pointGap;
    run(w, 1);
    expect(of(w, 'round-end')[0]).toMatchObject({ winner: 0, reason: 'gap' });
  });

  it('the clock decides by points, and the timer stops during Kal-yeo', () => {
    const { w, rules } = comp(1.0);
    const t0 = w.roundTicksLeft;
    w.callStoppage('Test', 30, false);
    run(w, 20);
    expect(w.roundTicksLeft).toBe(t0);
    run(w, 20);
    rules.stats[1].points = 2;
    w.roundTicksLeft = 1;
    run(w, 2);
    expect(of(w, 'round-end')[0]).toMatchObject({ winner: 1, reason: 'time' });
  });

  it('Art. 15.5 tie-break priorities, in order', () => {
    const tied = () => {
      const a = emptyStats();
      const b = emptyStats();
      a.points = b.points = 6;
      return [a, b] as const;
    };
    // a. Turning-kick points beat everything below.
    let [a, b] = tied();
    a.turningPoints = 4;
    b.headPoints = 6;
    b.registeredHits = 9;
    expect(decideRound(a, b)).toMatchObject({ winner: 0, detail: 'Art. 15.5: turning-kick points' });
    // b. Head, then trunk, then punch, then gam-jeom points.
    [a, b] = tied();
    a.headPoints = 3;
    b.trunkPoints = 6;
    expect(decideRound(a, b)).toMatchObject({ winner: 0, detail: 'Art. 15.5: head points' });
    [a, b] = tied();
    a.trunkPoints = 2;
    b.punchPoints = 3;
    expect(decideRound(a, b)).toMatchObject({ winner: 0, detail: 'Art. 15.5: trunk points' });
    [a, b] = tied();
    b.punchPoints = 1;
    a.gamjeomPoints = 3;
    expect(decideRound(a, b)).toMatchObject({ winner: 1, detail: 'Art. 15.5: punch points' });
    [a, b] = tied();
    a.gamjeomPoints = 2;
    b.registeredHits = 5;
    expect(decideRound(a, b)).toMatchObject({ winner: 0, detail: 'Art. 15.5: gam-jeom points' });
    // c. Registered hits.
    [a, b] = tied();
    b.registeredHits = 2;
    a.delivered = 9;
    expect(decideRound(a, b)).toMatchObject({ winner: 1, detail: 'Art. 15.5: registered hits' });
  });

  it('Art. 15.5 d: deterministic game fallback, labelled as a game decision, never a draw', () => {
    const a = emptyStats();
    const b = emptyStats();
    a.delivered = 3;
    expect(decideRound(a, b)).toMatchObject({ winner: 0, reason: 'decision', detail: 'Game decision: techniques delivered' });
    a.delivered = 0;
    b.attempts = 2;
    expect(decideRound(a, b)).toMatchObject({ winner: 1, reason: 'decision', detail: 'Game decision: techniques thrown' });
    b.attempts = 0;
    a.gamjeom = 1;
    expect(decideRound(a, b)).toMatchObject({ winner: 1, detail: 'Game decision: fewer gam-jeom' });
    a.gamjeom = 0;
    a.firstAttackTick = 100;
    b.firstAttackTick = 50;
    expect(decideRound(a, b)).toMatchObject({ winner: 1, detail: 'Game decision: attacked first' });
    const z = decideRound(emptyStats(), emptyStats());
    expect(z.winner).toBe(1);
    expect(z.reason).toBe('decision');
    for (const d of [decideRound(a, b), z]) expect(d.detail).not.toMatch(/referee|WT/i);
  });

  it('best of three (Art. 7.1.2): first to two round wins, no golden round', () => {
    expect(matchResult(1, [1, 0], 2)).toEqual({ over: false, winner: null });
    expect(matchResult(2, [2, 0], 2)).toEqual({ over: true, winner: 0 });
    expect(matchResult(2, [1, 1], 2)).toEqual({ over: false, winner: null });
    expect(matchResult(3, [1, 2], 2)).toEqual({ over: true, winner: 1 });
    expect(matchResult(3, [2, 1], 2)).toEqual({ over: true, winner: 0 });
  });

  it('a full match level on points every round is decided by tie-breaks, never a fourth round', () => {
    const { w, rules } = comp(1.0);
    const finish = (setup: () => void) => {
      setup();
      w.roundTicksLeft = 1;
      run(w, 2);
      if (w.phase === 'round-over') run(w, 200);
    };
    // R1: equal points, Chung has more turning points.
    finish(() => {
      rules.stats[0].points = rules.stats[1].points = 4;
      rules.stats[0].turningPoints = 4;
    });
    // R2: nothing happens at all: deterministic game fallback (Hong).
    finish(() => {});
    expect(w.roundWins).toEqual([1, 1]);
    expect(w.round).toBe(3);
    // R3: equal points, Hong has head points.
    finish(() => {
      rules.stats[0].points = rules.stats[1].points = 3;
      rules.stats[1].headPoints = 3;
    });
    expect(w.phase).toBe('match-over');
    expect(w.round).toBe(3);
    expect(w.matchWinner).toBe(1);
    expect(rules.history.map((h) => h.winner)).toEqual([0, 1, 1]);
    expect(rules.history.map((h) => h.detail)).toEqual(['Art. 15.5: turning-kick points', 'Game decision: no technique thrown (Hong by default)', 'Art. 15.5: head points']);
    expect(rules.history.every((h) => h.winner !== null)).toBe(true);
    // Rematch resets everything.
    w.resetMatch();
    expect(rules.history).toEqual([]);
    expect(rules.matchGamjeom).toEqual([0, 0]);
    expect(w.points).toEqual([0, 0]);
    expect(w.round).toBe(1);
  });

  it('a 2-0 match ends after two rounds', () => {
    const { w, rules } = comp(1.0);
    for (let r = 0; r < 2; r++) {
      rules.stats[0].points = 2;
      w.roundTicksLeft = 1;
      run(w, 2);
      if (w.phase === 'round-over') run(w, 200);
    }
    expect(w.phase).toBe('match-over');
    expect(w.round).toBe(2);
    expect(w.matchWinner).toBe(0);
  });
});

describe('round duration', () => {
  for (const secs of ROUND_DURATIONS) {
    it(`${secs}-second rounds: clock, timeout and next round use ${secs} s`, () => {
      const rules = new CompetitiveRules({ roundSeconds: secs });
      const w = new CombatWorld(rules, [STATS, STATS]);
      w.skipIntro = true;
      w.resetMatch();
      expect(w.roundTicksLeft).toBe(secs * 60);
      expect(w.secondsLeft).toBe(secs);
      rules.stats[0].points = 2;
      run(w, secs * 60 - 1);
      expect(w.phase).toBe('fight');
      expect(w.secondsLeft).toBe(1);
      run(w, 1);
      expect(w.phase).toBe('round-over');
      expect(of(w, 'round-end')[0]).toMatchObject({ winner: 0, reason: 'time' });
      run(w, 200);
      expect(w.round).toBe(2);
      expect(w.roundTicksLeft).toBe(secs * 60 - (200 - 180));
    });
  }
  it('defaults to 90 s; 120 s is identified as the senior standard', () => {
    expect(new CompetitiveRules().roundSeconds).toBe(90);
    expect(SENIOR_ROUND_SECONDS).toBe(120);
    expect([...ROUND_DURATIONS]).toEqual([60, 90, 120]);
  });
});

describe('gam-jeom limits (Art. 14)', () => {
  it('five gam-jeom in one round lose that round only', () => {
    const { w, rules } = comp(1.0);
    for (let i = 0; i < 4; i++) rules.penalize(w, w.fighters[0], 'below-waist');
    expect(w.phase).not.toBe('round-over');
    rules.penalize(w, w.fighters[0], 'below-waist');
    expect(of(w, 'round-end')[0]).toMatchObject({ winner: 1, reason: 'penalties' });
    expect(w.phase).toBe('round-over');
    expect(w.roundWins).toEqual([0, 1]);
  });

  it('ten cumulative gam-jeom across the match lose the match', () => {
    const { w, rules } = comp(1.0);
    const gj = (n: number) => {
      for (let i = 0; i < n; i++) rules.penalize(w, w.fighters[0], 'after-kalyeo');
    };
    /** End the current round on time with `leader` ahead, then step into the next round's fight. */
    const endRound = (leader: 0 | 1) => {
      const r = w.round;
      rules.stats[leader].points = rules.stats[1 - leader].points + 1;
      w.roundTicksLeft = 1;
      for (let i = 0; i < 2000 && w.phase !== 'match-over' && !(w.round > r && w.phase === 'fight'); i++) w.step([idle(), idle()]);
    };
    gj(4); // round 1: 4 (below the round limit of 5)
    endRound(0);
    expect(w.roundWins).toEqual([1, 0]);
    gj(4); // round 2: 4 more → 8 in the match
    endRound(1);
    expect(w.roundWins).toEqual([1, 1]);
    expect(rules.matchGamjeom[0]).toBe(8);
    expect(w.round).toBe(3);
    gj(2); // round 3: the 10th gam-jeom loses the match, despite only 2 this round
    expect(w.phase).toBe('match-over');
    expect(w.matchWinner).toBe(1);
    expect(of(w, 'round-end').pop()).toMatchObject({ reason: 'penalties', detail: '10 gam-jeom in the match' });
    expect(rules.history.pop()?.stats[0].gamjeom).toBe(2);
  });

  it('passive gam-jeom in the last 10 s awards 2; active ones always 1', () => {
    const { w, rules } = comp(1.0);
    w.roundTicksLeft = 9 * 60;
    rules.penalize(w, w.fighters[0], 'boundary');
    rules.penalize(w, w.fighters[0], 'fall');
    rules.penalize(w, w.fighters[0], 'after-kalyeo');
    expect(of(w, 'penalty').map((p) => p.pointsToOpponent)).toEqual([2, 2, 1]);
    w.roundTicksLeft = 11 * 60;
    rules.penalize(w, w.fighters[1], 'boundary');
    expect(of(w, 'penalty').pop()!.pointsToOpponent).toBe(1);
    expect(rules.stats[1].gamjeomPoints).toBe(5);
  });
});

describe('arcade is unaffected', () => {
  it('arcade hits award no points and fighters stay inside the mat', () => {
    const w = new CombatWorld(ArcadeRules, [STATS, STATS]);
    w.skipIntro = true;
    w.resetMatch();
    place(w, 1.0);
    w.step([atk('back', 'head'), idle()]);
    run(w, 50);
    expect(w.points).toEqual([0, 0]);
    expect(w.fighters[1].health).toBeLessThan(100);
    expect(w.fighters[0].boundsLimit).toBeCloseTo(3.7);
    w.fighters[0].z = -3.6;
    run(w, 60, () => ({ ...emptyIntent(), moveZ: -1 }));
    expect(w.fighters[0].z).toBeGreaterThanOrEqual(-3.7);
    expect(w.events.some((e) => e.type === 'penalty' || e.type === 'stoppage')).toBe(false);
  });
});

describe('lead-leg techniques', () => {
  const pairs: [AttackKind, AttackKind][] = [
    ['leadFront', 'front'],
    ['leadRound', 'round'],
    ['leadSide', 'side'],
  ];
  it('are faster, cheaper and recover sooner than their rear-leg versions', () => {
    for (const [l, r] of pairs) {
      const L = MOVES[l];
      const R = MOVES[r];
      expect(startupOf(L, 'body'), l).toBeLessThan(startupOf(R, 'body'));
      expect(L.stamina).toBeLessThan(R.stamina);
      expect(L.startup + L.active + L.recovery).toBeLessThan(R.startup + R.active + R.recovery);
      expect(L.damage).toBeLessThan(R.damage);
      expect(L.limb).toBe('leadFoot');
    }
  });

  it('strike from the lead side and mirror correctly in southpaw', () => {
    for (const stance of ['orthodox', 'southpaw'] as const) {
      const { w } = comp(3);
      const f = w.fighters[0];
      f.stance = stance;
      w.step([atk('leadRound'), idle()]);
      run(w, MOVES.leadRound.startup - 1);
      const p = f.strikePoint(0);
      // Orthodox lead leg is the left (+x when facing +z); southpaw mirrors.
      expect(Math.sign(p[0]), stance).toBe(stance === 'orthodox' ? 1 : -1);
    }
  });

  it('lead roundhouse lands a frame window earlier than the rear roundhouse', () => {
    const firstHit = (k: AttackKind) => {
      const { w } = comp(1.0);
      w.step([atk(k), idle()]);
      for (let t = 1; t < 40; t++) {
        w.step([idle(), idle()]);
        if (of(w, 'hit').length) return t;
      }
      return -1;
    };
    expect(firstHit('leadRound')).toBeGreaterThan(0);
    expect(firstHit('leadRound')).toBeLessThan(firstHit('round'));
  });

  it('a lead kick interrupts a slower rear kick (counter hit)', () => {
    const { w } = comp(1.05);
    w.step([idle(), atk('side')]);
    w.step([atk('leadRound'), idle()]);
    run(w, 14);
    expect(of(w, 'hit').some((e) => e.attacker === 0 && e.counter)).toBe(true);
    expect(w.fighters[1].state).toBe('hitstun');
  });
});
