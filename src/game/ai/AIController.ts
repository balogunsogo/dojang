import type { CombatWorld } from '../combat/CombatWorld';
import type { AttackPhase, Fighter, FighterStateName } from '../combat/Fighter';
import { MOVES, type MoveDef, moveTotal, staminaCost, startupOf } from '../combat/moves';
import { ARENA_HALF, TICK_HZ } from '../config';
import { type AttackKind, emptyIntent, type FighterIntent, type TargetHeight } from '../input/actions';
import { clamp, createRng, type Rng } from '../math';

export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * Difficulty is decision quality, perception delay and strategy. Every
 * profile uses the same actions, frame data, stamina and hit detection as
 * the player; there are no damage multipliers and no access to inputs.
 */
export interface AIProfile {
  label: string;
  /** Perception delay (ticks): the AI acts on what it saw this long ago. */
  reaction: number;
  /** Probability of reading an incoming attack correctly (vs. freezing or trading). */
  read: number;
  /** Given a correct read: probability of guarding / evading / stop-kicking. */
  guard: number;
  evade: number;
  stopKick: number;
  /** Probability of punishing an opponent's recovery or missed attack. */
  punish: number;
  /** Baseline appetite for attacking when in range. */
  aggression: number;
  /** Softmax temperature over option utilities (higher = sloppier choices). */
  noise: number;
  /** Ticks between tactical decisions. */
  think: number;
  staminaReserve: number;
  /** 0..1: how early and how reliably it steers away from the boundary. */
  boundary: number;
  /** 0..1: how quickly it learns and answers repeated player techniques. */
  adapt: number;
  /** Probability of following a landed technique with a combination. */
  combo: number;
  /** 0..1: weight given to score and remaining time (Competitive). */
  scoreAware: number;
  /** Chance per decision of an outright tactical mistake. */
  mistake: number;
  /** 0..1: tendency to repeat a favourite technique (predictability). */
  habit: number;
  /** Preferred fighting distance (m). */
  range: number;
  /** Uses lead-leg techniques for probing. */
  leadLeg: number;
  /**
   * Anticipatory guarding: raising the guard in range when the opponent's
   * observed attack rhythm says a technique is due. Fast kicks (11-tick
   * startup) cannot be blocked on reaction alone at human reaction times.
   */
  anticipate: number;
}

export const AI_PROFILES: Record<Difficulty, AIProfile> = {
  easy: {
    label: 'White belt',
    reaction: 22,
    read: 0.45,
    guard: 0.55,
    evade: 0.1,
    stopKick: 0,
    punish: 0.15,
    aggression: 0.5,
    noise: 1.1,
    think: 18,
    staminaReserve: 0,
    boundary: 0.45,
    adapt: 0,
    combo: 0.08,
    scoreAware: 0,
    mistake: 0.2,
    habit: 0.6,
    range: 1.05,
    leadLeg: 0.2,
    anticipate: 0.05,
  },
  normal: {
    label: 'Red belt',
    reaction: 14,
    read: 0.7,
    guard: 0.7,
    evade: 0.25,
    stopKick: 0.15,
    punish: 0.45,
    aggression: 0.55,
    noise: 0.5,
    think: 11,
    staminaReserve: 15,
    boundary: 0.85,
    adapt: 0.4,
    combo: 0.35,
    scoreAware: 0.5,
    mistake: 0.06,
    habit: 0.2,
    range: 1.15,
    leadLeg: 0.55,
    anticipate: 0.5,
  },
  hard: {
    label: 'Black belt',
    reaction: 9,
    read: 0.88,
    guard: 0.72,
    evade: 0.35,
    stopKick: 0.4,
    punish: 0.75,
    aggression: 0.6,
    noise: 0.2,
    think: 7,
    staminaReserve: 22,
    boundary: 1,
    adapt: 0.85,
    combo: 0.6,
    scoreAware: 1,
    mistake: 0.015,
    habit: 0,
    range: 1.2,
    leadLeg: 0.8,
    anticipate: 0.7,
  },
};

