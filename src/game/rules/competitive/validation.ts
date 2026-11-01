import type { AttackState, Fighter } from '../../combat/Fighter';
import type { HitZone } from '../../combat/hit';
import type { MoveDef } from '../../combat/moves';
import { clamp } from '../../math';
import type { CompetitiveConfig } from './config';

export interface ContactCheck {
  valid: boolean;
  reason?: string;
  /** Delivered force proxy 0..1 (extension reached x stamina condition). */
  force: number;
  turning: boolean;
}

/**
 * How far the technique had extended when it met the target (0 = still in
 * chamber, 1 = full reach). The simulation latches the impact point to the
 * target's surface on the first active tick, so a jammed kick (opponent too
 * close) shows up as a short extension. This is a geometric measurement of
 * the strike, not an invented sensor value.
 */
export function extensionAtContact(atk: AttackState): number {
  const m = atk.move;
  const nominal = m.impact[atk.height][2] - m.chamber[2];
  if (nominal <= 1e-6) return 1;
  return clamp((atk.impact[2] - m.chamber[2]) / nominal, 0, 1);
}

/** Turning-kick eligibility comes from how the technique is delivered, not hip rotation. */
export function isTurningTechnique(move: MoveDef, cfg: CompetitiveConfig): boolean {
  return move.turnDegrees >= cfg.turningMinDegrees;
}

export function isOutOfBounds(f: Fighter, cfg: CompetitiveConfig): boolean {
  return Math.max(Math.abs(f.x), Math.abs(f.z)) + cfg.footExtent > cfg.boundary;
}

/**
 * Validity of a clean (unblocked) contact under the competitive rules.
 * Blocked strikes never reach this point (they hit the arms, not the
 * scoring zones).
 */
export function validateContact(
  attacker: Fighter,
  atk: AttackState,
  zone: HitZone,
  stopped: boolean,
  cfg: CompetitiveConfig,
): ContactCheck {
  const move = atk.move;
  const turning = isTurningTechnique(move, cfg);
  const ext = extensionAtContact(atk);
  const force = ext * (atk.tired ? cfg.tiredForce : 1);
  if (stopped) return { valid: false, reason: 'After Kal-yeo', force, turning };
  if (isOutOfBounds(attacker, cfg)) return { valid: false, reason: 'Attacker out of bounds', force, turning };
  if (move.limb === 'rearHand' && zone !== 'body') return { valid: false, reason: 'Punch to the head', force, turning };
  const needed = zone === 'head' ? cfg.minHeadExtension : cfg.minTrunkExtension;
  if (force < needed) return { valid: false, reason: zone === 'head' ? 'No clean contact' : 'Insufficient impact', force, turning };
  return { valid: true, force, turning };
}
