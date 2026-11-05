import { ATTACK_KINDS, type FighterIntent } from '../input/actions';

/**
 * One tick of fighter input packed into a small integer, so both peers feed
 * the simulation exactly the same values. Layout (low bits first):
 * moveX int8+128 (8) · moveZ (8) · guard · dash · switch · head · attack 0..8 (4)
 */
const q = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127))) + 128;

export function encodeIntent(i: FighterIntent): number {
  const atk = i.attack ? ATTACK_KINDS.indexOf(i.attack) + 1 : 0;
  return q(i.moveX) | (q(i.moveZ) << 8) | (+i.guard << 16) | (+i.dash << 17) | (+i.switchStance << 18) | (+(i.height === 'head') << 19) | (atk << 20);
}

export function decodeIntent(n: number, out: FighterIntent): FighterIntent {
  out.moveX = ((n & 255) - 128) / 127;
  out.moveZ = (((n >> 8) & 255) - 128) / 127;
  out.guard = !!(n & (1 << 16));
  out.dash = !!(n & (1 << 17));
  out.switchStance = !!(n & (1 << 18));
  out.height = n & (1 << 19) ? 'head' : 'body';
  const atk = (n >> 20) & 15;
  out.attack = atk ? ATTACK_KINDS[atk - 1] : null;
  return out;
}

/** Prediction for a missing remote tick: keep holding, but no new presses. */
export const predictFrom = (n: number) => n & 0xfffff & ~((1 << 17) | (1 << 18));
