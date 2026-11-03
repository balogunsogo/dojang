/** Tiny offline DSP used to render the synthesized layers once into buffers. */

export type Mono = Float32Array;

/* ── Tiny offline DSP ──────────────────────────────────────────────────── */

export function rng(seed: number) {
  let x = (seed * 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296) * 2 - 1;
  };
}

/** RBJ biquad (in place). Frequency may glide from f0 to f1 over the buffer. */
export function biquad(buf: Mono, sr: number, type: 'lp' | 'hp' | 'bp', f0: number, q: number, f1 = f0) {
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
export function env(buf: Mono, sr: number, attack: number, decay: number, delay = 0) {
  const a = attack * sr;
  const d0 = delay * sr;
  for (let i = 0; i < buf.length; i++) {
    const t = i - d0;
    buf[i] *= t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / (decay * sr));
  }
  return buf;
}

export class Synth {
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
export function finish(b: Mono, sr: number, peak = 0.9, drive = 1.2) {
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

