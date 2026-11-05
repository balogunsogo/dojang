// Controller prompts with a simulated PlayStation pad (navigator.getGamepads is stubbed).
// Usage: npm run build && npx vite preview --port 4173, then node scripts/dev/gamepad-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const stub = () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  const pad = { id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [pad, null, null, null];
  window.__pad = (i, down) => (buttons[i].pressed = down);
};
const press = async (p, i) => {
  await p.evaluate((i) => window.__pad(i, true), i);
  await p.waitForTimeout(200);
  await p.evaluate((i) => window.__pad(i, false), i);
  await p.waitForTimeout(200);
};
const b = await chromium.launch();

// Desktop menus.
{
  const ctx = await b.newContext({ viewport: { width: 1100, height: 700 } });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false })));
  const p = await ctx.newPage();
  await p.goto(base + '?nomenu3d');
  await p.waitForSelector('[data-testid=hints]');
  check('keyboard hints before the pad is used', (await p.textContent('[data-testid=hints]')).includes('Enter'));
  await p.evaluate(() => window.dispatchEvent(new Event('gamepadconnected')));
  await press(p, 13); // D-pad down moves the menu
  const hints = await p.textContent('[data-testid=hints]');
  check('menu hints switch to PlayStation buttons', hints.includes('✕') && hints.includes('D-pad'), hints);
  await p.click('[data-testid=open-settings]');
  await press(p, 13);
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Control reference/i.test(b.textContent))?.click());
  await p.waitForSelector('[data-testid=gamepad-ref]');
  const ref = await p.textContent('[data-testid=gamepad-ref]');
  check('control reference shows PlayStation labels', ref.includes('□') && ref.includes('L1') && ref.includes('R3') && ref.includes('lock-on'), ref.slice(0, 120));
  await ctx.close();
}

// Phone with a controller: touch controls hide; R3 lock-on; D-pad down switches stance.
{
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false })));
  const p = await ctx.newPage();
  await p.goto(base + '?start=normal&ai=off&nomenu3d');
  await p.waitForSelector('[data-testid=touch-controls]', { timeout: 60000 });
  check('touch controls show before the pad is used', true);
  const lock0 = await p.evaluate(() => window.__dojang.session.camRig.lockOn);
  await press(p, 11); // R3
  await p.waitForTimeout(200);
  check('touch controls hide once the controller is used', !(await p.$('[data-testid=touch-controls]')));
  check('R3 toggles lock-on', (await p.evaluate(() => window.__dojang.session.camRig.lockOn)) !== lock0);
  await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
  const st0 = await p.evaluate(() => window.__dojang.session.world.fighters[0].stance);
  await press(p, 13); // D-pad down
  await p.waitForTimeout(600);
  check('D-pad down switches stance', (await p.evaluate(() => window.__dojang.session.world.fighters[0].stance)) !== st0);
  await p.touchscreen.tap(400, 150);
  await p.waitForTimeout(300);
  check('touching the screen brings the touch controls back', !!(await p.$('[data-testid=touch-controls]')));
  await ctx.close();
}
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
