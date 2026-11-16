// Phase 12A: replay capture and viewer on a production build.
//   node scripts/dev/replay-check.mjs [baseUrl] [--shots dir] [--only arcade|...]
// Real combat: the script positions the fighters and presses the real keys
// (a head roundhouse, then finishing kicks); the replay shows what happened.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  (${d})` : ''}`); };
const errors = [];
const b = await chromium.launch();
const shot = (p, n) => shots && p.screenshot({ path: `${shots}/${n}.png` });

async function open(vp = { width: 1280, height: 800 }, o = {}) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: !!o.touch, isMobile: !!o.touch });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false }));
    localStorage.setItem('dojang.progress.v1', JSON.stringify({ version: 1, fighter: 'tunde', belt: 'white', completed: ['practice'], records: {}, landed: {}, matches: { played: 0, won: 0, wins: { easy: 0, normal: 0, hard: 0 }, friendWins: 0 } }));
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
}
const progress = (p) => p.evaluate(() => localStorage.getItem('dojang.progress.v1'));
/** A real kick: square the fighters up at kicking range and press the keys. */
async function kick(p, key = 'KeyL', head = true) {
  await p.evaluate(() => { const [a, c] = window.__dojang.session.world.fighters; a.x = 0; a.z = -0.55; a.yaw = 0; c.x = 0; c.z = 0.55; c.yaw = Math.PI; a.stamina = 100; });
  const s0 = await p.evaluate(() => window.__dojang.session.world.fighters[0].attackSerial);
  if (head) await p.keyboard.down('KeyE');
  await p.keyboard.press(key);
  if (head) await p.keyboard.up('KeyE');
  await p.waitForFunction((s) => window.__dojang.session.world.fighters[0].attackSerial > s, s0, { timeout: 10000 }).catch(() => {});
  await p.waitForFunction(() => ['idle', 'guard'].includes(window.__dojang.session.world.fighters[0].state) || window.__dojang.session.world.phase !== 'fight', null, { timeout: 10000 }).catch(() => {});
}
/** Win a round by knockout with real kicks (the defender starts the exchange low on health). */
async function koRound(p) {
  await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
  await kick(p, 'KeyL', true); // a head roundhouse
  await p.waitForTimeout(1200);
  await p.evaluate(() => (window.__dojang.session.world.fighters[1].health = 12));
  for (let i = 0; i < 6 && (await p.evaluate(() => window.__dojang.session.world.phase === 'fight')); i++) await kick(p, 'KeyL', i % 2 === 0);
}