/** One perceived snapshot of the opponent (ring buffer, no per-tick allocation). */
interface Seen {
  x: number;
  z: number;
  state: FighterStateName;
  phase: AttackPhase | null;
  move: AttackKind | null;
  height: TargetHeight;
  stateTick: number;
  serial: number;
  stamina: number;
  guard: boolean;
}

const HISTORY = 48;
const ALL_MOVES = Object.values(MOVES);

/** Reach of a technique measured from the attacker's centre (m). */
export function reachOf(m: MoveDef, h: TargetHeight = 'body'): number {
  return m.impact[h][2] + m.radius + 0.2;
}

/**
 * Layered sparring AI:
 *  1. Perception: a delayed snapshot of the opponent (reaction time).
 *  2. Reactive layer: on a perceived attack choose guard / evade / stop-kick
 *     (once per attack), or fail to read it.
 *  3. Punish layer: attack into the opponent's recovery when a technique is
 *     fast enough to land before they recover.
 *  4. Tactical layer: utility scoring of attacks and footwork (range,
 *     stamina, boundary, score and clock, opponent habits), softmax-picked.
 * It produces the same FighterIntent as a human player.
 */
export class AIController {
  profile: AIProfile;
  difficulty: Difficulty;
  private rng: Rng;
  private readonly hist: Seen[] = [];
  private head = 0;
  private filled = 0;
  private readonly intent: FighterIntent = emptyIntent();
  private cooldown = 0;
  private plan: 'approach' | 'hold' | 'retreat' | 'circle' = 'hold';
  private planDir = 1;
  private guardTicks = 0;
  private reactedSerial = -1;
  private punishedSerial = -1;
  private learnedSerial = -1;
  /** Decaying counts of the opponent's techniques (opponent model). */
  readonly usage: Partial<Record<AttackKind, number>> = {};
  private recent: AttackKind[] = [];
  private queued: { kind: AttackKind; height: TargetHeight; at: number } | null = null;
  private favourite: AttackKind;
  /** Perceived opponent attack rhythm (ticks between techniques, EMA). */
  private lastOppAttack = -1;
  private oppInterval = 60;
  /** Diagnostics for tests and the debug overlay. */
  readonly stats = {
    guards: 0,
    anticipations: 0,
    evades: 0,
    stopKicks: 0,
    punishes: 0,
    attacks: 0,
    combos: 0,
    misreads: 0,
    /** For each reaction: ticks between the opponent's real attack start and the AI's decision. */
    reactionDelays: [] as number[],
  };

  constructor(difficulty: Difficulty, seed = 1234) {
    this.difficulty = difficulty;
    this.profile = AI_PROFILES[difficulty];
    this.rng = createRng(seed);
    for (let i = 0; i < HISTORY; i++)
      this.hist.push({ x: 0, z: 0, state: 'idle', phase: null, move: null, height: 'body', stateTick: 0, serial: 0, stamina: 100, guard: false });
    const favs: AttackKind[] = ['round', 'front', 'round', 'side'];
    this.favourite = favs[Math.floor(this.rng() * favs.length)];
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    this.profile = AI_PROFILES[d];
  }

  private observe(opp: Fighter) {
    const s = this.hist[this.head];
    s.x = opp.x;
    s.z = opp.z;
    s.state = opp.state;
    s.phase = opp.attackPhase;
    s.move = opp.attack?.move.id ?? null;
    s.height = opp.attack?.height ?? 'body';
    s.stateTick = opp.stateTick;
    s.serial = opp.attackSerial;
    s.stamina = opp.stamina;
    s.guard = opp.isGuarding;
    this.head = (this.head + 1) % HISTORY;
    this.filled = Math.min(HISTORY, this.filled + 1);
  }

