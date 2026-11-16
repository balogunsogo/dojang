/**
 * Replay recorder: observes a match and keeps just enough to replay up to
 * three highlights. Read-only: it copies numbers out of the world after each
 * authoritative tick and never writes back.
 *
 * - A ring of the last 12 s of ticks (compact rows, see format.ts).
 * - A highlight-worthy event opens a candidate clip: 6 s before (from the
 *   ring) and 4 s after (appended as the match goes on). At most 8
 *   candidates are alive; the weakest is dropped, never the latest hit.
 * - Online, ticks are staged as the rollback simulates them and committed
 *   only once they are confirmed (every remote input known, no correction
 *   pending), so predicted or rolled-back actions never enter the record and
 *   re-simulated events are never counted twice.
 * - When the match or activity completes, the best three are kept; their
 *   clips finish filling while the result screen shows, or are sealed early
 *   (replay opened, screen left). A clip cut short by the end of the match
 *   continues each fighter's last state (a KO fall, a victory) for display
 *   only, marked `synthFrom`; no outcome is invented.
 */
import type { CombatEvent, CombatWorld } from '../combat/CombatWorld';
import { TICK_HZ } from '../config';
import type { AttackKind } from '../input/actions';
import { F, FIGHTER_FIELDS, ROW, ROW_BYTES, STATES, W, WORLD_FIELDS, writeRow } from './format';
import { type Candidate, moveName, scoreHit, selectHighlights } from './highlights';

export const PRE_TICKS = 6 * TICK_HZ;
export const POST_TICKS = 4 * TICK_HZ;
export const RING_TICKS = 12 * TICK_HZ;
const CLIP_ROWS = PRE_TICKS + POST_TICKS + 1;
const MAX_CANDIDATES = 8;
const STAGE_SLOTS = 128;
const COMBO_TICKS = Math.round(1.2 * TICK_HZ);

export type ReplayEvent =
  | { t: number; k: 'attack'; who: 0 | 1; move: AttackKind; strikeIn: number }
  | { t: number; k: 'whiff'; who: 0 | 1 }
  | { t: number; k: 'hit'; a: 0 | 1; d: 0 | 1; move: AttackKind; zone: 'head' | 'body'; counter: boolean; turning: boolean; heavy: boolean; side: number; point: [number, number, number]; valid?: boolean; points: number }
  | { t: number; k: 'block'; a: 0 | 1; d: 0 | 1; move: AttackKind; punch: boolean; guardBreak: boolean; point: [number, number, number] }
  | { t: number; k: 'ko'; who: 0 | 1 }
  | { t: number; k: 'down'; who: 0 | 1 };

export interface ReplayClip {
  /** First tick of the clip (recorder ticks; diagnostics and tests). */
  start: number;
  label: string;
  by: 0 | 1 | null;
  /** Rows (ROW floats per tick), len ticks. */
  rows: Float32Array;
  len: number;
  /** Tick of the highlight moment within the clip. */
  eventTick: number;
  /** Events, ticks relative to the clip start. */
  events: ReplayEvent[];
  /** Rows from here on continue the last state for display (the match had ended). */
  synthFrom: number;
  score: number;
}

export interface ReplayMeta {
  ids: [string, string];
  belts: [string, string];
  names: [string, string];
  /** Which corner this device's player controls (null on couch / training partner shown as 1). */
  me: 0 | 1;
  mode: 'arcade' | 'competitive' | 'training';
  online: boolean;
  couch: boolean;
  boundary?: number;
  /** Where the replay returns to (set by the UI). */
  origin?: unknown;
}

export interface ReplaySet {
  id: number;
  meta: ReplayMeta;
  clips: ReplayClip[];
}

interface LiveCandidate extends Candidate {
  start: number;
  buf: Float32Array;
  len: number;
  events: ReplayEvent[];
}

let nextSetId = 1;