if (!only || only === 'arcade') {
  const p = await open();
  await p.goto(base + '?nomenu3d&start=normal&ai=off');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
  for (let r = 0; r < 2 && !(await p.evaluate(() => window.__dojang.session.world.phase === 'match-over')); r++) await koRound(p);
  await p.waitForSelector('[data-testid=result]', { timeout: 30000 });
  const rec = await p.evaluate(() => { const r = window.__dojang.session.recorder; return { completed: r.completed, n: r.highlightCount, bytes: r.bytes(), ticks: r.count, costMs: r.costMs }; });
  check('arcade: match completed with highlights chosen', rec.completed && rec.n >= 1 && rec.n <= 3, JSON.stringify(rec));
  console.log(`  capture: ${(rec.costMs / rec.ticks * 1000).toFixed(1)} µs/tick over ${rec.ticks} ticks; ${(rec.bytes / 1024).toFixed(0)} KB held`);
  await p.waitForSelector('[data-testid=watch-replay]', { timeout: 5000 });
  check('arcade: result panel offers Watch replay; round info intact', !!(await p.$('[data-testid=watch-replay]')) && !!(await p.$('[data-testid=rematch]')));
  const before = await progress(p);
  const t0 = Date.now();
  await p.click('[data-testid=watch-replay]');
  await p.waitForSelector('[data-testid=replay]');
  await p.waitForFunction(() => window.__replay && document.querySelector('[data-testid=replay-play]') && !document.querySelector('[data-testid=replay-play]').disabled, null, { timeout: 30000 });
  const init = Date.now() - t0;
  const info = await p.evaluate(() => ({ labels: window.__replay.set.clips.map((c) => c.label), bake: Math.round(window.__replay.bakeMs), clipLen: window.__replay.set.clips.map((c) => c.len) }));
  console.log(`  viewer ready in ${init} ms (bake ${info.bake} ms); clips ${JSON.stringify(info.labels)} lens ${info.clipLen}`);
  check('arcade: a knockout highlight labelled from the real events', info.labels.some((l) => /^Knockout · /.test(l)), info.labels.join(' | '));
  check('arcade: no Watch-replay overlay leftovers (result panel hidden while watching)', !(await p.$('[data-testid=result]')));
  await p.waitForTimeout(1500);
  await shot(p, 'arcade-broadcast');
  // Fidelity on the knockout: chamber, contact, the fall and floor contact, as recorded.
  {
    const ko = info.labels.findIndex((l) => /^Knockout/.test(l));
    if (ko !== 0) {
      await p.click('[data-testid=replay-next]');
      await p.waitForFunction(() => !document.querySelector('[data-testid=replay-play]').disabled, null, { timeout: 30000 });
    }
    if ((await p.getAttribute('[data-testid=replay-play]', 'aria-label')) === 'Pause') await p.click('[data-testid=replay-play]');
    const clip = await p.evaluate(() => { const c = window.__replay.clip; const ko = c.events.find((e) => e.k === 'ko'); const hit = c.events.find((e) => e.k === 'hit' && e.t === c.eventTick); return { ev: c.eventTick / 60, who: ko?.who, attacker: hit?.a, move: hit?.move, ids: window.__replay.set.meta.ids }; });
    check('KO clip: the finishing hit is a real recorded roundhouse by the Chung fighter on the Hong fighter', clip.move === 'round' && clip.attacker === 0 && clip.who === 1 && clip.ids[0] === 'tunde', JSON.stringify(clip));
    const hips = () => p.evaluate((who) => { const n = window.__replay['nodes'][who].find((x) => /hips/i.test(x.name)); const v = n.getWorldPosition(new n.position.constructor()); return +v.y.toFixed(3); }, clip.who);
    for (const [name, dt] of [['chamber', -0.12], ['contact', 0], ['falling', 0.7], ['floor', 2.2]]) {
      await p.evaluate((t) => window.__replay.seek(t), clip.ev + dt);
      await p.waitForTimeout(250);
      await shot(p, `ko-${name}`);
    }
    await p.evaluate((t) => window.__replay.seek(t), clip.ev - 0.5);
    const standing = await hips();
    await p.evaluate((t) => window.__replay.seek(t), clip.ev + 2.2);
    const down = await hips();
    check('KO clip: the knocked-out fighter falls to the floor (hips low) and stays there', standing > 0.75 && down < 0.4, `hips ${standing} → ${down}`);
    await p.click('[data-testid=replay-cam-broadcast]');
  }
  // Seek: exact pose, repeatable (no accumulated error).
  const pose = () => p.evaluate(() => { const n = window.__replay['nodes'][0]; return n.slice(0, 12).map((x) => [x.position.x, x.position.y, x.quaternion.x, x.quaternion.w].map((v) => +v.toFixed(5))).join(); });
  if ((await p.getAttribute('[data-testid=replay-play]', 'aria-label')) === 'Pause') await p.click('[data-testid=replay-play]');
  
  await p.evaluate(() => window.__replay.seek(3.2));
  const a1 = await pose();
  await p.evaluate(() => { window.__replay.seek(8); window.__replay.seek(0.5); window.__replay.seek(6.1); window.__replay.seek(3.2); });
  const a2 = await pose();
  check('seek: the same time gives the same pose after repeated seeking', a1 === a2);
  await p.waitForTimeout(300);
  const a3 = await pose();
  check('pause freezes the pose', a3 === a2);
  // Speeds.
  await p.click('[data-testid="replay-speed-0.25"]');
  await p.click('[data-testid=replay-play]');
  const s0 = await p.evaluate(() => window.__replay.time);
  await p.waitForTimeout(1000);
  const s1 = await p.evaluate(() => window.__replay.time);
  check('0.25× advances about a quarter of real time', s1 - s0 > 0.12 && s1 - s0 < 0.45, (s1 - s0).toFixed(3));
  await p.click('[data-testid=replay-speed-1]');
  // Cameras.
  for (const c of ['side', 'close', 'broadcast']) {
    await p.click(`[data-testid=replay-cam-${c}]`);
    await p.waitForTimeout(900);
    await shot(p, `arcade-${c}`);
  }
  const cam = await p.evaluate(() => { const c = window.__replay['camera']; return [c.position.x, c.position.y, c.position.z].map((v) => +v.toFixed(2)); });
  check('cameras stay inside the hall', Math.abs(cam[0]) < 6.2 && Math.abs(cam[2]) < 6.2 && cam[1] < 3.8 && cam[1] > 0.5, cam.join());
  // Next / previous highlight.
  const n = info.labels.length;
  if (n > 1) {
    await p.click('[data-testid=replay-next]');
    await p.waitForFunction(() => !document.querySelector('[data-testid=replay-play]').disabled, null, { timeout: 30000 });
    check('next highlight', (await p.textContent('[data-testid=replay-label]')) === info.labels[1]);
    await p.click('[data-testid=replay-prev]');
  }
  await p.keyboard.press('Escape');
  await p.waitForSelector('[data-testid=result]', { timeout: 5000 });
  check('back to the same result screen; the live scene is returned', !(await p.$('[data-testid=replay]')) && (await p.evaluate(() => window.__dojang.session['held'])) === false);
  check('watching changed no progress or statistics', (await progress(p)) === before);
  check('player released on exit', await p.evaluate(() => window.__replay === undefined));
  await p.context().close();
}


