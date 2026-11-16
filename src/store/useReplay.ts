import { create } from 'zustand';
import type { ReplayRecorder, ReplaySet } from '../game/replay/recorder';

export type ReplayCamera = 'broadcast' | 'side' | 'close';
export type ReplaySpeed = 0.25 | 0.5 | 1;

/** Commands from the viewer UI to the playback controller (registered by the host). */
export interface ReplayController {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  restart(): void;
  setSpeed(s: ReplaySpeed): void;
  setCamera(c: ReplayCamera): void;
  select(index: number): void;
}

/** Where the viewer returns to: the match's own result screen, or a menu panel (Champion). */
export type ReplayOrigin = { kind: 'match' } | { kind: 'menu'; panel: 'champion' };

interface ReplayState {
  /** The current match's recorder, until its clips are sealed. */
  pending: ReplayRecorder | null;
  /** Highlights of the most recently completed match or activity (memory only). */
  set: ReplaySet | null;
  /** Viewer open, and from where. */
  origin: ReplayOrigin | null;
  index: number;
  playing: boolean;
  speed: ReplaySpeed;
  camera: ReplayCamera;
  time: number;
  duration: number;
  /** The current clip is baked and on screen. */
  ready: boolean;
  controller: ReplayController | null;
  /** Bumps when a match completes (result panels re-check for highlights). */
  completions: number;
  /** A new match or activity starts: forget the previous highlights. */
  adopt(r: ReplayRecorder): void;
  /** Highlights available for the current result (0 = no Watch replay). */
  count(): number;
  /** Seal (if needed) and open the viewer. */
  open(origin: ReplayOrigin, index?: number): boolean;
  close(): void;
  ui(p: Partial<Pick<ReplayState, 'index' | 'playing' | 'speed' | 'camera' | 'time' | 'duration' | 'ready'>>): void;
}

export const useReplay = create<ReplayState>((set, get) => ({
  pending: null,
  set: null,
  origin: null,
  index: 0,
  playing: false,
  speed: 1,
  camera: 'broadcast',
  time: 0,
  duration: 0,
  ready: false,
  controller: null,
  completions: 0,
  adopt: (r) => {
    get().pending?.dispose();
    r.onCompleted = () => get().pending === r && set({ completions: get().completions + 1 });
    r.onSealed = (s) => {
      if (get().pending === r) set({ pending: null, set: s.clips.length ? s : null });
    };
    set({ pending: r, set: null, origin: null });
  },
  count: () => {
    const s = get();
    if (s.set) return s.set.clips.length;
    return s.pending?.completed ? s.pending.highlightCount : 0;
  },
  open: (origin, index = 0) => {
    const s = get();
    const sealed = s.set ?? s.pending?.seal() ?? null;
    if (!sealed || !sealed.clips.length) return false;
    set({ set: sealed, pending: null, origin, index: Math.min(index, sealed.clips.length - 1), playing: false, time: 0, ready: false, camera: 'broadcast', speed: 1 });
    return true;
  },
  close: () => set({ origin: null, playing: false, ready: false, controller: null }),
  ui: (p) => set(p),
}));
