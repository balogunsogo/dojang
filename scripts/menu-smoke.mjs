// Phase 7 focused smoke check: menu navigation, transitions into play and
// back, and one phone-sized layout pass. Usage (after `npm run build` and
// `npx vite preview --port 4173`): node scripts/menu-smoke.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = 'docs/media/phase7';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const b = await chromium.launch();
const ready = (p) => p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
const back = (p) => p.click('[data-testid=menu-back]');

// ── Desktop ──────────────────────────────────────────────────────────
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base);
  await p.waitForSelector('.main-nav');
  const labels = await p.$$eval('.nav-item .label', (els) => els.map((e) => e.textContent));
  check('desktop: six primary menu items', labels.length === 6 && /Training/.test(labels[0]) && labels.includes('Settings & Controls'), labels.join(' | '));
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  check('desktop: arrow keys move the selection', (await p.$eval('.nav-item.active .label', (e) => e.textContent)) === 'Competitive Sparring');
  await p.waitForSelector('.menu-backdrop.live', { timeout: 30000 }).catch(() => {});
  check('desktop: live dojang backdrop rendered', !!(await p.$('.menu-backdrop.live')));

  await p.click('[data-testid=open-fighter]');
  await p.click('[data-testid=fighter-hana]');
  check('desktop: fighter selection reflects choice', /Park Ha-na/.test(await p.textContent('.fighter-tabs .ftab.on')));
  await back(p);
  check('desktop: home shows the chosen fighter', /Park Ha-na/.test(await p.textContent('[data-testid=current-fighter]')));
  await p.click('[data-testid=open-fighter]');
  await p.click('[data-testid=fighter-jae]');
  await back(p);

  await p.click('[data-testid=open-progress]');
  check('desktop: belt track shows White, Yellow, Green', (await p.$$('.belt-track li')).length === 3 && !!(await p.$('.belt-track li.current')));
  await back(p);
  await p.click('[data-testid=open-settings]');
  const hasSettings = !!(await p.$('[data-testid=settings-panel]'));
  await p.click('.options .seg2 button:nth-child(2)');
  check('desktop: settings and controls tabs', hasSettings && !!(await p.$('.controls-help')));
  await back(p);

  await p.click('[data-testid=mode-training]');
  check('desktop: training lists 9 activities + recommendation', (await p.$$('.act-row')).length === 9 && !!(await p.$('[data-testid=continue-training]')));
  await p.waitForTimeout(1500); // let the camera settle on the training shot
  await p.screenshot({ path: `${out}/after-training-desktop.jpg`, quality: 80 });
  await back(p);

  await p.click('[data-testid=mode-competitive]');
  await p.click('[data-testid=round-120]');
  await p.click('[data-testid=opp-hard]');
  await p.click('[data-testid=start-match]');
  await ready(p);
  const m = await p.evaluate(() => ({ rules: window.__dojang.session.world.rules.id, secs: window.__dojang.session.world.secondsLeft, canvases: document.querySelectorAll('canvas').length }));
  check('desktop: Start match enters a Competitive 120 s match', m.rules === 'competitive' && m.secs >= 115, JSON.stringify(m));
  check('desktop: one WebGL canvas during play (menu stage disposed)', m.canvases === 1, `${m.canvases}`);
  await p.waitForSelector('[data-testid=hud]');
  await p.keyboard.press('Escape');
  await p.waitForSelector('[aria-label=Paused]');
  await p.click('text=Main menu');
  await p.waitForSelector('.main-nav');
  check('desktop: pause → main menu returns home', true);

  await p.click('[data-testid=mode-training]');
  await p.click('[data-testid=activity-practice]');
  await ready(p);
  check('desktop: activity row starts training', await p.evaluate(() => !!window.__dojang.session.training));
  check('desktop: no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ── Phone (portrait menu, then into a match) ────────────────────────
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base);
  await p.waitForSelector('.main-nav');
  await p.waitForSelector('.menu-backdrop.live', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/after-home-mobile.jpg`, quality: 80 });
  const boxes = await p.$$eval('.nav-item', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, h: r.height })));
  check('phone: all menu items on screen, ≥ 44 px tall', boxes.every((r) => r.top >= 0 && r.bottom <= 844 && r.h >= 44), JSON.stringify(boxes));
  await p.tap('[data-testid=open-progress]');
  await p.waitForSelector('.sheet');
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/after-progress-mobile.jpg`, quality: 80 });
  const sheet = await p.$eval('.sheet', (e) => e.getBoundingClientRect().width);
  check('phone: panels open as a full-width bottom sheet', Math.abs(sheet - 390) < 2, `${sheet}`);
  await p.tap('[data-testid=menu-back]');
  await p.tap('[data-testid=mode-arcade]');
  await p.tap('[data-testid=start-match]');
  await ready(p);
  check('phone: Start match enters Arcade by touch', await p.evaluate(() => window.__dojang.session.world.rules.id === 'arcade'));
  const noOverflow = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('phone: no horizontal overflow', noOverflow);
  check('phone: no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
