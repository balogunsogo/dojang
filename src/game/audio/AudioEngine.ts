/**
 * DOJANG audio: original sound design rendered in code (Web Audio).
 *
 * Every sound is synthesized ONCE into a small AudioBuffer "sample" (seeded
 * noise, real biquad filters, envelopes and layering: e.g. a trunk-protector
 * impact = low padded thump + vinyl slap + short fabric transient) and then
 * played as a single buffer node with slight pitch/volume variation. There
 * are no downloads and nothing to license; samples render lazily after the
 * first gesture and are reused for the session.
 *
 * Routing: voices -> sfx bus | ambient bus -> master -> limiter -> out.
 * Mix hierarchy (loud to quiet): impacts > match cues > whooshes > fabric >
 * footsteps > menu > ambience. Per-sound cooldowns and a voice cap keep
 * repetition and density in check. Browsers block audio until a gesture:
 * `unlock()` is safe to call repeatedly and nothing throws into the game.
 */

type Mono = Float32Array;

/* ── Tiny offline DSP ──────────────────────────────────────────────────── */

function rng(seed: number) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296) * 2 - 1;
  };
}

/** RBJ biquad (in place). Frequency may glide from f0 to f1 over the buffer. */
function biquad(buf: Mono, sr: number, type: 'lp' | 'hp' | 'bp', f0: number, q: number, f1 = f0) {
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  const n = buf.length;
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    a1 = 0,
    a2 = 0;
  for (let i = 0; i < n; i++) {
    if (i % 32 === 0) {
      const f = f0 * Math.pow(f1 / f0, i / n);
      const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
      const cs = Math.cos(w);
      const al = Math.sin(w) / (2 * q);
      const a0 = 1 + al;
      if (type === 'lp') {
        b0 = (1 - cs) / 2 / a0;
        b1 = (1 - cs) / a0;
        b2 = b0;
      } else if (type === 'hp') {
        b0 = (1 + cs) / 2 / a0;
        b1 = -(1 + cs) / a0;
        b2 = b0;
      } else {
        b0 = al / a0;
        b1 = 0;
        b2 = -al / a0;
      }
      a1 = (-2 * cs) / a0;
      a2 = (1 - al) / a0;
    }
    const x = buf[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    buf[i] = y;
  }
  return buf;
}

/** Attack/decay envelope (exponential decay), applied in place. */
function env(buf: Mono, sr: number, attack: number, decay: number, delay = 0) {
  const a = attack * sr;
  const d0 = delay * sr;
  for (let i = 0; i < buf.length; i++) {
    const t = i - d0;
    buf[i] *= t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / (decay * sr));
  }
  return buf;
}

class Synth {
  constructor(
    readonly sr: number,
    readonly len: number,
  ) {}
  out = (): Mono => new Float32Array(this.len);
  noise(seed: number): Mono {
    const r = rng(seed);
    const b = this.out();
    for (let i = 0; i < b.length; i++) b[i] = r();
    return b;
  }
  /** Sine with an exponential pitch glide. */
  sine(f0: number, f1: number, dur = this.len / this.sr): Mono {
    const b = this.out();
    let ph = 0;
    const n = Math.min(b.length, Math.floor(dur * this.sr));
    for (let i = 0; i < n; i++) {
      const f = f0 * Math.pow(f1 / f0, i / n);
      ph += (2 * Math.PI * f) / this.sr;
      b[i] = Math.sin(ph);
    }
    return b;
  }
  mix(...layers: [Mono, number][]): Mono {
    const b = this.out();
    for (const [l, g] of layers) for (let i = 0; i < b.length; i++) b[i] += l[i] * g;
    return b;
  }
}

/** Soft saturation + normalise to a peak, then a 3 ms fade-out guard. */
function finish(b: Mono, sr: number, peak = 0.9, drive = 1.2) {
  let m = 0;
  for (let i = 0; i < b.length; i++) {
    b[i] = Math.tanh(b[i] * drive);
    m = Math.max(m, Math.abs(b[i]));
  }
  const k = m > 0 ? peak / m : 1;
  const fade = Math.floor(0.003 * sr);
  for (let i = 0; i < b.length; i++) b[i] *= k * Math.min(1, (b.length - i) / fade);
  return b;
}

/* ── Sound library (each returns a mono buffer) ──────────────────────── */

