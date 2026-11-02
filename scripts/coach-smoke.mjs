// Focused checks for the training coach. Usage (after `npm run build` and
// `npx vite preview --port 4173`): node scripts/coach-smoke.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const b = await chromium.launch();
const ready = (p) => p.waitForFunction(() => window.__dojang?.session?.ready && window.__dojang.session.training, null, { timeout: 90000 });
const tipId = (p) => p.evaluate(() => document.querySelector('[data-testid=coach-tip]')?.getAttribute('data-tip') ?? null);
const tipText = (p) => p.evaluate(() => document.querySelector('[data-testid=coach-tip] p')?.textContent ?? '');
/** Throw a kick from well out of range (a whiff), keeping the partner far away. */
const whiff = async (p, key) => {
  await p.evaluate(() => {
    const [a, c] = window.__dojang.session.world.fighters;
    a.x = 0; a.z = -2; c.x = 0; c.z = 2; a.stamina = 100;
  });
  await p.keyboard.press(key);
  await p.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'idle', null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(300);
};

// ── Desktop keyboard: intro, corrective tip, disable, manual hint ───
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '?nomenu3d');
  await p.click('[data-testid=mode-training]');
  await p.click('[data-testid=activity-body10]');
  await p.click('[data-testid=begin-activity]');
  await ready(p);
  await p.waitForSelector('[data-tip=intro]', { timeout: 15000 }).catch(() => {});
  const intro = await tipText(p);
  check('tips: Body challenge opens with its real objective', /10 valid kicks/.test(intro) && /40 s/.test(intro), intro);
  check('input: keyboard wording names the real key', /press L/.test(intro), intro);
  await whiff(p, 'KeyL');
  await whiff(p, 'KeyL');
  await p.waitForSelector('[data-tip=range]', { timeout: 8000 }).catch(() => {});
  check('tips: repeated misses from range give a distance correction', (await tipId(p)) === 'range', `${await tipId(p)}: ${await tipText(p)}`);
  check('tips: never more than one tip on screen', (await p.$$('[data-testid=coach-tip]')).length === 1);

  await p.click('[data-testid=coach-off]');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('dojang.settings.v1') ?? '{}').trainingTips);
  check('prefs: "Turn off tips" saves the setting', saved === false, String(saved));
  for (let i = 0; i < 4; i++) await whiff(p, 'KeyK');
  await p.waitForTimeout(5000);
  const after = await tipId(p);
  check('prefs: no automatic tips while disabled', after === null || after === 'note', String(after));
  await p.keyboard.press('KeyH');
  await p.waitForSelector('[data-tip=hint]', { timeout: 5000 }).catch(() => {});
  check('prefs: Hint (H) still works with tips off', (await tipId(p)) === 'hint', await tipText(p));
  await p.click('[data-testid=coach-dismiss]');
  check('tips: a tip can be dismissed', (await tipId(p)) === null);
  check('desktop: no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ── Phone landscape, Compact touch: wording and placement ───────────
{
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(base + '?nomenu3d');
  await p.tap('[data-testid=mode-training]');
  await p.tap('[data-testid=activity-head5]');
  await p.tap('[data-testid=begin-activity]');
  await ready(p);
  await p.waitForSelector('[data-tip=intro]', { timeout: 15000 }).catch(() => {});
  const t = await tipText(p);
  check('input: Compact touch wording names on-screen controls, no keys', /dashed ring|chip/.test(t) && !/press |hold E|Space/.test(t), t);
  const geo = await p.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const tip = r('[data-testid=coach-tip]');
    const hit = (a, c) => a && c && a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
    return { inView: !!tip && tip.left >= 0 && tip.right <= innerWidth && tip.bottom <= innerHeight, bar: hit(tip, r('.train-bar')), cluster: hit(tip, r('.cluster')), pause: hit(tip, r('.t-pause')), stick: hit(tip, r('.stick-base')) };
  });
  check('phone: tip clear of HUD bar, pause, joystick and buttons', geo.inView && !geo.bar && !geo.cluster && !geo.pause && !geo.stick, JSON.stringify(geo));
  await p.screenshot({ path: 'docs/media/ui-system/coach-tip-mobile.jpg', quality: 80 });
  await ctx.close();
}
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
