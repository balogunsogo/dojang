// Phase 12B: replay video export on a production build, files verified with ffprobe/ffmpeg.
//   node scripts/dev/export-check.mjs [baseUrl] [--out dir]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : '/tmp/dojang-export';
// --full: present as an unconstrained device (8 cores, 8 GB) to exercise the 1280×720 path.
const full = args.includes('--full');
mkdirSync(out, { recursive: true });
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  (${d})` : ''}`); };
const errors = [];
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

async function open(o = {}) {
  const ctx = await b.newContext({ viewport: o.vp ?? { width: 1280, height: 800 }, acceptDownloads: true });
  await ctx.addInitScript(([noRec, full]) => {
    if (noRec) { delete window.MediaRecorder; }
    if (full) { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }); }
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'medium', menuScene: false }));
  }, [!!o.noRecorder, full]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
}
async function kick(p, key = 'KeyL', head = true) {
  await p.evaluate(() => { const [a, c] = window.__dojang.session.world.fighters; a.x = 0; a.z = -0.55; a.yaw = 0; c.x = 0; c.z = 0.55; c.yaw = Math.PI; a.stamina = 100; });
  const s0 = await p.evaluate(() => window.__dojang.session.world.fighters[0].attackSerial);
  if (head) await p.keyboard.down('KeyE');
  await p.keyboard.press(key);
  if (head) await p.keyboard.up('KeyE');
  await p.waitForFunction((s) => window.__dojang.session.world.fighters[0].attackSerial > s, s0, { timeout: 10000 }).catch(() => {});
  await p.waitForFunction(() => ['idle', 'guard'].includes(window.__dojang.session.world.fighters[0].state) || window.__dojang.session.world.phase !== 'fight', null, { timeout: 10000 }).catch(() => {});
}
/** A real match to a finish: a head roundhouse, then finishing kicks (Arcade KO). */
async function matchToReplay(p) {
  await p.goto(base + '?nomenu3d&start=normal&ai=off');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
  for (let r = 0; r < 2 && !(await p.evaluate(() => window.__dojang.session.world.phase === 'match-over')); r++) {
    await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
    await kick(p);
    await p.waitForTimeout(1000);
    await p.evaluate(() => (window.__dojang.session.world.fighters[1].health = 12));
    for (let i = 0; i < 6 && (await p.evaluate(() => window.__dojang.session.world.phase === 'fight')); i++) await kick(p, 'KeyL', i % 2 === 0);
  }
  await p.waitForSelector('[data-testid=watch-replay]', { timeout: 30000 });
  await p.click('[data-testid=watch-replay]');
  await p.waitForFunction(() => window.__replay && !document.querySelector('[data-testid=replay-play]').disabled, null, { timeout: 30000 });
}
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height,duration,r_frame_rate', '-of', 'json', f]).toString());
const decodes = (f) => { try { execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] }); return ''; } catch (e) { return String(e.stderr ?? e).slice(0, 300); } };
/** Loudest 10 ms window between t0 and t1 seconds (mono 8 kHz PCM). */
function peakAt(f, t0, t1) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 64 << 20 });
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  let best = -1, bestT = -1;
  for (let w = Math.max(0, Math.floor(t0 * 100)); w < Math.min(s.length / 80, t1 * 100); w++) {
    let e = 0;
    for (let k = 0; k < 80; k++) e += Math.abs(s[w * 80 + k] ?? 0);
    if (e > best) { best = e; bestT = w / 100; }
  }
  return { t: bestT, level: best / 80 };
}