type Recipe = (s: Synth, seed: number) => Mono;
const R: Record<string, [number, Recipe]> = {
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

/** Every sound in the library (sound lab, docs). */
export const SOUND_NAMES = (): string[] => Object.keys(R);

/** Variants per sound (different seeds) so repeats never sound identical. */
const VARIANTS: Record<string, number> = { body: 3, head: 3, punch: 2, block: 3, whoosh: 3, whooshFast: 2, whooshHeavy: 2, snap: 3, whiff: 2, step: 4, scuff: 2, land: 2, slide: 2, exhale: 3, drum: 1, fall: 2 };

/** Relative loudness (the mix). */
const GAIN: Record<string, number> = {
  body: 0.95, head: 0.9, heavy: 0.75, punch: 0.75, block: 0.7,
  whoosh: 0.42, whooshFast: 0.34, whooshHeavy: 0.48, snap: 0.3, whiff: 0.22,
  step: 0.15, scuff: 0.07, land: 0.32, slide: 0.16, exhale: 0.1,
  bell: 0.42, horn: 0.3, blip: 0.18, buzz: 0.26, drum: 0.42, boom: 0.6, fall: 0.6, victory: 0.24, defeat: 0.22,
  tock: 0.22, tick: 0.11, chime: 0.16, gong: 0.3,
  nav: 0.05, select: 0.07, confirm: 0.1, back: 0.09, swell: 0.12, stamina: 0.14,
};

/** Minimum spacing between plays of the same sound (seconds). */
const COOLDOWN: Record<string, number> = { step: 0.07, scuff: 0.16, land: 0.12, slide: 0.2, exhale: 0.9, nav: 0.04, select: 0.05, tick: 0.12, tock: 0.05, snap: 0.05 };

const MAX_VOICES = 24;
/** Samples are rendered at 32 kHz (resampled on playback): ~1/3 less memory, no audible loss. */
const SR = 32000;

export type ImpactKind = 'body' | 'head' | 'punch';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private roomTone: AudioBufferSourceNode | null = null;
  private failed = false;
  private bank = new Map<string, AudioBuffer[]>();
  private last = new Map<string, number>();
  private voices = 0;
  volume = 0.8;
  sfxVolume = 1;
  ambientVolume = 0.5;
  muted = false;
  /** Ambient room tone requested (plays while unlocked and audible). */
  private ambientWanted = false;
  /** Debug: names of the sounds played (most recent last), when enabled. */
  readonly log: string[] = [];
  logging = false;

  constructor() {
    if (typeof window !== 'undefined') (window as unknown as { __audio?: AudioEngine }).__audio = this;
  }

  get state(): AudioContextState | 'locked' {
    return this.ctx?.state ?? 'locked';
  }

  /** Must be called from a user gesture (iOS Safari requirement). */
  unlock() {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          this.failed = true;
          return;
        }
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.sfx = this.ctx.createGain();
        this.amb = this.ctx.createGain();
        // Gentle limiter: keeps stacked impacts from clipping.
        const lim = this.ctx.createDynamicsCompressor();
        lim.threshold.value = -10;
        lim.knee.value = 6;
        lim.ratio.value = 8;
        lim.attack.value = 0.002;
        lim.release.value = 0.12;
        this.sfx.connect(this.master);
        this.amb.connect(this.master);
        this.master.connect(lim).connect(this.ctx.destination);
        this.applyGains();
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        const r = rng(7);
        for (let i = 0; i < len; i++) d[i] = r();
        if (this.ambientWanted) this.startRoomTone();
        this.prewarm();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      // Audio is optional: never let it break the game.
      this.failed = true;
      this.ctx = null;
    }
  }

  /** Render the combat samples in small idle chunks so the first hit never stutters. */
  private prewarm() {
    const order = ['body', 'head', 'punch', 'block', 'whoosh', 'whooshFast', 'whooshHeavy', 'snap', 'step', 'land', 'heavy', 'whiff', 'scuff', 'exhale', 'select', 'confirm', 'back', 'nav'];
    const next = () => {
      const name = order.shift();
      if (!name || !this.ctx) return;
      this.buffers(name);
      setTimeout(next, 16);
    };
    setTimeout(next, 50);
  }

  private buffers(name: string): AudioBuffer[] {
    let list = this.bank.get(name);
    if (list) return list;
    const ctx = this.ctx!;
    const [dur, recipe] = R[name];
    list = [];
    for (let v = 0; v < (VARIANTS[name] ?? 1); v++) {
      const s = new Synth(SR, Math.ceil(dur * SR));
      const data = finish(recipe(s, v + 1), SR, 0.9, name === 'body' || name === 'heavy' || name === 'boom' || name === 'fall' ? 1.5 : 1.1);
      const buf = ctx.createBuffer(1, data.length, SR);
      buf.getChannelData(0).set(data);
      list.push(buf);
    }
    this.bank.set(name, list);
    return list;
  }

  /**
   * Play a sample. `delay` schedules it ahead (s); `gain` scales the mix
   * level; small random pitch/volume variation unless `exact`.
   */
  play(name: string, o: { delay?: number; gain?: number; rate?: number; exact?: boolean; key?: string } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !R[name]) return;
    const now = ctx.currentTime;
    const t = now + Math.max(0, o.delay ?? 0);
    const cdKey = o.key ?? name;
    const cd = COOLDOWN[name];
    if (cd && t - (this.last.get(cdKey) ?? -9) < cd) return;
    if (this.voices >= MAX_VOICES && (GAIN[name] ?? 0.5) < 0.3) return;
    this.last.set(cdKey, t);
    const list = this.buffers(name);
    const src = ctx.createBufferSource();
    src.buffer = list[(Math.random() * list.length) | 0];
    src.playbackRate.value = (o.rate ?? 1) * (o.exact ? 1 : 1 + (Math.random() * 2 - 1) * 0.045);
    const g = ctx.createGain();
    g.gain.value = (GAIN[name] ?? 0.5) * (o.gain ?? 1) * (o.exact ? 1 : 1 + (Math.random() * 2 - 1) * 0.1);
    src.connect(g).connect(this.sfx);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      g.disconnect();
    };
    src.start(t);
    if (this.logging) {
      this.log.push(name);
      if (this.log.length > 200) this.log.shift();
    }
  }

  /** Pause all audio (page hidden). */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  /** Resume after `suspend()` (only works once unlocked by a gesture). */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  setVolume(v: number) {
    this.volume = v;
    this.applyGains();
  }

  setMix(o: { master: number; sfx: number; ambient: number; muted: boolean }) {
    this.volume = o.master;
    this.sfxVolume = o.sfx;
    this.ambientVolume = o.ambient;
    this.muted = o.muted;
    this.applyGains();
  }

  private applyGains() {
    if (!this.master || !this.sfx || !this.amb) return;
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.sfx.gain.value = this.sfxVolume;
    this.amb.gain.value = this.ambientVolume * 0.6;
    // Silent ambience should not keep a noise loop running.
    const audibleAmb = !this.muted && this.volume > 0 && this.ambientVolume > 0;
    if (!audibleAmb) this.stopRoomTone();
    else if (this.ambientWanted) this.startRoomTone();
  }

  /** Quiet dojang room tone: low air with a faint, slow movement. */
  setAmbient(on: boolean) {
    this.ambientWanted = on;
    if (on) this.startRoomTone();
    else this.stopRoomTone();
  }

  private startRoomTone() {
    if (!this.ctx || !this.noise || this.roomTone || !this.amb) return;
    if (this.muted || this.ambientVolume <= 0 || this.volume <= 0) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.045;
    // Very slow breathing of the room (air handling), not a pulse.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.012;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(lp).connect(g).connect(this.amb);
    src.start();
    lfo.start();
    src.onended = () => {
      try {
        lfo.stop();
      } catch {
        /* already stopped */
      }
    };
    this.roomTone = src;
  }

  private stopRoomTone() {
    try {
      this.roomTone?.stop();
    } catch {
      /* already stopped */
    }
    this.roomTone = null;
  }

  /* ── Combat ───────────────────────────────────────────────────────── */

  /**
   * A technique starts. The whoosh is scheduled to peak at the extension
   * (`strikeIn` seconds from now), with a dobok snap at full extension and,
   * sometimes, a sharp exhale on committed techniques.
   */
  technique(o: { kind: 'kick' | 'leadKick' | 'turning' | 'punch'; strikeIn: number; who: 0 | 1 }) {
    const name = o.kind === 'turning' ? 'whooshHeavy' : o.kind === 'kick' ? 'whoosh' : 'whooshFast';
    const len = R[name][0];
    const vol = o.who === 0 ? 1 : 0.8;
    this.play(name, { delay: o.strikeIn - len * 0.7, gain: vol });
    if (o.kind !== 'punch') this.play('snap', { delay: o.strikeIn - 0.005, gain: vol * (o.kind === 'leadKick' ? 0.7 : 1), key: `snap${o.who}` });
    if ((o.kind === 'turning' || o.kind === 'kick') && Math.random() < 0.45) this.play('exhale', { delay: o.strikeIn - 0.06, gain: vol, key: `ex${o.who}` });
  }

  /** A clean contact on the protector. */
  impact(kind: ImpactKind, heavy: boolean) {
    this.play(kind);
    if (heavy) this.play('heavy', { gain: kind === 'punch' ? 0.6 : 1 });
  }

  /** A technique met the guard. */
  blocked(punch: boolean, guardBreak: boolean) {
    this.play('block', { gain: punch ? 0.7 : 1, rate: punch ? 1.2 : 1 });
    if (guardBreak) this.play('heavy', { gain: 0.6 });
  }

  /** A technique found nothing: the follow-through keeps going. */
  whiff() {
    this.play('whiff');
  }

  /* ── Movement ─────────────────────────────────────────────────────── */

  footstep(who: 0 | 1, pivot = false) {
    const gain = who === 0 ? 1 : 0.75;
    if (pivot) this.play('scuff', { gain, key: `sc${who}` });
    else this.play('step', { gain, key: `st${who}` });
  }

  land(who: 0 | 1) {
    this.play('land', { gain: who === 0 ? 1 : 0.75, key: `ld${who}` });
  }

  dash(who: 0 | 1) {
    this.play('slide', { gain: who === 0 ? 1 : 0.75, key: `sl${who}` });
  }

  /* ── Match flow and scoring ───────────────────────────────────────── */

  roundStart(competitive: boolean, deciding: boolean) {
    if (competitive) this.play('horn', { exact: true });
    else this.play('bell', { exact: true });
    if (deciding) {
      this.play('drum', { delay: 0.35 });
      this.play('drum', { delay: 0.62, gain: 0.8 });
    }
  }

  roundEnd(competitive: boolean) {
    if (competitive) this.play('horn', { exact: true, rate: 0.75, gain: 1.2 });
    else for (let i = 0; i < 3; i++) this.play('bell', { exact: true, delay: i * 0.28 });
  }

  /** Point registered; turning techniques get a second, higher blip. */
  score(points: number) {
    this.play('blip', { exact: true, delay: 0.04 });
    if (points >= 4) this.play('blip', { exact: true, delay: 0.13, rate: 1.26 });
  }

  penalty() {
    this.play('buzz', { exact: true });
    this.play('buzz', { exact: true, delay: 0.2 });
  }

  knockout() {
    this.play('boom');
  }

  /** Body hitting the mat. */
  thud() {
    this.play('fall');
  }

  matchEnd(won: boolean) {
    this.play(won ? 'victory' : 'defeat', { exact: true, delay: 0.9 });
  }

  staminaWarning() {
    this.play('stamina', { exact: true });
  }

  /* ── Training ─────────────────────────────────────────────────────── */

  /** Valid hit on the target (combo steps rise in pitch). */
  trainHit(step = 0) {
    this.play('tock', { rate: 1 + step * 0.12, exact: step > 0 });
  }
  trainMiss() {
    this.play('tick');
  }
  comboDone() {
    [0, 1, 2].forEach((i) => this.play('tock', { delay: i * 0.085, rate: 1 + i * 0.25, exact: true, key: `combo${i}` }));
  }
  milestone() {
    this.play('chime', { exact: true });
  }
  /** Challenge or drill complete. */
  fanfare() {
    this.play('chime', { exact: true });
    this.play('chime', { exact: true, delay: 0.16, rate: 1.335 });
  }
  promotion() {
    this.play('gong', { exact: true });
    this.play('victory', { exact: true, delay: 0.25, gain: 0.8 });
  }

  /* ── Menu ─────────────────────────────────────────────────────────── */

  /** Moving the current menu item (keys/gamepad). */
  nav() {
    this.play('nav', { exact: true });
  }
  /** Choosing an option, toggle or tab. */
  click() {
    this.play('select', { exact: true });
  }
  confirm() {
    this.play('confirm', { exact: true });
  }
  back() {
    this.play('back', { exact: true });
  }
  /** Leaving the menu for a match or activity. */
  start() {
    this.play('swell', { exact: true });
    this.play('confirm', { exact: true, delay: 0.05 });
  }

  dispose() {
    this.stopRoomTone();
    void this.ctx?.close();
    this.ctx = null;
    this.bank.clear();
  }
}

export const audio = new AudioEngine();
