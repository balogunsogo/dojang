import type { CombatWorld } from '../combat/CombatWorld';
import { MOVES } from '../combat/moves';

/**
 * Save and restore the whole simulation state for rollback. A deep copy that
 * keeps class prototypes; frozen objects (move data, configs) are shared.
 */
export type Snapshot = Record<string, unknown>;

// Static data is shared by reference, never copied.
for (const m of Object.values(MOVES)) deepFreeze(m);

function deepFreeze(o: object) {
  Object.freeze(o);
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
}

function clone<T>(v: T, seen: Map<object, unknown>): T {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  const hit = seen.get(v);
  if (hit) return hit as T;
  const out: Record<string, unknown> = Array.isArray(v) ? ([] as unknown as Record<string, unknown>) : Object.create(Object.getPrototypeOf(v));
  seen.set(v, out);
  for (const k of Object.keys(v)) out[k] = clone((v as Record<string, unknown>)[k], seen);
  return out as T;
}

export function snapshot(w: CombatWorld): Snapshot {
  return clone({ ...w } as unknown as Snapshot, new Map());
}

/** Restore into the existing world object (callers keep their reference). */
export function restore(w: CombatWorld, s: Snapshot) {
  Object.assign(w, clone(s, new Map()));
}

// ── Plain JSON form (desync checks and host resync) ──────────────────────
const REFS = new Map<object, string>(Object.entries(MOVES).map(([k, m]) => [m, `move:${k}`]));
const BY_REF = new Map<string, object>([...REFS].map(([o, k]) => [k, o]));

export function toJSON(s: Snapshot): string {
  return JSON.stringify(s, (k, v) => (k === 'hooks' ? undefined : k === 'events' ? [] : typeof v === 'number' && !Number.isFinite(v) ? { $num: String(v) } : v && typeof v === 'object' && REFS.has(v) ? { $ref: REFS.get(v) } : v));
}

/** Checksum of a snapshot (FNV-1a over its JSON). */
export function checksum(s: Snapshot): number {
  const str = toJSON(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Apply a host's JSON state onto a local snapshot (keeps prototypes). */
export function fromJSON(base: Snapshot, json: string): Snapshot {
  const plain = JSON.parse(json, (_k, v) => (v && typeof v === 'object' ? (typeof v.$ref === 'string' ? BY_REF.get(v.$ref) : typeof v.$num === 'string' ? Number(v.$num) : v) : v));
  const out = clone(base, new Map());
  merge(out, plain);
  return out;
}

function merge(t: Record<string, unknown>, src: Record<string, unknown>) {
  for (const k of Object.keys(src)) {
    const sv = src[k];
    const tv = t[k];
    if (sv && typeof sv === 'object' && tv && typeof tv === 'object' && !Object.isFrozen(tv) && !Object.isFrozen(sv) && !Array.isArray(sv) === !Array.isArray(tv)) {
      if (Array.isArray(tv)) (tv as unknown[]).length = (sv as unknown[]).length;
      merge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else t[k] = sv;
  }
}
