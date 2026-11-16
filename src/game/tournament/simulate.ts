/**
 * AI-only fixtures of the Dojang Open, decided by real headless matches: the
 * existing CombatWorld with Competitive rules at the Open's round length and
 * two AIControllers at the Open's difficulty. Nothing here touches the
 * player's match or the rendered scene.
 *
 * The simulation runs on the main thread in short slices (a few ms each,
 * yielding between them), so the match scene keeps rendering while a
 * fixture resolves. The whole batch has a time budget (about 2 s); a fixture
 * that cannot finish in budget, or fails, is decided by a seeded weighted
 * coin from the measured Phase 10 head-to-head win rates instead, with
 * consistent round scores, and is marked `fallback`.
 */
import type { Difficulty } from '../ai/AIController';
import { AIController } from '../ai/AIController';
import { CombatWorld } from '../combat/CombatWorld';
import type { FighterStats } from '../combat/Fighter';
import { TICK_HZ } from '../config';
import { CompetitiveRules } from '../rules/competitive/CompetitiveRules';
import type { CharacterId } from '../render/characterFactory';
import { type BoutId, type BoutSource, boutSeed, type OpenBracket, rng, type RoundSeconds } from './tournament';

export interface FixtureOutcome {
  /** 0 = fighter a, 1 = fighter b. */
  winner: 0 | 1;
  rounds: [number, number][];
  score: [number, number];
  source: Extract<BoutSource, 'sim' | 'fallback'>;
  /** Diagnostics. */
  frames: number;
  ms: number;
  reason?: string;
}

/** Hard cap on simulated time (three full 2:00 rounds plus breaks fit easily). */
const MAX_FRAMES = TICK_HZ * 60 * 9;

/** One headless match, stepped in slices. `slice()` returns true when the match is over. */
export class HeadlessBout {
  readonly world: CombatWorld;
  private readonly rules: CompetitiveRules;
  private readonly ai: [AIController, AIController];
  frames = 0;
  winner: 0 | 1 | null = null;
  constructor(stats: [FighterStats, FighterStats], difficulty: Difficulty, roundSeconds: RoundSeconds, seed: number) {
    this.rules = new CompetitiveRules({ roundSeconds });
    this.world = new CombatWorld(this.rules, stats);
    this.world.skipIntro = true;
    this.world.resetMatch();
    const r = rng(seed);
    this.ai = [new AIController(difficulty, ((r() * 0x7fffffff) | 0) + 1), new AIController(difficulty, ((r() * 0x7fffffff) | 0) + 1)];
  }
  get over() {
    return this.winner !== null || this.frames >= MAX_FRAMES;
  }
  /** Step up to `maxFrames` frames. */
  step(maxFrames: number) {
    const w = this.world;
    for (let i = 0; i < maxFrames && !this.over; i++) {
      w.step([this.ai[0].think(w, w.fighters[0], w.fighters[1]), this.ai[1].think(w, w.fighters[1], w.fighters[0])]);
      this.frames++;
      for (const e of w.events) if (e.type === 'match-end' && e.winner !== null) this.winner = e.winner;
      w.events.length = 0;
    }
    return this.over;
  }
  result(): Omit<FixtureOutcome, 'ms' | 'source'> | null {
    if (this.winner === null) return null;
    const rounds = this.rules.history.map((h) => [h.stats[0].points, h.stats[1].points] as [number, number]);
    return { winner: this.winner, rounds, score: [this.world.roundWins[0], this.world.roundWins[1]], frames: this.frames };
  }
}

// ---- Fallback ----------------------------------------------------------------

/**
 * Head-to-head win rate of the first-named fighter, from the Phase 10
 * balance harness re-run on the shipped stats (9,600 AI-vs-AI matches: every
 * pairing, both corners, Arcade and Competitive, 80 seeds, Hard and Normal;
 * docs/PHASE_10.md). Only these measured pairings are used; White belt uses
 * the same table (it was not measured separately).
 */
