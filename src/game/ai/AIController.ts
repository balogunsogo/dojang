import type { CombatWorld } from '../combat/CombatWorld';
import type { Fighter, FighterStateName } from '../combat/Fighter';
import { MOVES } from '../combat/moves';
import { type AttackKind, emptyIntent, type FighterIntent } from '../input/actions';
import { createRng, type Rng } from '../math';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AIProfile {
  /** Perception delay (ticks): the AI reacts to what it saw this long ago. */
  reaction: number;
  /** Probability of guarding against a perceived incoming attack. */
  guardChance: number;
  /** Probability per decision of attacking when in range. */
  aggression: number;
  /** Ticks between decisions. */
  thinkInterval: number;
  headChance: number;
  /** Chance to counter-attack right after blocking / evading. */
  counterChance: number;
  /** Will it whiff-punish and use dash-ins / back-steps? */
  footwork: number;
  /** Keeps this much stamina in reserve before attacking. */
  staminaReserve: number;
}

// Preliminary presets (Phase 1). Phase 2 tunes and validates these.
export const AI_PROFILES: Record<Difficulty, AIProfile> = {
  easy: { reaction: 24, guardChance: 0.2, aggression: 0.25, thinkInterval: 20, headChance: 0.1, counterChance: 0.1, footwork: 0.2, staminaReserve: 0 },
  normal: { reaction: 14, guardChance: 0.5, aggression: 0.45, thinkInterval: 12, headChance: 0.25, counterChance: 0.35, footwork: 0.5, staminaReserve: 15 },
  hard: { reaction: 8, guardChance: 0.75, aggression: 0.6, thinkInterval: 7, headChance: 0.35, counterChance: 0.65, footwork: 0.85, staminaReserve: 25 },
};

interface Seen {
  x: number;
  z: number;
  state: FighterStateName;
  attacking: boolean;
  recovering: boolean;
}

/**
 * A reactive sparring AI. It produces the same FighterIntent the player's
 * input produces, so it obeys identical frame data and stamina rules.
 */
export class AIController {
  profile: AIProfile;
  private rng: Rng;
  private history: Seen[] = [];
  private cooldown = 0;
  private plan: { kind: 'circle' | 'approach' | 'retreat' | 'hold'; dir: number; ticks: number } = { kind: 'hold', dir: 1, ticks: 0 };
  private guardTicks = 0;
  private pendingAttack: { kind: AttackKind; head: boolean; delay: number } | null = null;
  private wasBlocking = false;

  constructor(difficulty: Difficulty, seed = 1234) {
    this.profile = AI_PROFILES[difficulty];
    this.rng = createRng(seed);
  }

  setDifficulty(d: Difficulty) {
    this.profile = AI_PROFILES[d];
  }

