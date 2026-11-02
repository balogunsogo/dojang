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

// E2E_ONLY=comma,separated,section,names runs a subset (desktop, exchange, compact, classic, pwa, competitive, competitive-mobile, portrait).
const ONLY = process.env.E2E_ONLY?.split(',') ?? null;
const runs = (name) => !ONLY || ONLY.includes(name);
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
if (runs('desktop')) {
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
if (runs('exchange')) {
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

if (runs('compact')) {
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
  await touch('touchMove', [{ id: 5, x: kick.x - 60, y: kick.y - 20 }]);
  await touch('touchMove', [{ id: 5, x: kick.x - 110, y: kick.y - 36 }]);
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

  // Inner ring: lead-leg roundhouse, then it repeats on tap.
  await setRange(1.05);
  await touch('touchStart', [{ id: 12, ...kick }]);
  await touch('touchMove', [{ id: 12, x: kick.x - 20, y: kick.y - 20 }]);
  await touch('touchMove', [{ id: 12, x: kick.x - 42, y: kick.y - 42 }]);
  if (shots) await page.screenshot({ path: `${shots}/mobile-wheel-lead.jpg`, type: 'jpeg', quality: 80 });
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 10000 }).catch(() => {});
  const a6 = await lastAttack();
  await idle();
  const hpLead = (await world(page)).f[1].hp;
  check('compact: inner ring throws the lead-leg roundhouse and lands', a6.id === 'leadRound' && hpLead < 100, `${a6.id}, hp ${hpLead}`);
  await setRange(1.05);
  await touch('touchStart', [{ id: 13, ...kick }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 10000 }).catch(() => {});
  check('compact: lead-leg selection persists on tap', (await lastAttack()).id === 'leadRound');
  await idle();
  check('compact: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

if (runs('classic')) {
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
  // Rear/Lead chip turns Round into the lead-leg roundhouse.
  const leadChip = await center('[aria-label="Kicking leg"]');
  await touch('touchStart', [{ id: 2, ...leadChip }]);
  await touch('touchEnd', []);
  await setRange(1.05);
  const rb = await center('[aria-label="Round"]');
  await touch('touchStart', [{ id: 3, ...rb }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 10000 }).catch(() => {});
  check('classic: Lead chip switches Round to the lead-leg roundhouse', (await lastAttack()).id === 'leadRound');
  await idle();
  if (shots) await page.screenshot({ path: `${shots}/mobile-classic.jpg`, type: 'jpeg', quality: 80 });
  check('classic: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

if (runs('pwa')) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.goto(base + 'manifest.webmanifest');
  const m = res && res.ok() ? await res.json() : null;
  const icon = await page.goto(base + 'icons/icon-192.png');
  check('pwa: manifest and icons are served', !!m && m.display === 'fullscreen' && !!icon?.ok(), m ? `display ${m.display}` : 'missing');
  await ctx.close();
}

// ------------------------------------- Phase 3 gate: full match by touch only
if (runs('mobile-gate')) {
  const { ctx, page, errors } = await open(PHONE, '?start=normal&ai=off', { leftHanded: true, controlScale: 1.1, controlOpacity: 0.5 });
  await waitPhase(page, 'fight');
  const { touch, center, setRange, idle, lastAttack } = await touchKit(ctx, page);
  const vw = PHONE.viewport.width;
  const kick = await center('[data-testid=kick-main]');
  check('mobile gate: left-handed layout puts the Kick button on the left', kick.x < vw / 2, `x ${Math.round(kick.x)}`);
  // Mirrored wheel: slide toward the screen centre (right) to reach Side.
  await setRange(1.15);
  await touch('touchStart', [{ id: 1, ...kick }]);
  await touch('touchMove', [{ id: 1, x: kick.x + 60, y: kick.y - 20 }]);
  await touch('touchMove', [{ id: 1, x: kick.x + 110, y: kick.y - 36 }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 10000 }).catch(() => {});
  check('mobile gate: mirrored wheel selects Side', (await lastAttack()).id === 'side');
  await idle();
  // Pause and resume by touch.
  const pause = await center('[aria-label="Pause"]');
  await touch('touchStart', [{ id: 2, ...pause }]);
  await touch('touchEnd', []);
  await page.waitForSelector('text=Paused', { timeout: 5000 }).catch(() => {});
  const resume = await center('text=Resume');
  check('mobile gate: pause button opens the pause menu', !!resume);
  if (resume) {
    await touch('touchStart', [{ id: 3, ...resume }]);
    await touch('touchEnd', []);
  }
  await page.waitForSelector('text=Paused', { state: 'detached', timeout: 5000 }).catch(() => {});
  check('mobile gate: Resume by touch continues the match', !(await page.$('text=Paused')));
  // Finish the match by touch: two knockouts (health lowered to keep the test short).
  for (let r = 0; r < 2; r++) {
    await page.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
    await setRange(1.0);
    await page.evaluate(() => (window.__dojang.session.world.fighters[1].health = 3));
    const k = await center('[data-testid=kick-main]');
    await touch('touchStart', [{ id: 4, ...k }]);
    await touch('touchEnd', []);
    await page.waitForFunction(() => ['round-over', 'match-over'].includes(window.__dojang.session.world.phase), null, { timeout: 20000 }).catch(() => {});
  }
  await page.waitForSelector('[data-testid=rematch]', { timeout: 30000 }).catch(() => {});
  const rm = await center('[data-testid=rematch]');
  check('mobile gate: match finished by touch shows the result', !!rm);
  if (rm) {
    await touch('touchStart', [{ id: 5, ...rm }]);
    await touch('touchEnd', []);
    await page.waitForFunction(() => window.__dojang.session.world.round === 1 && window.__dojang.session.world.fighters[1].health === 100, null, { timeout: 10000 }).catch(() => {});
  }
  check('mobile gate: Rematch by touch restarts', await page.evaluate(() => window.__dojang.session.world.round === 1 && window.__dojang.session.world.matchWinner === null));
  if (shots) await page.screenshot({ path: `${shots}/mobile-lefty.jpg`, type: 'jpeg', quality: 80 });
  check('mobile gate: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ------------------------------------------------ competitive: full match
if (runs('competitive')) {
  const { ctx, page, errors } = await (async () => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    await ctx.addInitScript(() => {
      try {
        if (sessionStorage.getItem('e2e-init')) return;
        sessionStorage.setItem('e2e-init', '1');
        localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', showPerf: false, volume: 0 }));
      } catch {}
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(base + '?ai=off');
    return { ctx, page, errors };
  })();
  // Menu: choose Competitive Sparring, then a difficulty.
  await page.click('[data-testid=mode-competitive]');
  await page.selectOption('[data-testid=round-length]', '120');
  await page.click('[data-testid=start-normal]');
  await page.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await waitPhase(page, 'fight');
  const len = await page.evaluate(() => window.__dojang.session.competitive.cfg.roundSeconds);
  const clock = await page.$eval('[data-testid=clock] .time', (e) => Number(e.textContent));
  check('competitive: 120 s round length selected in the menu drives the clock', len === 120 && clock > 100 && clock <= 120, `cfg ${len}, clock ${clock}`);
  check('competitive: started from the menu with competitive rules', await page.evaluate(() => window.__dojang.session.world.rules.id === 'competitive'));
  const setRange = (gap) =>
    page.evaluate((gap) => {
      const [a, b] = window.__dojang.session.world.fighters;
      a.x = 0; a.z = 0; a.yaw = 0; b.x = 0; b.z = gap; b.yaw = Math.PI;
      a.stamina = b.stamina = 100;
    }, gap);
  const settle = () => page.waitForFunction(() => {
    const w = window.__dojang.session.world;
    return w.phase === 'fight' && w.fighters[0].state === 'idle' && w.fighters[1].state === 'idle';
  }, null, { timeout: 30000 });
  /** Throw a technique (with optional held modifiers) and wait until it has started and finished. */
  const throwKey = async (key, mods = []) => {
    const serial = await page.evaluate(() => window.__dojang.session.world.fighters[0].attackSerial);
    for (const m of mods) await page.keyboard.down(m);
    await page.keyboard.press(key);
    for (const m of mods) await page.keyboard.up(m);
    await page.waitForFunction((s) => window.__dojang.session.world.fighters[0].attackSerial > s, serial, { timeout: 15000 }).catch(() => {});
    const id = await page.evaluate(() => window.__dojang.session.world.fighters[0].attack?.move.id ?? null);
    await settle();
    return id;
  };
  // The HUD publishes at 12 Hz: wait until the scoreboard shows the simulation's points.
  const score = async (i) => {
    await page
      .waitForFunction((i) => Number(document.querySelector(`[data-testid=score-${i}]`)?.textContent) === window.__dojang.session.world.points[i], i, { timeout: 5000 })
      .catch(() => {});
    return page.$eval(`[data-testid=score-${i}]`, (e) => Number(e.textContent));
  };

  await setRange(1.0);
  await throwKey('KeyL');
  const s1 = await score(0);
  check('competitive: body roundhouse scores +2 on the scoreboard', s1 === 2, `${s1}`);
  if (shots) await page.screenshot({ path: `${shots}/competitive-desktop.jpg`, type: 'jpeg', quality: 80 });

  await setRange(0.95);
  await throwKey('KeyL', ['KeyE']);
  const s2 = await score(0);
  check('competitive: head roundhouse adds +3', s2 === 5, `${s2}`);

  await setRange(1.0);
  await throwKey('KeyI', ['KeyE']);
  const s3 = await score(0);
  check('competitive: turning head kick (back kick) adds +6', s3 === 11, `${s3}`);

  await setRange(1.05);
  const leadId = await throwKey('KeyL', ['KeyF']);
  const s4 = await score(0);
  check('competitive: F + L throws the lead roundhouse and scores +2', leadId === 'leadRound' && s4 === 13, `${leadId} ${s4}`);

  // Penalty: step over the boundary line.
  await page.evaluate(() => {
    const f = window.__dojang.session.world.fighters[0];
    f.x = 0;
    f.z = -3.95;
  });
  await page.waitForSelector('[data-testid=gj-0]', { timeout: 10000 }).catch(() => {});
  const gj = await page.$('[data-testid=gj-0]');
  const opp = await score(1);
  check('competitive: crossing the boundary gives a gam-jeom (+1 to the opponent)', !!gj && opp === 1, `opp ${opp}`);
  if (shots) await page.screenshot({ path: `${shots}/competitive-penalty.jpg`, type: 'jpeg', quality: 80 });

  // Finish rounds 1 and 2 on time (player ahead) to win 2-0.
  for (let r = 0; r < 2; r++) {
    await page.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
    if (r === 1) {
      await setRange(1.0);
      await throwKey('KeyK');
    }
    await page.evaluate(() => (window.__dojang.session.world.roundTicksLeft = 2));
    await page.waitForFunction(() => ['round-over', 'match-over'].includes(window.__dojang.session.world.phase), null, { timeout: 30000 });
  }
  await page.waitForSelector('[data-testid=comp-summary]', { timeout: 30000 }).catch(() => {});
  const summary = await page.$eval('[data-testid=comp-summary]', (e) => e.textContent).catch(() => '');
  check('competitive: result screen shows rounds, techniques and penalties', /R1/.test(summary) && /R2/.test(summary) && /Turning head kick/.test(summary) && /Crossing the boundary line/.test(summary), summary.slice(0, 120));
  const winner = await page.evaluate(() => window.__dojang.session.world.matchWinner);
  const rounds = await page.evaluate(() => window.__dojang.session.world.round);
  check('competitive: player wins the match 2-0 in two rounds (no extra round)', winner === 0 && rounds === 2, `winner ${winner}, rounds ${rounds}`);
  if (shots) await page.screenshot({ path: `${shots}/competitive-result.jpg`, type: 'jpeg', quality: 80 });
  await page.click('[data-testid=rematch]');
  await page.waitForFunction(() => window.__dojang.session.world.round === 1 && window.__dojang.session.world.points[0] === 0, null, { timeout: 10000 }).catch(() => {});
  const rr = await page.evaluate(() => ({ r: window.__dojang.session.world.round, p: [...window.__dojang.session.world.points], h: window.__dojang.session.competitive.history.length }));
  check('competitive: rematch resets rounds, points and history', rr.r === 1 && rr.p[0] === 0 && rr.h === 0, JSON.stringify(rr));
  await page.waitForSelector('[data-testid=result]', { state: 'detached', timeout: 10000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForSelector('text=Paused', { timeout: 10000 });
  await page.click('.panel >> text=Main menu');
  const menu = await page.waitForSelector('[data-testid=mode-competitive]', { timeout: 10000 }).catch(() => null);
  check('competitive: return to the main menu', !!menu);
  check('competitive: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

if (runs('competitive-mobile')) {
  const { ctx, page, errors } = await open(PHONE, '?start=normal&mode=competitive');
  await waitPhase(page, 'fight');
  await waitTicks(page, 200);
  const info = await page.evaluate(() => ({
    hud: document.querySelector('.hud-top').getBoundingClientRect().height,
    scores: document.querySelectorAll('.hud-top .pts').length,
    scheme: !!document.querySelector('.scheme-compact'),
  }));
  check('competitive mobile: compact HUD stays slim with scores (≤ 30 px)', info.hud <= 30 && info.scores === 2 && info.scheme, JSON.stringify(info));
  if (shots) await page.screenshot({ path: `${shots}/competitive-mobile.jpg`, type: 'jpeg', quality: 80 });
  check('competitive mobile: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ------------------------------------------------------- portrait prompt
if (runs('portrait')) {
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
