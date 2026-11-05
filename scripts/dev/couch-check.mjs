// Couch (same device) check: two players on one keyboard.
// Usage: npm run build && npx vite preview --port 4173, then node scripts/dev/couch-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 900, height: 560 } });
await ctx.addInitScript(() => localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false })));
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(base + '?nomenu3d');
await p.click('[data-testid=mode-friend]');
await p.click('[data-testid=p2-fighter-jae]');
await p.click('[data-testid=start-couch]');
await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 60000 });
await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
const pos = () => p.evaluate(() => window.__dojang.session.world.fighters.map((f) => +f.z.toFixed(2)));
const hold = async (key, ms = 1200) => {
  await p.keyboard.down(key);
  await p.waitForTimeout(ms);
  await p.keyboard.up(key);
  await p.waitForTimeout(200);
};
const names = await p.evaluate(() => [window.__dojang.session.defs.map((d) => d.id).join(), document.querySelector('.hud-top')?.textContent ?? '']);
check('couch match starts with the chosen fighters (mirror allowed)', names[0] === 'jae,jae', names[0]);
check('HUD shows P1 / P2 names', names[1].includes('P1') && names[1].includes('P2'), names[1].slice(0, 80));
const a = await pos();
await hold('KeyW');
const b1 = await pos();
check('P1 (W) moves only the blue fighter', b1[0] > a[0] + 0.05 && Math.abs(b1[1] - a[1]) < 0.05, `${a} -> ${b1}`);
await hold('ArrowUp');
const c = await pos();
check('P2 (arrows, screen-relative on the shared camera) moves only the red fighter', Math.abs(c[1] - b1[1]) > 0.05 && Math.abs(c[0] - b1[0]) < 0.05, `${b1} -> ${c}`);
await p.evaluate(() => (window.__dojang.session.world.fighters[1].stamina = 100));
await p.keyboard.press('Numpad2');
await p.waitForTimeout(100);
const st = await p.evaluate(() => window.__dojang.session.world.fighters.map((f) => f.state));
check('P2 numpad 2 throws a kick', st[1] === 'attack', st.join());
check('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
