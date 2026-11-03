/**
 * Phase 9 sound set, kept ONLY for the ?lab=sounds before/after comparison
 * (loaded in the lab chunk, never in the game). Fully synthesized.
 */
import { biquad, env, type Mono, Synth } from './dsp';

/* ── Sound library (each returns a mono buffer) ──────────────────────── */

export type Recipe = (s: Synth, seed: number) => Mono;
export const LEGACY_R: Record<string, [number, Recipe]> = {
  // Trunk protector (hogu): padded low thump, vinyl slap, short fabric tail.
  body: [
    0.32,
    (s, sd) =>
      s.mix(
        [env(s.sine(98 - sd * 4, 46), s.sr, 0.002, 0.075), 1],
        [env(biquad(s.noise(sd), s.sr, 'bp', 650 + sd * 60, 1.2), s.sr, 0.001, 0.04), 2.2],
        [env(biquad(s.noise(sd + 9), s.sr, 'hp', 2600, 0.7), s.sr, 0.0005, 0.011), 1.1],
        [env(biquad(s.noise(sd + 17), s.sr, 'bp', 3400, 0.8), s.sr, 0.004, 0.06, 0.01), 0.35],
      ),
  ],
  // Headgear foam: higher, drier and shorter.
  head: [
    0.24,
    (s, sd) =>
      s.mix(
        [env(s.sine(150 - sd * 5, 82), s.sr, 0.0015, 0.05), 0.75],
        [env(biquad(s.noise(sd + 3), s.sr, 'bp', 1300 + sd * 80, 1.4), s.sr, 0.001, 0.03), 2.4],
        [env(biquad(s.noise(sd + 11), s.sr, 'hp', 3600, 0.7), s.sr, 0.0004, 0.009), 1.3],
      ),
  ],
  // Extra weight for turning kicks, counters and knockdown blows.
  heavy: [
    0.45,
    (s, sd) => s.mix([env(s.sine(62, 36), s.sr, 0.003, 0.16), 1], [env(biquad(s.noise(sd + 5), s.sr, 'lp', 260, 0.7), s.sr, 0.002, 0.12), 1.2]),
  ],
  // Glove into the hogu.
  punch: [
    0.2,
    (s, sd) =>
      s.mix(
        [env(s.sine(135 - sd * 4, 72), s.sr, 0.0015, 0.045), 0.7],
        [env(biquad(s.noise(sd + 21), s.sr, 'bp', 950, 1.3), s.sr, 0.001, 0.028), 2],
        [env(biquad(s.noise(sd + 23), s.sr, 'hp', 3000, 0.7), s.sr, 0.0004, 0.008), 0.9],
      ),
  ],
  // Kick into the guard: dull knock on forearms, no hogu pop.
  block: [
    0.22,
    (s, sd) =>
      s.mix(
        [env(biquad(s.noise(sd + 31), s.sr, 'bp', 430 + sd * 30, 2), s.sr, 0.001, 0.045), 2.4],
        [env(s.sine(210, 150), s.sr, 0.001, 0.035), 0.5],
        [env(biquad(s.noise(sd + 33), s.sr, 'hp', 2000, 0.7), s.sr, 0.0005, 0.007), 0.5],
      ),
  ],
  // Kick whoosh: air rising to the extension (peak at ~70%), quick release.
  whoosh: [
    0.34,
    (s, sd) => {
      const b = biquad(s.noise(sd + 41), s.sr, 'bp', 320, 0.9, 1500);
      const n = b.length;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        b[i] *= u < 0.7 ? Math.pow(u / 0.7, 2.2) : Math.exp(-(u - 0.7) * 22);
      }
      return b;
    },
  ],
  // Fast whoosh (lead leg, punch): shorter and brighter.
  whooshFast: [
    0.2,
    (s, sd) => {
      const b = biquad(s.noise(sd + 43), s.sr, 'bp', 650, 1, 2400);
      const n = b.length;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        b[i] *= u < 0.7 ? Math.pow(u / 0.7, 2) : Math.exp(-(u - 0.7) * 26);
      }
      return b;
    },
  ],
  // Spinning back kick / side kick: longer, lower, heavier air.
  whooshHeavy: [
    0.44,
    (s, sd) => {
      const b = biquad(s.noise(sd + 45), s.sr, 'bp', 240, 0.8, 1100);
      const low = biquad(s.noise(sd + 46), s.sr, 'lp', 220, 0.7);
      const n = b.length;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        const e = u < 0.7 ? Math.pow(u / 0.7, 2.4) : Math.exp(-(u - 0.7) * 18);
        b[i] = (b[i] + low[i] * 0.6) * e;
      }
      return b;
    },
  ],
  // Dobok snap at full extension: a crisp crack and a flutter.
  snap: [
    0.12,
    (s, sd) => s.mix([env(biquad(s.noise(sd + 51), s.sr, 'hp', 1800, 0.8), s.sr, 0.0003, 0.012), 1], [env(biquad(s.noise(sd + 52), s.sr, 'bp', 2600, 1), s.sr, 0.002, 0.03, 0.009), 0.45]),
  ],
  // Missed technique: the follow-through keeps travelling, nothing lands.
  whiff: [
    0.3,
    (s, sd) => env(biquad(s.noise(sd + 55), s.sr, 'bp', 700, 0.9, 260), s.sr, 0.01, 0.1),
  ],
  // Bare foot on the competition mat.
  step: [
    0.12,
    (s, sd) => s.mix([env(biquad(s.noise(sd + 61), s.sr, 'lp', 190 + sd * 15, 0.9), s.sr, 0.002, 0.03), 2], [env(s.sine(88, 70), s.sr, 0.002, 0.025), 0.35]),
  ],
  // Pivot on the ball of the foot: soft skin-on-vinyl scuff.
  scuff: [
    0.18,
    (s, sd) => env(biquad(s.noise(sd + 63), s.sr, 'bp', 1500 + sd * 120, 0.7), s.sr, 0.02, 0.05),
  ],
  // Landing after a kick: weight comes down.
  land: [
    0.2,
    (s, sd) => s.mix([env(biquad(s.noise(sd + 65), s.sr, 'lp', 160, 0.9), s.sr, 0.002, 0.05), 2.2], [env(s.sine(74, 50), s.sr, 0.002, 0.05), 0.6]),
  ],
  // Dash: a slide on the mat.
  slide: [
    0.24,
    (s, sd) => env(biquad(s.noise(sd + 67), s.sr, 'bp', 900, 0.8, 480), s.sr, 0.02, 0.08),
  ],
  // Sharp exhale ("tss") on committed techniques: breath, not speech.
  exhale: [
    0.24,
    (s, sd) => {
      const a = biquad(biquad(s.noise(sd + 71), s.sr, 'hp', 1600, 0.7), s.sr, 'bp', 3200 + sd * 200, 0.9);
      const b = biquad(s.noise(sd + 72), s.sr, 'bp', 1150, 1.6);
      return env(s.mix([a, 1], [b, 0.35]), s.sr, 0.012, 0.07);
    },
  ],
  // Arcade bell: inharmonic partials of a small struck bell.
  bell: [
    1.6,
    (s) => s.mix([env(s.sine(880, 878), s.sr, 0.002, 0.55), 1], [env(s.sine(2429, 2425), s.sr, 0.001, 0.3), 0.45], [env(s.sine(4752, 4750), s.sr, 0.001, 0.12), 0.2]),
  ],
  // Competitive timer: clean electronic tone.
  horn: [
    0.5,
    (s) => {
      const t = s.mix([s.sine(784, 784), 1], [s.sine(1568, 1568), 0.25]);
      return env(biquad(t, s.sr, 'lp', 2400, 0.7), s.sr, 0.005, 0.25);
    },
  ],
  // Point registered (electronic scoring): short bright blip.
  blip: [0.12, (s) => env(s.mix([s.sine(1568, 1568), 1], [s.sine(3136, 3136), 0.2]), s.sr, 0.002, 0.035)],
  // Gam-jeom: low muted buzz.
  buzz: [
    0.3,
    (s) => {
      const b = s.out();
      for (let i = 0; i < b.length; i++) b[i] = Math.sign(Math.sin((2 * Math.PI * 196 * i) / s.sr)) * 0.6;
      return env(biquad(b, s.sr, 'lp', 900, 0.7), s.sr, 0.004, 0.09);
    },
  ],
  // Deciding round: two low drum strokes.
  drum: [
    0.5,
    (s, sd) => s.mix([env(s.sine(70, 48), s.sr, 0.003, 0.12), 1], [env(biquad(s.noise(sd + 81), s.sr, 'lp', 300, 0.8), s.sr, 0.002, 0.06), 0.9]),
  ],
  // Knockout: deep boom under the fall.
  boom: [
    0.9,
    (s, sd) => s.mix([env(s.sine(55, 30), s.sr, 0.004, 0.32), 1], [env(biquad(s.noise(sd + 83), s.sr, 'lp', 200, 0.7), s.sr, 0.003, 0.2), 0.7]),
  ],
  // Body to the mat.
  fall: [
    0.6,
    (s, sd) => s.mix([env(s.sine(82, 42), s.sr, 0.003, 0.14), 1], [env(biquad(s.noise(sd + 85), s.sr, 'lp', 280, 0.7), s.sr, 0.003, 0.12), 1.1], [env(biquad(s.noise(sd + 86), s.sr, 'bp', 2400, 0.8), s.sr, 0.01, 0.12, 0.02), 0.25]),
  ],
  // Victory: warm major chord swell. Defeat: soft falling minor third.
  victory: [
    2.2,
    (s) => env(s.mix([s.sine(261.6, 261.6), 0.5], [s.sine(329.6, 329.6), 0.35], [s.sine(392, 392), 0.35], [s.sine(523.3, 523.3), 0.25]), s.sr, 0.18, 0.7),
  ],
  defeat: [
    1.6,
    (s) => s.mix([env(s.sine(329.6, 329.6), s.sr, 0.05, 0.3), 0.5], [env(s.sine(261.6, 261.6), s.sr, 0.05, 0.5, 0.32), 0.5], [env(s.sine(196, 196), s.sr, 0.08, 0.55, 0.32), 0.3]),
  ],
  // Training: soft wood-block tock (hits), a muted low tick (misses).
  tock: [0.12, (s) => s.mix([env(s.sine(920, 880), s.sr, 0.0008, 0.035), 1], [env(s.sine(2350, 2300), s.sr, 0.0005, 0.012), 0.3])],
  tick: [0.1, (s) => env(s.sine(240, 200), s.sr, 0.002, 0.03)],
  chime: [0.9, (s) => s.mix([env(s.sine(1318.5, 1318.5), s.sr, 0.003, 0.3), 1], [env(s.sine(1975.5, 1975.5), s.sr, 0.003, 0.22), 0.5])],
  // Belt promotion: low gong.
  gong: [
    2.8,
    (s) => s.mix([env(s.sine(110, 108), s.sr, 0.004, 1.1), 1], [env(s.sine(293, 290), s.sr, 0.004, 0.7), 0.4], [env(s.sine(523, 518), s.sr, 0.004, 0.4), 0.18], [env(s.sine(741, 735), s.sr, 0.004, 0.25), 0.1]),
  ],
  // Menu: quiet navigation tick, select, confirm, back, start swell.
  nav: [0.05, (s, sd) => s.mix([env(s.sine(1900, 1900), s.sr, 0.0005, 0.008), 1], [env(biquad(s.noise(sd + 91), s.sr, 'hp', 4000, 0.7), s.sr, 0.0003, 0.003), 0.3])],
  select: [0.08, (s) => env(s.sine(1250, 1180), s.sr, 0.001, 0.018)],
  confirm: [0.22, (s) => s.mix([env(s.sine(1046.5, 1046.5), s.sr, 0.002, 0.04), 1], [env(s.sine(1568, 1568), s.sr, 0.002, 0.07, 0.055), 0.8])],
  back: [0.2, (s) => s.mix([env(s.sine(1175, 1175), s.sr, 0.002, 0.035), 0.9], [env(s.sine(880, 880), s.sr, 0.002, 0.06, 0.05), 0.8])],
  swell: [
    0.6,
    (s, sd) => {
      const b = biquad(s.noise(sd + 95), s.sr, 'lp', 300, 0.7, 1600);
      for (let i = 0; i < b.length; i++) {
        const u = i / b.length;
        b[i] *= Math.sin(Math.PI * Math.pow(u, 0.8)) * (1 - u);
      }
      return b;
    },
  ],
  stamina: [0.4, (s) => s.mix([env(s.sine(140, 140), s.sr, 0.004, 0.05), 1], [env(s.sine(140, 140), s.sr, 0.004, 0.05, 0.16), 1])],
};

/** Variants per sound (different seeds) so repeats never sound identical. */
export const LEGACY_VARIANTS: Record<string, number> = { body: 3, head: 3, punch: 2, block: 3, whoosh: 3, whooshFast: 2, whooshHeavy: 2, snap: 3, whiff: 2, step: 4, scuff: 2, land: 2, slide: 2, exhale: 3, drum: 1, fall: 2 };

/** Relative loudness (the mix). */
export const LEGACY_GAIN: Record<string, number> = {
  body: 0.95, head: 0.9, heavy: 0.75, punch: 0.75, block: 0.7,
  whoosh: 0.42, whooshFast: 0.34, whooshHeavy: 0.48, snap: 0.3, whiff: 0.22,
  step: 0.15, scuff: 0.07, land: 0.32, slide: 0.16, exhale: 0.1,
  bell: 0.42, horn: 0.3, blip: 0.18, buzz: 0.26, drum: 0.42, boom: 0.6, fall: 0.6, victory: 0.24, defeat: 0.22,
  tock: 0.22, tick: 0.11, chime: 0.16, gong: 0.3,
  nav: 0.05, select: 0.07, confirm: 0.1, back: 0.09, swell: 0.12, stamina: 0.14,
};