  /** The opponent as perceived `reaction` ticks ago. */
  private perceived(): Seen {
    const lag = Math.min(this.profile.reaction, this.filled - 1);
    return this.hist[(this.head - 1 - lag + HISTORY * 2) % HISTORY];
  }

  think(world: CombatWorld, self: Fighter, opp: Fighter): FighterIntent {
    const p = this.profile;
    const r = this.rng;
    const it = this.intent;
    it.moveX = it.moveZ = 0;
    it.guard = false;
    it.attack = null;
    it.height = 'body';
    it.dash = false;
    it.switchStance = false;
    this.observe(opp);
    if (world.phase !== 'fight') {
      // Respect the referee: no techniques during Kal-yeo or between rounds.
      this.queued = null;
      this.guardTicks = 0;
      return it;
    }
    if (self.state === 'ko' || self.state === 'victory' || self.state === 'down') return it;
    const seen = this.perceived();
    this.learn(seen, world.tick);

    const dx = seen.x - self.x;
    const dz = seen.z - self.z;
    const dist = Math.hypot(dx, dz) || 1e-6;
    const ux = dx / dist;
    const uz = dz / dist;

    // Combination follow-ups (pressed into the cancel window after a landed hit).
    if (this.queued && self.state === 'attack' && self.attack?.hasHit && !self.attack.blocked) {
      if (self.stateTick >= this.queued.at) {
        it.attack = this.queued.kind;
        it.height = this.queued.height;
        this.queued = null;
        this.stats.combos++;
        return it;
      }
    } else if (self.state !== 'attack') this.queued = null;
    if (!self.actionable && self.state !== 'dash') return it;

    // ---- 2. Reactive layer -----------------------------------------------
    const threat = seen.state === 'attack' && seen.phase !== 'recovery' && seen.move !== null;
    if (threat && seen.serial !== this.reactedSerial) {
      const m = MOVES[seen.move!];
      if (dist < reachOf(m, seen.height) + 0.35) {
        this.reactedSerial = seen.serial;
        // Fairness log: how long after the attack really started is the AI deciding?
        this.stats.reactionDelays.push(opp.state === 'attack' && opp.attackSerial === seen.serial ? opp.stateTick : p.reaction);
        // Estimated ticks until the opponent's strike is active.
        const elapsed = seen.stateTick + p.reaction;
        const remaining = startupOf(m, seen.height) - elapsed;
        if (r() > p.read) {
          this.stats.misreads++;
        } else {
          const stop = this.fastestInRange(self, dist, remaining - 1);
          const roomBehind = this.boundaryRoom(world, self, -ux, -uz);
          if (stop && r() < p.stopKick && self.stamina > staminaCost(stop, 'body') + 4) {
            this.stats.stopKicks++;
            it.attack = stop.id;
            return it;
          }
          if (r() < p.evade && self.stamina > 25 && roomBehind > 1.4) {
            this.stats.evades++;
            it.dash = true;
            it.moveX = -ux;
            it.moveZ = -uz;
            return it;
          }
          if (r() < p.guard) {
            this.stats.guards++;
            this.guardTicks = Math.max(8, remaining + m.active + 6);
          }
        }
      }
    }
    if (this.guardTicks > 0) {
      this.guardTicks--;
      it.guard = true;
      if (this.boundaryRoom(world, self, -ux, -uz) > 1.2) {
        it.moveX = -ux * 0.25;
        it.moveZ = -uz * 0.25;
      }
      return it;
    }

    // ---- 3. Punish layer ----------------------------------------------------
    const recovering = seen.state === 'attack' && seen.phase === 'recovery' && seen.move !== null;
    if (recovering && seen.serial !== this.punishedSerial) {
      this.punishedSerial = seen.serial;
      const m = MOVES[seen.move!];
      const left = moveTotal(m, seen.height) - (seen.stateTick + p.reaction);
      const pick = this.bestPunish(self, dist, left);
      if (pick && r() < p.punish) {
        this.stats.punishes++;
        return this.fire(pick, 'body', self);
      }
    }

    // ---- 4. Tactical layer --------------------------------------------------
    if (--this.cooldown <= 0) {
      this.cooldown = p.think + Math.floor(r() * p.think * 0.6);
      const choice = this.decide(world, self, seen, dist);
      if (choice) return this.fire(choice.move, choice.height, self);
    }
    this.move(world, self, seen, dist, ux, uz);
    return it;
  }

