import { create } from 'zustand';
import type { Difficulty } from '../game/ai/AIController';
import type { MatchPhase } from '../game/combat/CombatWorld';
import type { PerfSnapshot } from '../game/perf/PerfMonitor';
import type { QualitySetting } from '../game/render/quality';

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
  mode: 'arcade' | 'competitive';
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
}

const SETTINGS_KEY = 'dojang.settings.v1';

function loadSettings(): Settings {
  const def: Settings = { quality: 'auto', showPerf: false, volume: 0.8, forceTouch: false, controlScheme: 'compact', selectedKick: 'round', pwaHintDismissed: false, compRoundSeconds: 90 };
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
  mode: 'arcade' | 'competitive';
  paused: boolean;
  loading: boolean;
  loadError: string | null;
  hud: HudState | null;
  toasts: Toast[];
  perf: PerfSnapshot | null;
  settings: Settings;
  startMatch(d: Difficulty, mode?: 'arcade' | 'competitive'): void;
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
