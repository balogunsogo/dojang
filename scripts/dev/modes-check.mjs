// Phase 10: every single-player mode with a new fighter (preview build).
//   node scripts/dev/modes-check.mjs [baseUrl]
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
const open = async (fighter) => {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 620 } });
  await ctx.addInitScript((f) => {
    localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false }));
    localStorage.setItem('dojang.progress.v1', JSON.stringify({ version: 1, fighter: f, belt: 'white', completed: [], records: {}, landed: {}, matches: { played: 0, won: 0, wins: {} } }));
  }, fighter);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
};
const kickAt = async (p, key) => {
  const s0 = await p.evaluate(() => window.__dojang.session.world.fighters[0].attackSerial);
  await p.evaluate(() => {
    const [a, c] = window.__dojang.session.world.fighters;
    a.x = 0; a.z = -0.5; a.yaw = 0; c.x = 0; c.z = 0.5; c.yaw = Math.PI; a.stamina = 100;
  });
  await p.keyboard.press(key);
  await p.waitForFunction((s) => window.__dojang.session.world.fighters[0].attackSerial > s, s0, { timeout: 15000 }).catch(() => {});
  await p.waitForFunction(() => window.__dojang.session.world.fighters[0].state === 'idle', null, { timeout: 15000 }).catch(() => {});
};

// Arcade: Tunde vs the next fighter (Sofia); his kicks land.
{
  const p = await open('tunde');
  await p.goto(base + '?nomenu3d&start=normal&ai=off');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
  await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
  const ids = await p.evaluate(() => window.__dojang.session.defs.map((d) => d.id).join());
  check('arcade: Tunde vs Sofia (opponent is the next fighter in roster order)', ids === 'tunde,sofia', ids);
  const h0 = await p.evaluate(() => window.__dojang.session.world.fighters[1].health);
  for (let i = 0; i < 4; i++) await kickAt(p, 'KeyL');
  const h1 = await p.evaluate(() => window.__dojang.session.world.fighters[1].health);
  check('arcade: Tunde lands kicks on Sofia (health drops)', h1 < h0, `${h0} -> ${h1}`);
  await p.context().close();
}

// Competitive: Amara vs Jae (the roster wraps), AI fighting for a few seconds.
{
  const p = await open('amara');
  await p.goto(base + '?nomenu3d&start=normal&mode=competitive');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
  await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
  const ids = await p.evaluate(() => window.__dojang.session.defs.map((d) => d.id).join());
  check('competitive: Amara vs Jae (roster order wraps)', ids === 'amara,jae', ids);
  for (let i = 0; i < 4; i++) await kickAt(p, 'KeyK');
  await p.waitForTimeout(3000);
  const st = await p.evaluate(() => { const w = window.__dojang.session.world; return { phase: w.phase, ai: w.fighters[1].attackSerial }; });
  check('competitive: the match runs with the AI opponent acting', st.phase !== 'intro' && st.ai > 0, JSON.stringify(st));
  await p.context().close();
}

// Training: Min-jun in the body-kick challenge.
{
  const p = await open('minjun');
  await p.goto(base + '?nomenu3d');
  await p.click('[data-testid=mode-training]');
  await p.click('[data-testid=activity-body10]');
  await p.click('[data-testid=begin-activity]');
  await p.waitForFunction(() => window.__dojang?.session?.ready && window.__dojang.session.training, null, { timeout: 90000 });
  const who = await p.evaluate(() => window.__dojang.session.defs[0].id);
  check('training: Min-jun is the fighter you control', who === 'minjun', who);
  for (let i = 0; i < 4; i++) await kickAt(p, 'KeyL');
  const hits = await p.evaluate(() => window.__dojang.session.training.hits);
  check('training: Min-jun\'s kicks register', hits >= 3, `hits ${hits}`);
  await p.context().close();
}
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
