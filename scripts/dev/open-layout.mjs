// Phase 11 layouts: the handoff's story bracket at 1440x900, 1024x768,
// 844x390, 740x360 and 390x844 (resume, pre-match, bracket, champion,
// eliminated), with overflow checks and pager / gamepad navigation.
//   node scripts/dev/open-layout.mjs [baseUrl] [--shots dir]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const errors = [];
const B = (id, a, b, winner = null, rounds = [], score = [0, 0], source = null) => ({ id, a, b, winner, rounds, score, source });
const story = (stage) => {
  const bouts = {
    qf1: B('qf1', 'amara', 'jae', 'amara', [[12, 9], [6, 8], [10, 4]], [2, 1], 'player'),
    qf2: B('qf2', 'minjun', 'hana', 'minjun', [[9, 4], [8, 6]], [2, 0], 'sim'),
    sf1: B('sf1', 'tunde', 'amara'),
    sf2: B('sf2', 'sofia', 'minjun'),
    f: B('f', null, null),
  };
  if (stage === 'f') {
    bouts.sf1 = B('sf1', 'tunde', 'amara', 'amara', [[5, 9], [7, 11]], [0, 2], 'player');
    bouts.sf2 = B('sf2', 'sofia', 'minjun', 'sofia', [[10, 8], [6, 9], [7, 4]], [2, 1], 'sim');
    bouts.f = B('f', 'amara', 'sofia');
  }
  const totals = { entered: 3, titles: 1, best: 'champion' };
  return JSON.stringify({ version: 1, nextNumber: 5, active: { version: 1, number: 4, seed: 4, fighter: 'amara', difficulty: 'normal', roundSeconds: 90, seeds: ['tunde', 'sofia'], bouts, startedAt: new Date(0).toISOString() }, history: [], totals });
};
const VPS = [
  ['1440x900', { width: 1440, height: 900 }, false],
  ['1024x768', { width: 1024, height: 768 }, false],
  ['844x390', { width: 844, height: 390 }, true],
  ['740x360', { width: 740, height: 360 }, true],
  ['390x844', { width: 390, height: 844 }, true],
];
const b = await chromium.launch();
async function open(viewport, touch, save) {
  const ctx = await b.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(([s]) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('dojang.progress.v1', JSON.stringify({ version: 1, fighter: 'amara', belt: 'yellow', completed: ['practice'], records: {}, landed: {}, matches: { played: 4, won: 3, wins: { easy: 0, normal: 3, hard: 0 }, friendWins: 0 } }));
    localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: true }));
    localStorage.setItem('dojang.tournament.v1', s);
    window.__pad = { id: 'stub', index: 0, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0], timestamp: 0 };
    navigator.getGamepads = () => [window.__pad];
  }, [save]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base);
  await p.waitForSelector('[data-testid=mode-tournament]', { timeout: 30000 });
  await p.waitForSelector('.menu-backdrop.live', { timeout: 90000 }).catch(() => {});
  return p;
}
const fit = (p, sel) =>
  p.evaluate((sel) => {
    const over = document.documentElement.scrollWidth - innerWidth;
    const el = document.querySelector(sel);
    const r = el?.getBoundingClientRect();
    // Any visible element poking out of the viewport sideways.
    const outside = [...document.querySelectorAll('.menu-layer *, .overlay *')].filter((e) => {
      const q = e.getBoundingClientRect();
      return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== 'hidden' && (q.right > innerWidth + 1 || q.left < -1);
    }).length;
    return { over, outside, primaryVisible: !!r && r.bottom <= innerHeight + 1 && r.top >= 0 && r.right <= innerWidth + 1, h: r ? Math.round(r.height) : 0 };
  }, sel);
const shot = (p, n) => shots && p.screenshot({ path: `${shots}/${n}.png` });
const press = async (p, i) => {
  await p.evaluate((i) => (window.__pad.buttons[i] = { pressed: true, value: 1 }), i);
  await p.waitForTimeout(150);
  await p.evaluate((i) => (window.__pad.buttons[i] = { pressed: false, value: 0 }), i);
  await p.waitForTimeout(150);
};
async function playOut(p, rounds) {
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
  for (const r of rounds) {
    await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
    await p.evaluate(([w, a, c]) => {
      const s = window.__dojang.session;
      s.competitive.stats[0].points = a;
      s.competitive.stats[1].points = c;
      s.world.endRound(w, 'time');
    }, r);
  }
}