  think(world: CombatWorld, self: Fighter, opp: Fighter): FighterIntent {
    const p = this.profile;
    const intent = emptyIntent();
    this.history.push({
      x: opp.x,
      z: opp.z,
      state: opp.state,
      attacking: opp.state === 'attack' && opp.attackPhase !== 'recovery',
      recovering: opp.state === 'attack' && opp.attackPhase === 'recovery',
    });
    if (this.history.length > 40) this.history.shift();
    const seen = this.history[Math.max(0, this.history.length - 1 - p.reaction)];

    if (world.phase !== 'fight' || self.state === 'ko' || self.state === 'victory') return intent;

    const dx = seen.x - self.x;
    const dz = seen.z - self.z;
    const dist = Math.hypot(dx, dz);
    const ux = dist > 1e-6 ? dx / dist : 0;
    const uz = dist > 1e-6 ? dz / dist : 1;
    const r = this.rng;

    // Defensive reaction to a perceived attack.
    if (seen.attacking && dist < 1.8 && self.actionable) {
      if (this.guardTicks <= 0 && r() < p.guardChance * 0.35) {
        this.guardTicks = 22 + Math.floor(r() * 12);
        if (r() < p.footwork * 0.3 && self.stamina > 25) {
          intent.dash = true; // back-step out of range
          intent.moveX = -ux;
          intent.moveZ = -uz;
          return intent;
        }
      }
    }
    if (this.guardTicks > 0) {
      this.guardTicks--;
      intent.guard = true;
      this.wasBlocking = true;
      intent.moveX = -ux * 0.3;
      intent.moveZ = -uz * 0.3;
      if (self.state === 'blockstun' && r() < p.counterChance * 0.1 && !this.pendingAttack) {
        this.pendingAttack = { kind: dist < 0.95 ? 'punch' : 'round', head: false, delay: 0 };
        this.guardTicks = 0;
      }
      return intent;
    }
    if (this.wasBlocking) {
      this.wasBlocking = false;
      if (r() < p.counterChance && self.stamina > 20) {
        this.pendingAttack = { kind: dist < 1.0 ? 'front' : 'round', head: false, delay: 2 };
      }
    }

    // Whiff punish: opponent is recovering inside our range.
    if (seen.recovering && dist < 1.35 && !this.pendingAttack && r() < p.footwork * 0.25) {
      this.pendingAttack = { kind: dist < 1.05 ? 'round' : 'side', head: false, delay: 0 };
    }

    if (this.pendingAttack && self.actionable) {
      if (this.pendingAttack.delay-- <= 0) {
        intent.attack = this.pendingAttack.kind;
        intent.height = this.pendingAttack.head ? 'head' : 'body';
        this.pendingAttack = null;
        this.cooldown = p.thinkInterval;
        return intent;
      }
    }

    // Footwork plan.
    if (--this.cooldown <= 0) {
      this.cooldown = p.thinkInterval + Math.floor(r() * p.thinkInterval);
      const ideal = 1.15;
      const inRange = dist < 1.35;
      if (inRange && self.stamina > p.staminaReserve && r() < p.aggression) {
        this.pendingAttack = { kind: this.pickAttack(dist, r), head: r() < p.headChance, delay: 0 };
      } else if (self.stamina < 20) {
        this.plan = { kind: 'retreat', dir: r() < 0.5 ? -1 : 1, ticks: 40 };
      } else if (dist > ideal + 0.35) {
        if (r() < p.footwork * 0.2 && dist < 2.6 && self.stamina > 40) {
          intent.dash = true;
          intent.moveX = ux;
          intent.moveZ = uz;
          return intent;
        }
        this.plan = { kind: 'approach', dir: r() < 0.5 ? -1 : 1, ticks: 30 };
      } else if (dist < 0.85) {
        this.plan = { kind: 'retreat', dir: r() < 0.5 ? -1 : 1, ticks: 20 };
      } else {
        this.plan = { kind: r() < 0.6 ? 'circle' : 'hold', dir: r() < 0.5 ? -1 : 1, ticks: 30 };
      }
    }

    // Lateral vector (perpendicular to the line between fighters).
    const lx = uz * this.plan.dir;
    const lz = -ux * this.plan.dir;
    switch (this.plan.kind) {
      case 'approach':
        intent.moveX = ux * 0.9 + lx * 0.25;
        intent.moveZ = uz * 0.9 + lz * 0.25;
        break;
      case 'retreat':
        intent.moveX = -ux * 0.8 + lx * 0.4;
        intent.moveZ = -uz * 0.8 + lz * 0.4;
        break;
      case 'circle':
        intent.moveX = lx * 0.7 + ux * (dist - 1.15);
        intent.moveZ = lz * 0.7 + uz * (dist - 1.15);
        break;
      case 'hold':
        intent.moveX = ux * (dist - 1.15) * 0.8;
        intent.moveZ = uz * (dist - 1.15) * 0.8;
        break;
    }
    // Stay off the edge of the mat.
    if (Math.abs(self.x) > 3.2) intent.moveX -= Math.sign(self.x) * 0.8;
    if (Math.abs(self.z) > 3.2) intent.moveZ -= Math.sign(self.z) * 0.8;
    return intent;
  }

  private pickAttack(dist: number, r: Rng): AttackKind {
    // Pick a technique whose reach suits the current distance.
    const options: [AttackKind, number][] = [];
    for (const m of Object.values(MOVES)) {
      const reach = m.impact.body[2] + 0.25;
      if (dist > reach) continue;
      let w = 1;
      if (m.id === 'punch') w = dist < 0.95 ? 2 : 0.2;
      if (m.id === 'round') w = 2.5;
      if (m.id === 'front') w = 1.5;
      if (m.id === 'side') w = dist > 1.05 ? 2 : 0.6;
      if (m.id === 'back') w = 0.6;
      options.push([m.id, w]);
    }
    if (options.length === 0) return 'round';
    const total = options.reduce((s, o) => s + o[1], 0);
    let pick = r() * total;
    for (const [k, w] of options) {
      pick -= w;
      if (pick <= 0) return k;
    }
    return options[0][0];
  }
}