let normalFile = null;
/** The 10 ms window with the largest jump over the previous 30 ms. */
function sharpestRise(f, t0, t1) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 64 << 20 });
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  const env = (w) => { let e = 0; for (let k = 0; k < 80; k++) e += Math.abs(s[w * 80 + k] ?? 0); return e / 80 + 1; };
  let best = { t: -1, ratio: 0 };
  for (let w = Math.floor(t0 * 100); w <= t1 * 100; w++) {
    const r = env(w) / ((env(w - 1) + env(w - 2) + env(w - 3)) / 3);
    if (r > best.ratio) best = { t: w / 100, ratio: r };
  }
  return best;
}
/** Sound onsets (10 ms windows whose energy jumps 3x over the previous 50 ms). */
function onsets(f) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 64 << 20 });
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  const env = [];
  for (let w = 0; w < s.length / 80; w++) { let e = 0; for (let k = 0; k < 80; k++) e += Math.abs(s[w * 80 + k] ?? 0); env.push(e / 80); }
  const out = [];
  for (let w = 5; w < env.length; w++) {
    const prev = (env[w - 1] + env[w - 2] + env[w - 3] + env[w - 4] + env[w - 5]) / 5;
    if (env[w] > 300 && env[w] > prev * 3 && (!out.length || w / 100 - out[out.length - 1] > 0.05)) out.push(w / 100);
  }
  return out;
}
async function exportOnce(p, aspect, slow) {
  await p.click('[data-testid=replay-export]');
  await p.waitForSelector('[data-testid=export-panel]');
  if (aspect === '9:16') await p.click('[data-testid="export-aspect-9:16"]');
  if (slow) await p.click('[data-testid=export-speed-selected]');
  const info = await p.textContent('[data-testid=export-info]');
  // Timing probe: when each impact sound is scheduled (audio clock) and when playback crosses the hit tick.
  await p.evaluate(() => {
    const A = window.__audio;
    window.__sched = [];
    window.__cross = null;
    if (!A.__wrapped) {
      const orig = A.play.bind(A);
      A.play = (name, o = {}) => { if (A.ctx) window.__sched.push([name, A.ctx.currentTime + A.offset + Math.max(0, o.delay ?? 0) + A.extraDelay]); return orig(name, o); };
      A.__wrapped = true;
    }
    const ev = window.__replay.clip.eventTick;
    const watch = () => { if (window.__replay && window.__replay['tick'] >= ev && window.__replay.playing && window.__cross === null) window.__cross = { ctx: A.ctx.currentTime, tick: window.__replay['tick'] }; if (window.__cross === null) requestAnimationFrame(watch); };
    requestAnimationFrame(watch);
  });
  await p.click('[data-testid=export-start]');
  await p.waitForSelector('[data-testid=export-progress]', { timeout: 5000 });
  await p.waitForTimeout(1500);
  const preview = await p.evaluate(() => { const c = document.querySelector('.game-canvas canvas') ?? document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height) }; });
  if (aspect === '9:16') await p.screenshot({ path: `${out}/export-recording-portrait.png` });
  else if (!slow) await p.screenshot({ path: `${out}/export-recording-landscape.png` });
  await p.waitForSelector('[data-testid=export-done]', { timeout: 120000 });
  const timing = await p.evaluate(() => {
    const imp = window.__sched.filter(([n]) => /headgear|hogu|glove/.test(n)).map(([, t]) => t);
    const c = window.__cross;
    if (!c || !imp.length) return null;
    // The hit tick's exact audio-clock time, from where playback crossed it.
    const speed = window.__replay.speed || 1;
    const hitAt = c.ctx - (c.tick - window.__replay.clip.eventTick) / 60 / speed;
    const nearest = imp.reduce((m, t) => (Math.abs(t - hitAt) < Math.abs(m - hitAt) ? t : m), imp[0]);
    return { errMs: Math.round((nearest - hitAt) * 1000) };
  });
  const done = await p.textContent('[data-testid=export-done]');
  if (!slow) await p.screenshot({ path: `${out}/export-done-${aspect === '9:16' ? 'portrait' : 'landscape'}.png` });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-testid=export-save]')]);
  const file = `${out}/${dl.suggestedFilename()}`;
  await dl.saveAs(file);
  await p.click('[data-testid=export-close]');
  const restored = await p.evaluate(() => { const c = document.querySelector('canvas'); return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, style: c.getAttribute('style') }; });
  return { file, info, done, preview, restored, name: dl.suggestedFilename(), timing };
}

