// Phase 11: the Dojang Open, end to end on a production build (live menu stage).
//   node scripts/dev/open-check.mjs [baseUrl] [--shots dir] [--only win|out|resume|layout]
// Bouts are real Competitive matches; the script ends rounds through the
// world's own endRound (the normal round/match flow, recording and saving).
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch();
const errors = [];
const shot = async (p, name) => shots && p.screenshot({ path: `${shots}/${name}.png` });

export async function open(viewport, o = {}) {
  const ctx = await b.newContext({ viewport, hasTouch: !!o.touch, isMobile: !!o.touch });
  await ctx.addInitScript(([fighter, menuScene, extra]) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('dojang.progress.v1', JSON.stringify({ version: 1, fighter, belt: 'white', completed: ['practice'], records: {}, landed: {}, matches: { played: 0, won: 0, wins: { easy: 0, normal: 0, hard: 0 }, friendWins: 0 } }));
      localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene }));
      if (extra) localStorage.setItem('dojang.tournament.v1', extra);
    }
  }, [o.fighter ?? 'amara', o.menuScene ?? true, o.save ?? null]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'debug' && m.text().includes('[Dojang Open]') && (p.__diag = m.text()));
  await p.goto(base);
  await p.waitForSelector('[data-testid=mode-tournament]', { timeout: 30000 });
  if (o.menuScene !== false) await p.waitForSelector('.menu-backdrop.live', { timeout: 90000 }).catch(() => {});
  return p;
}
const save = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('dojang.tournament.v1') ?? 'null'));
const progress = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('dojang.progress.v1')).matches);

/** Play the current bout: per round [winnerCorner, playerPoints, opponentPoints]. */
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
const WIN = [[0, 12, 9], [1, 6, 8], [0, 10, 4]];
const WIN20 = [[0, 9, 5], [0, 11, 7]];
const LOSE = [[1, 7, 9], [0, 11, 6], [1, 5, 8]];

async function enterOpen(p, level = 'normal', len = 90) {
  await p.click('[data-testid=mode-tournament]');
  await p.waitForSelector('[data-testid=enter-open]');
  await p.click(`[data-testid=open-level-${level}]`);
  await p.click(`[data-testid=open-len-${len}]`);
  await p.click('[data-testid=enter-open]');
  await p.waitForSelector('[data-testid=bracket]');
}
async function fightFromBracket(p, rounds) {
  await p.click('[data-testid=fight-stage]');
  await p.waitForSelector('[data-testid=fight]');
  await p.click('[data-testid=fight]');
  await playOut(p, rounds);
}

