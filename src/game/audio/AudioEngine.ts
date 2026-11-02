/**
 * Small synthesized sound set (Web Audio, no asset downloads): kick whoosh,
 * body/head impacts, block, bell, scoring, footsteps, menu and training
 * cues, and an optional room tone. Everything is generated procedurally, so
 * there is nothing to license and nothing to load.
 *
 * Routing: sounds -> sfx bus | ambient bus -> master -> destination.
 * Browsers block audio until a user gesture: `unlock()` is called from
 * gestures and is safe to call repeatedly; every method is a no-op until
 * then, and failures never throw into the game.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private roomTone: AudioBufferSourceNode | null = null;
  private failed = false;
  volume = 0.8;
  sfxVolume = 1;
  ambientVolume = 0.5;
  muted = false;
  /** Ambient room tone requested (plays while unlocked and audible). */
  private ambientWanted = false;

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
        this.sfx.connect(this.master);
        this.amb.connect(this.master);
        this.master.connect(this.ctx.destination);
        this.applyGains();
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        if (this.ambientWanted) this.startRoomTone();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      // Audio is optional: never let it break the game.
      this.failed = true;
      this.ctx = null;
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
  }

  /** Quiet dojang room tone (filtered noise loop). */
  setAmbient(on: boolean) {
    this.ambientWanted = on;
    if (on) this.startRoomTone();
    else this.stopRoomTone();
  }

  private startRoomTone() {
    if (!this.ctx || !this.noise || this.roomTone) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.amb!);
    src.start();
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
    src.connect(filt).connect(g).connect(this.sfx!);
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
    o.connect(g).connect(this.sfx!);
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

  /** Soft foot contact on the mat. */
  footstep(weight = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 0.05, 320 + Math.random() * 120, 0.8, 0.05 * weight, 'lowpass');
  }

  /** Short UI tick for menu buttons. */
  click() {
    if (!this.ctx) return;
    this.tone(this.ctx.currentTime, 1250, 0.04, 0.05, 'triangle');
  }

  /** Training feedback: rising for success, low for a miss. */
  feedback(success: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (success) {
      this.tone(t, 990, 0.1, 0.08, 'sine');
      this.tone(t + 0.07, 1480, 0.14, 0.07, 'sine');
    } else this.tone(t, 260, 0.12, 0.06, 'triangle', 200);
  }

  /** Fanfare for a completed challenge or a belt promotion. */
  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.11, f, 0.5, 0.09, 'triangle'));
  }

  /** Low-stamina warning: two soft low pulses. */
  staminaWarning() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 140, 0.12, 0.08, 'sine');
    this.tone(t + 0.16, 140, 0.12, 0.08, 'sine');
  }

  /** Body hitting the mat. */
  thud() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 90, 0.35, 0.5, 'sine', 40);
    this.noiseBurst(t, 0.2, 260, 0.7, 0.3, 'lowpass');
  }

  dispose() {
    this.stopRoomTone();
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