/** Open the viewer from a result screen and wait until the clip is baked. */
async function watch(p, sel = '[data-testid=watch-replay]') {
  await p.waitForSelector(sel, { timeout: 20000 });
  await p.click(sel);
  await p.waitForSelector('[data-testid=replay]');
  await p.waitForFunction(() => window.__replay && !document.querySelector('[data-testid=replay-play]').disabled, null, { timeout: 30000 });
  return p.evaluate(() => ({ labels: window.__replay.set.clips.map((c) => c.label), by: window.__replay.set.clips.map((c) => c.by), names: window.__replay.set.meta.names }));
}
/** End the current round through the world's own flow (used after real scoring kicks). */
async function endRound(p, w) {
  await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
  await p.evaluate((w) => window.__dojang.session.world.endRound(w, 'time'), w);
}

// ── Competitive: real head kicks score; the result keeps its round table ──
if (!only || only === 'competitive') {
  const p = await open();
  await p.goto(base + '?nomenu3d&start=normal&ai=off&mode=competitive');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
  for (let r = 0; r < 2; r++) {
    await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
    await kick(p, 'KeyL', true);
    await p.waitForTimeout(400);
    await endRound(p, 0);
  }
  await p.waitForSelector('[data-testid=comp-summary]', { timeout: 30000 });
  const v = await watch(p);
  check('competitive: a scored head kick is a highlight, labelled with its points', v.labels.some((l) => /Roundhouse kick · \d points?|Head kick/.test(l)), v.labels.join(' | '));
  await shot(p, 'competitive-replay');
  await p.click('[data-testid=replay-back]');
  check('competitive: back to the result with the round table intact', !!(await p.waitForSelector('[data-testid=comp-summary]', { timeout: 5000 }).catch(() => null)));
  await p.context().close();
}

