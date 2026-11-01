// The game-action abstraction. Every input device (keyboard, touch buttons,
// touch gestures, gamepad) and the AI produce the same structures, so combat
// code never knows where an input came from.

export type AttackKind = 'punch' | 'front' | 'round' | 'side' | 'back' | 'leadFront' | 'leadRound' | 'leadSide';
export type TargetHeight = 'body' | 'head';
export const ATTACK_KINDS: AttackKind[] = ['punch', 'front', 'round', 'side', 'back', 'leadFront', 'leadRound', 'leadSide'];
/** Lead-leg technique for a rear-leg kick, where one exists. */
export const LEAD_OF: Partial<Record<AttackKind, AttackKind>> = { front: 'leadFront', round: 'leadRound', side: 'leadSide' };

/**
 * Raw device-level actions for one rendered frame. Movement is in screen /
 * camera space (x = right, y = up/forward on the stick). "Pressed" flags are
 * edge-triggered and consumed by the next simulation tick.
 */
export interface ActionState {
  moveX: number;
  moveY: number;
  guard: boolean;
  /** Head-target modifier (held). */
  high: boolean;
  /** Lead-leg modifier (held): kick keys throw the lead-leg version. */
  lead: boolean;
  attack: AttackKind | null;
  /** Height requested together with `attack` (gestures can set this directly). */
  attackHeight: TargetHeight | null;
  dash: boolean;
  switchStance: boolean;
  toggleLock: boolean;
  pause: boolean;
  /** Camera orbit deltas (radians) accumulated since last frame. */
  camYaw: number;
  camPitch: number;
  camZoom: number;
}

export function emptyActions(): ActionState {
  return {
    moveX: 0,
    moveY: 0,
    guard: false,
    high: false,
    lead: false,
    attack: null,
    attackHeight: null,
    dash: false,
    switchStance: false,
    toggleLock: false,
    pause: false,
    camYaw: 0,
    camPitch: 0,
    camZoom: 0,
  };
}

/**
 * Simulation-level intent for one fighter for one tick. Movement is a world
 * space direction (length <= 1). Produced from ActionState by the player
 * controller (using camera yaw) or directly by the AI.
 */
export interface FighterIntent {
  moveX: number;
  moveZ: number;
  guard: boolean;
  attack: AttackKind | null;
  height: TargetHeight;
  dash: boolean;
  switchStance: boolean;
}

export function emptyIntent(): FighterIntent {
  return { moveX: 0, moveZ: 0, guard: false, attack: null, height: 'body', dash: false, switchStance: false };
}
