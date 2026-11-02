import { create } from 'zustand';
import type { Difficulty } from '../game/ai/AIController';
import type { MatchPhase } from '../game/combat/CombatWorld';
import type { PerfSnapshot } from '../game/perf/PerfMonitor';
import type { QualitySetting } from '../game/render/quality';

export type GameMode = 'arcade' | 'competitive' | 'training';

export interface HudState {
  names: [string, string];
  shortNames: [string, string];
  health: [number, number];
  maxHealth: [number, number];
  stamina: [number, number];
  seconds: number;
  round: number;
  wins: [number, number];
  roundsToWin: number;
  phase: MatchPhase;
  matchWinner: 0 | 1 | null;
  lastRoundWinner: 0 | 1 | null;
  high: boolean;
  lockOn: boolean;
  stance: 'orthodox' | 'southpaw';
  mode: GameMode;
  points: [number, number];
  gamjeom: [number, number];
  /** Gam-jeom across the whole match (Art. 14 cumulative limit). */
  gamjeomMatch: [number, number];
  lead: boolean;
}

export interface Toast {
  id: number;
  text: string;
  sub?: string;
  side: 0 | 1 | null;
  kind: 'call' | 'hit' | 'info' | 'score' | 'penalty';
}

export interface Settings {
  quality: QualitySetting;
  showPerf: boolean;
  volume: number;
  /** Show touch controls even when a keyboard is detected. */
  forceTouch: boolean;
  /** Touch layout: compact (one Kick button + technique wheel) or classic (one button per technique). */
  controlScheme: 'compact' | 'classic';
  /** Technique fired by the compact Kick button (persists). */
  selectedKick: 'front' | 'round' | 'side' | 'back' | 'leadFront' | 'leadRound' | 'leadSide';
  /** Dismissed the "add to home screen" hint. */
  pwaHintDismissed: boolean;
  /** Competitive round length (s): 60, 90 (default) or 120 (WT senior standard). */
  compRoundSeconds: 60 | 90 | 120;
  /** Touch controls: idle opacity (0.35–1) and size (0.85–1.25). */
  controlOpacity: number;
  controlScale: number;
  /** Mirror the touch layout: techniques on the left, joystick on the right. */
  leftHanded: boolean;
  /** Lock-on camera drifts to a side view when you are not steering it. */
  cameraAssist: boolean;
  /** Comfort: reduce camera shake / hit flashes. */
  reduceShake: boolean;
  reduceFlash: boolean;
  /** Audio channels (0–1) and mute. `volume` is the master level. */
  sfxVolume: number;
  ambientVolume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  showPerf: false,
  volume: 0.8,
  forceTouch: false,
  controlScheme: 'compact',
  selectedKick: 'round',
  pwaHintDismissed: false,
  compRoundSeconds: 90,
  controlOpacity: 0.7,
  controlScale: 1,
  leftHanded: false,
  cameraAssist: true,
  reduceShake: false,
  reduceFlash: false,
  sfxVolume: 1,
  ambientVolume: 0.5,
  muted: false,
};

const SETTINGS_KEY = 'dojang.settings.v1';

function loadSettings(): Settings {
  const def: Settings = { ...DEFAULT_SETTINGS };
  // Respect the OS reduced-motion preference on first run.
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) def.reduceShake = def.reduceFlash = true;
  } catch {
    /* no matchMedia */
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable (private mode): defaults */
  }
  return def;
}

interface GameStore {
  screen: 'menu' | 'match';
  difficulty: Difficulty;
  mode: GameMode;
  paused: boolean;
  loading: boolean;
  loadError: string | null;
  hud: HudState | null;
  toasts: Toast[];
  perf: PerfSnapshot | null;
  settings: Settings;
  startMatch(d: Difficulty, mode?: GameMode): void;
  toMenu(): void;
  setPaused(p: boolean): void;
  setHud(h: HudState): void;
  pushToast(t: Omit<Toast, 'id'>, ms?: number): void;
  setPerf(p: PerfSnapshot): void;
  setLoading(l: boolean, err?: string | null): void;
  updateSettings(s: Partial<Settings>): void;
}

let toastId = 1;

export const useGameStore = create<GameStore>((set, get) => ({
  screen: 'menu',
  difficulty: 'normal',
  mode: 'arcade',
  paused: false,
  loading: false,
  loadError: null,
  hud: null,
  toasts: [],
  perf: null,
  settings: loadSettings(),
  startMatch: (difficulty, mode = 'arcade') => set({ screen: 'match', difficulty, mode, paused: false, hud: null, toasts: [] }),
  toMenu: () => set({ screen: 'menu', paused: false, hud: null, toasts: [] }),
  setPaused: (paused) => set({ paused }),
  setHud: (hud) => set({ hud }),
  pushToast: (t, ms = 1100) => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), ms);
  },
  setPerf: (perf) => set({ perf }),
  setLoading: (loading, err = null) => set({ loading, loadError: err }),
  updateSettings: (s) => {
    const settings = { ...get().settings, ...s };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    set({ settings });
  },
}));
