// Phase 11: bracket text never runs into the bottom actions (primary, abandon, hints),
// at desktop, laptop, tablet and phone sizes. Quarterfinal stage (the lowest note).
//   node scripts/dev/open-bracket-fit.mjs [baseUrl] [--shots dir]
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  (${d})` : ''}`); };
const B = (id, a, b) => ({ id, a, b, winner: null, rounds: [], score: [0, 0], source: null });
const save = JSON.stringify({ version: 1, nextNumber: 3, history: [], totals: { entered: 1, titles: 0, best: 'semifinalist' }, active: { version: 1, number: 2, seed: 2, fighter: 'jae', difficulty: 'normal', roundSeconds: 90, seeds: ['minjun', 'tunde'], startedAt: new Date(0).toISOString(), bouts: { qf1: B('qf1', 'jae', 'hana'), qf2: B('qf2', 'amara', 'sofia'), sf1: B('sf1', 'minjun', null), sf2: B('sf2', 'tunde', null), f: B('f', null, null) } } });
const VPS = [
  ['1325x720 (reported)', 1325, 720, false], ['1366x657', 1366, 657, false], ['1280x720', 1280, 720, false], ['1280x800', 1280, 800, false],
  ['1440x900', 1440, 900, false], ['1920x1080', 1920, 1080, false], ['1440x760', 1440, 760, false], ['1024x768', 1024, 768, false], ['1024x600', 1024, 600, false],
  ['1180x820 tablet', 1180, 820, true], ['768x1024 tablet', 768, 1024, true], ['844x390', 844, 390, true], ['740x360', 740, 360, true], ['390x844', 390, 844, true], ['360x640', 360, 640, true],
];
const b = await chromium.launch();
const errors = [];
for (const [name, width, height, touch] of VPS) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript((s) => {
    localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false }));
    localStorage.setItem('dojang.tournament.v1', s);
  }, save);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '?nomenu3d');
  await p.click('[data-testid=mode-tournament]');
  await p.click('[data-testid=continue-open]');
  await p.click('[data-testid=menu-back]');
  await p.waitForSelector('[data-testid=bracket]');
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    // The visible part of an element: clipped by any scrolling ancestor.
    const box = (e) => {
      let q = e.getBoundingClientRect();
      let r = { left: q.left, top: q.top, right: q.right, bottom: q.bottom };
      for (let a = e.parentElement; a; a = a.parentElement) {
        const o = getComputedStyle(a).overflowY;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') {
          const c = a.getBoundingClientRect();
          r = { left: Math.max(r.left, c.left), top: Math.max(r.top, c.top), right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom) };
        }
      }
      return { ...r, width: Math.max(0, r.right - r.left), height: Math.max(0, r.bottom - r.top) };
    };
    const vis = (e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0; };
    // Bracket text: tree rows, headers, notes, champion; pager rows and notes.
    const text = [...document.querySelectorAll('.open-tree .fx-row, .open-tree .col-h, .open-tree .fx-note, .open-tree .champ, .pager-fx .fx-row, .pager-fx .fx-note, .pager-fx .group-label')].filter(vis);
    const actions = [...document.querySelectorAll('.btn-primary, .open-abandon-link, .open-hints, .pager-foot .foot-line')].filter(vis);
    const hit = (a, c) => a.width > 0 && a.height > 0 && a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
    const overlaps = [];
    for (const t of text) for (const a of actions) if (hit(box(t), box(a))) overlaps.push(`${t.textContent.trim().slice(0, 24)} × ${a.textContent.trim().slice(0, 20)}`);
    const offscreen = text.filter((t) => { const q = box(t); return q.height > 0 && q.bottom > innerHeight + 1 || q.right > innerWidth + 1 || q.left < -1; }).map((t) => t.textContent.trim().slice(0, 20));
    const tree = document.querySelector('.open-tree');
    const layout = document.querySelector('[data-testid=bracket]').className.replace('open-bracket', '').trim();
    const scale = tree ? (tree.style.transform || 'scale(1)') : '-';
    const minFont = Math.min(...text.map((t) => parseFloat(getComputedStyle(t).fontSize) * (tree && tree.contains(t) ? parseFloat((tree.style.transform.match(/[\d.]+/) || [1])[0]) : 1)));
    const prim = document.querySelector('.btn-primary');
    return { layout, scale, overlaps, offscreen, overflowX: document.documentElement.scrollWidth - innerWidth, primaryOnScreen: !!prim && box(prim).bottom <= innerHeight + 1, minFont: Math.round(minFont * 10) / 10 };
  });
  check(`${name}: no bracket text under the actions, nothing off screen [${r.layout} ${r.scale}, min text ${r.minFont}px]`, r.overlaps.length === 0 && r.offscreen.length === 0 && r.overflowX <= 0 && r.primaryOnScreen && r.minFont >= 8.4, [...r.overlaps, ...r.offscreen].join(' | '));
  if (shots) await p.screenshot({ path: `${shots}/fit-${name.split(' ')[0]}.png` });
  await ctx.close();
}
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
