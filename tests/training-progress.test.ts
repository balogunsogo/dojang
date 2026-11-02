import { describe, expect, it } from 'vitest';
import { CombatWorld } from '../src/game/combat/CombatWorld';
import { type AttackKind, emptyIntent, type FighterIntent } from '../src/game/input/actions';
import { checkPromotion, defaultProgress, loadProgress, migrate, PROGRESS_KEY, recordMatch, recordTraining, saveProgress } from '../src/game/progress/progress';
import { activityById } from '../src/game/training/activities';
import { TrainingController } from '../src/game/training/TrainingController';
import { TrainingRules } from '../src/game/training/TrainingRules';

const STATS = { speed: 1, power: 1, staminaRegen: 1, maxHealth: 100 };

function setup(activity: string) {
  const w = new CombatWorld(new TrainingRules(), [STATS, STATS]);
  w.skipIntro = true;
  w.resetMatch();
  w.fighters[0].z = -0.5;
  w.fighters[1].z = 0.5; // 1.0 m: kicking range
  w.events.length = 0;
  return { w, t: new TrainingController(activityById(activity)) };
}
/** Throw `kind` and let it play out, partner driven by the controller. */
function throwAndRun(w: CombatWorld, t: TrainingController, kind: AttackKind | null, ticks = 45, guard = false) {
  for (let i = 0; i < ticks; i++) {
    const me: FighterIntent = { ...emptyIntent(), attack: i === 0 ? kind : null, guard };
    w.fighters[0].stamina = 100;
    w.step([me, t.partnerIntent(w)]);
    t.update(w);
    w.events.length = 0;
    // Keep range constant for a deterministic test.
    w.fighters[0].x = 0;
    w.fighters[0].z = -0.5;
    if (!t.activity.partner.startsWith('att')) {
      w.fighters[1].x = 0;
      w.fighters[1].z = 0.5;
    }
  }
}

describe('progress persistence', () => {
  it('migrates old/partial/garbage saves without losing valid fields', () => {
    expect(migrate(null)).toEqual(defaultProgress());
    const m = migrate({ fighter: 'hana', belt: 'yellow', completed: ['body10', 3], landed: { round: 4 }, matches: { played: 2, won: 1 }, bogus: true });
    expect(m.fighter).toBe('hana');
    expect(m.belt).toBe('yellow');
    expect(m.completed).toEqual(['body10']);
    expect(m.landed.round).toBe(4);
    expect(m.matches.wins).toEqual({ easy: 0, normal: 0, hard: 0 });
    expect(migrate({ belt: 'purple', fighter: 'x' }).belt).toBe('white');
  });

  it('round-trips through storage and survives corrupt JSON and refused writes', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const p = { ...defaultProgress(), belt: 'green' as const, fighter: 'hana' as const };
    expect(saveProgress(p, store)).toBe(true);
    expect(loadProgress(store)).toEqual(p);
    mem.set(PROGRESS_KEY, '{not json');
    expect(loadProgress(store)).toEqual(defaultProgress());
    const refusing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(saveProgress(p, refusing)).toBe(false);
  });
});

describe('belt promotion', () => {
  it('white → yellow needs all four milestones; yellow → green needs its own four', () => {
    let p = defaultProgress();
    p = recordTraining(p, { activity: 'practice', completed: true, attempts: 6, hits: 4, accuracy: 0.66, score: 4, time: null, bestCombo: 2, landed: { front: 1, round: 1, side: 1, punch: 1 } });
    expect(checkPromotion(p).promotedTo).toBeNull();
    p = recordTraining(p, { activity: 'body10', completed: true, attempts: 14, hits: 10, accuracy: 10 / 14, score: 10, time: 22, bestCombo: 5, landed: {} });
    expect(checkPromotion(p).promotedTo).toBeNull(); // still needs a match win
    p = recordMatch(p, 'easy', true);
    const r = checkPromotion(p);
    expect(r.promotedTo).toBe('yellow');
    p = r.progress;
    for (const id of ['combo-front-round', 'combo-lead-rear', 'combo-side-back', 'block-counter'])
      p = recordTraining(p, { activity: id, completed: true, attempts: 6, hits: 6, accuracy: 1, score: 3, time: 20, bestCombo: 2, landed: {} });
    p = recordTraining(p, { activity: 'alternate', completed: true, attempts: 10, hits: 8, accuracy: 0.8, score: 8, time: 30, bestCombo: 4, landed: {} });
    expect(checkPromotion(p).promotedTo).toBeNull(); // needs a red-belt win
    p = recordMatch(p, 'easy', true);
    expect(checkPromotion(p).promotedTo).toBeNull();
    p = recordMatch(p, 'normal', true);
    expect(checkPromotion(p).promotedTo).toBe('green');
    expect(checkPromotion(checkPromotion(p).progress).promotedTo).toBeNull(); // top of the ladder
  });

  it('accuracy only counts on completed runs with at least 5 attempts', () => {
    let p = defaultProgress();
    p = recordTraining(p, { activity: 'alternate', completed: false, attempts: 3, hits: 3, accuracy: 1, score: 3, time: null, bestCombo: 3, landed: {} });
    expect(p.records.alternate.bestAccuracy).toBe(0);
  });
});

describe('training activities on the real simulation', () => {
  it('body challenge counts valid body kicks and completes at the goal', () => {
    const { w, t } = setup('body10');
    for (let i = 0; i < 10 && !t.done; i++) throwAndRun(w, t, 'round');
    expect(t.done).toBe(true);
    expect(t.hits).toBe(10);
    expect(t.attempts).toBe(10);
    expect(t.result().completed).toBe(true);
  });

  it('wrong zone and misses do not count; time limit fails the challenge', () => {
    const { w, t } = setup('head5');
    throwAndRun(w, t, 'round'); // body height: wrong target
    expect(t.hits).toBe(0);
    expect(t.attempts).toBe(1);
    for (let i = 0; i < 40 * 60; i++) throwAndRun(w, t, null, 1);
    expect(t.failed).toBe(true);
    expect(t.result().completed).toBe(false);
  });

  it('combination drill validates order: front → round counts, round → front does not', () => {
    const { w, t } = setup('combo-front-round');
    throwAndRun(w, t, 'round', 35);
    throwAndRun(w, t, 'front', 35);
    expect(t.reps).toBe(0);
    throwAndRun(w, t, 'round', 35); // completes front → round
    expect(t.reps).toBe(1);
    for (let i = 0; i < 2; i++) {
      throwAndRun(w, t, 'front', 35);
      throwAndRun(w, t, 'round', 35);
    }
    expect(t.reps).toBe(3);
    expect(t.done).toBe(true);
  });

  it('combination drill enforces the timing window', () => {
    const { w, t } = setup('combo-front-round');
    throwAndRun(w, t, 'front', 35);
    throwAndRun(w, t, null, 120); // wait 2 s
    throwAndRun(w, t, 'round', 35);
    expect(t.reps).toBe(0);
  });

  it('block → counter drill: the partner attacks, a guard then a kick completes a rep', () => {
    const { w, t } = setup('block-counter');
    let reps = 0;
    for (let i = 0; i < 1200 && t.reps < 1; i++) {
      // Guard until a block registers, then counter.
      const blocked = t.hud().nextStep === 'Counter kick';
      throwAndRun(w, t, blocked ? 'round' : null, blocked ? 30 : 1, !blocked);
      reps = t.reps;
    }
    expect(reps).toBe(1);
  });
});
