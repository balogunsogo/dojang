/**
 * The Dojang Open: a six-fighter, single-elimination tournament.
 *
 * Pure model, separate from the 60 Hz combat simulation: the draw, the five
 * fixtures, advancement, results, history and persistence. Matches
 * themselves are ordinary Competitive matches (player bouts) or headless
 * simulations (AI-only fixtures, see simulate.ts); this module only records
 * their outcomes.
 */
import type { Difficulty } from '../ai/AIController';
import { type CharacterId, isCharacterId, ROSTER } from '../render/characterFactory';

export const TOURNAMENT_KEY = 'dojang.tournament.v1';
export const HISTORY_LIMIT = 20;

export type Stage = 'qf' | 'sf' | 'f';
export const BOUT_IDS = ['qf1', 'qf2', 'sf1', 'sf2', 'f'] as const;
export type BoutId = (typeof BOUT_IDS)[number];
export type RoundSeconds = 60 | 90 | 120;

/**
 * How a fixture was decided: the player's real match, a headless AI match,
 * the seeded fallback (when the simulation could not finish in budget), or a
 * walkover (the player abandoned before fighting it).
 */
export type BoutSource = 'player' | 'sim' | 'fallback' | 'walkover';

export interface Bout {
  id: BoutId;
  /** Null until decided upstream. */
  a: CharacterId | null;
  b: CharacterId | null;
  winner: CharacterId | null;
  /** Per-round points, `a` first. Empty for a walkover. */
  rounds: [number, number][];
  /** Rounds won, `a` first (a tied round on points is still decided by the tie-breaks). */
  score: [number, number];
  source: BoutSource | null;
}

export interface OpenBracket {
  number: number;
  /** Seed of the draw's RNG (reproducible draws). */
  seed: number;
  fighter: CharacterId;
  difficulty: Difficulty;
  roundSeconds: RoundSeconds;
  seeds: [CharacterId, CharacterId];
  bouts: Record<BoutId, Bout>;
  startedAt: string;
}

export interface ActiveOpen extends OpenBracket {
  version: 1;
}

export type OpenResult = 'champion' | 'runner-up' | 'semifinalist' | 'quarterfinalist';

/** A finished Open, with its final bracket (reviewable from Champion, Eliminated and History). */
export interface OpenRecord extends OpenBracket {
  result: OpenResult;
  champion: CharacterId;
  abandoned: boolean;
  finishedAt: string;
}

export interface TournamentSave {
  version: 1;
  nextNumber: number;
  active: ActiveOpen | null;
  /** Newest first, capped at HISTORY_LIMIT. */
  history: OpenRecord[];
  /** Never capped. */
  totals: { entered: number; titles: number; best: OpenResult | null };
}

export const STAGE_OF: Record<BoutId, Stage> = { qf1: 'qf', qf2: 'qf', sf1: 'sf', sf2: 'sf', f: 'f' };
export const STAGE_NAME: Record<Stage, string> = { qf: 'Quarterfinal', sf: 'Semifinal', f: 'Final' };
export const STAGE_PLURAL: Record<Stage, string> = { qf: 'Quarterfinals', sf: 'Semifinals', f: 'Final' };
export const RESULT_NAME: Record<OpenResult, string> = { champion: 'Champion', 'runner-up': 'Runner-up', semifinalist: 'Semifinalist', quarterfinalist: 'Quarterfinalist' };
const RESULT_RANK: Record<OpenResult, number> = { champion: 3, 'runner-up': 2, semifinalist: 1, quarterfinalist: 0 };
/** The player's bouts, in order. */
export const PLAYER_PATH = ['qf1', 'sf1', 'f'] as const;
/** Which fixture's winner fills which slot. */
const FEEDS: { from: BoutId; to: BoutId; slot: 'a' | 'b' }[] = [
  { from: 'qf1', to: 'sf1', slot: 'b' },
  { from: 'qf2', to: 'sf2', slot: 'b' },
  { from: 'sf1', to: 'f', slot: 'a' },
  { from: 'sf2', to: 'f', slot: 'b' },
];

// ---- RNG and the draw --------------------------------------------------------

/** mulberry32: small, fast, seedable. */
export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a per-fixture seed from the Open's seed. */
export function boutSeed(seed: number, id: BoutId) {
  return (Math.imul(seed ^ 0x9e3779b9, BOUT_IDS.indexOf(id) + 7) >>> 0) || 1;
}

export function newSeed() {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] || 1;
  } catch {
    return (Math.random() * 0xffffffff) >>> 0 || 1;
  }
}