// ── Couch: highlights by either fighter (player 2 lands the head kicks) ──
if (!only || only === 'couch') {
  const p = await open();
  await p.goto(base + '?nomenu3d');
  await p.click('[data-testid=mode-friend]');
  await p.click('[data-testid=start-couch]');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
  for (let r = 0; r < 2 && !(await p.evaluate(() => window.__dojang.session.world.phase === 'match-over')); r++) {
    await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
    for (let i = 0; i < 8 && (await p.evaluate(() => window.__dojang.session.world.phase === 'fight')); i++) {
      if (i === 1) await p.evaluate(() => (window.__dojang.session.world.fighters[0].health = 12));
      await p.evaluate(() => { const [a, c] = window.__dojang.session.world.fighters; a.x = 0; a.z = -0.55; a.yaw = 0; c.x = 0; c.z = 0.55; c.yaw = Math.PI; c.stamina = 100; });
      const s0 = await p.evaluate(() => window.__dojang.session.world.fighters[1].attackSerial);
      await p.keyboard.down('Numpad6');
      await p.keyboard.press('Numpad2');
      await p.keyboard.up('Numpad6');
      await p.waitForFunction((s) => window.__dojang.session.world.fighters[1].attackSerial > s, s0, { timeout: 8000 }).catch(() => {});
      await p.waitForFunction(() => ['idle', 'guard'].includes(window.__dojang.session.world.fighters[1].state) || window.__dojang.session.world.phase !== 'fight', null, { timeout: 8000 }).catch(() => {});
    }
  }
  await p.waitForSelector('[data-testid=result]', { timeout: 30000 });
  const v = await watch(p);
  check('couch: highlights credit player 2 (Hong), not "the player"', v.by.includes(1) && v.labels.some((l) => /Knockout|Head kick/.test(l)), `${v.labels.join(' | ')} by ${v.by.join(',')}`);
  check('couch: the by-line shows P2\'s name', /P2/.test(await p.textContent('.replay-by')), await p.textContent('.replay-by'));
  await shot(p, 'couch-replay');
  await p.context().close();
}

// ── Training: a completed drill is a "Training combination" ──
if (!only || only === 'training') {
  const p = await open();
  await p.goto(base + '?nomenu3d');
  await p.click('[data-testid=mode-training]');
  await p.click('[data-testid=activity-combo-front-round]');
  await p.click('[data-testid=begin-activity]');
  await p.waitForFunction(() => window.__dojang?.session?.ready && window.__dojang.session.training, null, { timeout: 90000 });
  for (let r = 0; r < 3; r++) {
    await kick(p, 'KeyK', false);
    await kick(p, 'KeyL', false);
  }
  await p.waitForSelector('[data-testid=training-summary]', { timeout: 30000 });
  const v = await watch(p);
  check('training: summary offers the replay; a completed drill is labelled', v.labels.includes('Training combination'), v.labels.join(' | '));
  await shot(p, 'training-replay');
  await p.click('[data-testid=replay-back]');
  check('training: back to the summary', !!(await p.waitForSelector('[data-testid=training-summary]', { timeout: 5000 }).catch(() => null)));
  await p.context().close();
}

