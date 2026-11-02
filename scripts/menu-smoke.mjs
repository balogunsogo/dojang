// Focused UI smoke check: menu navigation, transitions into play and back,
// and phone layouts. Usage (after `npm run build` and
// `npx vite preview --port 4173`): node scripts/menu-smoke.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = 'docs/media/ui-system';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const b = await chromium.launch();
const ready = (p) => p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
const settle = (p, ms = 1200) => p.waitForTimeout(ms);

// ── Desktop ──────────────────────────────────────────────────────────
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base);
  await p.waitForSelector('.home-menu');
  const tiers = await p.$$eval('.home-menu .menu-item', (els) => els.map((e) => [e.classList.contains('t1') ? 1 : 2, e.querySelector('.label').textContent]));
  check('desktop: two-tier home menu (3 play modes + 3 secondary)', tiers.length === 6 && tiers.filter(([t]) => t === 1).length === 3, JSON.stringify(tiers));
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  check('desktop: arrow keys move the current item', (await p.$eval('.menu-item.current .label', (e) => e.textContent)) === 'Competitive sparring');
  await p.evaluate(() => document.fonts.ready);
  const fonts = await p.evaluate(() => ({ display: document.fonts.check('300 40px Hahmlet'), ui: document.fonts.check('500 16px "IBM Plex Sans"') }));
  check('desktop: Hahmlet and IBM Plex Sans loaded (self-hosted)', fonts.display && fonts.ui, JSON.stringify(fonts));
  await p.waitForSelector('.menu-backdrop.live', { timeout: 30000 }).catch(() => {});
  check('desktop: live 3D dojang behind the menu', !!(await p.$('.menu-backdrop.live')));
  await settle(p);
  await p.screenshot({ path: `${out}/after-home-desktop.jpg`, quality: 82 });

  await p.click('[data-testid=open-fighter]');
  await p.click('[data-testid=fighter-hana]');
  check('desktop: fighter option row selects', /Ha-na/.test(await p.textContent('[data-testid=fighter-confirm]')));
  await p.keyboard.press('Escape');
  check('desktop: Esc returns home; footer shows the fighter', /Park Ha-na/.test(await p.textContent('[data-testid=current-fighter]')));
  await p.click('[data-testid=open-fighter]');
  await p.click('[data-testid=fighter-jae]');
  await p.click('[data-testid=menu-back]');

  await p.click('[data-testid=open-progress]');
  check('desktop: belt ladder with next-belt requirements', (await p.$$('.belt-ladder > li')).length === 3 && !!(await p.$('[data-testid=belt-reqs]')));
  await p.click('[data-testid=menu-back]');
  await p.click('[data-testid=open-settings]');
  const hasSettings = !!(await p.$('[data-testid=settings-panel]'));
  await p.click('[data-testid=open-controls]');
  check('desktop: settings and control reference', hasSettings && !!(await p.$('.controls-ref')));
  await p.keyboard.press('Escape');
  await p.click('[data-testid=menu-back]');

  await p.click('[data-testid=mode-training]');
  check('desktop: training lists 9 activities', (await p.$$('.option-row')).length === 9);
  await p.click('[data-testid=activity-head5]');
  check('desktop: selecting an activity updates the objective', /head/i.test(await p.textContent('.col-detail')));
  await p.click('[data-testid=menu-back]');

  await p.click('[data-testid=mode-competitive]');
  await p.click('[data-testid=round-120]');
  await p.click('[data-testid=opp-hard]');
  await settle(p);
  await p.screenshot({ path: `${out}/after-setup-desktop.jpg`, quality: 82 });
  await p.keyboard.press('Enter');
  await ready(p);
  const m = await p.evaluate(() => ({ rules: window.__dojang.session.world.rules.id, secs: window.__dojang.session.world.secondsLeft, canvases: document.querySelectorAll('canvas').length }));
  check('desktop: Enter starts a Competitive 2:00 match', m.rules === 'competitive' && m.secs >= 115, JSON.stringify(m));
  check('desktop: one WebGL canvas during play', m.canvases === 1, `${m.canvases}`);
  await p.waitForSelector('[data-testid=hud]');
  await p.keyboard.press('Escape');
  await p.waitForSelector('[aria-label=Paused]');
  await settle(p, 600);
  await p.screenshot({ path: `${out}/after-pause-desktop.jpg`, quality: 82 });
  check('desktop: pause menu lists real actions', /Resume.*Restart match.*Settings & controls.*Quit to menu/s.test(await p.textContent('[aria-label=Paused]')));
  await p.click('[data-testid=quit-to-menu]');
  await p.waitForSelector('.home-menu');
  check('desktop: Quit to menu returns home', true);

  await p.click('[data-testid=mode-training]');
  await p.click('[data-testid=activity-practice]');
  await p.click('[data-testid=begin-activity]');
  await ready(p);
  check('desktop: Begin starts the selected activity', await p.evaluate(() => window.__dojang.session.training?.activity.id === 'practice'));
  check('desktop: no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ── Phone: portrait menus, landscape menu, into a match ─────────────
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base);
  await p.waitForSelector('.home-menu');
  await p.waitForSelector('.menu-backdrop.live', { timeout: 30000 }).catch(() => {});
  await settle(p);
  await p.screenshot({ path: `${out}/after-home-mobile.jpg`, quality: 82 });
  const boxes = await p.$$eval('.home-menu .menu-item', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) })));
  check('phone portrait: all menu items on screen, ≥ 44 px', boxes.every((r) => r.top >= 0 && r.bottom <= 844 && r.h >= 44), JSON.stringify(boxes));
  check('phone portrait: no keyboard hints on touch', !(await p.$('.hints')));
  await p.tap('[data-testid=mode-arcade]');
  await p.waitForSelector('[data-testid=start-match]');
  await settle(p, 900);
  await p.screenshot({ path: `${out}/after-setup-mobile.jpg`, quality: 82 });
  const btn = await p.$eval('[data-testid=start-match]', (e) => e.getBoundingClientRect().bottom);
  check('phone portrait: Start match reachable on screen', btn <= 844, `${btn}`);
  const noOverflow = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('phone portrait: no horizontal overflow', noOverflow);
  await p.setViewportSize({ width: 844, height: 390 });
  await p.tap('[data-testid=menu-back]');
  await p.waitForSelector('.home-menu');
  await settle(p);
  await p.screenshot({ path: `${out}/after-home-landscape.jpg`, quality: 82 });
  const lb = await p.$$eval('.home-menu .menu-item', (els) => els.map((e) => e.getBoundingClientRect()).every((r) => r.top >= 0 && r.bottom <= 390 && r.right <= 844));
  check('phone landscape: whole menu fits without scrolling', lb);
  await p.tap('[data-testid=mode-arcade]');
  await p.tap('[data-testid=start-match]');
  await ready(p);
  check('phone: Start match enters Arcade by touch', await p.evaluate(() => window.__dojang.session.world.rules.id === 'arcade'));
  check('phone: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
