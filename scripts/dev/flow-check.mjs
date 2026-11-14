// End-of-activity and end-of-match flows: Retry, Next, Rematch and back-to-menu must
// leave the player in a working state (no stuck panels, input works).
// Usage: npm run build && npx vite preview --port 4173, then node scripts/dev/flow-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch();
const page = async () => {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 600 } });
  await ctx.addInitScript(() => localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false })));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => check('no page errors', false, e.message));
  return p;
};
const ready = (p) => p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
const attackWorks = (p) =>
  p.evaluate(async () => {
    const s = window.__dojang.session;
    const f = s.world.fighters[0];
    f.stamina = 100;
    const before = f.attackSerial;
    window.__dojang.input.press('round');
    for (let i = 0; i < 30 && f.attackSerial === before; i++) await new Promise((r) => setTimeout(r, 50));
    return f.attackSerial > before;
  });

// ── Training: finish, Retry, finish again, Next.
{
  const p = await page();
  await p.goto(`${base}?nomenu3d`);
  await p.click('[data-testid=mode-training]');
  await p.click('[data-testid=begin-activity]');
  await ready(p);
  await p.evaluate(() => window.__dojang.session.finishTraining());
  await p.waitForSelector('[data-testid=training-summary]', { timeout: 5000 });
  check('training: the summary appears when the activity ends', true);
  await p.click('[data-testid=retry-activity]');
  await p.waitForTimeout(500);
  const stuck = !!(await p.$('[data-testid=training-summary]'));
  check('training: Retry closes the summary and restarts the activity', !stuck && !(await p.evaluate(() => window.__dojang.session.training.finished)));
  check('training: controls work after Retry', await attackWorks(p));
  await p.evaluate(() => window.__dojang.session.finishTraining());
  await p.waitForSelector('[data-testid=training-summary]', { timeout: 5000 }).catch(() => {});
  check('training: finishing again shows the summary again', !!(await p.$('[data-testid=training-summary]')));
  const nextId = await p.evaluate(() => window.__dojang.session.training.activity.id);
  await p.click('[data-testid=next-activity]');
  await p.waitForFunction((id) => window.__dojang?.session?.ready && window.__dojang.session.training?.activity.id !== id, nextId, { timeout: 60000 });
  check('training: Next starts the next activity with no summary', !(await p.$('[data-testid=training-summary]')));
  check('training: controls work after Next', await attackWorks(p));
  await p.context().close();
}

// ── Arcade: match over, Rematch, controls work; Back to menu.
{
  const p = await page();
  await p.goto(`${base}?start=normal&ai=off&nomenu3d`);
  await ready(p);
  await p.evaluate(() => { const w = window.__dojang.session.world; w.roundWins = [1, 0]; w.endRound(0, 'ko'); });
  await p.waitForSelector('[data-testid=result]', { timeout: 5000 });
  await p.click('[data-testid=rematch]');
  await p.waitForTimeout(600);
  check('arcade: Rematch closes the result and starts round 1', !(await p.$('[data-testid=result]')) && (await p.evaluate(() => window.__dojang.session.world.round)) === 1);
  await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 20000 });
  check('arcade: controls work after Rematch', await attackWorks(p));
  await p.evaluate(() => { const w = window.__dojang.session.world; w.roundWins = [0, 1]; w.endRound(1, 'ko'); });
  await p.waitForSelector('[data-testid=result]', { timeout: 5000 });
  await p.click('[data-testid=to-menu]');
  await p.waitForSelector('.home-menu', { timeout: 5000 }).catch(() => {});
  check('arcade: Back to menu returns home', !!(await p.$('.home-menu')));
  await p.context().close();
}

// ── No pause menu over a finished match or a training summary (touch pause button, app switch).
{
  const p = await page();
  await p.goto(`${base}?start=normal&ai=off&nomenu3d&touch=1`);
  await ready(p);
  await p.evaluate(() => { const w = window.__dojang.session.world; w.roundWins = [1, 0]; w.endRound(0, 'ko'); });
  await p.waitForSelector('[data-testid=result]', { timeout: 5000 });
  await p.dispatchEvent('.t-pause', 'pointerdown').catch(() => {});
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(300);
  check('result screen: pause button / app switch do not stack the pause menu on top', !(await p.$('[data-testid=resume]')) && !!(await p.$('[data-testid=result]')));
  await p.goto(`${base}?nomenu3d&touch=1`);
  await p.click('[data-testid=mode-training]');
  await p.click('[data-testid=begin-activity]');
  await ready(p);
  await p.evaluate(() => window.__dojang.session.finishTraining());
  await p.waitForSelector('[data-testid=training-summary]', { timeout: 5000 });
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.dispatchEvent('.t-pause', 'pointerdown').catch(() => {});
  await p.waitForTimeout(300);
  check('training summary: pause button / app switch do not stack the pause menu on top', !(await p.$('[data-testid=resume]')) && !!(await p.$('[data-testid=training-summary]')));
  await p.context().close();
}

// ── Pause: Restart from the pause menu, and Esc resumes.
{
  const p = await page();
  await p.goto(`${base}?start=normal&ai=off&nomenu3d`);
  await ready(p);
  await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 20000 });
  await p.keyboard.press('Escape');
  await p.waitForSelector('[data-testid=resume]');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check('pause: Esc pauses and Esc resumes', !(await p.$('[data-testid=resume]')) && !(await p.evaluate(() => window.__dojang.session.paused)));
  await p.keyboard.press('Escape');
  await p.waitForSelector('[data-testid=resume]');
  await p.click('text=Restart match');
  await p.waitForTimeout(300);
  check('pause: Restart match resumes into a fresh round 1', !(await p.$('[data-testid=resume]')) && (await p.evaluate(() => window.__dojang.session.world.round)) === 1);
  await p.context().close();
}
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
