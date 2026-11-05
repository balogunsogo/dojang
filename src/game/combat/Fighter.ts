import { dhypot, dsin, dcos } from '../dmath';
import { ARENA_HALF, DT, STAMINA_MAX } from '../config';
import type { AttackKind, FighterIntent, TargetHeight } from '../input/actions';
import { approachAngle, clamp, smoothstep, type V3, wrapAngle, yawOf } from '../math';
import { MOVES, type MoveDef, moveTotal, resolveHeight, staminaCost, startupOf } from './moves';

export type FighterStateName =
  | 'idle'
  | 'dash'
  | 'attack'
  | 'guard'
  | 'blockstun'
  | 'hitstun'
  | 'switch'
  | 'ko'
  | 'victory'
  /** On the floor after a fall or knockdown (Competitive rules only). */
  | 'down';
export type Stance = 'orthodox' | 'southpaw';
export type AttackPhase = 'startup' | 'active' | 'recovery';

/** Per-character tuning; the two selectable fighters differ here. */
export interface FighterStats {
  speed: number; // multiplier on footwork speed
  power: number; // damage multiplier
  staminaRegen: number; // multiplier
  maxHealth: number;
}

export interface AttackState {
  move: MoveDef;
  height: TargetHeight;
  startup: number;
  total: number;
  hasHit: boolean;
  blocked: boolean;
  /** Impact point (local frame, orthodox) latched at the first active tick. */
  impact: V3;
  /** True when thrown with low stamina: slower and weaker. */
  tired: boolean;
}

export interface HitReaction {
  zone: 'body' | 'head';
  heavy: boolean;
  /** Direction the hit came from, world yaw. */
  fromYaw: number;
  /** Technique that caused it (presentation only). */
  kind: AttackKind;
  /** +1 if it came from the defender's left side, -1 from the right, 0 straight on. */
  side: number;
}

const WALK_FWD = 2.1;
const WALK_BACK = 1.75;
const WALK_SIDE = 1.85;
const GUARD_SPEED_MULT = 0.45;
const ACCEL = 16;
const DASH_TICKS = 12;
const DASH_SPEED = 5.4;
const DASH_COST = 9;
const DASH_ATTACK_CANCEL = 7;
const SWITCH_TICKS = 10;
const BUFFER_TICKS = 10;
const TURN_RATE = 9; // rad/s
const ATTACK_TURN_RATE = 2.2;
const MIN_ATTACK_STAMINA = 4;

export class Fighter {
  readonly id: 0 | 1;
  readonly stats: FighterStats;
  x = 0;
  z = 0;
  /** Sim facing (toward the opponent). Visual body twist is an animation concern. */
  yaw = 0;
  vx = 0;
  vz = 0;
  health: number;
  stamina = STAMINA_MAX;
  stance: Stance = 'orthodox';
  state: FighterStateName = 'idle';
  stateTick = 0;
  attack: AttackState | null = null;
  /** Increments on every technique started (animation uses it to restart). */
  attackSerial = 0;
  hitReaction: HitReaction | null = null;
  stunTicks = 0;
  /** Was this fighter hit during attack startup (counter hit)? */
  counterHit = false;
  /**
   * How far from the mat centre the fighter may move (m). Arcade keeps
   * fighters on the mat; Competitive raises it so the boundary line can
   * actually be crossed (and penalized).
   */
  boundsLimit = ARENA_HALF - 0.3;
  /** Why the fighter is down: own fall (penalized) or opponent's technique. */
  downCause: 'fall' | 'knockdown' | null = null;
  /** Locomotion phase for footwork animation (radians). */
  stepPhase = 0;
  private dashX = 0;
  private dashZ = 0;
  private buffered: { kind: AttackKind; height: TargetHeight; ttl: number } | null = null;
  /** Ticks since the last stamina expense; recovery kicks in after a short delay. */
  private sinceSpend = 99;