// ── Audio: cues follow the timeline; pause and seek stay silent; mute applies ──
if (!only || only === 'audio') {
  const p = await open();
  await p.goto(base + '?nomenu3d&start=normal&ai=off');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
  for (let r = 0; r < 2 && !(await p.evaluate(() => window.__dojang.session.world.phase === 'match-over')); r++) await koRound(p);
  await watch(p);
  await p.evaluate(() => { window.__audio.logging = true; window.__audio.log.length = 0; });
  const ev = await p.evaluate(() => window.__replay.clip.eventTick / 60);
  await p.evaluate((t) => { window.__replay.pause(); window.__replay.seek(t - 0.6); window.__replay.play(); }, ev);
  await p.waitForTimeout(1300);
  const played = await p.evaluate(() => [...window.__audio.log]);
  check('audio: the replay plays the recorded moment\'s sounds (technique air and the impact)', played.some((n) => /air|whoosh/.test(n)) && played.some((n) => /headgear|hogu|slap/.test(n)), played.join(','));
  await p.evaluate(() => { window.__replay.pause(); window.__audio.log.length = 0; });
  await p.waitForTimeout(500);
  await p.evaluate((t) => { window.__replay.seek(t + 0.05); window.__replay.seek(t - 0.02); window.__replay.seek(t + 0.1); }, ev);
  await p.waitForTimeout(400);
  check('audio: paused and seeking across the impact plays nothing (no duplicates)', (await p.evaluate(() => window.__audio.log.length)) === 0, (await p.evaluate(() => window.__audio.log.join(','))));
  // Seeded variation: the same moment twice gives the same take choice.
  const take = async () => { await p.evaluate((t) => { window.__audio.log.length = 0; window.__replay.seek(t - 0.3); window.__replay.play(); }, ev); await p.waitForTimeout(700); await p.evaluate(() => window.__replay.pause()); return p.evaluate(() => window.__audio['lastVariant'] ? JSON.stringify([...window.__audio['lastVariant']]) : ''); };
  const t1 = await take();
  const t2 = await take();
  check('audio: a replayed moment uses the same takes each time (seeded)', t1 === t2 && t1.length > 2, `${t1} / ${t2}`);
  // Mute applies to the replay bus (it sits under the effects level and master).
  await p.evaluate(() => window.__audio.setMix({ master: 0.8, sfx: 1, ambient: 0.5, muted: true }));
  const g = await p.evaluate(() => window.__audio['master']?.gain.value);
  check('audio: mute silences replay playback (master at 0)', g === 0, String(g));
  check('audio: leaving the viewer closes the replay bus', await p.evaluate(async () => { document.querySelector('[data-testid=replay-back]').click(); await new Promise((r) => setTimeout(r, 300)); return window.__audio ? window.__audio['replayBus'] === null : true; }));
  await p.context().close();
}

// ── Phones: the scene stays visible; essential controls fit ──
if (!only || only === 'mobile') {
  for (const [name, vp] of [['844x390', { width: 844, height: 390 }], ['390x844', { width: 390, height: 844 }], ['740x360', { width: 740, height: 360 }]]) {
    // Matches are played in landscape (the game asks to rotate); a replay can be watched either way.
    const portrait = vp.height > vp.width;
    const p = await open(portrait ? { width: vp.height, height: vp.width } : vp, { touch: true });
    await p.goto(base + '?nomenu3d&start=normal&ai=off');
    await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
    await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
    for (let r = 0; r < 2 && !(await p.evaluate(() => window.__dojang.session.world.phase === 'match-over')); r++) await koRound(p);
    await watch(p);
    if (portrait) await p.setViewportSize(vp);
    await p.waitForTimeout(800);
    const f = await p.evaluate(() => {
      const bar = document.querySelector('.replay-bar').getBoundingClientRect();
      const top = document.querySelector('.replay-top').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.replay-ui button, .replay-ui input')].filter((b) => b.getBoundingClientRect().width > 0);
      const small = btns.filter((b) => b.getBoundingClientRect().height < 40 && b.tagName === 'BUTTON').length;
      const out = btns.filter((b) => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1; }).length;
      return { sceneVisible: Math.round(bar.top - top.bottom), small, out, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    check(`${name}: controls fit, touch targets ≥ 40 px, the scene stays visible`, f.out === 0 && f.small === 0 && f.overflow <= 0 && f.sceneVisible > vp.height * 0.2, JSON.stringify(f));
    await p.tap('[data-testid="replay-cam-side"]');
    check(`${name}: tap switches the camera`, (await p.getAttribute('[data-testid="replay-cam-side"]', 'aria-checked')) === 'true');
    await shot(p, `mobile-${name}`);
    await p.context().close();
  }
}

check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