const bout = (id: BoutId, a: CharacterId | null, b: CharacterId | null): Bout => ({ id, a, b, winner: null, rounds: [], score: [0, 0], source: null });

/**
 * Handoff section 3.2: shuffle the other five (Fisher-Yates); the first two
 * are the seeds (byes to the semifinals); the player always fights QF1.
 */
export function createOpen(o: { number: number; seed: number; fighter: CharacterId; difficulty: Difficulty; roundSeconds: RoundSeconds; now?: Date }): ActiveOpen {
  const r = rng(o.seed);
  const others = ROSTER.filter((id) => id !== o.fighter);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const [seed1, seed2, q1, q2a, q2b] = others;
  return {
    version: 1,
    number: o.number,
    seed: o.seed,
    fighter: o.fighter,
    difficulty: o.difficulty,
    roundSeconds: o.roundSeconds,
    seeds: [seed1, seed2],
    bouts: {
      qf1: bout('qf1', o.fighter, q1),
      qf2: bout('qf2', q2a, q2b),
      sf1: bout('sf1', seed1, null),
      sf2: bout('sf2', seed2, null),
      f: bout('f', null, null),
    },
    startedAt: (o.now ?? new Date()).toISOString(),
  };
}

// ---- Queries -------------------------------------------------------------------

export const loserOf = (b: Bout): CharacterId | null => (b.winner === null ? null : b.winner === b.a ? b.b : b.a);
export const isDecided = (b: Bout) => b.winner !== null;
export const seedOf = (o: OpenBracket, id: CharacterId | null): 1 | 2 | null => (id === o.seeds[0] ? 1 : id === o.seeds[1] ? 2 : null);

/** Rounds won, `a` first. */
export const boutScore = (b: Bout): [number, number] => b.score;

/** The player's fixtures won so far. */
export const playerWins = (o: OpenBracket) => PLAYER_PATH.filter((id) => o.bouts[id].winner === o.fighter).length;

/** The bout the player lost, if any. */
export function playerLoss(o: OpenBracket): Bout | null {
  for (const id of PLAYER_PATH) {
    const b = o.bouts[id];
    if (b.winner !== null && b.winner !== o.fighter && (b.a === o.fighter || b.b === o.fighter)) return b;
  }
  return null;
}

/** The player's next bout (both fighters known, undecided), or null when the player is done. */
export function nextPlayerBout(o: OpenBracket): Bout | null {
  if (playerLoss(o)) return null;
  for (const id of PLAYER_PATH) {
    const b = o.bouts[id];
    if (b.winner === null) return b.a && b.b ? b : null;
  }
  return null;
}

/** The player's opponent in a bout. */
export const opponentIn = (o: OpenBracket, b: Bout): CharacterId | null => (b.a === o.fighter ? b.b : b.b === o.fighter ? b.a : null);

/** The stage the player has reached (the stage of the bout they are on, or ended on). */
export function stageReached(o: OpenBracket): Stage {
  const w = playerWins(o);
  return w >= 2 ? 'f' : w === 1 ? 'sf' : 'qf';
}

export function champion(o: OpenBracket): CharacterId | null {
  return o.bouts.f.winner;
}

export const isComplete = (o: OpenBracket) => o.bouts.f.winner !== null;

export function playerResult(o: OpenBracket): OpenResult {
  if (o.bouts.f.winner === o.fighter) return 'champion';
  return ({ f: 'runner-up', sf: 'semifinalist', qf: 'quarterfinalist' } as const)[stageReached(o)];
}

/**
 * AI-only fixtures that must be decided now (handoff 3.3): QF2 once QF1 is
 * decided, SF2 once SF1 is decided, and every remaining fixture (in order)
 * once the player is out. Only fixtures whose two fighters are known.
 */
export function fixturesDue(o: OpenBracket): BoutId[] {
  const out = !!playerLoss(o);
  const due: BoutId[] = [];
  const b = o.bouts;
  if (b.qf2.winner === null && (b.qf1.winner !== null || out)) due.push('qf2');
  if (b.sf2.winner === null && (b.sf1.winner !== null || out)) due.push('sf2');
  if (out) {
    if (b.sf1.winner === null) due.push('sf1');
    if (b.f.winner === null) due.push('f');
  }
  return due;
}

// ---- Transitions ---------------------------------------------------------------

