export type QualityTier = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | QualityTier;

export interface QualityProfile {
  tier: QualityTier;
  /** Max device pixel ratio. */
  maxDpr: number;
  /** Lowest DPR the adaptive scaler may drop to. */
  minDpr: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
  /** Frame budget the adaptive scaler defends (ms). */
  targetMs: number;
}

export const PROFILES: Record<QualityTier, QualityProfile> = {
  low: { tier: 'low', maxDpr: 1, minDpr: 0.6, shadows: false, shadowMapSize: 512, antialias: false, targetMs: 33.3 },
  medium: { tier: 'medium', maxDpr: 1.5, minDpr: 0.75, shadows: true, shadowMapSize: 1024, antialias: false, targetMs: 16.7 },
  high: { tier: 'high', maxDpr: 2, minDpr: 1, shadows: true, shadowMapSize: 2048, antialias: true, targetMs: 16.7 },
};

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

/** Heuristic starting tier; the adaptive scaler then corrects using measured frame times. */
export function detectTier(): QualityTier {
  if (typeof navigator === 'undefined') return 'medium';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  if (isTouchDevice()) return cores <= 4 || mem <= 3 ? 'low' : 'medium';
  return cores <= 2 || mem <= 2 ? 'medium' : 'high';
}

export function resolveQuality(setting: QualitySetting): QualityProfile {
  return PROFILES[setting === 'auto' ? detectTier() : setting];
}

/**
 * Adaptive resolution: lowers the render pixel ratio when the measured frame
 * time is over budget and raises it again when there is headroom.
 */
export class DynamicResolution {
  dpr: number;
  private over = 0;
  private under = 0;
  /** Times the resolution had to drop; each one makes raising it again more cautious. */
  private drops = 0;
  constructor(private profile: QualityProfile, deviceDpr: number) {
    this.dpr = Math.min(profile.maxDpr, deviceDpr);
  }
  /** Returns a new DPR when a change is warranted, otherwise null. */
  update(dt: number, avgMs: number, deviceDpr: number): number | null {
    const max = Math.min(this.profile.maxDpr, deviceDpr);
    const min = Math.min(max, this.profile.minDpr);
    if (avgMs > this.profile.targetMs * 1.15) {
      this.over += dt;
      this.under = 0;
    } else if (avgMs < this.profile.targetMs * 0.7) {
      this.under += dt;
      this.over = 0;
    } else {
      this.over = this.under = 0;
    }
    if (this.over > 1.5 && this.dpr > min) {
      this.dpr = Math.max(min, +(this.dpr - 0.15).toFixed(2));
      this.over = 0;
      this.drops++;
      return this.dpr;
    }
    // Avoid see-sawing (each change resizes the canvas): wait longer after every drop.
    if (this.under > Math.min(30, 4 + 8 * this.drops) && this.dpr < max) {
      this.dpr = Math.min(max, +(this.dpr + 0.1).toFixed(2));
      this.under = 0;
      return this.dpr;
    }
    return null;
  }
}