const H2H: Record<string, number> = {
  'jae-hana': 0.472, 'jae-tunde': 0.5, 'jae-sofia': 0.534, 'jae-minjun': 0.481, 'jae-amara': 0.497,
  'hana-tunde': 0.519, 'hana-sofia': 0.516, 'hana-minjun': 0.505, 'hana-amara': 0.494,
  'tunde-sofia': 0.508, 'tunde-minjun': 0.472, 'tunde-amara': 0.492,
  'sofia-minjun': 0.502, 'sofia-amara': 0.486, 'minjun-amara': 0.53,
};

export function winRate(a: CharacterId, b: CharacterId): number {
  if (a === b) return 0.5;
  const ab = H2H[`${a}-${b}`];
  if (ab !== undefined) return ab;
  const ba = H2H[`${b}-${a}`];
  return ba !== undefined ? 1 - ba : 0.5;
}

/** Seeded weighted coin with plausible, internally consistent round scores. */
export function fallbackOutcome(a: CharacterId, b: CharacterId, roundSeconds: RoundSeconds, seed: number, reason = 'budget'): FixtureOutcome {
  const r = rng(seed ^ 0x5bd1e995);
  const winner: 0 | 1 = r() < winRate(a, b) ? 0 : 1;
  const threeRounds = r() < 0.4;
  // Round winners in order: 2-0, or 2-1 with the dropped round first or second.
  const order: (0 | 1)[] = threeRounds ? (r() < 0.5 ? [1, 0, 0] : [0, 1, 0]) : [0, 0];
  const scale = roundSeconds / 90;
  const rounds = order.map((rw) => {
    const hi = Math.max(1, Math.round((4 + r() * 9) * scale));
    const lo = Math.min(hi - 1, Math.floor(hi * (0.25 + r() * 0.6)));
    const roundWinner = rw === 0 ? winner : ((1 - winner) as 0 | 1);
    return (roundWinner === 0 ? [hi, lo] : [lo, hi]) as [number, number];
  });
  const score: [number, number] = winner === 0 ? [2, threeRounds ? 1 : 0] : [threeRounds ? 1 : 0, 2];
  return { winner, rounds, score, source: 'fallback', frames: 0, ms: 0, reason };
}

// ---- Batch resolution --------------------------------------------------------

export interface ResolveOptions {
  /** Total wall-clock budget for the batch (ms). */
  budgetMs?: number;
  /** Work per slice before yielding (ms). */
  sliceMs?: number;
  /** Yield to the browser between slices. */
  yieldFn?: () => Promise<void>;
  now?: () => number;
  stats: (id: CharacterId) => FighterStats;
}

export const yieldToMain = (): Promise<void> =>
  new Promise((res) => {
    // A MessageChannel task runs sooner than setTimeout(0) and is not clamped in background tabs.
    try {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => res();
      ch.port2.postMessage(0);
    } catch {
      setTimeout(res, 0);
    }
  });

/** Simulate one fixture of an Open within a deadline. */
export async function resolveFixture(o: OpenBracket, id: BoutId, deadline: number, opts: ResolveOptions): Promise<FixtureOutcome> {
  const b = o.bouts[id];
  const a = b.a!;
  const c = b.b!;
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  const seed = boutSeed(o.seed, id);
  try {
    const sim = new HeadlessBout([opts.stats(a), opts.stats(c)], o.difficulty, o.roundSeconds, seed);
    const sliceMs = opts.sliceMs ?? 6;
    while (!sim.over) {
      const s = now();
      // Step in small batches until this slice's time is used.
      while (!sim.over && now() - s < sliceMs) sim.step(120);
      if (sim.over) break;
      if (now() > deadline) return { ...fallbackOutcome(a, c, o.roundSeconds, seed, 'budget'), ms: now() - t0 };
      await (opts.yieldFn ?? yieldToMain)();
    }
    const res = sim.result();
    if (!res) return { ...fallbackOutcome(a, c, o.roundSeconds, seed, 'frame cap'), ms: now() - t0 };
    return { ...res, source: 'sim', ms: now() - t0 };
  } catch (e) {
    return { ...fallbackOutcome(a, c, o.roundSeconds, seed, `error: ${String(e)}`), ms: now() - t0 };
  }
}