/** Copy winners into the slots they feed. */
function propagate(bouts: Record<BoutId, Bout>) {
  for (const { from, to, slot } of FEEDS) if (bouts[from].winner && bouts[to][slot] === null) bouts[to] = { ...bouts[to], [slot]: bouts[from].winner };
}

/**
 * Record a fixture's result. Returns a new bracket, or null when the result
 * does not apply (already decided, unknown fighters, inconsistent winner):
 * so a duplicate callback can never record twice.
 */
export function applyResult<T extends OpenBracket>(o: T, id: BoutId, r: { winner: CharacterId; rounds: [number, number][]; score: [number, number]; source: BoutSource }): T | null {
  const b = o.bouts[id];
  if (b.winner !== null || !b.a || !b.b || (r.winner !== b.a && r.winner !== b.b)) return null;
  const bouts = { ...o.bouts, [id]: { ...b, winner: r.winner, rounds: r.rounds.map(([x, y]) => [x, y] as [number, number]), score: [r.score[0], r.score[1]] as [number, number], source: r.source } };
  propagate(bouts);
  return { ...o, bouts };
}

/** Abandon: the player's pending bout goes to the opponent by walkover (no rounds, no match recorded). */
export function walkover<T extends OpenBracket>(o: T): T {
  const b = nextPlayerBout(o);
  if (!b) return o;
  const opp = opponentIn(o, b)!;
  return applyResult(o, b.id, { winner: opp, rounds: [], score: [0, 0], source: 'walkover' }) ?? o;
}

export function toRecord(o: ActiveOpen, abandoned: boolean, now = new Date()): OpenRecord {
  const { version: _v, ...bracket } = o;
  return { ...bracket, result: playerResult(o), champion: champion(o)!, abandoned, finishedAt: now.toISOString() };
}

/** Move a complete Open into history (newest first, capped) and update the totals. */
export function finishOpen(s: TournamentSave, abandoned: boolean, now = new Date()): TournamentSave {
  if (!s.active || !isComplete(s.active)) return s;
  const rec = toRecord(s.active, abandoned, now);
  const best = s.totals.best && RESULT_RANK[s.totals.best] >= RESULT_RANK[rec.result] ? s.totals.best : rec.result;
  return {
    ...s,
    active: null,
    history: [rec, ...s.history.filter((h) => h.number !== rec.number)].slice(0, HISTORY_LIMIT),
    totals: { entered: s.totals.entered + 1, titles: s.totals.titles + (rec.result === 'champion' ? 1 : 0), best },
  };
}

export function emptySave(): TournamentSave {
  return { version: 1, nextNumber: 1, active: null, history: [], totals: { entered: 0, titles: 0, best: null } };
}

/** Start a new Open (only when none is active). */
export function enterOpen(s: TournamentSave, o: { seed: number; fighter: CharacterId; difficulty: Difficulty; roundSeconds: RoundSeconds; now?: Date }): TournamentSave {
  if (s.active) return s;
  return { ...s, nextNumber: s.nextNumber + 1, active: createOpen({ ...o, number: s.nextNumber }) };
}

// ---- Persistence ---------------------------------------------------------------

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const SOURCES: BoutSource[] = ['player', 'sim', 'fallback', 'walkover'];
const RESULTS = Object.keys(RESULT_RANK) as OpenResult[];
const int = (v: unknown, min = 0): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min ? v : null);
const charOrNull = (v: unknown): CharacterId | null | undefined => (v === null ? null : isCharacterId(v) ? v : undefined);

function readBout(id: BoutId, raw: unknown): Bout | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const a = charOrNull(r.a);
  const b = charOrNull(r.b);
  const winner = charOrNull(r.winner);
  if (a === undefined || b === undefined || winner === undefined) return null;
  if (winner !== null && winner !== a && winner !== b) return null;
  const rounds: [number, number][] = [];
  if (Array.isArray(r.rounds)) {
    for (const x of r.rounds) {
      if (!Array.isArray(x) || x.length !== 2) return null;
      const p = int(x[0]);
      const q = int(x[1]);
      if (p === null || q === null) return null;
      rounds.push([p, q]);
    }
  }
  if (rounds.length > 3) return null;
  const sc = Array.isArray(r.score) && r.score.length === 2 ? [int(r.score[0]), int(r.score[1])] : [0, 0];
  if (sc[0] === null || sc[1] === null || sc[0] > 3 || sc[1] > 3) return null;
  const score: [number, number] = [sc[0], sc[1]];
  const source = SOURCES.includes(r.source as BoutSource) ? (r.source as BoutSource) : null;
  if ((winner === null) !== (source === null)) return null;
  return { id, a, b, winner, rounds, score, source };
}

