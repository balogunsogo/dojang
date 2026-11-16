/**
 * Replay record format: one compact row of floats per simulation tick, with
 * exactly the fighter state the procedural animator reads (FighterAnimator)
 * plus the world's hit stop and phase. No poses, no scene objects, no deep
 * copies: about 240 bytes per tick for both fighters.
 */
import type { CombatWorld, MatchPhase } from '../combat/CombatWorld';
import type { Fighter, FighterStateName } from '../combat/Fighter';
import { MOVES } from '../combat/moves';
import { ATTACK_KINDS, type AttackKind, type TargetHeight } from '../input/actions';

export const STATES: FighterStateName[] = ['idle', 'dash', 'attack', 'guard', 'blockstun', 'hitstun', 'switch', 'ko', 'victory', 'down'];
export const PHASES: MatchPhase[] = ['intro', 'fight', 'break', 'round-over', 'match-over'];
const HEIGHTS: TargetHeight[] = ['body', 'head'];

/** Per-fighter field offsets. */
export const F = {
  x: 0, z: 1, yaw: 2, vx: 3, vz: 4, stamina: 5, stance: 6, state: 7, stateTick: 8, stunTicks: 9, attackSerial: 10, downCause: 11,
  atk: 12, move: 13, height: 14, startup: 15, total: 16, hasHit: 17, blocked: 18, ix: 19, iy: 20, iz: 21, tired: 22,
  hit: 23, zone: 24, heavy: 25, side: 26, fromYaw: 27, kind: 28,
} as const;
export const FIGHTER_FIELDS = 29;
/** World fields, then two fighters. */
export const W = { hitstop: 0, phase: 1 } as const;
export const WORLD_FIELDS = 2;
export const ROW = WORLD_FIELDS + 2 * FIGHTER_FIELDS;
export const ROW_BYTES = ROW * 4;

/** Write the world's current state into `dst` at row `r` (no allocation). */
export function writeRow(dst: Float32Array, r: number, w: CombatWorld) {
  const o = r * ROW;
  dst[o + W.hitstop] = w.hitstop;
  dst[o + W.phase] = PHASES.indexOf(w.phase);
  writeFighter(dst, o + WORLD_FIELDS, w.fighters[0]);
  writeFighter(dst, o + WORLD_FIELDS + FIGHTER_FIELDS, w.fighters[1]);
}

function writeFighter(d: Float32Array, o: number, f: Fighter) {
  d[o + F.x] = f.x;
  d[o + F.z] = f.z;
  d[o + F.yaw] = f.yaw;
  d[o + F.vx] = f.vx;
  d[o + F.vz] = f.vz;
  d[o + F.stamina] = f.stamina;
  d[o + F.stance] = f.stance === 'southpaw' ? 1 : 0;
  d[o + F.state] = STATES.indexOf(f.state);
  d[o + F.stateTick] = f.stateTick;
  d[o + F.stunTicks] = f.stunTicks;
  d[o + F.attackSerial] = f.attackSerial;
  d[o + F.downCause] = f.downCause === 'fall' ? 1 : f.downCause === 'knockdown' ? 2 : 0;
  const a = f.attack;
  d[o + F.atk] = a ? 1 : 0;
  if (a) {
    d[o + F.move] = ATTACK_KINDS.indexOf(a.move.id as AttackKind);
    d[o + F.height] = HEIGHTS.indexOf(a.height);
    d[o + F.startup] = a.startup;
    d[o + F.total] = a.total;
    d[o + F.hasHit] = a.hasHit ? 1 : 0;
    d[o + F.blocked] = a.blocked ? 1 : 0;
    d[o + F.ix] = a.impact[0];
    d[o + F.iy] = a.impact[1];
    d[o + F.iz] = a.impact[2];
    d[o + F.tired] = a.tired ? 1 : 0;
  } else d.fill(0, o + F.move, o + F.tired + 1); // rows are reused: no stale attack data
  const h = f.hitReaction;
  d[o + F.hit] = h ? 1 : 0;
  if (h) {
    d[o + F.zone] = h.zone === 'head' ? 1 : 0;
    d[o + F.heavy] = h.heavy ? 1 : 0;
    d[o + F.side] = h.side;
    d[o + F.fromYaw] = h.fromYaw;
    d[o + F.kind] = ATTACK_KINDS.indexOf(h.kind);
  } else d.fill(0, o + F.zone, o + F.kind + 1);
}