export class ReplayRecorder {
  /** Committed ticks so far. */
  count = 0;
  /** Diagnostics: total time spent recording (ms) and ticks recorded. */
  costMs = 0;
  private readonly ring = new Float32Array(RING_TICKS * ROW);
  private recent: ReplayEvent[] = [];
  private cands: LiveCandidate[] = [];
  private chosen: LiveCandidate[] | null = null;
  private pool: Float32Array[] = [];
  private lastHit: [{ tick: number; move: AttackKind } | null, { tick: number; move: AttackKind } | null] = [null, null];
  private completedAt = -1;
  private sealed: ReplaySet | null = null;
  private disposed = false;
  // Online staging: rows and events per simulated frame, until confirmed.
  private readonly stageRows = new Float32Array(STAGE_SLOTS * ROW);
  private readonly stageFrame = new Int32Array(STAGE_SLOTS).fill(-1);
  private readonly stageEvents: ReplayEvent[][] = Array.from({ length: STAGE_SLOTS }, () => []);
  private committedFrame = -1;
  /** Called once the clips are complete (all windows filled, or sealed early). */
  onSealed: ((s: ReplaySet) => void) | null = null;

  constructor(readonly meta: ReplayMeta) {}

  get completed() {
    return this.completedAt >= 0;
  }

  /** Highlights available after completion (before sealing too). */
  get highlightCount() {
    return this.sealed ? this.sealed.clips.length : (this.chosen?.length ?? 0);
  }

  // ── Offline: every step is authoritative ─────────────────────────────

  /** Record the tick the world just stepped, with its events. */
  tick(w: CombatWorld, events: readonly CombatEvent[]) {
    if (this.disposed || this.sealed) return;
    const t0 = performance.now();
    writeRow(this.ring, this.count % RING_TICKS, w);
    const evs = convert(events, w, this.count);
    this.commit(evs);
    this.costMs += performance.now() - t0;
  }

  // ── Online: stage what the rollback simulates, commit what is confirmed ─

  /** The rollback simulated frame `f` (possibly again, after a correction). */
  stage(f: number, w: CombatWorld) {
    if (this.disposed || this.sealed || f <= this.committedFrame) return;
    const t0 = performance.now();
    const s = f % STAGE_SLOTS;
    writeRow(this.stageRows, s, w);
    this.stageFrame[s] = f;
    this.stageEvents[s] = convert(w.events, w, -1);
    this.costMs += performance.now() - t0;
  }

  /** Commit staged frames up to `f` (every input up to `f` is known and no correction is pending). */
  commitThrough(f: number) {
    if (this.disposed || this.sealed) return;
    while (this.committedFrame < f) {
      const next = this.committedFrame + 1;
      const s = next % STAGE_SLOTS;
      if (this.stageFrame[s] !== next) return; // not simulated yet
      this.ring.set(this.stageRows.subarray(s * ROW, s * ROW + ROW), (this.count % RING_TICKS) * ROW);
      const evs = this.stageEvents[s];
      for (const e of evs) e.t = this.count;
      this.commit(evs);
      this.stageEvents[s] = [];
      this.committedFrame = next;
    }
  }

  /** Training feedback at the current tick ('rep' = a completed drill). */
  training(code: string) {
    if (code !== 'rep' || this.disposed || this.sealed || this.completed) return;
    const t = this.count - 1;
    const c = this.latestCandidate(t, 60);
    if (c) {
      c.score += 22;
      c.kind = 'train';
      c.label = 'Training combination';
    } else this.open({ tick: t, score: 30, kind: 'train', label: 'Training combination', by: null });
  }

  // ── Core ─────────────────────────────────────────────────────────────

  private commit(evs: ReplayEvent[]) {
    const t = this.count;
    this.count++;
    // Recent events (for new candidates' lead-in), bounded to the ring.
    for (const e of evs) this.recent.push(e);
    if (this.recent.length > 400 || (this.recent[0] && this.recent[0].t < t - RING_TICKS)) this.recent = this.recent.filter((e) => e.t >= t - RING_TICKS);
    // Grow live clips.
    const live = this.chosen ?? this.cands;
    const row = (t % RING_TICKS) * ROW;
    for (const c of live) {
      if (t <= c.tick + POST_TICKS && c.len < CLIP_ROWS) {
        c.buf.set(this.ring.subarray(row, row + ROW), c.len * ROW);
        c.len++;
        for (const e of evs) c.events.push(e);
      }
    }
    if (!this.completed) for (const e of evs) this.consider(e);
    if (this.chosen && this.chosen.every((c) => t >= c.tick + POST_TICKS || c.len >= CLIP_ROWS)) this.seal();
  }

