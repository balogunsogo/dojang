import type { Difficulty } from '../game/ai/AIController';
import type { BELT_COLORS } from '../game/render/characterFactory';

/** The AI difficulty presets, named by belt (sparring setup and the Dojang Open). */
export const DIFFS: { id: Difficulty; label: string; note: string; belt: keyof typeof BELT_COLORS }[] = [
  { id: 'easy', label: 'White belt', note: 'Slow reactions, predictable, simple combinations', belt: 'white' },
  { id: 'normal', label: 'Red belt', note: 'Better spacing and blocking, some counters', belt: 'red' },
  { id: 'hard', label: 'Black belt', note: 'Reads your habits, counters, plays the score', belt: 'black' },
];
export const LEVEL_NAME: Record<Difficulty, string> = { easy: 'White belt', normal: 'Red belt', hard: 'Black belt' };
export const LEVEL_BELT: Record<Difficulty, 'white' | 'red' | 'black'> = { easy: 'white', normal: 'red', hard: 'black' };
