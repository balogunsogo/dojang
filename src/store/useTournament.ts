import { create } from 'zustand';
import type { Difficulty } from '../game/ai/AIController';
import { CHARACTERS, type CharacterId } from '../game/render/characterFactory';
import { type FixtureOutcome, resolveFixture } from '../game/tournament/simulate';
import {
  applyResult,
  type BoutId,
  enterOpen,
  finishOpen,
  fixturesDue,
  isComplete,
  loadTournament,
  newSeed,
  nextPlayerBout,
  type OpenBracket,
  opponentIn,
  type RoundSeconds,
  saveTournament,
  type TournamentSave,
  walkover,
} from '../game/tournament/tournament';
import { useGameStore } from './useGameStore';

/** Batch budget for AI-only fixtures (handoff 3.3: "say 2 s"). */
const SIM_BUDGET_MS = 2000;

export interface FixtureDiag {
  id: BoutId;
  source: FixtureOutcome['source'];
  ms: number;
  frames: number;
  reason?: string;
}

/** The player bout that just ended, for the result panel. */
export interface BoutOutcome {
  number: number;
  bout: BoutId;
  won: boolean;
}

interface TournamentStore {
  save: TournamentSave;
  /** The browser refused the last save (private mode, quota): the Open lives in memory only. */
  saveUnavailable: boolean;
  /** AI-only fixtures are being decided (the result panel waits; never a spinner). */
  busy: boolean;
  lastOutcome: BoutOutcome | null;
  /** Open number shown read-only on the bracket (a finished Open), or null for the active one. */
  review: number | null;
  /** Champion screen already celebrated (sound plays once per Open). */
  celebrated: number[];
  /** Diagnostics of the last background batch. */
  diag: FixtureDiag[];
  enter(o: { fighter: CharacterId; difficulty: Difficulty; roundSeconds: RoundSeconds }): void;
  /** Start the player's next bout as a Competitive match. */
  startBout(): boolean;
  /** Record the player's bout (exactly once), then decide what is due. */
  finishBout(won: boolean, rounds: [number, number][], score: [number, number]): Promise<boolean>;
  abandon(): Promise<void>;
  /** Decide AI-only fixtures that are due (also on load, after a refresh mid-way). */
  resolveDue(abandoned?: boolean): Promise<void>;
  /** Try a save now, to show the "save unavailable" state before an Open starts. */
  probeStorage(): void;
  setReview(n: number | null): void;
  markCelebrated(n: number): void;
}

const stats = (id: CharacterId) => CHARACTERS[id].stats;

function persist(save: TournamentSave) {
  const ok = saveTournament(save);
  useTournament.setState({ save, saveUnavailable: !ok });
}

let resolving: Promise<void> | null = null;

export const useTournament = create<TournamentStore>((set, get) => ({
  save: loadTournament(),
  saveUnavailable: false,
  busy: false,
  lastOutcome: null,
  review: null,
  celebrated: [],
  diag: [],

  enter: (o) => {
    const s = get().save;
    if (s.active) return;
    persist(enterOpen(s, { ...o, seed: newSeed() }));
    set({ review: null, lastOutcome: null });
  },

  startBout: () => {
    const o = get().save.active;
    const b = o && nextPlayerBout(o);
    if (!o || !b) return false;
    useGameStore.getState().startTournamentBout({ number: o.number, bout: b.id, fighter: o.fighter, opponent: opponentIn(o, b)!, roundSeconds: o.roundSeconds }, o.difficulty);
    return true;
  },

  finishBout: async (won, rounds, score) => {
    const t = useGameStore.getState().tournament;
    const o = get().save.active;
    if (!t || !o || o.number !== t.number) return false;
    const b = o.bouts[t.bout];
    const opp = opponentIn(o, b);
    if (!opp) return false;
    // The player's numbers come first; store them in the bout's a/b order.
    const flip = b.a !== o.fighter;
    const next = applyResult(o, t.bout, {
      winner: won ? o.fighter : opp,
      rounds: flip ? rounds.map(([p, q]) => [q, p] as [number, number]) : rounds,
      score: flip ? [score[1], score[0]] : score,
      source: 'player',
    });
    if (!next) return false; // already recorded (a duplicate callback, a revisit): never twice
    set({ busy: true, lastOutcome: { number: o.number, bout: t.bout, won } });
    // Save the bout first, then count it once toward the ordinary match record.
    persist({ ...get().save, active: next });
    useGameStore.getState().recordMatchResult(won);
    await get().resolveDue();
    set({ busy: false });
    return true;
  },

  abandon: async () => {
    if (resolving) await resolving;
    const s = get().save;
    if (!s.active) return;
    set({ busy: true });
    persist({ ...s, active: walkover(s.active) });
    await get().resolveDue(true);
    set({ busy: false, review: null, lastOutcome: null });
  },

  resolveDue: async (abandoned = false) => {
    if (resolving) return resolving;
    resolving = (async () => {
      const deadline = performance.now() + SIM_BUDGET_MS;
      const diag: FixtureDiag[] = [];
      for (let guard = 0; guard < 5; guard++) {
        const o = get().save.active;
        if (!o) break;
        const id = fixturesDue(o)[0];
        if (!id) break;
        const r = await resolveFixture(o, id, deadline, { stats });
        const cur = get().save.active;
        if (!cur || cur.number !== o.number) break;
        const b = cur.bouts[id];
        const next = applyResult(cur, id, { winner: r.winner === 0 ? b.a! : b.b!, rounds: r.rounds, score: r.score, source: r.source });
        diag.push({ id, source: r.source, ms: Math.round(r.ms), frames: r.frames, reason: r.reason });
        if (next) persist({ ...get().save, active: next });
      }
      // A finished Open moves to history (champion, or the player is out and the rest decided).
      const s = get().save;
      if (s.active && isComplete(s.active)) persist(finishOpen(s, abandoned));
      set({ diag });
      if (diag.length && typeof console !== 'undefined') console.info('[Dojang Open] fixtures', diag);
    })();
    try {
      await resolving;
    } finally {
      resolving = null;
    }
  },

  probeStorage: () => persist(get().save),
  setReview: (review) => set({ review }),
  markCelebrated: (n) => set({ celebrated: [...get().celebrated, n] }),
}));

/** The bracket on screen: a finished Open under review, else the active one, else the latest record. */
export function bracketInView(s: { save: TournamentSave; review: number | null }): OpenBracket | null {
  if (s.review !== null) return s.save.history.find((h) => h.number === s.review) ?? null;
  return s.save.active ?? s.save.history[0] ?? null;
}

// After a refresh mid-way (a bout saved but its fixtures not yet decided), finish them.
if (typeof window !== 'undefined') {
  const o = useTournament.getState().save.active;
  if (o && fixturesDue(o).length) queueMicrotask(() => void useTournament.getState().resolveDue());
}
