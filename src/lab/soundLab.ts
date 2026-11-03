import { AudioEngine, audio, SOUND_NAMES } from '../game/audio/AudioEngine';
import { finish, Synth } from '../game/audio/dsp';
import { LEGACY_GAIN, LEGACY_R } from '../game/audio/legacy9';

/**
 * Dev/UAT page (?lab=sounds).
 * - A/B: representative examples rendered offline through the Phase 9 set
 *   and the Phase 9.1 engine, loudness-matched (same RMS), so only the
 *   character differs.
 * - Every individual Phase 9.1 sound, with x4 to hear variation.
 */
type Script = (k: Kit) => void;
interface Kit {
  /** Schedule an engine call at time t (s). */
  at(t: number, fn: (e: AudioEngine) => void): void;
  /** Legacy (Phase 9) sound at time t. */
  old(t: number, name: string, gain?: number): void;
}

const EXAMPLES: { id: string; label: string; v91: Script; v9: Script }[] = [
  {
    id: 'body-kick',
    label: 'Body kick lands',
    v91: (k) => (k.at(0, (e) => e.technique({ kind: 'kick', strikeIn: 0.24, who: 0 })), k.at(0.24, (e) => e.impact('body', false, 1))),
    v9: (k) => (k.old(0.24 - 0.34 * 0.7, 'whoosh'), k.old(0.235, 'snap'), k.old(0.24, 'body')),
  },
  {
    id: 'head-kick',
    label: 'Turning head kick lands',
    v91: (k) => (k.at(0, (e) => e.technique({ kind: 'turning', strikeIn: 0.3, who: 0 })), k.at(0.3, (e) => e.impact('head', true, 1))),
    v9: (k) => (k.old(0.3 - 0.44 * 0.7, 'whooshHeavy'), k.old(0.295, 'snap'), k.old(0.3, 'head'), k.old(0.3, 'heavy')),
  },
  {
    id: 'blocked-kick',
    label: 'Kick blocked',
    v91: (k) => (k.at(0, (e) => e.technique({ kind: 'kick', strikeIn: 0.24, who: 0 })), k.at(0.24, (e) => e.blocked(false, false, 1))),
    v9: (k) => (k.old(0.24 - 0.34 * 0.7, 'whoosh'), k.old(0.235, 'snap'), k.old(0.24, 'block')),
  },
  {
    id: 'miss',
    label: 'Kick misses',
    v91: (k) => (k.at(0, (e) => e.technique({ kind: 'kick', strikeIn: 0.24, who: 0 })), k.at(0.33, (e) => e.whiff(0))),
    v9: (k) => (k.old(0.24 - 0.34 * 0.7, 'whoosh'), k.old(0.235, 'snap'), k.old(0.33, 'whiff')),
  },
  {
    id: 'punch',
    label: 'Punch lands',
    v91: (k) => (k.at(0, (e) => e.technique({ kind: 'punch', strikeIn: 0.12, who: 0 })), k.at(0.12, (e) => e.impact('punch', false, 1))),
    v9: (k) => (k.old(0.12 - 0.2 * 0.7, 'whooshFast'), k.old(0.12, 'punch')),
  },
  {
    id: 'footwork',
    label: 'Footwork, pivot, landing',
    v91: (k) => {
      [0, 0.26, 0.55, 0.8, 1.06].forEach((t, i) => k.at(t, (e) => e.footstep((i % 2) as 0 | 1)));
      k.at(1.35, (e) => e.footstep(0, true));
      k.at(1.7, (e) => e.dash(0));
      k.at(2.2, (e) => e.land(0));
    },
    v9: (k) => {
      [0, 0.26, 0.55, 0.8, 1.06].forEach((t, i) => k.old(t, 'step', i % 2 ? 0.75 : 1));
      k.old(1.35, 'scuff');
      k.old(1.7, 'slide');
      k.old(2.2, 'land');
    },
  },
  {
    id: 'sequence',
    label: 'Combined exchange',
    v91: (k) => {
      k.at(0, (e) => e.footstep(0));
      k.at(0.25, (e) => e.footstep(0));
      k.at(0.4, (e) => e.technique({ kind: 'kick', strikeIn: 0.24, who: 0 }));
      k.at(0.64, (e) => e.impact('body', false, 1));
      k.at(1.05, (e) => e.land(0));
      k.at(1.35, (e) => e.technique({ kind: 'leadKick', strikeIn: 0.16, who: 1 }));
      k.at(1.51, (e) => e.blocked(false, false, 0));
      k.at(1.8, (e) => e.footstep(1));
      k.at(2.0, (e) => e.technique({ kind: 'turning', strikeIn: 0.3, who: 0 }));
      k.at(2.3, (e) => e.impact('head', true, 1));
      k.at(2.75, (e) => e.land(0));
      k.at(3.0, (e) => e.technique({ kind: 'punch', strikeIn: 0.12, who: 1 }));
      k.at(3.2, (e) => e.whiff(1));
    },
    v9: (k) => {
      k.old(0, 'step');
      k.old(0.25, 'step');
      k.old(0.4 + 0.24 - 0.34 * 0.7, 'whoosh'), k.old(0.635, 'snap'), k.old(0.64, 'body');
      k.old(1.05, 'land');
      k.old(1.35 + 0.16 - 0.2 * 0.7, 'whooshFast', 0.8), k.old(1.505, 'snap', 0.8), k.old(1.51, 'block');
      k.old(1.8, 'step', 0.75);
      k.old(2.0 + 0.3 - 0.44 * 0.7, 'whooshHeavy'), k.old(2.295, 'snap'), k.old(2.3, 'head'), k.old(2.3, 'heavy');
      k.old(2.75, 'land');
      k.old(3.0 + 0.12 - 0.2 * 0.7, 'whooshFast', 0.8), k.old(3.2, 'whiff');
    },
  },
];

