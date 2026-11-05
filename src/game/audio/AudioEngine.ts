/**
 * DOJANG audio (Phase 9.1): a hybrid of curated recordings and synthesis.
 *
 * Recorded layers (CC0, Kenney "Impact Sounds" and "RPG Audio", see
 * docs/ASSET_MANIFEST.md) give the physical texture: padded protector and
 * headgear contact, glove contact, guard contact, bare-foot mat footfalls and
 * dobok cloth. They are decoded once, cleaned (sub-bass high-passed so they
 * read on phone speakers, leading silence trimmed, peak-normalised) and
 * reused. Synthesis is kept where control matters: the air of a whoosh, a
 * short contact slap, the guard knock body, scoring/timer/menu/training cues,
 * and the breath exhale. If the recordings cannot load, every layer falls
 * back to its Phase 9 synthesized equivalent.
 *
 * Routing: voice -> gain -> stereo pan -> sfx bus (high-pass 40 Hz) ->
 * master -> limiter -> out, with an optional send to ONE shared short room
 * reflection (convolver). Ambience has its own bus. Voices are panned and
 * gently attenuated by the fighter's on-screen position (setPositions).
 *
 * The engine can also run on an OfflineAudioContext (lab comparisons and
 * exported examples). Browsers block live audio until a gesture: `unlock()`
 * is safe to call repeatedly and nothing ever throws into the game.
 */
import { biquad, env, finish, type Mono, rng, Synth } from './dsp';
import { LEGACY_R, type Recipe } from './legacy9';

const SR = 32000;
const BASE = `${import.meta.env?.BASE_URL ?? '/'}audio/`;

/** Recorded sample groups: file prefix -> takes, clean-up high-pass (Hz), synth fallback. */
const SAMPLES: Record<string, { n: number; hp: number; fallback: string }> = {
  hogu: { n: 5, hp: 85, fallback: 'body' },
  headgear: { n: 3, hp: 130, fallback: 'head' },
  glove: { n: 2, hp: 150, fallback: 'punch' },
  guard: { n: 3, hp: 90, fallback: 'block' },
  mat: { n: 3, hp: 60, fallback: 'step' },
  'cloth-swish': { n: 2, hp: 220, fallback: 'snap' },
  'cloth-settle': { n: 1, hp: 160, fallback: 'snap' },
  'cloth-flick': { n: 1, hp: 300, fallback: 'snap' },
};

/** Synthesized layers (new or kept from Phase 9). */
const SYN: Record<string, [number, Recipe]> = {
  ...LEGACY_R,
  // Short vinyl/foam contact transient laid over a recorded impact (definition, not boom).
  slap: [0.06, (s, sd) => env(biquad(biquad(s.noise(sd + 101), s.sr, 'hp', 1900, 0.7), s.sr, 'lp', 7000, 0.7), s.sr, 0.0004, 0.008)],
  // Dull forearm knock body under the recorded guard contact.
  knock: [0.16, (s, sd) => s.mix([env(biquad(s.noise(sd + 103), s.sr, 'bp', 360 + sd * 25, 1.5), s.sr, 0.001, 0.035), 2], [env(biquad(s.noise(sd + 104), s.sr, 'lp', 900, 0.7), s.sr, 0.001, 0.02), 0.8])],
  // Air of a kick: softer than Phase 9 (the cloth recording now carries the motion).
  air: [
    0.34,
    (s, sd) => {
      const b = biquad(biquad(s.noise(sd + 107), s.sr, 'bp', 300, 0.8, 1200), s.sr, 'lp', 3500, 0.7);
      const n = b.length;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        b[i] *= u < 0.72 ? Math.pow(u / 0.72, 2.6) : Math.exp(-(u - 0.72) * 20);
      }
      return b;
    },
  ],
};

/** Variants rendered for synthesized layers. */
const SYN_VARIANTS: Record<string, number> = { slap: 3, knock: 3, air: 3, whooshFast: 2, whooshHeavy: 2, whiff: 2, scuff: 2, slide: 2, exhale: 3, body: 3, head: 3, punch: 2, block: 3, step: 4, snap: 3 };