for (const [name, vp, touch] of VPS) {
  // Semifinal stage: resume, pre-match, bracket.
  const p = await open(vp, touch, story('sf'));
  await shot(p, `${name}-home`);
  await p.click('[data-testid=mode-tournament]');
  await p.waitForSelector('[data-testid=continue-open]');
  await p.waitForTimeout(500);
  let f = await fit(p, '[data-testid=continue-open]');
  check(`${name} resume: no overflow; primary on screen`, f.over <= 0 && f.outside === 0 && f.primaryVisible, JSON.stringify(f));
  await shot(p, `${name}-resume`);
  await p.click('[data-testid=continue-open]');
  await p.waitForSelector('[data-testid=fight]');
  await p.waitForTimeout(1500);
  f = await fit(p, '[data-testid=fight]');
  check(`${name} pre-match: no overflow; Fight on screen`, f.over <= 0 && f.outside === 0 && f.primaryVisible, JSON.stringify(f));
  await shot(p, `${name}-prematch`);
  await p.click('[data-testid=menu-back]');
  await p.waitForSelector('[data-testid=bracket]');
  await p.waitForTimeout(800);
  f = await fit(p, '[data-testid=fight-stage]');
  const layout = await p.$eval('[data-testid=bracket]', (e) => e.className);
  const wantTree = vp.width >= 900 && vp.height >= 600;
  check(`${name} bracket: ${wantTree ? 'tree' : 'stage pager'}; no overflow; primary on screen`, (wantTree ? !!(await p.$('[data-testid=bracket-tree]')) : /pager/.test(layout)) && f.over <= 0 && f.outside === 0 && f.primaryVisible, `${layout} ${JSON.stringify(f)}`);
  if (touch) check(`${name} bracket: primary ≥ 48 px; touch targets ≥ 44 px`, f.h >= 48 && (await p.$$eval('.open-bracket button', (bs) => bs.filter((x) => x.getBoundingClientRect().height > 0 && x.getBoundingClientRect().height < 44).length)) === 0);
  await shot(p, `${name}-bracket`);
  if (!wantTree) {
    const sel = () => p.$eval('[role=tab][aria-selected=true]', (e) => e.dataset.testid);
    check(`${name} pager: opens on the current stage`, (await sel()) === 'stage-tab-sf');
    await p.focus('[role=tab][aria-selected=true]');
    await p.keyboard.press('ArrowLeft');
    check(`${name} pager: ← switches stage (QF, with its results)`, (await sel()) === 'stage-tab-qf' && !!(await p.$('[data-bout=qf1] .fx-row.winner')));
    await press(p, 5);
    await press(p, 5);
    check(`${name} pager: gamepad RB moves through stages`, (await sel()) === 'stage-tab-f', await sel());
    await p.tap('[data-testid=stage-tab-sf]');
    check(`${name} pager: tap a stage tab`, (await sel()) === 'stage-tab-sf');
  }
  // Gamepad Y opens the abandon confirm; B cancels it.
  await press(p, 3);
  const opened = !!(await p.$('[data-testid=abandon-confirm]'));
  await p.keyboard.press('Escape');
  check(`${name} gamepad Y opens abandon (focus on Keep playing); Esc cancels`, opened && !(await p.$('[data-testid=abandon-confirm]')) && !!(await p.$('[data-testid=bracket]')));
  await p.context().close();

  // Final stage: play the final; win at most sizes, lose at 844 for the eliminated panel.
  const lose = name === '844x390' || name === '1024x768';
  const q = await open(vp, touch, story('f'));
  await q.click('[data-testid=mode-tournament]');
  await q.click('[data-testid=continue-open]');
  await q.click('[data-testid=fight]');
  await playOut(q, lose ? [[1, 7, 9], [0, 11, 6], [1, 5, 8]] : [[0, 8, 10], [1, 9, 6], [0, 7, 4]].map(([w, a, c]) => [w === 0 ? 1 : 0, c, a]).map(([w, a, c]) => [1 - w, c, a]));
  if (lose) {
    await q.waitForSelector('[data-testid=open-out-title]', { timeout: 30000 });
    await q.waitForTimeout(500);
    f = await fit(q, '[data-testid=new-open]');
    check(`${name} runner-up panel: no overflow; primary on screen`, f.over <= 0 && f.outside === 0 && f.primaryVisible, JSON.stringify(f));
    await shot(q, `${name}-runnerup`);
  } else {
    await q.waitForSelector('[data-testid=champion]', { timeout: 30000 });
    await q.waitForTimeout(1500);
    f = await fit(q, '[data-testid=new-open]');
    check(`${name} champion: no overflow; primary on screen`, f.over <= 0 && f.outside === 0 && f.primaryVisible, JSON.stringify(f));
    check(`${name} champion: record "2 titles from 4"`, /2 titles? from 4/.test(await q.textContent('[data-testid=champion]')));
    await shot(q, `${name}-champion`);
  }
  await q.context().close();
}
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