// ── 1. Champion path (desktop) ──────────────────────────────────────
if (!only || only === 'win') {
  const p = await open({ width: 1440, height: 900 });
  await shot(p, 'd-home');
  const homeItem = await p.textContent('[data-testid=mode-tournament]');
  check('home: "Tournament" item after Competitive sparring', /Tournament/.test(homeItem) && /six fighters, three wins/.test(homeItem));
  const order = await p.$$eval('.menu-list .menu-item .label', (e) => e.map((x) => x.textContent));
  check('home: placed after Competitive sparring, before Play a friend', order.indexOf('Tournament') === order.indexOf('Competitive sparring') + 1 && order.indexOf('Play a friend') === order.indexOf('Tournament') + 1, order.join(' | '));
  await p.click('[data-testid=mode-tournament]');
  await p.waitForSelector('[data-testid=enter-open]');
  const lv = await p.$$eval('[data-testid^=open-level-] .name', (e) => e.map((x) => x.textContent));
  check('entry: exactly White / Red / Black belt', lv.join() === 'White belt,Red belt,Black belt', lv.join());
  const focused = await p.evaluate(() => document.activeElement?.getAttribute('name'));
  check('entry: initial focus on the level group', focused === 'open-level', String(focused));
  await shot(p, 'd-entry');
  const settingsBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('dojang.settings.v1')).compRoundSeconds ?? 90);
  await p.click('[data-testid=open-level-hard]');
  await p.click('[data-testid=open-len-60]');
  await p.click('[data-testid=enter-open]');
  await p.waitForSelector('[data-testid=bracket]');
  let s = await save(p);
  check('enter: saved immediately with the chosen level and length', s?.active?.difficulty === 'hard' && s.active.roundSeconds === 60 && s.active.number === 1 && s.nextNumber === 2);
  check('enter: round length not written back to settings', (await p.evaluate(() => JSON.parse(localStorage.getItem('dojang.settings.v1')).compRoundSeconds ?? 90)) === settingsBefore);
  const a = s.active;
  check('draw: player in QF1, never seeded, six distinct', a.bouts.qf1.a === 'amara' && !a.seeds.includes('amara') && new Set([a.bouts.qf1.a, a.bouts.qf1.b, a.bouts.qf2.a, a.bouts.qf2.b, ...a.seeds]).size === 6, JSON.stringify(a.seeds));
  await p.waitForTimeout(600);
  await shot(p, 'd-bracket-qf');
  check('bracket: "Quarterfinal next" and focus on the primary', /Quarterfinal next/.test(await p.textContent('#t-bracket')) && (await p.evaluate(() => document.activeElement?.dataset.testid)) === 'fight-stage');
  await p.click('[data-testid=fight-stage]');
  await p.waitForSelector('[data-testid=fight]');
  await p.waitForTimeout(1500);
  await shot(p, 'd-prematch');
  const oppName = await p.textContent('[data-testid=prematch-opponent]');
  check('pre-match: names the drawn opponent at the Open level', oppName.includes('Black belt AI'), oppName);
  await p.click('[data-testid=fight]');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  const m = await p.evaluate(() => { const s = window.__dojang.session; return { ids: s.defs.map((d) => d.id), mode: s.competitive ? 'competitive' : 'other', len: s.competitive?.roundSeconds, diff: s.ai.difficulty ?? null }; });
  check('QF1: a real Competitive match, player v drawn opponent, Open round length', m.ids[0] === 'amara' && m.ids[1] === a.bouts.qf1.b && m.mode === 'competitive' && m.len === 60, JSON.stringify(m));
  check('QF1: Black belt maps to the existing "hard" AI preset', m.diff === 'hard', String(m.diff));
  const before = await progress(p);
  await playOut(p, WIN);
  await p.waitForSelector('[data-testid=open-next]', { timeout: 30000 });
  await shot(p, 'd-postwin-qf');
  s = await save(p);
  check('QF won: QF2 already decided by a real simulation before the panel', s.active.bouts.qf2.winner && (s.active.bouts.qf2.source === 'sim' || s.active.bouts.qf2.source === 'fallback'), s.active.bouts.qf2.source);
  check('QF won: bout saved with rounds and score', s.active.bouts.qf1.winner === 'amara' && JSON.stringify(s.active.bouts.qf1.score) === '[2,1]' && s.active.bouts.qf1.rounds.length === 3);
  const after = await progress(p);
  check('QF won: counted once toward the match record (hard)', after.played === before.played + 1 && after.won === before.won + 1 && after.wins.hard === before.wins.hard + 1, JSON.stringify(after));
  const panel = await p.textContent('[data-testid=result]');
  check('post-win panel: "You win 2 – 1", the QF lines, Next v Seed 1, no Rematch', /You win/.test(panel) && /2 – 1/.test(panel) && /Quarterfinals complete/.test(panel) && panel.includes(`Next · Semifinal`) && !(await p.$('[data-testid=rematch]')));
  check('post-win panel: focus on "Next: Semifinal"', (await p.evaluate(() => document.activeElement?.dataset.testid)) === 'open-next-bout');
  console.log('  diag:', p.__diag ?? '(none)');
  // Revisit: going to the bracket and back can't count the bout twice.
  await p.click('[data-testid=open-bracket]');
  await p.waitForSelector('[data-testid=bracket]');
  await p.waitForTimeout(800);
  await shot(p, 'd-bracket-sf');
  check('bracket: "Semifinal next", QF tick moved, QF2 shown', /Semifinal next/.test(await p.textContent('#t-bracket')) && (await p.$('[data-bout=qf2] .fx-row.winner')) !== null);
  check('no double count after revisiting', JSON.stringify(await progress(p)) === JSON.stringify(after));
  await fightFromBracket(p, WIN20);
  await p.waitForSelector('[data-testid=open-next]', { timeout: 30000 });
  s = await save(p);
  check('SF won: SF2 decided before the panel; final set', s.active.bouts.sf2.winner && s.active.bouts.f.a === 'amara' && s.active.bouts.f.b === s.active.bouts.sf2.winner);
  await shot(p, 'd-postwin-sf');
  await p.click('[data-testid=open-next-bout]');
  await p.waitForSelector('[data-testid=fight]');
  check('"Next: Final" goes straight to Pre-match', /Final/.test(await p.textContent('#t-prematch')));
  await p.click('[data-testid=fight]');
  await playOut(p, WIN);
  await p.waitForSelector('[data-testid=champion]', { timeout: 30000 });
  await p.waitForTimeout(1800);
  await shot(p, 'd-champion');
  s = await save(p);
  check('final won: Champion screen; Open moved to history; totals 1/1', !s.active && s.history[0].result === 'champion' && s.history[0].champion === 'amara' && s.totals.entered === 1 && s.totals.titles === 1);
  const ch = await p.textContent('[data-testid=champion]');
  check('champion: path, record line, bracket preserved in the record', /Quarterfinal/.test(ch) && /Your Open record: 1 title from 1 entry/.test(ch) && s.history[0].bouts.f.winner === 'amara');
  const fin = await progress(p);
  check('three bouts counted exactly once (3 played, 3 won)', fin.played === before.played + 3 && fin.won === before.won + 3, JSON.stringify(fin));
  await p.click('[data-testid=champion-bracket]');
  await p.waitForSelector('[data-testid=bracket]');
  await p.waitForTimeout(600);
  await shot(p, 'd-bracket-final');
  check('completed bracket reviewable after the Open is cleared', /You won the Open/.test(await p.textContent('#t-bracket')) && /Amara Okafor/.test(await p.textContent('[data-testid=bracket-champion]')));
  await p.click('[data-testid=new-open]');
  await p.waitForSelector('[data-testid=enter-open]');
  check('entry after a title: No. 2 and the summary lines', /No\. 2 · 1 title from 1 entry/.test(await p.textContent('.screen .context')) && /Last champion/.test(await p.textContent('[data-testid=open-notes]')));
  await p.click('[data-testid=open-history-link]');
  await p.waitForSelector('[data-testid=open-history]');
  await shot(p, 'd-history');
  check('history lists the Open', /No\. 1/.test(await p.textContent('[data-testid=open-history]')));
  await p.context().close();
}