/** Mix levels (relative). Hierarchy: impacts > blocks > movement > feet/cloth > UI > room. */
const GAIN: Record<string, number> = {
  hogu: 0.92, headgear: 0.86, glove: 0.66, guard: 0.72, mat: 0.3,
  'cloth-swish': 0.3, 'cloth-settle': 0.13, 'cloth-flick': 0.2,
  slap: 0.22, knock: 0.32, air: 0.28, whooshFast: 0.22, whooshHeavy: 0.36, whiff: 0.16,
  scuff: 0.06, slide: 0.13, exhale: 0.1,
  bell: 0.4, horn: 0.28, blip: 0.17, buzz: 0.24, drum: 0.36, victory: 0.22, defeat: 0.2,
  tock: 0.2, tick: 0.1, chime: 0.15, gong: 0.28,
  nav: 0.05, select: 0.07, confirm: 0.1, back: 0.09, swell: 0.12, stamina: 0.14,
  // Synth fallbacks for recorded groups.
  body: 0.85, head: 0.8, punch: 0.65, block: 0.6, step: 0.15, snap: 0.25,
};

/** Room reflection send per sound (0 = dry). */
const SEND: Record<string, number> = {
  hogu: 0.16, headgear: 0.14, glove: 0.12, guard: 0.12, knock: 0.08, mat: 0.1, slap: 0.06,
  air: 0.07, whooshFast: 0.06, whooshHeavy: 0.08, whiff: 0.06, 'cloth-swish': 0.05, bell: 0.18, horn: 0.1, drum: 0.14,
};

/** Minimum spacing between plays of the same sound (seconds). */
const COOLDOWN: Record<string, number> = { mat: 0.07, scuff: 0.16, slide: 0.2, exhale: 0.9, nav: 0.04, select: 0.05, tick: 0.12, tock: 0.05, 'cloth-flick': 0.05, 'cloth-settle': 0.25 };

const MAX_VOICES = 24;

/** Every playable sound (sound lab, docs). */
export const SOUND_NAMES = (): string[] => [...Object.keys(SAMPLES), ...Object.keys(SYN)];

export type ImpactKind = 'body' | 'head' | 'punch';
type Who = 0 | 1;

export class AudioEngine {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private room: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private roomTone: AudioBufferSourceNode | null = null;
  private failed = false;
  private bank = new Map<string, AudioBuffer[]>();
  private lastVariant = new Map<string, number>();
  private last = new Map<string, number>();
  private voices = 0;
  private loading: Promise<void> | null = null;
  /** Per-fighter stereo pan (-1..1) and distance gain, updated by the game each frame. */
  readonly pos: { pan: number; gain: number }[] = [
    { pan: 0, gain: 1 },
    { pan: 0, gain: 1 },
  ];
  volume = 0.8;
  sfxVolume = 1;
  ambientVolume = 0.5;
  muted = false;
  private ambientWanted = false;
  /** Debug: names of the sounds played (most recent last), when enabled. */
  readonly log: string[] = [];
  logging = false;
  /** Offline rendering: added to every scheduled time (lab timelines). */
  offset = 0;

  /** Pass a context (e.g. OfflineAudioContext) to render without a gesture. */
  constructor(context?: BaseAudioContext) {
    if (context) this.build(context);
    else if (typeof window !== 'undefined') (window as unknown as { __audio?: AudioEngine }).__audio = this;
  }

  get state(): AudioContextState | 'locked' {
    return this.ctx?.state ?? 'locked';
  }

