// Touch controls must recover when a release never reaches the control
// (system gesture, notification). Usage: node scripts/dev/touch-stuck-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false })));
const p = await ctx.newPage();
await p.goto(base + '?start=normal&ai=off&nomenu3d');
await p.waitForSelector('[data-testid=kick-main]', { timeout: 60000 });
const box = await p.locator('[data-testid=kick-main]').boundingBox();
const x = box.x + box.width / 2;
const y = box.y + box.height / 2;
const cdp = await ctx.newCDPSession(p);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
await p.evaluate(() => window.addEventListener('pointerdown', (e) => (window.__lastId = e.pointerId), true));
const lostRelease = (type) =>
  p.evaluate((type) => window.dispatchEvent(type === 'blur' ? new Event('blur') : new PointerEvent(type, { pointerId: window.__lastId, pointerType: 'touch' })), type);

// Hold the Kick button until the wheel opens, then lose the release.
await touch('touchStart', [{ x, y, id: 1 }]);
await p.waitForTimeout(900);
check('holding Kick opens the technique wheel', !!(await p.$('[data-testid=kick-wheel]')));
await lostRelease('pointercancel');
await p.waitForTimeout(100);
check('a release the button never saw closes the wheel', !(await p.$('[data-testid=kick-wheel]')));
await touch('touchEnd', []);
// The button works again afterwards.
await p.evaluate(() => (window.__dojang.session.world.fighters[0].stamina = 100));
await touch('touchStart', [{ x, y, id: 2 }]);
await touch('touchEnd', []);
await p.waitForTimeout(150);
check('Kick taps work again afterwards', (await p.evaluate(() => window.__dojang.session.world.fighters[0].state)) === 'attack');
// App switch while the wheel is open.
await p.waitForTimeout(1500);
await touch('touchStart', [{ x, y, id: 3 }]);
await p.waitForTimeout(900);
const opened = !!(await p.$('[data-testid=kick-wheel]'));
await lostRelease('blur');
await p.waitForTimeout(100);
check('leaving the app closes an open wheel', opened && !(await p.$('[data-testid=kick-wheel]')));
await touch('touchEnd', []);
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
