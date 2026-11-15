// Phase 10 fighter-selection input check (production build, live menu stage).
//   node scripts/dev/select-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch();
const errors = [];
const open = async (viewport, extra = {}) => {
  const ctx = await b.newContext({ viewport, ...extra });
  await ctx.addInitScript(() => {
    localStorage.setItem('dojang.progress.v1', JSON.stringify({ version: 1, fighter: 'jae', belt: 'yellow', completed: ['practice'], records: {}, landed: {}, matches: { played: 0, won: 0, wins: {} } }));
    // A stub gamepad the test can press.
    const btn = () => ({ pressed: false, value: 0 });
    window.__pad = { id: 'Stub pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, btn), axes: [0, 0, 0, 0], timestamp: 0 };
    navigator.getGamepads = () => [window.__pad];
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.stack || e.message));
  await p.goto(base);
  await p.waitForSelector('[data-testid=open-fighter]', { timeout: 30000 });
  return p;
};
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('dojang.progress.v1')).fighter);
const checked = (p) => p.evaluate(() => document.querySelector('.roster input:checked')?.value);

// Desktop, keyboard.
{
  const p = await open({ width: 1440, height: 900 });
  await p.waitForSelector('.menu-backdrop.live', { timeout: 90000 });
  await p.click('[data-testid=open-fighter]');
  await p.waitForSelector('.fighter-select');
  const order = await p.$$eval('.roster input', (els) => els.map((e) => e.value).join());
  check('roster order is jae, hana, tunde, sofia, minjun, amara', order === 'jae,hana,tunde,sofia,minjun,amara', order);
  await p.focus('.roster input:checked');
  await p.keyboard.press('ArrowDown');
  check('ArrowDown selects the next fighter and saves it', (await checked(p)) === 'hana' && (await saved(p)) === 'hana');
  // The swap happens behind the dim.
  await p.waitForTimeout(1000);
  await p.evaluate(() => { window.__dim = []; new MutationObserver(() => window.__dim.push(document.querySelector('[data-testid=stage-dim]').classList.contains('on'))).observe(document.querySelector('[data-testid=stage-dim]'), { attributes: true }); });
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(1000); // software rendering: frames are slow here
  const dims = await p.evaluate(() => window.__dim);
  const dimOn = dims.includes(true);
  const dimOff = dims.at(-1) === false;
  check('a fighter change dims the stage, then clears', dimOn && dimOff, JSON.stringify(dims));
  check('detail block shows the selected fighter', /Relentless pressure/.test(await p.textContent('[data-testid=fighter-detail]')) && /Fight as Tunde/.test(await p.textContent('[data-testid=fighter-confirm]')));
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('ArrowUp');
  check('ArrowUp wraps from the first to the last fighter', (await checked(p)) === 'amara', await checked(p));
  // Hover never swaps the model.
  await p.hover('[data-testid=fighter-sofia]');
  await p.waitForTimeout(200);
  check('hover does not change the selection', (await checked(p)) === 'amara' && (await saved(p)) === 'amara');
  // Rapid input: one swap at the end, no errors.
  for (let i = 0; i < 8; i++) await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(500);
  check('rapid input settles on the last choice (8 steps from Amara wraps to Ha-na)', (await checked(p)) === 'hana' && (await saved(p)) === 'hana', await checked(p));
  await p.keyboard.press('Escape');
  await p.waitForSelector('[data-testid=current-fighter]');
  check('Esc goes back; home footer and menu item show the fighter and belt', /Park Ha-na/.test(await p.textContent('[data-testid=current-fighter]')) && /Park Ha-na · Yellow belt/.test(await p.textContent('[data-testid=open-fighter]')));
  await p.click('[data-testid=open-fighter]');
  await p.focus('.roster input:checked');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-testid=spar-start], .screen:has(#t-spar), [data-testid=difficulty-normal]', { timeout: 5000 }).catch(() => {});
  check('Enter confirms and goes to sparring setup', !(await p.$('.fighter-select')));

  // Gamepad: D-pad down moves focus and selection follows it; B goes back.
  await p.keyboard.press('Escape');
  await p.click('[data-testid=open-fighter]');
  await p.focus('.roster input:checked');
  await p.evaluate(() => window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: window.__pad })));
  const press = async (i) => {
    await p.evaluate((i) => (window.__pad.buttons[i] = { pressed: true, value: 1 }), i);
    await p.waitForTimeout(120);
    await p.evaluate((i) => (window.__pad.buttons[i] = { pressed: false, value: 0 }), i);
    await p.waitForTimeout(120);
  };
  await press(13);
  check('gamepad D-pad down selects the next fighter (selection follows focus)', (await checked(p)) === 'tunde' && (await saved(p)) === 'tunde', await checked(p));
  await press(1);
  check('gamepad B goes back', !(await p.$('.fighter-select')));
  await p.context().close();
}

// Phone landscape: tap, left/right switch columns, no scrolling.
for (const vp of [{ width: 844, height: 390 }, { width: 740, height: 360 }]) {
  const p = await open(vp, { hasTouch: true, isMobile: true });
  await p.click('[data-testid=open-fighter]');
  await p.waitForSelector('.fighter-select');
  await p.tap('[data-testid=fighter-sofia]');
  check(`${vp.width}x${vp.height}: tap selects`, (await checked(p)) === 'sofia' && (await saved(p)) === 'sofia');
  await p.focus('.roster input:checked');
  await p.keyboard.press('ArrowRight');
  check(`${vp.width}x${vp.height}: Right jumps to the same row, other column`, (await checked(p)) === 'jae', await checked(p));
  const fit = await p.evaluate(() => { const b = document.querySelector('.fighter-select .screen-body'); const btn = document.querySelector('[data-testid=fighter-confirm]').getBoundingClientRect(); return { scroll: b.scrollHeight - b.clientHeight, over: document.documentElement.scrollWidth - innerWidth, btnBottom: btn.bottom, h: innerHeight, back: document.querySelector('.btn-back').getAttribute('aria-label') }; });
  check(`${vp.width}x${vp.height}: nothing scrolls; button pinned on screen; icon back is labelled`, fit.scroll <= 0 && fit.over <= 0 && fit.btnBottom <= fit.h && fit.back === 'Back to menu', JSON.stringify(fit));
  await p.context().close();
}

// Reduced motion: no dim.
{
  const p = await open({ width: 1280, height: 800 }, { reducedMotion: 'reduce' });
  await p.waitForSelector('.menu-backdrop.live', { timeout: 90000 });
  await p.click('[data-testid=open-fighter]');
  await p.focus('.roster input:checked');
  await p.waitForTimeout(300);
  await p.keyboard.press('ArrowDown');
  const dim = await p.$eval('[data-testid=stage-dim]', (e) => e.classList.contains('on'));
  check('reduced motion: fighter change swaps instantly (no dim)', !dim && (await checked(p)) === 'hana');
  await p.context().close();
}
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