  /** Resolves when the recordings are decoded (or have fallen back). */
  ready(): Promise<void> {
    return this.loading ?? Promise.resolve();
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
        this.build(new Ctor());
        if (this.ambientWanted) this.startRoomTone();
      }
      const live = this.ctx as AudioContext;
      if (live.state === 'suspended') void live.resume().catch(() => undefined);
    } catch {
      // Audio is optional: never let it break the game.
      this.failed = true;
      this.ctx = null;
    }
  }

  private build(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    // Sub-bass phones cannot reproduce only eats headroom.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 40;
    hp.Q.value = 0.7;
    // Gentle limiter: keeps stacked impacts from clipping.
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -10;
    lim.knee.value = 6;
    lim.ratio.value = 8;
    lim.attack.value = 0.002;
    lim.release.value = 0.12;
    this.sfx.connect(hp).connect(this.master);
    this.amb.connect(this.master);
    this.master.connect(lim).connect(ctx.destination);
    // One shared short room reflection (wood floor, plaster, mats): early
    // taps plus a brief diffuse tail, low-passed. Subtle by design.
    this.room = ctx.createConvolver();
    this.room.buffer = this.roomIR(ctx);
    const roomOut = ctx.createGain();
    roomOut.gain.value = 1;
    this.room.connect(roomOut).connect(hp);
    this.applyGains();
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    const r = rng(7);
    for (let i = 0; i < len; i++) d[i] = r();
    this.loading = this.loadSamples();
    this.prewarm();
  }

  private roomIR(ctx: BaseAudioContext) {
    const len = Math.floor(0.32 * ctx.sampleRate);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      const r = rng(200 + ch);
      for (let i = 0; i < len; i++) d[i] = r() * Math.exp(-i / (0.07 * ctx.sampleRate)) * 0.35;
      // Early reflections (walls about 5-7 m away), slightly different per ear.
      for (const [ms, g] of [
        [7 + ch * 1.3, 0.55],
        [13 - ch * 1.1, 0.4],
        [21 + ch * 2, 0.28],
        [29 - ch, 0.18],
      ] as const)
        d[Math.floor((ms / 1000) * ctx.sampleRate)] += g * (ch ? -1 : 1);
      biquad(d, ctx.sampleRate, 'lp', 3200, 0.7);
    }
    return ir;
  }

  /** Fetch, decode and clean the recordings; fall back to synthesis on any failure. */
  private async loadSamples() {
    const ctx = this.ctx!;
    await Promise.all(
      Object.entries(SAMPLES).map(async ([name, s]) => {
        try {
          const list: AudioBuffer[] = [];
          for (let i = 1; i <= s.n; i++) {
            const res = await fetch(`${BASE}${name}-${i}.mp3`);
            if (!res.ok) throw new Error(String(res.status));
            const raw = await ctx.decodeAudioData(await res.arrayBuffer());
            list.push(this.clean(raw, s.hp));
          }
          this.bank.set(name, list);
        } catch {
          // Keep the game fully audible offline: synthesized equivalent.
          this.bank.set(name, this.renderSyn(s.fallback));
        }
      }),
    );
  }

  /** Mono, high-passed (twice: 24 dB/oct), leading silence trimmed, peak 0.9. */
  private clean(raw: AudioBuffer, hp: number) {
    const ctx = this.ctx!;
    const n = raw.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < raw.numberOfChannels; c++) {
      const d = raw.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i] / raw.numberOfChannels;
    }
    biquad(mono, raw.sampleRate, 'hp', hp, 0.7);
    biquad(mono, raw.sampleRate, 'hp', hp, 0.7);
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
    let start = 0;
    while (start < n && Math.abs(mono[start]) < peak * 0.03) start++;
    start = Math.max(0, start - Math.floor(0.001 * raw.sampleRate));
    const out = mono.subarray(start);
    const k = peak > 0 ? 0.9 / peak : 1;
    const fade = Math.floor(0.004 * raw.sampleRate);
    const buf = ctx.createBuffer(1, out.length, raw.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < out.length; i++) d[i] = out[i] * k * Math.min(1, (out.length - i) / fade);
    return buf;
  }

  private renderSyn(name: string): AudioBuffer[] {
    const ctx = this.ctx!;
    const [dur, recipe] = SYN[name];
    const list: AudioBuffer[] = [];
    for (let v = 0; v < (SYN_VARIANTS[name] ?? 1); v++) {
      const s = new Synth(SR, Math.ceil(dur * SR));
      const data: Mono = finish(recipe(s, v + 1), SR, 0.9, 1.1);
      const buf = ctx.createBuffer(1, data.length, SR);
      buf.getChannelData(0).set(data);
      list.push(buf);
    }
    return list;
  }

  /** Render the synthesized combat layers in small idle chunks after unlock. */
  private prewarm() {
    const order = ['air', 'slap', 'knock', 'whooshFast', 'whooshHeavy', 'whiff', 'scuff', 'exhale', 'slide', 'select', 'confirm', 'back', 'nav'];
    const next = () => {
      const name = order.shift();
      if (!name || !this.ctx) return;
      this.buffers(name);
      setTimeout(next, 16);
    };
    setTimeout(next, 50);
  }

  private buffers(name: string): AudioBuffer[] | null {
    const list = this.bank.get(name);
    if (list) return list;
    if (SAMPLES[name]) return null; // still loading
    if (!SYN[name]) return null;
    const made = this.renderSyn(name);
    this.bank.set(name, made);
    return made;
  }

  /**
   * Play a sound. `delay` schedules it ahead (s); `gain` scales its mix
   * level; `at` pans/attenuates by a fighter's position. Small pitch/level
   * variation and a different take each time, unless `exact`.
   */
  play(name: string, o: { delay?: number; gain?: number; rate?: number; exact?: boolean; key?: string; at?: Who } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    let list = this.buffers(name);
    let mixName = name;
    if (!list && SAMPLES[name]) {
      // Recording not decoded yet (first second after unlock): use the synth stand-in.
      mixName = SAMPLES[name].fallback;
      list = this.buffers(mixName);
    }
    if (!list) return;
    const now = ctx.currentTime;
    const t = now + this.offset + Math.max(0, o.delay ?? 0);
    const cdKey = o.key ?? name;
    const cd = COOLDOWN[name];
    if (cd && t - (this.last.get(cdKey) ?? -9) < cd) return;
    if (this.voices >= MAX_VOICES && (GAIN[name] ?? 0.5) < 0.3) return;
    this.last.set(cdKey, t);
    // A different take than last time.
    let v = (Math.random() * list.length) | 0;
    if (list.length > 1 && v === this.lastVariant.get(name)) v = (v + 1) % list.length;
    this.lastVariant.set(name, v);
    const src = ctx.createBufferSource();
    src.buffer = list[v];
    src.playbackRate.value = (o.rate ?? 1) * (o.exact ? 1 : 1 + (Math.random() * 2 - 1) * 0.03);
    const p = o.at !== undefined ? this.pos[o.at] : null;
    const g = ctx.createGain();
    g.gain.value = (GAIN[mixName] ?? 0.5) * (o.gain ?? 1) * (p ? p.gain : 1) * (o.exact ? 1 : 1 + (Math.random() * 2 - 1) * 0.06);
    src.connect(g);
    let out: AudioNode = g;
    if (p && 'createStereoPanner' in ctx) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = p.pan;
      g.connect(pan);
      out = pan;
    }
    out.connect(this.sfx);
    const send = SEND[name] ?? 0;
    let sendG: GainNode | null = null;
    if (send > 0 && this.room) {
      sendG = ctx.createGain();
      sendG.gain.value = send;
      out.connect(sendG).connect(this.room);
    }
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      g.disconnect();
      if (out !== g) out.disconnect();
      sendG?.disconnect();
    };
    src.start(t);
    if (this.logging) {
      this.log.push(name);
      if (this.log.length > 200) this.log.shift();
    }
  }

  /** Fighter positions from the camera: pan -1..1 (screen x) and a gentle distance gain. */
  setPositions(pan0: number, dist0: number, pan1: number, dist1: number) {
    const g = (d: number) => Math.min(1.08, Math.max(0.62, 3.6 / Math.max(0.5, d)));
    this.pos[0].pan = Math.max(-0.6, Math.min(0.6, pan0 * 0.6));
    this.pos[0].gain = g(dist0);
    this.pos[1].pan = Math.max(-0.6, Math.min(0.6, pan1 * 0.6));
    this.pos[1].gain = g(dist1);
  }

  /** Pause all audio (page hidden). */
  suspend() {
    const c = this.ctx as AudioContext | null;
    if (c && c.state === 'running' && 'suspend' in c) void c.suspend().catch(() => undefined);
  }

  /** Resume after `suspend()` (only works once unlocked by a gesture). */
  resume() {
    const c = this.ctx as AudioContext | null;
    if (c && c.state === 'suspended' && 'resume' in c) void c.resume().catch(() => undefined);
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
   * A technique starts. The air is scheduled to peak at the extension
   * (`strikeIn` s from now); the dobok swishes into it and, on committed
   * kicks, flicks at full extension; sometimes a sharp exhale.
   */
  technique(o: { kind: 'kick' | 'leadKick' | 'turning' | 'punch'; strikeIn: number; who: Who }) {
    const at = o.who;
    const air = o.kind === 'turning' ? 'whooshHeavy' : o.kind === 'kick' ? 'air' : 'whooshFast';
    const len = SYN[air][0];
    this.play(air, { delay: o.strikeIn - len * 0.72, at });
    if (o.kind !== 'punch') {
      // Cloth moves with the leg: swish into the extension, flick on committed kicks.
      this.play('cloth-swish', { delay: Math.max(0, o.strikeIn - 0.16), gain: o.kind === 'leadKick' ? 0.75 : 1, at, key: `cs${at}` });
      if (o.kind !== 'leadKick') this.play('cloth-flick', { delay: o.strikeIn - 0.01, at, key: `cf${at}`, rate: 1.15 });
    } else this.play('cloth-swish', { delay: Math.max(0, o.strikeIn - 0.08), gain: 0.45, rate: 1.3, at, key: `cs${at}` });
    if ((o.kind === 'turning' || o.kind === 'kick') && Math.random() < 0.4) this.play('exhale', { delay: o.strikeIn - 0.06, at, key: `ex${at}` });
  }

  /** A clean contact on the protector (`at` = the fighter who was struck). */
  impact(kind: ImpactKind, heavy: boolean, at?: Who) {
    if (kind === 'body') {
      this.play('hogu', { at });
      this.play('slap', { at, gain: 0.9 });
      if (heavy) this.play('hogu', { at, rate: 0.84, gain: 0.42, key: 'hogu-weight' });
    } else if (kind === 'head') {
      this.play('headgear', { at, rate: 1.06 });
      this.play('slap', { at, rate: 1.15, gain: 0.8 });
      if (heavy) this.play('headgear', { at, rate: 0.9, gain: 0.35, key: 'head-weight' });
    } else {
      this.play('glove', { at, rate: 1.2 });
      this.play('slap', { at, rate: 1.3, gain: 0.55 });
    }
  }

  /** A technique met the guard: dull forearm contact, never a scoring pop. */
  blocked(punch: boolean, guardBreak: boolean, at?: Who) {
    this.play('guard', { at, rate: punch ? 2 : 1.65, gain: punch ? 0.75 : 1 });
    this.play('knock', { at, gain: punch ? 0.7 : 1 });
    if (guardBreak) this.play('hogu', { at, rate: 0.8, gain: 0.3, key: 'guard-break' });
  }

  /** A technique found nothing: only the follow-through air. */
  whiff(at?: Who) {
    this.play('whiff', { at });
  }

  /* ── Movement ─────────────────────────────────────────────────────── */

  /** The local player's corner (online guests fight in corner 1); their own steps are a little louder. */
  player: 0 | 1 = 0;

  footstep(who: Who, pivot = false) {
    const gain = who === this.player ? 1 : 0.8;
    if (pivot) this.play('scuff', { gain, key: `sc${who}`, at: who });
    else this.play('mat', { gain, key: `st${who}`, at: who });
  }

  /** Weight comes down after a kick, and the dobok settles. */
  land(who: Who) {
    this.play('mat', { rate: 0.82, gain: 1.4, key: `ld${who}`, at: who });
    this.play('cloth-settle', { delay: 0.04, key: `set${who}`, at: who });
  }

  dash(who: Who) {
    this.play('slide', { key: `sl${who}`, at: who });
    this.play('mat', { delay: 0.16, gain: 1.1, key: `dl${who}`, at: who });
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

  /** Knockout: the body's second settle on the mat (no synthetic boom). */
  knockout(at?: Who) {
    this.play('hogu', { rate: 0.62, gain: 0.5, delay: 0.22, at, key: 'ko' });
  }

  /** Body hitting the mat. */
  thud(at?: Who) {
    this.play('hogu', { rate: 0.7, gain: 0.8, at, key: 'fall' });
    this.play('mat', { rate: 0.6, gain: 1.6, at, key: 'fall-mat' });
    this.play('cloth-settle', { delay: 0.08, gain: 1.4, at, key: 'fall-cloth' });
  }

  matchEnd(won: boolean) {
    this.play(won ? 'victory' : 'defeat', { exact: true, delay: 0.9 });
  }

  staminaWarning() {
    this.play('stamina', { exact: true });
  }

  /* ── Training ─────────────────────────────────────────────────────── */

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
  fanfare() {
    this.play('chime', { exact: true });
    this.play('chime', { exact: true, delay: 0.16, rate: 1.335 });
  }
  promotion() {
    this.play('gong', { exact: true });
    this.play('victory', { exact: true, delay: 0.25, gain: 0.8 });
  }

  /* ── Menu ─────────────────────────────────────────────────────────── */

  nav() {
    this.play('nav', { exact: true });
  }
  click() {
    this.play('select', { exact: true });
  }
  confirm() {
    this.play('confirm', { exact: true });
  }
  back() {
    this.play('back', { exact: true });
  }
  start() {
    this.play('swell', { exact: true });
    this.play('confirm', { exact: true, delay: 0.05 });
  }

  dispose() {
    this.stopRoomTone();
    const c = this.ctx as AudioContext | null;
    if (c && 'close' in c) void c.close();
    this.ctx = null;
    this.bank.clear();
  }
}

export const audio = new AudioEngine();