  /** Update the opponent model from a newly perceived technique. */
  private learn(seen: Seen, tick: number) {
    if (seen.state !== 'attack' || seen.move === null || seen.serial === this.learnedSerial) return;
    this.learnedSerial = seen.serial;
    if (this.lastOppAttack >= 0) this.oppInterval += (tick - this.lastOppAttack - this.oppInterval) * 0.3;
    this.lastOppAttack = tick;
    for (const k in this.usage) this.usage[k as AttackKind]! *= 0.8;
    this.usage[seen.move] = (this.usage[seen.move] ?? 0) + 1;
  }

  /** The opponent's habitual technique, if the AI has noticed one. */
  predictedHabit(): AttackKind | null {
    if (this.profile.adapt <= 0) return null;
    let best: AttackKind | null = null;
    let n = 0;
    for (const [k, v] of Object.entries(this.usage)) if (v! > n) [best, n] = [k as AttackKind, v!];
    return n >= 3 - this.profile.adapt ? best : null;
  }

  private fire(move: MoveDef, height: TargetHeight, self: Fighter): FighterIntent {
    const it = this.intent;
    it.attack = move.id;
    it.height = height;
    this.stats.attacks++;
    this.recent.push(move.id);
    if (this.recent.length > 3) this.recent.shift();
    // Plan a combination: lead-leg probe into a rear-leg technique.
    if (this.rng() < this.profile.combo && move.cancelAfter < 20) {
      const follow: AttackKind = move.limb === 'leadFoot' ? (this.rng() < 0.6 ? 'round' : 'back') : 'leadRound';
      const at = startupOf(move, height) + move.active + move.cancelAfter;
      this.queued = { kind: follow, height: this.rng() < 0.3 ? 'head' : 'body', at };
    }
    void self;
    return it;
  }

  /** Fastest technique that reaches `dist` and becomes active within `ticks`. */
  private fastestInRange(self: Fighter, dist: number, ticks: number): MoveDef | null {
    let best: MoveDef | null = null;
    for (const m of ALL_MOVES) {
      if (m.id === 'back' || m.id === 'punch') continue;
      if (m.limb === 'leadFoot' && this.profile.leadLeg < 0.3) continue;
      if (dist > reachOf(m) || dist < m.chamber[2] + 0.35) continue;
      if (m.startup > ticks) continue;
      if (!best || m.startup < best.startup) best = m;
    }
    void self;
    return best;
  }

  private bestPunish(self: Fighter, dist: number, ticksLeft: number): MoveDef | null {
    let best: MoveDef | null = null;
    for (const m of ALL_MOVES) {
      if (dist > reachOf(m) || dist < m.chamber[2] + 0.3) continue;
      if (m.startup + 1 >= ticksLeft) continue;
      if (self.stamina < staminaCost(m, 'body')) continue;
      if (!best || m.damage > best.damage) best = m;
    }
    return best;
  }

  /** Distance from `self` to the boundary when moving in direction (dx, dz). */
  private boundaryRoom(world: CombatWorld, self: Fighter, dx: number, dz: number): number {
    const lim = world.rules.boundary ?? ARENA_HALF - 0.3;
    const tx = dx > 1e-3 ? (lim - self.x) / dx : dx < -1e-3 ? (-lim - self.x) / dx : Infinity;
    const tz = dz > 1e-3 ? (lim - self.z) / dz : dz < -1e-3 ? (-lim - self.z) / dz : Infinity;
    return Math.min(tx, tz);
  }