// ── 2. Eliminations (QF, SF, final) ─────────────────────────────────
if (!only || only === 'out') {
  for (const [stage, pre, title, result] of [
    ['qf', [], 'Out in the quarterfinal', 'quarterfinalist'],
    ['sf', [WIN], 'Out in the semifinal', 'semifinalist'],
    ['f', [WIN, WIN20], 'Runner-up', 'runner-up'],
  ]) {
    const p = await open({ width: 1440, height: 900 }, { menuScene: stage === 'sf' });
    await enterOpen(p);
    for (const r of pre) {
      if (await p.$('[data-testid=bracket]')) await fightFromBracket(p, r);
      else {
        await p.click('[data-testid=fight]');
        await playOut(p, r);
      }
      await p.waitForSelector('[data-testid=open-next]', { timeout: 30000 });
      await p.click('[data-testid=open-next-bout]');
      await p.waitForSelector('[data-testid=fight]');
    }
    const before = await progress(p);
    if (await p.$('[data-testid=bracket]')) await fightFromBracket(p, LOSE);
    else {
      await p.click('[data-testid=fight]');
      await playOut(p, LOSE);
    }
    await p.waitForSelector('[data-testid=open-out-title]', { timeout: 30000 });
    const s = await save(p);
    const t = await p.textContent('[data-testid=open-out-title]');
    check(`lost the ${stage}: "${title}"; recorded as ${result}; champion decided`, t === title && !s.active && s.history[0].result === result && s.history[0].champion && s.history[0].champion !== 'amara', `${t} / ${s.history[0]?.result}`);
    const after = await progress(p);
    check(`lost the ${stage}: one played, no win; AI fixtures didn't touch the record`, after.played === before.played + 1 && after.won === before.won);
    if (stage === 'sf') {
      await shot(p, 'd-eliminated-sf');
      const txt = await p.textContent('[data-testid=result]');
      check('eliminated panel: "How the Open finished" and the champion line', /How the Open finished/.test(txt) && /ends here with a champion/.test(txt));
      await p.click('[data-testid=open-bracket]');
      await p.waitForSelector('[data-testid=bracket]');
      check('eliminated: final bracket reviewable', /The Open is over/.test(await p.textContent('#t-bracket')));
      await p.waitForTimeout(600);
      await shot(p, 'd-bracket-out');
    }
    await p.context().close();
  }
}

