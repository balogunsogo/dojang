/**
 * Small synthesized sound set (Web Audio, no asset downloads):
 * kick whoosh, body/head impacts, block, round bell. Everything is generated
 * procedurally so there is nothing to license and nothing to load.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.8;

  /** Must be called from a user gesture (iOS Safari requirement). */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private noiseBurst(t: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', sweepTo?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', endFreq?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  whoosh(strength = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.18 + 0.06 * strength, 500, 0.9, 0.18 * strength, 'bandpass', 2200);
  }

  hit(zone: 'body' | 'head', heavy: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Trunk protector "pop" vs sharper headgear crack.
    if (zone === 'body') {
      this.tone(t, heavy ? 120 : 150, 0.18, 0.7, 'sine', 50);
      this.noiseBurst(t, 0.09, 1400, 1.2, 0.5, 'bandpass');
    } else {
      this.tone(t, 220, 0.12, 0.5, 'triangle', 90);
      this.noiseBurst(t, 0.07, 2600, 1.5, 0.6, 'bandpass');
    }
  }

  block() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.06, 900, 3, 0.35, 'bandpass');
    this.tone(t, 320, 0.06, 0.15, 'square', 200);
  }

  /** Scoreboard chime: higher and longer for higher-value techniques. */
  score(points: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 660 + Math.min(points, 6) * 70;
    this.tone(t + 0.02, base, 0.18, 0.14, 'triangle');
    this.tone(t + 0.1, base * 1.5, 0.22 + points * 0.03, 0.12, 'triangle');
  }

  /** Penalty buzzer. */
  penalty() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 180, 0.35, 0.14, 'square', 150);
  }

  bell(times = 1) {
    if (!this.ctx) return;
    for (let i = 0; i < times; i++) {
      const t = this.ctx.currentTime + i * 0.28;
      for (const [f, g] of [
        [880, 0.22],
        [1320, 0.12],
        [2210, 0.06],
      ] as const)
        this.tone(t, f, 1.2, g);
    }
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
