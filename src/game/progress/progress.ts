import type { Difficulty } from '../ai/AIController';
import type { AttackKind } from '../input/actions';
import type { CharacterId } from '../render/characterFactory';

/**
 * Local player progress: selected fighter, belt, completed challenges,
 * training records and match statistics. Stored in localStorage as
 * versioned JSON; unknown or older data is migrated field by field so a
 * save is never lost to a format change.
 *
 * Belts here are fictional gameplay milestones inspired by Taekwondo
 * training, not official grading requirements.
 */
export type Belt = 'white' | 'yellow' | 'green';
export const BELT_ORDER: Belt[] = ['white', 'yellow', 'green'];

export interface ActivityRecord {
  completions: number;
  attempts: number;
  bestAccuracy: number; // 0..1
  bestScore: number; // activity-specific (hits, reps)
  bestTime: number | null; // seconds to complete, lower is better
  bestCombo: number;
}

export interface Progress {
  version: 1;
  fighter: CharacterId;
  belt: Belt;
  /** Challenge / drill ids completed at least once. */
  completed: string[];
  records: Record<string, ActivityRecord>;
  /** Practice: techniques landed on target, by kind. */
  landed: Partial<Record<AttackKind, number>>;
  matches: {
    played: number;
    won: number;
    /** Wins by AI difficulty (any mode). */
    wins: Record<Difficulty, number>;
  };
}

export const PROGRESS_KEY = 'dojang.progress.v1';