const RATE = 44100;

function legacyBuffer(ctx: BaseAudioContext, name: string) {
  const [dur, recipe] = LEGACY_R[name];
  const s = new Synth(32000, Math.ceil(dur * 32000));
  const data = finish(recipe(s, 1), 32000, 0.9, name === 'body' || name === 'heavy' ? 1.5 : 1.1);
  const b = ctx.createBuffer(1, data.length, 32000);
  b.getChannelData(0).set(data);
  return b;
}

/** Render one example offline; returns stereo channels normalised to -20 dBFS RMS. */
async function render(ex: (typeof EXAMPLES)[number], which: 'v9' | 'v91'): Promise<Float32Array[]> {
  const dur = ex.id === 'sequence' ? 4 : ex.id === 'footwork' ? 3 : 1.4;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * RATE), RATE);
  if (which === 'v91') {
    const e = new AudioEngine(ctx);
    e.setMix({ master: 1, sfx: 1, ambient: 0, muted: false });
    e.setPositions(-0.35, 3.4, 0.35, 3.8);
    await e.ready();
    ex.v91({
      at: (t, fn) => {
        e.offset = t;
        fn(e);
        e.offset = 0;
      },
      old: () => undefined,
    });
  } else {
    const cache = new Map<string, AudioBuffer>();
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -10;
    lim.ratio.value = 8;
    lim.connect(ctx.destination);
    ex.v9({
      at: () => undefined,
      old: (t, name, gain = 1) => {
        if (!cache.has(name)) cache.set(name, legacyBuffer(ctx, name));
        const src = ctx.createBufferSource();
        src.buffer = cache.get(name)!;
        const g = ctx.createGain();
        g.gain.value = (LEGACY_GAIN[name] ?? 0.5) * gain;
        src.connect(g).connect(lim);
        src.start(Math.max(0, t));
      },
    });
  }
  const buf = await ctx.startRendering();
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  let rawPeak = 0;
  for (const c of ch) for (const v of c) rawPeak = Math.max(rawPeak, Math.abs(v));
  let sum = 0;
  let n = 0;
  for (const c of ch) for (const v of c) if (Math.abs(v) > 0.003) ((sum += v * v), n++);
  const rms = Math.sqrt(sum / Math.max(1, n));
  const k = rms > 0 ? 0.1 / rms : 1; // -20 dBFS RMS over the active signal
  let peak = 0;
  for (const c of ch) for (const v of c) peak = Math.max(peak, Math.abs(v * k));
  const kk = peak > 0.98 ? (k * 0.98) / peak : k;
  STATS[`${ex.id}-${which}`] = { rawPeakDb: +(20 * Math.log10(rawPeak || 1e-9)).toFixed(1), rawRmsDb: +(20 * Math.log10(rms || 1e-9)).toFixed(1) };
  return ch.map((c) => c.map((v) => v * kk));
}

