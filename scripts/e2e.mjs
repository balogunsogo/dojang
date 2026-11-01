// Browser end-to-end checks with headless Chromium (software WebGL).
// Usage: node scripts/e2e.mjs [baseUrl] [--shots dir]
// Starts nothing itself: run `npm run preview` (or dev) first.
// Note: SwiftShader renders on the CPU, so frame rates here say nothing about
// real devices. Checks wait on simulation ticks, not wall-clock time.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4173/';
const shotIdx = args.indexOf('--shots');
const shots = shotIdx >= 0 ? args[shotIdx + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(ctxOpts, query, extraSettings = {}) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript((extra) => {
    try {
      if (sessionStorage.getItem('e2e-init')) return; // keep settings changed during the test
      sessionStorage.setItem('e2e-init', '1');
      localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', showPerf: true, volume: 0, forceTouch: false, ...extra }));
    } catch {}
  }, extraSettings);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + query);
  await page.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  return { ctx, page, errors };
}
const world = (page) =>
  page.evaluate(() => {
    const w = window.__dojang.session.world;
    return {
      phase: w.phase,
      tick: w.tick,
      round: w.round,
      wins: w.roundWins,
      f: w.fighters.map((f) => ({ x: f.x, z: f.z, hp: f.health, state: f.state, stamina: f.stamina, attack: f.attack?.move.id ?? null })),
      dist: Math.hypot(w.fighters[0].x - w.fighters[1].x, w.fighters[0].z - w.fighters[1].z),
    };
  });
const waitTicks = (page, n) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        const w = window.__dojang.session.world;
        const start = w.tick;
        const id = setInterval(() => {
          if (w.tick - start >= n) {
            clearInterval(id);
            res(undefined);
          }
        }, 20);
      }),
    n,
  );
const waitPhase = (page, phase) => page.waitForFunction((p) => window.__dojang.session.world.phase === p, phase, { timeout: 90000 });