  constructor(id: 0 | 1, stats: FighterStats) {
    this.id = id;
    this.stats = stats;
    this.health = stats.maxHealth;
  }

  reset(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vz = 0;
    this.health = this.stats.maxHealth;
    this.stamina = STAMINA_MAX;
    this.stance = 'orthodox';
    this.setState('idle');
    this.attack = null;
    this.hitReaction = null;
    this.buffered = null;
    this.counterHit = false;
    this.sinceSpend = 99;
  }

  get mirror(): number {
    return this.stance === 'orthodox' ? 1 : -1;
  }

  get attackPhase(): AttackPhase | null {
    const a = this.attack;
    if (!a || this.state !== 'attack') return null;
    if (this.stateTick < a.startup) return 'startup';
    if (this.stateTick < a.startup + a.move.active) return 'active';
    return 'recovery';
  }

  get isGuarding(): boolean {
    return this.state === 'guard';
  }

  /** Can this fighter act (not stunned, not KO'd)? */
  get actionable(): boolean {
    return this.state === 'idle' || this.state === 'guard';
  }

  setState(s: FighterStateName) {
    this.state = s;
    this.stateTick = 0;
    if (s !== 'attack') this.attack = null;
  }

  spendStamina(n: number) {
    this.stamina = Math.max(0, this.stamina - n);
    this.sinceSpend = 0;
  }

  /** Advance one tick. `opp` is used for facing and attack range latching. */
  step(intent: FighterIntent, opp: Fighter) {
    this.stateTick++;
    this.sinceSpend++;
    if (this.buffered && --this.buffered.ttl <= 0) this.buffered = null;
    if (intent.attack) this.buffered = { kind: intent.attack, height: intent.height, ttl: BUFFER_TICKS };

    const toOpp = yawOf(opp.x - this.x, opp.z - this.z);
    let desiredVX = 0;
    let desiredVZ = 0;
    let turnRate = TURN_RATE;

    switch (this.state) {
      case 'idle':
      case 'guard': {
        if (intent.switchStance) {
          this.setState('switch');
          break;
        }
        if (this.tryStartAttack()) break;
        if (intent.dash && this.stamina >= DASH_COST * 0.5) {
          this.startDash(intent);
          break;
        }
        const wantGuard = intent.guard;
        if (wantGuard && this.state !== 'guard') this.setState('guard');
        else if (!wantGuard && this.state === 'guard') this.setState('idle');
        [desiredVX, desiredVZ] = this.footworkVelocity(intent);
        break;
      }
      case 'dash': {
        const k = 1 - smoothstep(Math.min(1, this.stateTick / DASH_TICKS));
        desiredVX = this.dashX * DASH_SPEED * (0.35 + 0.65 * k) * this.stats.speed;
        desiredVZ = this.dashZ * DASH_SPEED * (0.35 + 0.65 * k) * this.stats.speed;
        this.vx = desiredVX;
        this.vz = desiredVZ;
        if (this.stateTick >= DASH_ATTACK_CANCEL && this.tryStartAttack()) break;
        if (this.stateTick >= DASH_TICKS) this.setState(intent.guard ? 'guard' : 'idle');
        break;
      }
      case 'attack': {
        const a = this.attack!;
        turnRate = ATTACK_TURN_RATE;
        const t = this.stateTick;
        if (t === a.startup) this.latchImpact(opp);
        // Root motion: travel forward through startup + active.
        if (t < a.startup + a.move.active) {
          const adv = a.move.advance / (a.startup + a.move.active) / DT;
          desiredVX = dsin(this.yaw) * adv;
          desiredVZ = dcos(this.yaw) * adv;
          this.vx = desiredVX;
          this.vz = desiredVZ;
        }
        // Chain into another technique after a landed hit (combinations).
        if (a.hasHit && !a.blocked && t >= a.startup + a.move.active + a.move.cancelAfter) {
          if (this.tryStartAttack()) break;
        }
        if (t >= a.total) {
          this.setState(intent.guard ? 'guard' : 'idle');
          this.tryStartAttack();
        }
        break;
      }
      case 'blockstun':
      case 'hitstun': {
        turnRate = 0;
        if (this.stateTick >= this.stunTicks) {
          this.hitReaction = null;
          this.setState(intent.guard ? 'guard' : 'idle');
        }
        break;
      }
      case 'switch': {
        if (this.stateTick === Math.floor(SWITCH_TICKS / 2)) {
          this.stance = this.stance === 'orthodox' ? 'southpaw' : 'orthodox';
        }
        [desiredVX, desiredVZ] = this.footworkVelocity(intent);
        desiredVX *= 0.5;
        desiredVZ *= 0.5;
        if (this.stateTick >= SWITCH_TICKS) this.setState('idle');
        break;
      }
      case 'down':
        turnRate = 0;
        if (this.stateTick >= this.stunTicks) this.setState('idle');
        break;
      case 'ko':
      case 'victory':
        turnRate = 0;
        break;
    }

    // Facing tracks the opponent (lock-on footwork, like real sparring).
    if (turnRate > 0) this.yaw = approachAngle(this.yaw, toOpp, turnRate * DT);
    this.yaw = wrapAngle(this.yaw);

    // Velocity smoothing (not during dash/attack root motion which set v directly).
    if (this.state === 'idle' || this.state === 'guard' || this.state === 'switch') {
      const k = Math.min(1, ACCEL * DT);
      this.vx += (desiredVX - this.vx) * k;
      this.vz += (desiredVZ - this.vz) * k;
    } else if (this.state === 'hitstun' || this.state === 'blockstun' || this.state === 'ko' || this.state === 'victory' || this.state === 'down') {
      const f = 0.8898817709880238; // Math.exp(-7 / 60), precomputed (deterministic)
      this.vx *= f;
      this.vz *= f;
    } else if (this.state === 'attack' && this.attackPhase === 'recovery') {
      this.vx *= 0.8;
      this.vz *= 0.8;
    }

    this.x += this.vx * DT;
    this.z += this.vz * DT;
    const lim = this.boundsLimit;
    this.x = clamp(this.x, -lim, lim);
    this.z = clamp(this.z, -lim, lim);

    const speed = dhypot(this.vx, this.vz);
    this.stepPhase += DT * (5.2 + speed * 3.2);

    this.regenStamina();
  }

