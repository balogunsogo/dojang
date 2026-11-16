/**
 * One headless Dojang Open fixture: the existing CombatWorld with Competitive
 * rules and two AIControllers. Dependency-light (no rendering, no roster), so
 * it runs in the simulation worker as well as on the main thread.
 */
import type { Difficulty } from '../ai/AIController';
import { AIController } from '../ai/AIController';
import { CombatWorld } from '../combat/CombatWorld';
import type { FighterStats } from '../combat/Fighter';
import { TICK_HZ } from '../config';
import { CompetitiveRules } from '../rules/competitive/CompetitiveRules';
import { rng } from './rng';

export interface HeadlessResult {
  winner: 0 | 1;
  rounds: [number, number][];
  score: [number, number];
  frames: number;
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
  constructor(stats: [FighterStats, FighterStats], difficulty: Difficulty, roundSeconds: 60 | 90 | 120, seed: number) {
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
  result(): HeadlessResult | null {
    if (this.winner === null) return null;
    const rounds = this.rules.history.map((h) => [h.stats[0].points, h.stats[1].points] as [number, number]);
    return { winner: this.winner, rounds, score: [this.world.roundWins[0], this.world.roundWins[1]], frames: this.frames };
  }
}