// ---------------------------------------------------------------- desktop
{
  const { ctx, page, errors } = await open({ viewport: { width: 960, height: 540 } }, '?start=normal&ai=off');
  await waitPhase(page, 'fight');
  // Walk toward the opponent (camera-relative: D = screen right in the side-on lock-on view) until in kicking range.
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => {
    const [a, b] = window.__dojang.session.world.fighters;
    return Math.hypot(a.x - b.x, a.z - b.z) < 1.15;
  }, null, { timeout: 60000 });
  await page.keyboard.up('KeyD');
  const s0 = await world(page);
  check('desktop: D footwork closes distance', s0.dist < 1.15, `dist ${s0.dist.toFixed(2)}`);
  await waitTicks(page, 20);

  const techniques = [
    ['KeyL', 'round'],
    ['KeyK', 'front'],
    ['KeyU', 'side'],
    ['KeyJ', 'punch'],
    ['KeyI', 'back'],
  ];
  for (const [key, id] of techniques) {
    const before = await world(page);
    await page.keyboard.press(key);
    await page.waitForFunction((id) => window.__dojang.session.world.fighters[0].attack?.move.id === id, id, { timeout: 20000 }).catch(() => {});
    const mid = await world(page);
    if (id === 'round' && shots) {
      await waitTicks(page, 9);
      await page.screenshot({ path: `${shots}/desktop-roundhouse.jpg`, type: 'jpeg', quality: 80 });
    }
    await page.waitForFunction(() => {
      const f = window.__dojang.session.world.fighters;
      return f[0].state === 'idle' && f[1].state !== 'hitstun';
    }, null, { timeout: 30000 });
    const after = await world(page);
    check(`desktop: ${id} triggers technique and lands`, mid.f[0].attack === id && after.f[1].hp < before.f[1].hp, `hp ${before.f[1].hp}→${after.f[1].hp}`);
    // Step back into range if pushed away.
    if (after.dist > 1.05) {
      await page.keyboard.down('KeyD');
      await page.waitForFunction(() => {
        const [a, b] = window.__dojang.session.world.fighters;
        return Math.hypot(a.x - b.x, a.z - b.z) < 1.05;
      }, null, { timeout: 30000 }).catch(() => {});
      await page.keyboard.up('KeyD');
    }
    await page.evaluate(() => (window.__dojang.session.world.fighters[0].stamina = 100));
  }
  // Head kick with E modifier.
  await page.evaluate(() => (window.__dojang.session.world.events.length = 0));
  await page.keyboard.down('KeyE');
  await page.keyboard.press('KeyL');
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].attack?.height === 'head', null, { timeout: 20000 }).catch(() => {});
  const head = await page.evaluate(() => window.__dojang.session.world.fighters[0].attack?.height);
  await page.keyboard.up('KeyE');
  check('desktop: E + L throws a head-height roundhouse', head === 'head');

  // Guard: hold Space, opponent (driven via debug) kicks.
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'idle', null, { timeout: 20000 });
  await page.keyboard.down('Space');
  await waitTicks(page, 3);
  const g = await world(page);
  check('desktop: Space holds guard', g.f[0].state === 'guard');
  await page.keyboard.up('Space');
  // Pause.
  await page.keyboard.press('Escape');
  await page.waitForSelector('text=Paused', { timeout: 10000 });
  const t1 = (await world(page)).tick;
  await page.waitForTimeout(800);
  const t2 = (await world(page)).tick;
  check('desktop: Esc pauses the simulation', t1 === t2);
  await page.click('text=Resume');
  check('desktop: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ------------------------------------------------- AI exchange + result flow
{
  const { ctx, page, errors } = await open({ viewport: { width: 960, height: 540 } }, '?start=normal');
  await waitPhase(page, 'fight');
  // Player presses forward and attacks periodically; AI fights back.
  const keys = ['KeyL', 'KeyK', 'KeyJ', 'KeyU'];
  for (let i = 0; i < 24; i++) {
    await page.keyboard.down('KeyD');
    await waitTicks(page, 10);
    await page.keyboard.up('KeyD');
    await page.keyboard.press(keys[i % keys.length]);
    await waitTicks(page, 20);
    const s = await world(page);
    if (s.f[0].hp < 100 && s.f[1].hp < 100) break;
  }
  const s = await world(page);
  check('exchange: both fighters land techniques vs AI', s.f[0].hp < 100 && s.f[1].hp < 100, `hp ${s.f[0].hp} / ${s.f[1].hp}`);
  if (shots) await page.screenshot({ path: `${shots}/desktop-exchange.jpg`, type: 'jpeg', quality: 80 });
  // Force match point and a KO to reach the result screen.
  await page.evaluate(() => {
    const w = window.__dojang.session.world;
    w.roundWins[0] = w.rules.roundsToWin - 1;
    w.fighters[1].health = 0.5;
    w.fighters[1].x = w.fighters[0].x + Math.sin(w.fighters[0].yaw) * 0.95;
    w.fighters[1].z = w.fighters[0].z + Math.cos(w.fighters[0].yaw) * 0.95;
    w.fighters[0].stamina = 100;
  });
  const stopAi = await page.evaluate(() => {
    window.__dojang.session.ai.profile = { ...window.__dojang.session.ai.profile, aggression: 0, guardChance: 0, counterChance: 0, footwork: 0 };
    return true;
  });
  void stopAi;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('KeyJ');
    await waitTicks(page, 25);
    if ((await world(page)).phase === 'match-over') break;
  }
  await page.waitForSelector('[data-testid=result]', { timeout: 30000 }).catch(() => {});
  const res = await page.$('[data-testid=result]');
  check('flow: KO on match point shows the result screen', !!res);
  if (shots && res) await page.screenshot({ path: `${shots}/result.jpg`, type: 'jpeg', quality: 80 });
  if (res) {
    await page.click('[data-testid=rematch]');
    await waitTicks(page, 5);
    const r = await world(page);
    check('flow: rematch resets the match', r.round === 1 && r.f[1].hp === 100 && r.wins[0] === 0, `round ${r.round} hp ${r.f[1].hp}`);
  }
  check('exchange: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------- mobile (touch)
const PHONE = { viewport: { width: 852, height: 393 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };

async function touchKit(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
  const center = async (sel) => {
    const b = await page.$(sel);
    if (!b) return null;
    const box = await b.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  // Place the fighters in kicking range facing each other and refill stamina.
  const setRange = (gap = 1.0) =>
    page.evaluate((gap) => {
      const s = window.__dojang.session;
      const [a, b] = s.world.fighters;
      a.x = 0; a.z = 0; a.yaw = 0; b.x = 0; b.z = gap; b.yaw = Math.PI;
      a.stamina = b.stamina = 100;
      b.health = 100;
      s.world.events.length = 0;
    }, gap);
  const idle = () => page.waitForFunction(() => {
    const f = window.__dojang.session.world.fighters;
    return f[0].state === 'idle' && f[1].state !== 'hitstun' && f[1].state !== 'blockstun';
  }, null, { timeout: 30000 });
  const lastAttack = () => page.evaluate(() => {
    const f = window.__dojang.session.world.fighters[0];
    return { id: f.attack?.move.id ?? null, height: f.attack?.height ?? null };
  });
  return { touch, center, setRange, idle, lastAttack };
}

{
  const { ctx, page, errors } = await open(PHONE, '?start=normal&ai=off');
  await waitPhase(page, 'fight');
  const touchUi = await page.$('[data-testid=touch-controls].scheme-compact');
  check('compact: compact scheme is the default on a touch device', !!touchUi);
  const hudH = await page.evaluate(() => document.querySelector('.hud-top').getBoundingClientRect().height);
  check('compact: slim scoreboard on a phone (≤ 30 px)', hudH <= 30, `${hudH.toFixed(0)} px`);
  const { touch, center, setRange, idle, lastAttack } = await touchKit(ctx, page);

  // Joystick toward the opponent.
  const s0 = await world(page);
  const stick = { id: 1, x: 150, y: 290 };
  await touch('touchStart', [stick]);
  const dir = await page.evaluate(() => {
    const s = window.__dojang.session;
    const [a, b] = s.world.fighters;
    const yaw = s.camRig.viewYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const ux = b.x - a.x, uz = b.z - a.z;
    const m = Math.hypot(ux, uz);
    return { x: (ux * -fz + uz * fx) / m, y: (ux * fx + uz * fz) / m };
  });
  const moved = { id: 1, x: stick.x + dir.x * 48, y: stick.y - dir.y * 48 };
  await touch('touchMove', [moved]);
  await page.waitForFunction(() => {
    const [a, b] = window.__dojang.session.world.fighters;
    return Math.hypot(a.x - b.x, a.z - b.z) < 1.1;
  }, null, { timeout: 60000 }).catch(() => {});
  const s1 = await world(page);
  check('compact: joystick moves the fighter toward the opponent', s1.dist < s0.dist - 0.5, `dist ${s0.dist.toFixed(2)}→${s1.dist.toFixed(2)}`);

  // Stick + Guard held together.
  const guard = await center('[aria-label="Guard"]');
  await touch('touchStart', [moved, { id: 2, ...guard }]);
  await waitTicks(page, 4);
  const sg = await world(page);
  const stickHeld = await page.evaluate(() => window.__dojang.input.touch.moveX !== 0 || window.__dojang.input.touch.moveY !== 0);
  check('compact: simultaneous stick + guard (multitouch)', sg.f[0].state === 'guard' && stickHeld, `state ${sg.f[0].state}, stick ${stickHeld}`);
  await touch('touchEnd', [moved]);
  await touch('touchEnd', []);
  await waitTicks(page, 8);

  // Quick tap on Kick throws the selected technique (default roundhouse), while another finger orbits the camera.
  await setRange();
  const kick = await center('[data-testid=kick-main]');
  const yaw0 = await page.evaluate(() => window.__dojang.session.camRig.yaw);
  await touch('touchStart', [{ id: 4, x: 430, y: 150 }]);
  await touch('touchMove', [{ id: 4, x: 400, y: 150 }]);
  await touch('touchStart', [{ id: 4, x: 400, y: 150 }, { id: 3, ...kick }]);
  await touch('touchMove', [{ id: 4, x: 370, y: 152 }, { id: 3, ...kick }]);
  await touch('touchEnd', [{ id: 4, x: 370, y: 152 }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 10000 }).catch(() => {});
  const a1 = await lastAttack();
  if (shots) {
    await waitTicks(page, 9);
    await page.screenshot({ path: `${shots}/mobile-compact.jpg`, type: 'jpeg', quality: 80 });
  }
  await idle();
  const yaw1 = await page.evaluate(() => window.__dojang.session.camRig.yaw);
  const hp1 = (await world(page)).f[1].hp;
  check('compact: tap Kick throws the selected roundhouse and lands', a1.id === 'round' && hp1 < 100, `${a1.id}, hp ${hp1}`);
  check('compact: camera orbit in the open area during a Kick tap', Math.abs(yaw1 - yaw0) > 0.05, `yaw Δ ${(yaw1 - yaw0).toFixed(3)}`);

  // Slide from Kick to the left: wheel opens, release on Side selects and throws it.
  await setRange(1.1);
  await touch('touchStart', [{ id: 5, ...kick }]);
  await touch('touchMove', [{ id: 5, x: kick.x - 25, y: kick.y - 8 }]);
  const wheelOpen = !!(await page.$('[data-testid=kick-wheel]'));
  await touch('touchMove', [{ id: 5, x: kick.x - 70, y: kick.y - 22 }]);
  if (shots) await page.screenshot({ path: `${shots}/mobile-wheel.jpg`, type: 'jpeg', quality: 80 });
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 10000 }).catch(() => {});
  const a2 = await lastAttack();
  const sel = await page.evaluate(() => JSON.parse(localStorage.getItem('dojang.settings.v1')).selectedKick);
  check('compact: sliding from Kick opens the technique wheel', wheelOpen);
  check('compact: releasing on Side throws a side kick and selects it', a2.id === 'side' && sel === 'side', `attack ${a2.id}, selected ${sel}`);
  await idle();

  // The selection persists: a plain tap now repeats the side kick.
  await setRange(1.1);
  await touch('touchStart', [{ id: 6, ...kick }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 10000 }).catch(() => {});
  const a3 = await lastAttack();
  check('compact: selected technique repeats on tap without reopening the wheel', a3.id === 'side', `${a3.id}`);
  const label = await page.$eval('[data-testid=kick-main] .l', (e) => e.textContent);
  check('compact: Kick button shows the selected technique', label === 'Side', label);
  await idle();

  // Slide up past the outer ring: head-height front kick.
  await setRange(0.95);
  await touch('touchStart', [{ id: 7, ...kick }]);
  await touch('touchMove', [{ id: 7, x: kick.x, y: kick.y - 40 }]);
  await touch('touchMove', [{ id: 7, x: kick.x + 2, y: kick.y - 165 }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 10000 }).catch(() => {});
  const a4 = await lastAttack();
  check('compact: slide past the outer ring throws a head kick', a4.id === 'front' && a4.height === 'head', `${a4.id} ${a4.height}`);
  await idle();

  // Head/Body chip, Punch, stance switch.
  const chip = await center('[aria-label="Target height"]');
  await touch('touchStart', [{ id: 8, ...chip }]);
  await touch('touchEnd', []);
  await setRange(0.9);
  await touch('touchStart', [{ id: 9, ...kick }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 10000 }).catch(() => {});
  const a5 = await lastAttack();
  check('compact: Head chip makes the Kick button aim high', a5.height === 'head', `${a5.id} ${a5.height}`);
  await idle();
  await touch('touchStart', [{ id: 8, ...chip }]);
  await touch('touchEnd', []);
  const punch = await center('[aria-label="Punch"]');
  await touch('touchStart', [{ id: 10, ...punch }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].attack?.move.id === 'punch', null, { timeout: 10000 }).catch(() => {});
  check('compact: Punch button throws a punch', (await lastAttack()).id === 'punch');
  await idle();
  const stance0 = await page.evaluate(() => window.__dojang.session.world.fighters[0].stance);
  const sw = await center('[aria-label="Switch stance"]');
  await touch('touchStart', [{ id: 11, ...sw }]);
  await touch('touchEnd', []);
  await waitTicks(page, 14);
  const stance1 = await page.evaluate(() => window.__dojang.session.world.fighters[0].stance);
  check('compact: stance switch button changes stance', stance0 !== stance1, `${stance0}→${stance1}`);
  check('compact: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

{
  const { ctx, page, errors } = await open(PHONE, '?start=normal&ai=off', { controlScheme: 'classic' });
  await waitPhase(page, 'fight');
  check('classic: classic scheme can be selected', !!(await page.$('[data-testid=touch-controls].scheme-classic')));
  const { touch, center, setRange, idle, lastAttack } = await touchKit(ctx, page);
  for (const [label, id] of [['Front', 'front'], ['Round', 'round'], ['Side', 'side'], ['Back', 'back']]) {
    await setRange(1.0);
    const b = await center(`[aria-label="${label}"]`);
    await touch('touchStart', [{ id: 1, ...b }]);
    await touch('touchEnd', []);
    await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 10000 }).catch(() => {});
    const a = await lastAttack();
    await idle();
    const hp = (await world(page)).f[1].hp;
    check(`classic: ${label} button lands`, a.id === id && hp < 100, `${a.id}, hp ${hp}`);
  }
  if (shots) await page.screenshot({ path: `${shots}/mobile-classic.jpg`, type: 'jpeg', quality: 80 });
  check('classic: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.goto(base + 'manifest.webmanifest');
  const m = res && res.ok() ? await res.json() : null;
  const icon = await page.goto(base + 'icons/icon-192.png');
  check('pwa: manifest and icons are served', !!m && m.display === 'fullscreen' && !!icon?.ok(), m ? `display ${m.display}` : 'missing');
  await ctx.close();
}

// ------------------------------------------------------- portrait prompt
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, '?start=normal&ai=off');
  const prompt = await page.waitForSelector('[data-testid=rotate-prompt]', { timeout: 10000 }).catch(() => null);
  check('portrait: rotate prompt shown', !!prompt);
  if (shots) await page.screenshot({ path: `${shots}/mobile-portrait.jpg`, type: 'jpeg', quality: 80 });
  await page.click('text=Continue in portrait').catch(() => {});
  const gone = !(await page.$('[data-testid=rotate-prompt]'));
  check('portrait: prompt can be dismissed', gone);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