  private footworkVelocity(intent: FighterIntent): [number, number] {
    const mag = Math.min(1, dhypot(intent.moveX, intent.moveZ));
    if (mag < 0.08) return [0, 0];
    const fx = dsin(this.yaw);
    const fz = dcos(this.yaw);
    // Decompose into forward/back and lateral components relative to facing.
    const fwd = intent.moveX * fx + intent.moveZ * fz;
    const lat = intent.moveX * fz - intent.moveZ * fx;
    const fs = fwd >= 0 ? WALK_FWD : WALK_BACK;
    let vf = fwd * fs;
    let vl = lat * WALK_SIDE;
    const mult = (this.state === 'guard' ? GUARD_SPEED_MULT : 1) * this.stats.speed * (this.stamina < 15 ? 0.8 : 1);
    vf *= mult;
    vl *= mult;
    return [fx * vf + fz * vl, fz * vf - fx * vl];
  }

  private startDash(intent: FighterIntent) {
    let dx = intent.moveX;
    let dz = intent.moveZ;
    const m = dhypot(dx, dz);
    if (m < 0.2) {
      // No direction: back-step dash (classic evasive footwork).
      dx = -dsin(this.yaw);
      dz = -dcos(this.yaw);
    } else {
      dx /= m;
      dz /= m;
    }
    this.dashX = dx;
    this.dashZ = dz;
    this.spendStamina(DASH_COST);
    this.setState('dash');
  }

