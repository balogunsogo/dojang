// Global simulation constants. Gameplay runs on a fixed 60 Hz tick so that
// frame data (startup/active/recovery) is expressed in ticks and behaves the
// same on a 30 FPS phone and a 144 Hz desktop.
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
/** Max sim steps per rendered frame; protects low-end devices from a spiral of death. */
export const MAX_STEPS_PER_FRAME = 5;

/** Half-size of the square competition mat (8 m x 8 m, WT field of play is ~8 m). */
export const ARENA_HALF = 4.0;
/** Body collision radius used for push-apart between fighters and walls. */
export const BODY_RADIUS = 0.34;

/** Hurt volumes in the defender's local frame (metres). */
export const HURT = {
  /** Trunk protector (hogu): vertical capsule. */
  bodyBottom: 0.98,
  bodyTop: 1.38,
  bodyRadius: 0.2,
  /** Head (headgear). */
  headHeight: 1.62,
  headRadius: 0.15,
} as const;

export const STAMINA_MAX = 100;