  /** Tactical decision: maybe attack (returns the choice) and update the footwork plan. */
  private decide(world: CombatWorld, self: Fighter, seen: Seen, dist: number): { move: MoveDef; height: TargetHeight } | null {
    const p = this.profile;
    const r = this.rng;
    const competitive = world.rules.id === 'competitive';
    const me = self.id;
    const lead = world.points[me] - world.points[1 - me];
    const secs = world.roundTicksLeft / TICK_HZ;
    // Score/clock pressure: >0 = must take risks, <0 = protect a lead.
    let pressure = 0;
    if (competitive && p.scoreAware > 0) {
      const late = clamp(1 - secs / 45, 0, 1);
      pressure = clamp(-lead / 6, -1, 1) * (0.4 + 0.6 * late) * p.scoreAware;
    } else if (!competitive && p.scoreAware > 0) {
      const hp = self.health - (world.fighters[1 - me].health ?? 0);
      pressure = clamp(-hp / 40, -1, 1) * 0.5 * p.scoreAware;
    }
    const habit = this.predictedHabit();

    // ---- Attack options ----
    const opts: { move: MoveDef; height: TargetHeight; u: number }[] = [];
    if (self.stamina > p.staminaReserve * (1 - Math.max(0, pressure)) || r() < p.mistake) {
      for (const m of ALL_MOVES) {
        for (const h of m.heights) {
          const reach = reachOf(m, h);
          const minD = m.chamber[2] + 0.35;
          if (dist > reach + (r() < p.mistake ? 0.6 : 0)) continue;
          if (self.stamina < staminaCost(m, h) * 0.6) continue;
          let hit = dist < minD ? 0.15 : 0.55 + 0.25 * (1 - Math.abs(dist - (reach - 0.25)) / 0.6);
          if (seen.guard) hit *= m.limb === 'leadFoot' ? 0.55 : 0.4;
          if (seen.state === 'hitstun' || seen.state === 'blockstun' || seen.state === 'down') hit *= 0.2;
          if (seen.state === 'attack' && seen.phase === 'recovery') hit *= 1.5;
          if (h === 'head') hit *= 0.65;
          const value = competitive ? (m.turning ? (h === 'head' ? 6 : 4) : m.limb === 'rearHand' ? 1 : h === 'head' ? 3 : 2) : m.damage / 4;
          const exposure = (m.recovery + m.startup) / 30;
          let u = hit * value * (1 + 0.6 * Math.max(0, pressure)) - exposure * (0.6 - 0.5 * pressure);
          // Lead leg: quick, safe probes at range; rear leg: commitment.
          if (m.limb === 'leadFoot') u += p.leadLeg * (0.5 + (seen.guard ? 0.4 : 0));
          // Answer a habit: stop-kick a habitual slow technique, out-pace a fast one.
          if (habit && p.adapt > 0) {
            const hm = MOVES[habit];
            if (m.startup < hm.startup) u += 0.5 * p.adapt;
          }
          if (this.recent.includes(m.id)) u -= 0.35 * (1 - p.habit);
          if (m.id === this.favourite) u += 1.2 * p.habit;
          u += p.aggression;
          opts.push({ move: m, height: h, u });
        }
      }
    }

    // ---- Footwork options ----
    const lim = world.rules.boundary ?? ARENA_HALF - 0.3;
    const myEdge = lim - Math.max(Math.abs(self.x), Math.abs(self.z));
    let want = p.range - 0.25 * pressure;
    if (pressure < -0.5) want = 1.9; // protect a late lead: stay out of range
    if (self.stamina < 25) want = Math.max(want, 1.8);
    // Anticipation: in the opponent's range and their rhythm says a kick is due.
    let guardU = -5;
    if (p.anticipate > 0 && dist < 1.45 && this.lastOppAttack >= 0) {
      const due = clamp((world.tick - this.lastOppAttack) / Math.max(20, this.oppInterval), 0, 1.4);
      guardU = p.anticipate * 3 * due - 0.4 - 0.8 * Math.max(0, pressure);
    }
    const moveU = {
      approach: (dist - want) * 1.6,
      retreat: (want - dist) * 1.6 - (myEdge < 1.2 ? 2 * p.boundary : 0),
      circle: 0.35 + (myEdge < 1.5 ? 1.5 * p.boundary : 0),
      hold: 0.25,
      guard: guardU,
    };
    // Softmax over everything.
    const T = Math.max(0.05, p.noise);
    let total = 0;
    const weights: number[] = [];
    const all = [...opts.map((o) => o.u), moveU.approach, moveU.retreat, moveU.circle, moveU.hold, moveU.guard];
    const max = Math.max(...all);
    for (const u of all) {
      const w = Math.exp((u - max) / T);
      weights.push(w);
      total += w;
    }
    let pick = r() * total;
    let idx = 0;
    for (; idx < weights.length - 1; idx++) {
      pick -= weights[idx];
      if (pick <= 0) break;
    }
    if (idx < opts.length) return { move: opts[idx].move, height: opts[idx].height };
    const plans = ['approach', 'retreat', 'circle', 'hold', 'guard'] as const;
    const chosen = plans[idx - opts.length];
    if (chosen === 'guard') {
      this.stats.anticipations++;
      this.guardTicks = 16 + Math.floor(r() * 14);
      this.plan = 'hold';
      return null;
    }
    this.plan = chosen;
    // Circle towards the centre (or, for weaker profiles, at random).
    this.planDir = r() < p.boundary ? this.centreSide(self, seen) : r() < 0.5 ? -1 : 1;
    return null;
  }