  private tryStartAttack(): boolean {
    const b = this.buffered;
    if (!b) return false;
    if (this.stamina < MIN_ATTACK_STAMINA) return false;
    const move = MOVES[b.kind];
    const height = resolveHeight(move, b.height);
    const cost = staminaCost(move, height);
    const tired = this.stamina < cost;
    const startup = startupOf(move, height) + (tired ? 4 : 0);
    const total = moveTotal(move, height) + (tired ? 6 : 0);
    this.buffered = null;
    this.spendStamina(cost);
    this.setState('attack');
    this.attackSerial++;
    this.attack = {
      move,
      height,
      startup,
      total,
      hasHit: false,
      blocked: false,
      impact: [...move.impact[height]] as V3,
      tired,
    };
    return true;
  }

  /**
   * Distance-aware extension: when the opponent is closer than full reach the
   * technique lands on the surface of the target instead of passing through.
   * When the opponent is out of range the nominal (full) extension is kept and
   * the attack whiffs.
   */
  private latchImpact(opp: Fighter) {
    const a = this.attack!;
    const nominal = a.move.impact[a.height];
    const d = dhypot(opp.x - this.x, opp.z - this.z);
    const depth = a.height === 'head' ? 0.08 : 0.14;
    const minF = a.move.chamber[2] + 0.18;
    const f = clamp(d - depth, minF, nominal[2]);
    a.impact = [nominal[0], nominal[1], f];
  }

  /** World-space strike point at a given progress (0..1) through the active window. */
  strikePoint(progress: number): V3 {
    const a = this.attack!;
    let c = a.move.chamber;
    const i = a.impact;
    // A head-height kick is chambered high and extends near-horizontally to the
    // head; it must not sweep diagonally up through the trunk zone.
    if (a.height === 'head' && a.move.limb !== 'rearHand') c = [c[0], Math.max(c[1], i[1] - 0.12), c[2]];
    const t = smoothstep(clamp(progress, 0, 1));
    const m = this.mirror;
    const local: V3 = [(c[0] + (i[0] - c[0]) * t) * m, c[1] + (i[1] - c[1]) * t, c[2] + (i[2] - c[2]) * t];
    const cs = dcos(this.yaw);
    const sn = dsin(this.yaw);
    return [this.x + local[0] * cs + local[2] * sn, local[1], this.z - local[0] * sn + local[2] * cs];
  }

  private regenStamina() {
    if (this.state === 'ko') return;
    let rate = 0;
    switch (this.state) {
      case 'idle':
        rate = dhypot(this.vx, this.vz) > 0.3 ? 11 : 17;
        break;
      case 'guard':
        rate = 6;
        break;
      case 'switch':
      case 'dash':
        rate = 4;
        break;
      case 'down':
        rate = 8;
        break;
      default:
        rate = 0;
    }
    if (this.sinceSpend < 20) rate *= 0.25;
    this.stamina = Math.min(STAMINA_MAX, this.stamina + rate * this.stats.staminaRegen * DT);
  }

  /** Apply a successful (unblocked) hit. */
  /** Put the fighter on the floor for `ticks` (falls and knockdowns). */
  knockDown(ticks: number, cause: 'fall' | 'knockdown') {
    this.buffered = null;
    this.hitReaction = null;
    this.stunTicks = ticks;
    this.downCause = cause;
    this.setState('down');
  }

  receiveHit(stun: number, pushX: number, pushZ: number, reaction: HitReaction) {
    this.counterHit = this.state === 'attack' && this.attackPhase === 'startup';
    this.hitReaction = reaction;
    this.stunTicks = stun + (this.counterHit ? 6 : 0);
    this.buffered = null;
    this.setState('hitstun');
    this.vx = pushX;
    this.vz = pushZ;
  }

  receiveBlock(stun: number, pushX: number, pushZ: number, reaction?: HitReaction) {
    this.stunTicks = stun;
    this.setState('blockstun');
    if (reaction) this.hitReaction = reaction;
    this.vx = pushX;
    this.vz = pushZ;
  }
}