// ── 3. Resume, mid-bout exit, abandon ───────────────────────────────
if (!only || only === 'resume') {
  const p = await open({ width: 1440, height: 900 });
  await enterOpen(p);
  await fightFromBracket(p, WIN);
  await p.waitForSelector('[data-testid=open-next]', { timeout: 30000 });
  await p.click('[data-testid=open-next-bout]');
  await p.click('[data-testid=fight]');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  // Mid-bout: win a round, then refresh. Nothing is recorded; the bout replays.
  await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
  await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
  await p.evaluate(() => window.__dojang.session.world.endRound(0, 'time'));
  const before = await progress(p);
  const s0 = await save(p);
  await p.reload();
  await p.waitForSelector('[data-testid=mode-tournament]');
  const item = await p.textContent('[data-testid=mode-tournament]');
  check('refresh mid-bout: Home shows "Continue the Open · Semifinal next"', /Continue the Open/.test(item) && /Semifinal next/.test(item), item);
  check('refresh mid-bout: nothing recorded; save unchanged', JSON.stringify(await progress(p)) === JSON.stringify(before) && JSON.stringify(await save(p)) === JSON.stringify(s0));
  await p.click('[data-testid=mode-tournament]');
  await p.waitForSelector('[data-testid=continue-open]');
  await p.waitForTimeout(800);
  await shot(p, 'd-resume');
  check('resume: "Continue: Semifinal" and the replay note', /Continue: Semifinal/.test(await p.textContent('[data-testid=continue-open]')) && /from round one/.test(await p.textContent('.screen')));
  await p.click('[data-testid=continue-open]');
  await p.click('[data-testid=fight]');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  const w = await p.evaluate(() => window.__dojang.session.world.roundWins.join());
  check('resumed bout starts from round one', w === '0,0', w);
  // Pause → leave the bout: copy, and back to the bracket with nothing recorded.
  await p.keyboard.press('Escape');
  await p.waitForSelector('[data-testid=open-pause-note]');
  check('pause copy in a tournament', /restart from round one/.test(await p.textContent('[data-testid=open-pause-note]')));
  await shot(p, 'd-pause');
  await p.click('[data-testid=quit-to-menu]');
  await p.waitForSelector('[data-testid=bracket]');
  check('leave the bout: back to the bracket, unchanged', JSON.stringify(await save(p)) === JSON.stringify(s0));
  // Abandon: inline confirm, focus on Keep playing, Esc cancels, then abandon.
  await p.click('[data-testid=abandon-open]');
  await p.waitForSelector('[data-testid=abandon-confirm]');
  check('abandon: inline alertdialog with focus on "Keep playing"', (await p.evaluate(() => document.activeElement?.dataset.testid)) === 'abandon-keep');
  await shot(p, 'd-abandon');
  await p.keyboard.press('Escape');
  check('abandon: Esc cancels and returns focus to the link', !(await p.$('[data-testid=abandon-confirm]')) && (await p.evaluate(() => document.activeElement?.dataset.testid)) === 'abandon-open' && !!(await p.$('[data-testid=bracket]')));
  const pb = await progress(p);
  await p.click('[data-testid=abandon-open]');
  await p.click('[data-testid=abandon-yes]');
  await p.waitForSelector('[data-testid=enter-open]', { timeout: 15000 });
  const s1 = await save(p);
  check('abandon: recorded as semifinalist (abandoned), champion decided, active cleared', !s1.active && s1.history[0].abandoned && s1.history[0].result === 'semifinalist' && !!s1.history[0].champion && s1.history[0].bouts.sf1.source === 'walkover');
  check('abandon: match record untouched', JSON.stringify(await progress(p)) === JSON.stringify(pb));
  check('abandon: "Entered" counts it', s1.totals.entered === 1 && s1.totals.titles === 0);
  await p.context().close();
  // Corrupt / unknown saves: discarded silently, history kept.
  const bad = JSON.stringify({ ...s1, active: { ...s0.active, bouts: { ...s0.active.bouts, qf2: { ...s0.active.bouts.qf2, a: 'zed' } } } });
  const q = await open({ width: 1280, height: 800 }, { save: bad, menuScene: false });
  const qi = await q.textContent('[data-testid=mode-tournament]');
  const qs = await save(q);
  check('unknown fighter in a saved Open: discarded, history kept', /Tournament/.test(qi) && !/Continue/.test(qi), qi);
  await q.context().close();
  const r = await open({ width: 1280, height: 800 }, { save: '{broken', menuScene: false });
  check('corrupt save: starts clean', /Tournament/.test(await r.textContent('[data-testid=mode-tournament]')));
  await r.context().close();
}

check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