/** Validates an Open's bracket: known fighters, the draw's shape, consistent winners. */
function readBracket(raw: unknown): OpenBracket | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const number = int(r.number, 1);
  const seed = int(r.seed);
  if (number === null || seed === null || !isCharacterId(r.fighter) || !DIFFICULTIES.includes(r.difficulty as Difficulty)) return null;
  if (r.roundSeconds !== 60 && r.roundSeconds !== 90 && r.roundSeconds !== 120) return null;
  if (!Array.isArray(r.seeds) || r.seeds.length !== 2 || !r.seeds.every(isCharacterId)) return null;
  const rb = r.bouts as Record<string, unknown> | undefined;
  if (!rb || typeof rb !== 'object') return null;
  const bouts = {} as Record<BoutId, Bout>;
  for (const id of BOUT_IDS) {
    const b = readBout(id, rb[id]);
    if (!b) return null;
    bouts[id] = b;
  }
  const o: OpenBracket = {
    number,
    seed,
    fighter: r.fighter,
    difficulty: r.difficulty as Difficulty,
    roundSeconds: r.roundSeconds,
    seeds: [r.seeds[0], r.seeds[1]],
    bouts,
    startedAt: typeof r.startedAt === 'string' ? r.startedAt : new Date(0).toISOString(),
  };
  // Shape of the draw: six distinct fighters, the player in QF1, seeds in the semifinals.
  const field = [bouts.qf1.a, bouts.qf1.b, bouts.qf2.a, bouts.qf2.b, o.seeds[0], o.seeds[1]];
  if (new Set(field).size !== 6 || field.includes(null) || bouts.qf1.a !== o.fighter || bouts.sf1.a !== o.seeds[0] || bouts.sf2.a !== o.seeds[1]) return null;
  // Every filled downstream slot must be its feeder's winner.
  for (const { from, to, slot } of FEEDS) if (bouts[to][slot] !== null && bouts[to][slot] !== bouts[from].winner) return null;
  return o;
}

function readRecord(raw: unknown): OpenRecord | null {
  const o = readBracket(raw);
  if (!o) return null;
  const r = raw as Record<string, unknown>;
  if (!RESULTS.includes(r.result as OpenResult) || !isCharacterId(r.champion) || o.bouts.f.winner !== r.champion) return null;
  return { ...o, result: r.result as OpenResult, champion: r.champion, abandoned: r.abandoned === true, finishedAt: typeof r.finishedAt === 'string' ? r.finishedAt : o.startedAt };
}

/**
 * Accept any stored shape. A corrupt or unknown active Open (for example a
 * fighter this build doesn't have) is discarded silently; invalid history
 * entries are dropped; totals are kept.
 */
export function migrate(raw: unknown): TournamentSave {
  const s = emptySave();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.history)) s.history = r.history.map(readRecord).filter((x): x is OpenRecord => !!x).slice(0, HISTORY_LIMIT);
  const t = (r.totals ?? {}) as Record<string, unknown>;
  s.totals.entered = Math.max(int(t.entered) ?? 0, s.history.length);
  s.totals.titles = Math.max(int(t.titles) ?? 0, s.history.filter((h) => h.result === 'champion').length);
  const bests = [t.best, ...s.history.map((h) => h.result)].filter((x): x is OpenResult => RESULTS.includes(x as OpenResult));
  s.totals.best = bests.reduce<OpenResult | null>((m, x) => (m && RESULT_RANK[m] >= RESULT_RANK[x] ? m : x), null);
  const active = r.active ? readBracket(r.active) : null;
  s.active = active && !isComplete(active) ? { version: 1, ...active } : null;
  const used = Math.max(0, ...s.history.map((h) => h.number), s.active?.number ?? 0);
  s.nextNumber = Math.max(int(r.nextNumber, 1) ?? 1, used + 1);
  return s;
}

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadTournament(storage: Storage | null = safeStorage()): TournamentSave {
  try {
    const raw = storage?.getItem(TOURNAMENT_KEY);
    return raw ? migrate(JSON.parse(raw)) : emptySave();
  } catch {
    return emptySave();
  }
}

/** Returns false when the browser refused to save (private mode, quota). */
export function saveTournament(s: TournamentSave, storage: Storage | null = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(TOURNAMENT_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export const bestResultOf = (s: TournamentSave): OpenResult | null => s.totals.best;
export const latestChampion = (s: TournamentSave): OpenRecord | null => s.history[0] ?? null;