export function defaultProgress(): Progress {
  return {
    version: 1,
    fighter: 'jae',
    belt: 'white',
    completed: [],
    records: {},
    landed: {},
    matches: { played: 0, won: 0, wins: { easy: 0, normal: 0, hard: 0 } },
  };
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Accept any stored shape and return a valid current-version Progress. */
export function migrate(raw: unknown): Progress {
  const p = defaultProgress();
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  if (r.fighter === 'jae' || r.fighter === 'hana') p.fighter = r.fighter;
  if (BELT_ORDER.includes(r.belt as Belt)) p.belt = r.belt as Belt;
  if (Array.isArray(r.completed)) p.completed = r.completed.filter((x): x is string => typeof x === 'string');
  if (r.records && typeof r.records === 'object') {
    for (const [k, v] of Object.entries(r.records as Record<string, Record<string, unknown>>)) {
      if (!v || typeof v !== 'object') continue;
      p.records[k] = {
        completions: num(v.completions),
        attempts: num(v.attempts),
        bestAccuracy: num(v.bestAccuracy),
        bestScore: num(v.bestScore),
        bestTime: typeof v.bestTime === 'number' ? v.bestTime : null,
        bestCombo: num(v.bestCombo),
      };
    }
  }
  if (r.landed && typeof r.landed === 'object') for (const [k, v] of Object.entries(r.landed as Record<string, unknown>)) p.landed[k as AttackKind] = num(v);
  const m = r.matches as Record<string, unknown> | undefined;
  if (m && typeof m === 'object') {
    p.matches.played = num(m.played);
    p.matches.won = num(m.won);
    const w = (m.wins ?? {}) as Record<string, unknown>;
    p.matches.wins = { easy: num(w.easy), normal: num(w.normal), hard: num(w.hard) };
  }
  return p;
}

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function loadProgress(storage: Storage | null = safeStorage()): Progress {
  try {
    const raw = storage?.getItem(PROGRESS_KEY);
    return raw ? migrate(JSON.parse(raw)) : defaultProgress();
  } catch {
    return defaultProgress(); // corrupt JSON or storage blocked
  }
}

/** Returns false when the browser refused to save (private mode, quota). */
export function saveProgress(p: Progress, storage: Storage | null = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PROGRESS_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

// ---- Belt requirements -----------------------------------------------------

export interface Requirement {
  id: string;
  label: string;
  done(p: Progress): boolean;
  /** Short progress text, e.g. "2/4". */
  status(p: Progress): string;
}

const BASICS: AttackKind[] = ['front', 'round', 'side', 'punch'];
const COMBOS = ['combo-front-round', 'combo-lead-rear', 'combo-side-back'];

const acc = (p: Progress, ids: string[]) => Math.max(0, ...ids.map((i) => p.records[i]?.bestAccuracy ?? 0));

/** Requirements to earn each belt (from the belt below it). */
export const BELT_REQUIREMENTS: Record<Exclude<Belt, 'white'>, Requirement[]> = {
  yellow: [
    {
      id: 'practice-basics',
      label: 'Technique practice: land a front kick, roundhouse, side kick and punch',
      done: (p) => BASICS.every((k) => (p.landed[k] ?? 0) > 0),
      status: (p) => `${BASICS.filter((k) => (p.landed[k] ?? 0) > 0).length}/${BASICS.length}`,
    },
    {
      id: 'challenge-body10',
      label: 'Complete the Body kick challenge',
      done: (p) => p.completed.includes('body10'),
      status: (p) => (p.completed.includes('body10') ? 'done' : '—'),
    },
    {
      id: 'accuracy-60',
      label: 'Reach 60% accuracy in a target challenge',
      done: (p) => acc(p, ['body10', 'head5', 'alternate', 'moving']) >= 0.6,
      status: (p) => `${Math.round(acc(p, ['body10', 'head5', 'alternate', 'moving']) * 100)}%`,
    },
    {
      id: 'win-white',
      label: 'Win a sparring match (White belt opponent or harder)',
      done: (p) => p.matches.wins.easy + p.matches.wins.normal + p.matches.wins.hard > 0,
      status: (p) => `${p.matches.wins.easy + p.matches.wins.normal + p.matches.wins.hard} wins`,
    },
  ],
  green: [
    {
      id: 'combos',
      label: 'Complete three combination drills',
      done: (p) => COMBOS.every((c) => p.completed.includes(c)),
      status: (p) => `${COMBOS.filter((c) => p.completed.includes(c)).length}/${COMBOS.length}`,
    },
    {
      id: 'accuracy-75',
      label: 'Reach 75% accuracy in Alternating targets',
      done: (p) => acc(p, ['alternate']) >= 0.75,
      status: (p) => `${Math.round(acc(p, ['alternate']) * 100)}%`,
    },
    {
      id: 'defense',
      label: 'Complete the Block → Counter drill',
      done: (p) => p.completed.includes('block-counter'),
      status: (p) => (p.completed.includes('block-counter') ? 'done' : '—'),
    },
    {
      id: 'win-red',
      label: 'Win a sparring match (Red belt opponent or harder)',
      done: (p) => p.matches.wins.normal + p.matches.wins.hard > 0,
      status: (p) => `${p.matches.wins.normal + p.matches.wins.hard} wins`,
    },
  ],
};

export function nextBelt(b: Belt): Exclude<Belt, 'white'> | null {
  const i = BELT_ORDER.indexOf(b);
  return i >= 0 && i < BELT_ORDER.length - 1 ? (BELT_ORDER[i + 1] as Exclude<Belt, 'white'>) : null;
}

/** If every requirement for the next belt is met, return the promoted progress. */
export function checkPromotion(p: Progress): { progress: Progress; promotedTo: Belt | null } {
  const nb = nextBelt(p.belt);
  if (!nb) return { progress: p, promotedTo: null };
  if (!BELT_REQUIREMENTS[nb].every((r) => r.done(p))) return { progress: p, promotedTo: null };
  return { progress: { ...p, belt: nb }, promotedTo: nb };
}

// ---- Recording -------------------------------------------------------------

export interface TrainingResult {
  activity: string;
  completed: boolean;
  attempts: number;
  hits: number;
  accuracy: number;
  score: number;
  time: number | null;
  bestCombo: number;
  landed: Partial<Record<AttackKind, number>>;
}

export function recordTraining(p: Progress, r: TrainingResult): Progress {
  const prev = p.records[r.activity] ?? { completions: 0, attempts: 0, bestAccuracy: 0, bestScore: 0, bestTime: null, bestCombo: 0 };
  const landed = { ...p.landed };
  for (const [k, v] of Object.entries(r.landed)) landed[k as AttackKind] = (landed[k as AttackKind] ?? 0) + (v ?? 0);
  return {
    ...p,
    landed,
    completed: r.completed && !p.completed.includes(r.activity) ? [...p.completed, r.activity] : p.completed,
    records: {
      ...p.records,
      [r.activity]: {
        completions: prev.completions + (r.completed ? 1 : 0),
        attempts: prev.attempts + 1,
        // Accuracy only counts for completed runs with a meaningful sample.
        bestAccuracy: r.completed && r.attempts >= 5 ? Math.max(prev.bestAccuracy, r.accuracy) : prev.bestAccuracy,
        bestScore: Math.max(prev.bestScore, r.score),
        bestTime: r.completed && r.time !== null ? (prev.bestTime === null ? r.time : Math.min(prev.bestTime, r.time)) : prev.bestTime,
        bestCombo: Math.max(prev.bestCombo, r.bestCombo),
      },
    },
  };
}

export function recordMatch(p: Progress, difficulty: Difficulty, won: boolean): Progress {
  return {
    ...p,
    matches: {
      played: p.matches.played + 1,
      won: p.matches.won + (won ? 1 : 0),
      wins: { ...p.matches.wins, [difficulty]: p.matches.wins[difficulty] + (won ? 1 : 0) },
    },
  };
}