/** Raw (pre-matching) peak and RMS of each render: the clipping/loudness sanity check. */
export const STATS: Record<string, { rawPeakDb: number; rawRmsDb: number }> = {};

export function runSoundLab(root: HTMLElement) {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:24px;font:15px/1.4 system-ui,sans-serif;color:#efe6d8;background:#15120f;min-height:100%;overflow:auto';
  wrap.innerHTML =
    '<h1 style="font-weight:400;margin:0 0 4px">DOJANG sound lab</h1><p style="color:#a99f90;margin:0 0 16px;max-width:60ch">A/B compares Phase 9 (fully synthesized) with Phase 9.1 (recorded CC0 layers + synthesis, stereo and room) at matched loudness. Headphones and a phone speaker are both worth a listen.</p>';
  const btn = (label: string, fn: () => void, primary = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `margin:4px;padding:10px 14px;min-height:44px;background:${primary ? '#3a2f22' : '#2a221b'};color:#efe6d8;border:1px solid #4a3d31;border-radius:2px;cursor:pointer`;
    b.onclick = fn;
    return b;
  };
  let live: AudioContext | null = null;
  const playCh = (ch: Float32Array[]) => {
    live ??= new AudioContext();
    void live.resume();
    const b = live.createBuffer(2, ch[0].length, RATE);
    b.getChannelData(0).set(ch[0]);
    b.getChannelData(1).set(ch[1]);
    const s = live.createBufferSource();
    s.buffer = b;
    const g = live.createGain();
    g.gain.value = 0.8;
    s.connect(g).connect(live.destination);
    s.start();
  };
  const rendered = new Map<string, Float32Array[]>();
  const get = async (ex: (typeof EXAMPLES)[number], w: 'v9' | 'v91') => {
    const key = `${ex.id}:${w}`;
    if (!rendered.has(key)) rendered.set(key, await render(ex, w));
    return rendered.get(key)!;
  };
  const h = (t: string) => {
    const e = document.createElement('h2');
    e.textContent = t;
    e.style.cssText = 'font-size:13px;color:#a99f90;margin:18px 0 4px';
    wrap.appendChild(e);
  };
  h('A/B at matched loudness');
  for (const ex of EXAMPLES) {
    const row = document.createElement('div');
    row.innerHTML = `<span style="display:inline-block;min-width:200px">${ex.label}</span>`;
    row.appendChild(btn('Phase 9', () => void get(ex, 'v9').then(playCh)));
    row.appendChild(btn('Phase 9.1', () => void get(ex, 'v91').then(playCh), true));
    wrap.appendChild(row);
  }
  h('Phase 9.1 sounds (×4 = variation)');
  for (const n of SOUND_NAMES().filter((x) => !(x in LEGACY_R) || ['whooshFast', 'whooshHeavy', 'whiff', 'scuff', 'slide', 'exhale', 'bell', 'horn', 'blip', 'buzz', 'drum', 'victory', 'defeat', 'tock', 'tick', 'chime', 'gong', 'nav', 'select', 'confirm', 'back', 'swell'].includes(x))) {
    const go = (times: number) => () => {
      audio.unlock();
      audio.setMix({ master: 0.9, sfx: 1, ambient: 0.5, muted: false });
      for (let i = 0; i < times; i++) audio.play(n, { delay: i * 0.45 });
    };
    wrap.appendChild(btn(n, go(1)));
    wrap.appendChild(btn('×4', go(4)));
  }
  root.appendChild(wrap);
  // Export hook for documentation (renders every example, both versions).
  (window as unknown as { __renderExamples?: () => Promise<Record<string, number[][]>> }).__renderExamples = async () => {
    const out: Record<string, number[][]> = {};
    for (const ex of EXAMPLES)
      for (const w of ['v9', 'v91'] as const) {
        const ch = await get(ex, w);
        out[`${ex.id}-${w}`] = ch.map((c) => Array.from(c));
      }
    (out as unknown as { stats: unknown }).stats = STATS;
    return out;
  };
}