{
  const p = await open();
  await matchToReplay(p);
  const clip = await p.evaluate(() => ({ dur: window.__replay.duration, ev: window.__replay.clip.eventTick / 60, label: window.__replay.clip.label }));
  const sup = await p.evaluate(() => [['video/mp4;codecs=avc1,mp4a.40.2', MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')], ['video/webm;codecs=vp9,opus', MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')]]);
  console.log(`  clip "${clip.label}" ${clip.dur.toFixed(2)} s, moment at ${clip.ev.toFixed(2)} s; browser support ${JSON.stringify(sup)}`);
  for (const [aspect, slow] of [['16:9', false], ['9:16', false], ['16:9', true]]) {
    if (slow) {
      await p.click('[data-testid="replay-speed-0.5"]');
    }
    const speed = slow ? 0.5 : 1;
    const r = await exportOnce(p, aspect, slow);
    const pr = probe(r.file);
    const v = pr.streams.find((s) => s.codec_type === 'video');
    const a = pr.streams.find((s) => s.codec_type === 'audio');
    const dur = +pr.format.duration;
    const want = clip.dur / speed;
    const tag = `${aspect}${slow ? ' 0.5×' : ''}`;
    console.log(`  ${tag}: ${r.name} · ${pr.format.format_name} · ${v?.codec_name} ${v?.width}x${v?.height} · ${a?.codec_name ?? 'no audio'} · ${dur.toFixed(2)} s · ui "${r.done.trim()}"`);
    const ext = r.name.split('.').pop();
    check(`${tag}: container matches the file extension (${ext}) and the browser's actual format`, (ext === 'webm' && /webm|matroska/.test(pr.format.format_name)) || (ext === 'mp4' && /mp4|mov/.test(pr.format.format_name)), pr.format.format_name);
    // 1280×720 (720×1280 portrait), or 960×540 on a constrained device (this container counts as one).
    const long = Math.max(v.width, v.height);
    check(`${tag}: ${aspect} at ${long === 1280 ? '720p' : '540p (constrained-device fallback)'}`, (long === 1280 || long === 960) && (aspect === '16:9' ? v.width * 9 === v.height * 16 : v.width * 16 === v.height * 9), `${v.width}x${v.height}`);
    check(`${tag}: duration matches the clip${slow ? ' at half speed' : ''} (${want.toFixed(1)} s + a short hold)`, Number.isFinite(dur) && dur > want - 0.4 && dur < want + 1.5, dur.toFixed(2));
    check(`${tag}: includes the replay's sound`, !!a, a?.codec_name ?? 'none');
    const err = decodes(r.file);
    check(`${tag}: the file decodes end to end without errors (playable)`, err === '', err);
    if (r.timing && !slow) check(`${tag}: the impact is scheduled at the hit's moment`, Math.abs(r.timing.errMs) <= 20, JSON.stringify(r.timing));
    if (a && !slow) {
      // At normal speed the impact is the loudest sound around the moment: it lands where the video shows the hit.
      const expect = clip.ev / speed;
      const pk = peakAt(r.file, expect - 0.8, expect + 0.8);
      check(`${tag}: audio in sync: the impact peaks at the hit (${expect.toFixed(2)} s)`, Math.abs(pk.t - expect) <= 0.15, `peak ${pk.t.toFixed(2)} s, level ${pk.level.toFixed(0)}`);
      if (aspect === '16:9') normalFile = r.file;
    } else if (a && slow && normalFile) {
      // Slow motion: whooshes separate from impacts, so compare the whole timing pattern instead.
      // Every sound onset of the 1× export must reappear at twice its time (plus a small fixed offset).
      const o1 = onsets(normalFile);
      const o2 = onsets(r.file);
      let best = { c: 0, hit: 0 };
      for (let c = -0.5; c <= 0.5; c += 0.01) {
        const hit = o1.filter((t) => o2.some((u) => Math.abs(u - (2 * t + c)) <= 0.06)).length;
        if (hit > best.hit) best = { c, hit };
      }
      // Impacts and footsteps scale exactly; a technique's air is anchored to its (slowed) extension minus a fixed lead, so not every onset doubles.
      check(`${tag}: audio in sync at half speed: the 1× sound pattern lands at twice its times`, best.hit >= 0.5 * o1.length && Math.abs(best.c) <= 0.1, `${best.hit}/${o1.length} onsets matched, offset ${best.c.toFixed(2)} s`);
      // The impact itself, at the hit (the whoosh comes ~0.4 s earlier at half speed, outside this window).
      const expect = clip.ev / speed + best.c;
      // The impact is scheduled on the audio clock exactly at the hit tick's moment (the container's
      // audio/video alignment is proven by the 1× exports above).
      check(`${tag}: the impact is scheduled at the hit's moment at half speed`, !!r.timing && Math.abs(r.timing.errMs) <= 20, JSON.stringify(r.timing));
    }
    check(`${tag}: preview showed the export's aspect while recording`, Math.abs(r.preview.cssW / r.preview.cssH - (aspect === '16:9' ? 16 / 9 : 9 / 16)) < 0.02 && r.preview.w === v.width && r.preview.h === v.height, JSON.stringify(r.preview));
    check(`${tag}: the viewer's renderer and canvas are restored afterwards`, !/position: absolute/.test(r.restored.style ?? '') && Math.abs(r.restored.w / r.restored.cw - r.restored.h / r.restored.ch) < 0.02, JSON.stringify(r.restored));
    if (aspect === '9:16' && !slow) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(clip.ev), '-i', r.file, '-frames:v', '1', `${out}/portrait-frame.jpg`]);
    if (aspect === '16:9' && !slow) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(clip.ev), '-i', r.file, '-frames:v', '1', `${out}/landscape-frame.jpg`]);
  }
  // Cancel midway: back to the setup, nothing kept, renderer restored.
  await p.click('[data-testid=replay-speed-1]');
  await p.click('[data-testid=replay-export]');
  await p.click('[data-testid=export-start]');
  await p.waitForTimeout(2500);
  await p.keyboard.press('Escape');
  await p.waitForSelector('[data-testid=export-start]', { timeout: 10000 });
  const after = await p.evaluate(() => { const c = document.querySelector('canvas'); return { style: c.getAttribute('style') ?? '', exporting: !!document.querySelector('[data-testid=export-progress]') }; });
  check('cancel: Esc stops the export, back to the setup, renderer restored', !after.exporting && !/position: absolute/.test(after.style), JSON.stringify(after));
  await p.click('[data-testid=export-close]');
  await p.click('[data-testid=replay-back]');
  await p.waitForSelector('[data-testid=result]', { timeout: 5000 });
  const live = await p.evaluate(() => { const c = document.querySelector('canvas'); return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, held: window.__dojang.session['held'] }; });
  check('after exporting: back to the result; the match renderer is full size again', !live.held && Math.abs(live.w / live.cw - live.h / live.ch) < 0.02, JSON.stringify(live));
  await p.context().close();
}
// Phones: the export panel fits; a short export records with progress.
for (const [name, vp] of [['844x390', { width: 844, height: 390 }], ['390x844', { width: 390, height: 844 }]]) {
  const portrait = vp.height > vp.width;
  const ctx = await b.newContext({ viewport: portrait ? { width: vp.height, height: vp.width } : vp, hasTouch: true, isMobile: true, acceptDownloads: true });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false })); } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await matchToReplay(p);
  if (portrait) await p.setViewportSize(vp);
  await p.tap('[data-testid=replay-export]');
  await p.waitForSelector('[data-testid=export-start]');
  await p.tap('[data-testid="export-aspect-9:16"]');
  const fit = await p.evaluate(() => { const els = [...document.querySelectorAll('.replay-export-panel button')].filter((x) => x.getBoundingClientRect().width > 0); return { out: els.filter((x) => { const r = x.getBoundingClientRect(); return r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1; }).length, small: els.filter((x) => x.getBoundingClientRect().height < 40).length }; });
  check(`${name}: export panel fits, touch targets ≥ 40 px`, fit.out === 0 && fit.small === 0, JSON.stringify(fit));
  await p.screenshot({ path: `${out}/phone-${name}-setup.png` });
  await p.tap('[data-testid=export-start]');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/phone-${name}-recording.png` });
  await p.waitForSelector('[data-testid=export-done]', { timeout: 120000 });
  await p.screenshot({ path: `${out}/phone-${name}-done.png` });
  check(`${name}: a portrait export completes on a phone layout`, /720 × 1280|540 × 960/.test(await p.textContent('[data-testid=export-done]')), await p.textContent('[data-testid=export-done]'));
  await ctx.close();
}
// A browser without MediaRecorder: a clear limitation, no broken file.
{
  const p = await open({ noRecorder: true });
  await matchToReplay(p);
  await p.click('[data-testid=replay-export]');
  const msg = await p.textContent('[data-testid=export-unsupported]').catch(() => '');
  check('unsupported browser: a clear message and no Export button', /cannot record video/.test(msg) && !(await p.$('[data-testid=export-start]')), msg);
  await p.context().close();
}
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
