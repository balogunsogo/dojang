// Focused audio checks (automated; this does not judge how things sound).
// Usage: npm run build && npx vite preview --port 4173, then
//   node scripts/dev/audio-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });

// ── Desktop: categories, settings ────────────────────────────────────
{
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '?start=normal&ai=off&nomenu3d');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  check('audio stays locked before any gesture', (await p.evaluate(() => window.__audio.state)) === 'locked');
  await p.mouse.click(640, 400);
  await p.waitForFunction(() => window.__audio.state === 'running', null, { timeout: 5000 }).catch(() => {});
  check('a click unlocks audio (context running)', (await p.evaluate(() => window.__audio.state)) === 'running');
  await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 30000 });
  await p.waitForTimeout(800);

  const run = async (label, setup, key) => {
    await p.evaluate(setup);
    await p.evaluate(() => {
      window.__audio.log.length = 0;
      window.__audio.logging = true;
    });
    await p.keyboard.press(key);
    await p.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'attack', null, { timeout: 5000 }).catch(() => {});
    await p.waitForFunction(() => window.__dojang.session.world.fighters[0].state !== 'attack', null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(700); // let scheduled whoosh/snap start
    return p.evaluate(() => [...window.__audio.log]);
  };
  const inRange = () => {
    const s = window.__dojang.session;
    const [a, c] = s.world.fighters;
    a.x = 0; a.z = -0.5; a.yaw = 0; c.x = 0; c.z = 0.5; c.yaw = Math.PI; a.stamina = 100;
  };
  const far = () => {
    const s = window.__dojang.session;
    const [a, c] = s.world.fighters;
    a.x = 0; a.z = -1.6; a.yaw = 0; c.x = 0; c.z = 1.6; c.yaw = Math.PI; a.stamina = 100;
  };
  const impacts = ['body', 'head', 'punch'];

  const hit = await run('hit', inRange, 'KeyL');
  check('landed roundhouse: whoosh + dobok snap + body impact, no block/whiff', hit.includes('whoosh') && hit.includes('snap') && hit.includes('body') && !hit.includes('block') && !hit.includes('whiff'), hit.join(','));
  const miss = await run('miss', far, 'KeyL');
  check('missed roundhouse: whoosh + whiff, no impact or block', miss.includes('whoosh') && miss.includes('whiff') && !miss.some((n) => impacts.includes(n)) && !miss.includes('block'), miss.join(','));
  // Opponent holds guard for the block case.
  await p.evaluate(() => {
    const s = window.__dojang.session;
    s.o.aiEnabled = true;
    s.ai.think = () => ({ moveX: 0, moveZ: 0, attack: null, guard: true, dash: false, switchStance: false, height: 'body' });
  });
  await p.waitForTimeout(300);
  const blocked = await run('block', inRange, 'KeyK');
  check('blocked front kick: whoosh + block, no impact', blocked.includes('whoosh') && blocked.includes('block') && !blocked.some((n) => impacts.includes(n)), blocked.join(','));
  await p.evaluate(() => {
    const s = window.__dojang.session;
    s.ai.think = () => ({ moveX: 0, moveZ: 0, attack: null, guard: false, dash: false, switchStance: false, height: 'body' });
  });
  await p.waitForTimeout(300);
  const punch = await run('punch', inRange, 'KeyJ');
  check('landed punch: fast whoosh + punch impact (no dobok snap)', punch.includes('whooshFast') && punch.includes('punch') && !punch.includes('snap'), punch.join(','));

  // Settings: mute and volume through the pause menu.
  await p.keyboard.press('Escape');
  await p.click('[data-testid=pause-settings]');
  const gain = () => p.evaluate(() => window.__audio['master'].gain.value);
  const setRange = (label, v) =>
    p.evaluate(([label, v]) => {
      const el = document.querySelector(`input[aria-label="${label}"]`);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [label, v]);
  await setRange('Master', 0.3);
  await p.waitForTimeout(200);
  check('master volume slider sets the output gain', Math.abs((await gain()) - 0.3) < 1e-6, String(await gain()));
  await p.click('label.setting-row.toggle:has-text("Mute")');
  await p.waitForTimeout(200);
  const muted = await p.evaluate(() => ({ g: window.__audio['master'].gain.value, room: !!window.__audio['roomTone'], saved: JSON.parse(localStorage.getItem('dojang.settings.v1')).muted }));
  check('mute silences output, stops the room tone and is saved', muted.g === 0 && !muted.room && muted.saved === true, JSON.stringify(muted));
  await p.click('label.setting-row.toggle:has-text("Mute")');
  await p.waitForTimeout(200);
  const un = await p.evaluate(() => ({ g: window.__audio['master'].gain.value, room: !!window.__audio['roomTone'] }));
  check('unmute restores volume and room tone', Math.abs(un.g - 0.3) < 1e-6 && un.room, JSON.stringify(un));
  check('desktop: no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ── Mobile (emulated touch phone): unlock on tap, menu cues ──────────
{
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(base + '?nomenu3d');
  await p.waitForSelector('.home-menu');
  await p.tap('[data-testid=mode-arcade]');
  await p.waitForFunction(() => window.__audio.state === 'running', null, { timeout: 5000 }).catch(() => {});
  check('mobile: first tap unlocks audio', (await p.evaluate(() => window.__audio.state)) === 'running');
  await p.evaluate(() => {
    window.__audio.log.length = 0;
    window.__audio.logging = true;
  });
  await p.tap('[data-testid=menu-back]');
  await p.tap('[data-testid=mode-training]');
  const log = await p.evaluate(() => [...window.__audio.log]);
  check('mobile: menu back/confirm cues play', log.includes('back') && log.includes('confirm'), log.join(','));
  await ctx.close();
}
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
