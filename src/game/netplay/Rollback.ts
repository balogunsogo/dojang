import type { CombatEvent, CombatWorld } from '../combat/CombatWorld';
import { emptyIntent, type FighterIntent } from '../input/actions';
import { decodeIntent, encodeIntent, predictFrom } from './inputCodec';
import { checksum, fromJSON, restore, type Snapshot, snapshot, toJSON } from './snapshot';

/** Messages exchanged between the two peers during a match. */
export type NetMsg =
  | { t: 'in'; f: number; i: number[]; ack: number; fr: number; a: number }
  | { t: 'sum'; f: number; h: number }
  | { t: 'need'; f: number }
  | { t: 'state'; f: number; s: string };

export interface RollbackOptions {
  /** Ticks of input delay (hides small latency without rollback). */
  delay?: number;
  /** Max ticks we simulate ahead of the last confirmed remote input. */
  maxPrediction?: number;
  /** The host's state wins when a desync is detected. */
  host: boolean;
}

const NEUTRAL = encodeIntent(emptyIntent());
const SUM_EVERY = 60;
const KEEP = 120;

/**
 * GGPO-style rollback for two peers. Each tick: send our input (with a few
 * ticks of delay), predict the opponent's input if it has not arrived, and
 * when a real input differs from the prediction, rewind to that tick and
 * re-simulate. The simulation is deterministic, so both peers converge.
 */
export class Rollback {
  /** Next tick to simulate. */
  frame = 0;
  /** Highest tick for which every remote input is known. */
  remoteHead: number;
  /** Events from simulated ticks (including re-simulations), drained by the session. */
  readonly events: { f: number; e: CombatEvent }[] = [];
  rollbacks = 0;
  /** Last time a message arrived (ms). */
  lastHeard = performance.now();
  private readonly local: number[] = [];
  private readonly remote: number[] = [];
  private readonly used: number[] = [];
  private readonly snaps = new Map<number, Snapshot>();
  private readonly mySums = new Map<number, number>();
  private readonly hostSums = new Map<number, number>();
  private rollbackFrom = Infinity;
  private peerAck = -1;
  private localAdv = 0;
  private remoteAdv = 0;
  private sinceWait = 0;
  private readonly delay: number;
  private readonly maxPred: number;
  private readonly intents: [FighterIntent, FighterIntent] = [emptyIntent(), emptyIntent()];

  constructor(
    private readonly world: CombatWorld,
    private readonly me: 0 | 1,
    private readonly send: (m: NetMsg) => void,
    private readonly o: RollbackOptions,
  ) {
    this.delay = o.delay ?? 2;
    this.maxPred = o.maxPrediction ?? 8;
    for (let f = 0; f < this.delay; f++) this.local[f] = this.remote[f] = NEUTRAL;
    this.remoteHead = this.delay - 1;
  }

  /** True when the current state uses no predicted input. */
  get confirmed() {
    return this.remoteHead >= this.frame - 1;
  }

  /** A correction is waiting to be re-simulated on the next tick. */
  get pending() {
    return this.rollbackFrom !== Infinity;
  }

  /**
   * Advance one tick with this peer's intent. Returns false when waiting
   * (too far ahead of the opponent); the caller should keep the input.
   */
  tick(intent: FighterIntent): boolean {
    this.sinceWait++;
    const ahead = this.frame - this.remoteHead > this.maxPred;
    const drift = (this.localAdv - this.remoteAdv) / 2 >= 1 && this.sinceWait > 15;
    if (ahead || drift) {
      if (drift) this.sinceWait = 0;
      return false;
    }
    this.local[this.frame + this.delay] = encodeIntent(intent);
    this.settle();
    this.sim(this.frame);
    this.frame++;
    this.snaps.delete(this.frame - KEEP);
    this.checkSync();
    return true;
  }

  /** Re-simulate from the earliest mispredicted tick, if any. */
  settle() {
    if (this.rollbackFrom < this.frame) {
      const from = this.rollbackFrom;
      restore(this.world, this.snaps.get(from)!);
      for (let f = from; f < this.frame; f++) this.sim(f);
      this.rollbacks++;
    }
    this.rollbackFrom = Infinity;
  }

  receive(m: NetMsg) {
    this.lastHeard = performance.now();
    if (m.t === 'in') {
      for (let k = 0; k < m.i.length; k++) if (this.remote[m.f + k] === undefined) this.remote[m.f + k] = m.i[k];
      while (this.remote[this.remoteHead + 1] !== undefined) {
        const f = ++this.remoteHead;
        if (f < this.frame && this.used[f] !== this.remote[f]) this.rollbackFrom = Math.min(this.rollbackFrom, f);
      }
      this.peerAck = Math.max(this.peerAck, m.ack);
      this.localAdv = this.frame - m.fr;
      this.remoteAdv = m.a;
    } else if (m.t === 'sum') {
      this.hostSums.set(m.f, m.h);
      this.compare(m.f);
    } else if (m.t === 'need' && this.o.host) {
      // Send the newest confirmed state we still hold.
      const f = Math.min(this.remoteHead + 1, this.frame - 1);
      const s = this.snaps.get(f);
      if (s) this.send({ t: 'state', f, s: toJSON(s) });
    } else if (m.t === 'state' && !this.o.host) {
      const base = this.snaps.get(m.f);
      if (!base || m.f >= this.frame) return;
      this.snaps.set(m.f, fromJSON(base, m.s));
      this.rollbackFrom = Math.min(this.rollbackFrom, m.f);
    }
  }

  private sim(f: number) {
    this.snaps.set(f, snapshot(this.world));
    const r = this.remote[f] ?? predictFrom(this.remote[this.remoteHead] ?? NEUTRAL);
    this.used[f] = r;
    decodeIntent(this.local[f] ?? NEUTRAL, this.intents[this.me]);
    decodeIntent(r, this.intents[1 - this.me]);
    this.world.step(this.intents);
    for (const e of this.world.events) this.events.push({ f, e });
    this.world.events.length = 0;
  }

  /** Send our recent inputs (call once per rendered frame, after ticking). */
  flush() {
    this.sendInputs();
  }

  private sendInputs() {
    const last = this.local.length - 1;
    const from = Math.max(this.peerAck + 1, last - 30, 0);
    this.send({ t: 'in', f: from, i: this.local.slice(from, last + 1), ack: this.remoteHead, fr: this.frame, a: this.localAdv });
  }

  /** Every second, compare a confirmed state's checksum with the host's. */
  private checkSync() {
    const k = Math.floor((this.remoteHead + 1) / SUM_EVERY) * SUM_EVERY;
    if (k <= 0 || k >= this.frame || this.mySums.has(k) || !this.snaps.has(k)) return;
    const h = checksum(this.snaps.get(k)!);
    this.mySums.set(k, h);
    if (this.o.host) this.send({ t: 'sum', f: k, h });
    else this.compare(k);
    this.mySums.delete(k - SUM_EVERY * 4);
    this.hostSums.delete(k - SUM_EVERY * 4);
  }

  /** Number of desyncs seen (for diagnostics). */
  desyncs = 0;
  private compare(k: number) {
    const mine = this.mySums.get(k);
    const host = this.hostSums.get(k);
    if (mine === undefined || host === undefined || mine === host) return;
    this.desyncs++;
    this.send({ t: 'need', f: k });
  }
}