  /** Lateral direction (+1/-1) that moves this fighter towards the mat centre. */
  private centreSide(self: Fighter, seen: Seen): number {
    const dx = seen.x - self.x;
    const dz = seen.z - self.z;
    // Lateral vector for dir=+1 is (dz, -dx); pick the side that reduces |pos|.
    const lx = dz;
    const lz = -dx;
    return lx * -self.x + lz * -self.z >= 0 ? 1 : -1;
  }

  private move(world: CombatWorld, self: Fighter, seen: Seen, dist: number, ux: number, uz: number) {
    const p = this.profile;
    const it = this.intent;
    const lx = uz * this.planDir;
    const lz = -ux * this.planDir;
    const want = p.range;
    switch (this.plan) {
      case 'approach':
        it.moveX = ux * 0.9 + lx * 0.2;
        it.moveZ = uz * 0.9 + lz * 0.2;
        break;
      case 'retreat':
        it.moveX = -ux * 0.8 + lx * 0.45;
        it.moveZ = -uz * 0.8 + lz * 0.45;
        break;
      case 'circle':
        it.moveX = lx * 0.75 + ux * (dist - want) * 0.8;
        it.moveZ = lz * 0.75 + uz * (dist - want) * 0.8;
        break;
      case 'hold':
        it.moveX = ux * (dist - want) * 0.8;
        it.moveZ = uz * (dist - want) * 0.8;
        break;
    }
    // Boundary awareness: steer back towards the centre before the line.
    const lim = world.rules.boundary ?? ARENA_HALF - 0.3;
    const margin = 0.5 + 1.1 * p.boundary;
    for (const axis of ['x', 'z'] as const) {
      const pos = self[axis];
      const edge = lim - Math.abs(pos);
      if (edge < margin) {
        const push = (1 - edge / margin) * (0.6 + p.boundary);
        if (axis === 'x') it.moveX -= Math.sign(pos) * push;
        else it.moveZ -= Math.sign(pos) * push;
      }
    }
    void seen;
  }
}