  private consider(e: ReplayEvent) {
    if (e.k === 'hit') {
      const prev = this.lastHit[e.a];
      const combo = prev && e.t - prev.tick <= COMBO_TICKS ? prev.move : undefined;
      this.lastHit[e.a] = { tick: e.t, move: e.move };
      const s = scoreHit({ attacker: e.a, move: e.move, zone: e.zone, counter: e.counter, turning: e.turning, valid: e.valid, points: e.points, combo });
      if (s.score > 0) this.open({ tick: e.t, ...s });
    } else if (e.k === 'block' && e.guardBreak) {
      this.open({ tick: e.t, score: 14, kind: 'guard', label: `Guard break · ${moveName(e.move)}`, by: e.a, move: e.move });
    } else if (e.k === 'ko' || e.k === 'down') {
      // Upgrade the finishing strike (its impact frames the clip best).
      const strike = this.latestCandidate(e.t, 12, (1 - e.who) as 0 | 1);
      const ko = e.k === 'ko';
      if (strike) {
        strike.score += ko ? 100 : 55;
        strike.kind = ko ? 'ko' : 'down';
        strike.label = `${ko ? 'Knockout' : 'Knockdown'}${strike.move ? ` · ${moveName(strike.move)}` : ''}`;
      } else if (ko) this.open({ tick: e.t, score: 100, kind: 'ko', label: 'Knockout', by: (1 - e.who) as 0 | 1 });
    }
  }

  private latestCandidate(t: number, within: number, by?: 0 | 1) {
    for (let i = this.cands.length - 1; i >= 0; i--) {
      const c = this.cands[i];
      if (t - c.tick <= within && (by === undefined || c.by === by)) return c;
    }
    return null;
  }

  private open(c: Candidate) {
    const start = Math.max(0, this.count - RING_TICKS, c.tick - PRE_TICKS);
    const buf = this.pool.pop() ?? new Float32Array(CLIP_ROWS * ROW);
    let len = 0;
    for (let t = start; t < this.count; t++, len++) {
      const r = (t % RING_TICKS) * ROW;
      buf.set(this.ring.subarray(r, r + ROW), len * ROW);
    }
    const live: LiveCandidate = { ...c, start, buf, len, events: this.recent.filter((e) => e.t >= start) };
    this.cands.push(live);
    if (this.cands.length > MAX_CANDIDATES) {
      // Drop the weakest, never the newest (it may still become the match-winner).
      let worst = 0;
      for (let i = 1; i < this.cands.length - 1; i++) if (this.cands[i].score < this.cands[worst].score) worst = i;
      this.pool.push(this.cands[worst].buf);
      this.cands.splice(worst, 1);
    }
  }

  /** The match or activity ended (online: once the result is confirmed). */
  complete(winner: 0 | 1 | null = null) {
    if (this.completed || this.disposed) return;
    this.completedAt = this.count;
    // The winner's last strike within 4 s of the end is the match-winning one.
    if (winner !== null) {
      const last = this.latestCandidate(this.count - 1, 4 * TICK_HZ, winner);
      if (last && last.kind !== 'train') {
        last.score += 35;
        if (!/^(Knockout|Knockdown)/.test(last.label)) last.label = `Match-winning · ${last.label.replace(/^Combination · /, '')}`;
      }
    }
    this.chosen = selectHighlights(this.cands) as LiveCandidate[];
    for (const c of this.cands) if (!this.chosen.includes(c)) this.pool.push(c.buf);
    this.cands = [];
    this.pool = [];
    if (this.chosen.length === 0) this.seal();
    else if (this.chosen.every((c) => this.count - 1 >= c.tick + POST_TICKS)) this.seal();
  }