/**
 * A read-only stand-in for a Fighter, filled from a row: the fields the
 * animator reads, with the same derived getters. Reused (no allocation).
 */
export class FighterView {
  id: 0 | 1;
  x = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  stamina = 100;
  stance: 'orthodox' | 'southpaw' = 'orthodox';
  state: FighterStateName = 'idle';
  stateTick = 0;
  stunTicks = 0;
  attackSerial = 0;
  downCause: 'fall' | 'knockdown' | null = null;
  attack: { move: (typeof MOVES)[AttackKind]; height: TargetHeight; startup: number; total: number; hasHit: boolean; blocked: boolean; impact: [number, number, number]; tired: boolean } | null = null;
  hitReaction: { zone: 'body' | 'head'; heavy: boolean; side: number; fromYaw: number; kind: AttackKind } | null = null;
  private readonly atkObj = { move: MOVES.punch, height: 'body' as TargetHeight, startup: 0, total: 0, hasHit: false, blocked: false, impact: [0, 0, 0] as [number, number, number], tired: false };
  private readonly hitObj = { zone: 'body' as 'body' | 'head', heavy: false, side: 0, fromYaw: 0, kind: 'punch' as AttackKind };
  constructor(id: 0 | 1) {
    this.id = id;
  }
  get mirror(): number {
    return this.stance === 'orthodox' ? 1 : -1;
  }
  read(src: Float32Array, r: number) {
    const o = r * ROW + WORLD_FIELDS + this.id * FIGHTER_FIELDS;
    this.x = src[o + F.x];
    this.z = src[o + F.z];
    this.yaw = src[o + F.yaw];
    this.vx = src[o + F.vx];
    this.vz = src[o + F.vz];
    this.stamina = src[o + F.stamina];
    this.stance = src[o + F.stance] ? 'southpaw' : 'orthodox';
    this.state = STATES[src[o + F.state]] ?? 'idle';
    this.stateTick = src[o + F.stateTick];
    this.stunTicks = src[o + F.stunTicks];
    this.attackSerial = src[o + F.attackSerial];
    this.downCause = src[o + F.downCause] === 1 ? 'fall' : src[o + F.downCause] === 2 ? 'knockdown' : null;
    if (src[o + F.atk]) {
      const a = this.atkObj;
      a.move = MOVES[ATTACK_KINDS[src[o + F.move]]];
      a.height = HEIGHTS[src[o + F.height]];
      a.startup = src[o + F.startup];
      a.total = src[o + F.total];
      a.hasHit = !!src[o + F.hasHit];
      a.blocked = !!src[o + F.blocked];
      a.impact[0] = src[o + F.ix];
      a.impact[1] = src[o + F.iy];
      a.impact[2] = src[o + F.iz];
      a.tired = !!src[o + F.tired];
      this.attack = a;
    } else this.attack = null;
    if (src[o + F.hit]) {
      const h = this.hitObj;
      h.zone = src[o + F.zone] ? 'head' : 'body';
      h.heavy = !!src[o + F.heavy];
      h.side = src[o + F.side];
      h.fromYaw = src[o + F.fromYaw];
      h.kind = ATTACK_KINDS[src[o + F.kind]];
      this.hitReaction = h;
    } else this.hitReaction = null;
    return this;
  }
}

export const rowHitstop = (src: Float32Array, r: number) => src[r * ROW + W.hitstop];
export const rowPhase = (src: Float32Array, r: number): MatchPhase => PHASES[src[r * ROW + W.phase]] ?? 'fight';
export const rowX = (src: Float32Array, r: number, i: 0 | 1) => src[r * ROW + WORLD_FIELDS + i * FIGHTER_FIELDS + F.x];
export const rowZ = (src: Float32Array, r: number, i: 0 | 1) => src[r * ROW + WORLD_FIELDS + i * FIGHTER_FIELDS + F.z];
export const rowState = (src: Float32Array, r: number, i: 0 | 1): FighterStateName => STATES[src[r * ROW + WORLD_FIELDS + i * FIGHTER_FIELDS + F.state]] ?? 'idle';
