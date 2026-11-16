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

check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