  /** Finish the clips now. Returns the set (null when the match never completed). */
  seal(): ReplaySet | null {
    if (this.sealed) return this.sealed;
    if (!this.completed || this.disposed) return null;
    const clips: ReplayClip[] = (this.chosen ?? []).map((c) => {
      const synthFrom = c.len;
      const want = Math.min(CLIP_ROWS, c.tick - c.start + POST_TICKS + 1);
      // Continue each fighter's final state for display (time in state runs on; nothing else changes).
      for (let r = c.len; r < want; r++) continueRow(c.buf, r);
      const len = Math.max(c.len, want);
      const rows = c.buf.slice(0, len * ROW);
      return { start: c.start, label: c.label, by: c.by, rows, len, eventTick: c.tick - c.start, events: c.events.map((e) => ({ ...e, t: e.t - c.start })).filter((e) => e.t >= 0 && e.t < len), synthFrom, score: c.score };
    });
    this.sealed = { id: nextSetId++, meta: this.meta, clips };
    this.chosen = null;
    this.recent = [];
    this.onSealed?.(this.sealed);
    return this.sealed;
  }

  /** A committed row from the ring (tests / diagnostics), or null when it has left the ring. */
  rowAt(tick: number): Float32Array | null {
    if (tick < 0 || tick >= this.count || tick < this.count - RING_TICKS) return null;
    const r = (tick % RING_TICKS) * ROW;
    return this.ring.slice(r, r + ROW);
  }

  /** Committed events still in the recent window (tests / diagnostics). */
  get recentEvents(): readonly ReplayEvent[] {
    return this.recent;
  }

  /** Bytes held now (ring, staging, live clips). */
  bytes() {
    const live = (this.chosen ?? this.cands).length + this.pool.length;
    const clips = this.sealed ? this.sealed.clips.reduce((s, c) => s + c.rows.byteLength, 0) : live * CLIP_ROWS * ROW_BYTES;
    return this.ring.byteLength + this.stageRows.byteLength + clips;
  }

  dispose() {
    this.disposed = true;
    this.cands = [];
    this.chosen = null;
    this.pool = [];
    this.recent = [];
    this.onSealed = null;
  }
}

/** Copy the previous row, advancing each fighter's time in state; no motion, no hit stop. */
function continueRow(buf: Float32Array, r: number) {
  const o = r * ROW;
  buf.copyWithin(o, o - ROW, o);
  buf[o + W.hitstop] = 0;
  for (let i = 0; i < 2; i++) {
    const f = o + WORLD_FIELDS + i * FIGHTER_FIELDS;
    buf[f + F.stateTick] += 1;
    buf[f + F.vx] = 0;
    buf[f + F.vz] = 0;
    // An attack that would end continues as idle (no new outcome).
    if (STATES[buf[f + F.state]] === 'attack' && buf[f + F.stateTick] >= buf[f + F.total]) {
      buf[f + F.state] = STATES.indexOf('idle');
      buf[f + F.stateTick] = 0;
      buf[f + F.atk] = 0;
    }
  }
}

/** Compact copies of this tick's combat events (only what playback needs). */
function convert(events: readonly CombatEvent[], w: CombatWorld, t: number): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'attack': {
        const atk = w.fighters[e.fighter].attack;
        out.push({ t, k: 'attack', who: e.fighter, move: e.move.id as AttackKind, strikeIn: (atk?.startup ?? 8) / TICK_HZ });
        break;
      }
      case 'whiff':
        out.push({ t, k: 'whiff', who: e.fighter });
        break;
      case 'hit':
        out.push({
          t,
          k: 'hit',
          a: e.attacker,
          d: e.defender,
          move: e.move.id as AttackKind,
          zone: e.zone,
          counter: e.counter,
          turning: !!e.move.turning,
          heavy: e.counter || e.zone === 'head' || e.move.pushback > 3,
          side: e.move.id === 'round' ? w.fighters[e.attacker].mirror : e.move.id === 'leadRound' ? -w.fighters[e.attacker].mirror : 0,
          point: [e.point[0], e.point[1], e.point[2]],
          valid: e.valid,
          points: e.points,
        });
        break;
      case 'block':
        out.push({ t, k: 'block', a: e.attacker, d: e.defender, move: e.move.id as AttackKind, punch: e.move.limb === 'rearHand', guardBreak: e.guardBreak, point: [e.point[0], e.point[1], e.point[2]] });
        break;
      case 'ko':
        out.push({ t, k: 'ko', who: e.fighter });
        break;
      case 'down':
        out.push({ t, k: 'down', who: e.fighter });
        break;
    }
  }
  return out;
}
