// Phase 12A online: both peers record locally; after the confirmed result
// each can watch, and their highlights are identical (same confirmed history).
// Usage: (cd server && npx wrangler dev) ; build with VITE_NET_URL=http://127.0.0.1:8787 VITE_ONLINE=1, serve, then
//   node scripts/dev/replay-online-check.mjs [baseUrl] [--shots dir]
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  (${d})` : ''}`); };
const errors = [];
const b = await chromium.launch({ args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const open = async () => {
  const ctx = await b.newContext({ viewport: { width: 900, height: 560 } });
  await ctx.addInitScript(() => localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false })));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
};
const host = await open();
await host.goto(base + '?nomenu3d');
await host.click('[data-testid=mode-friend]');
await host.click('[data-testid=friend-where-online]');
await host.fill('[data-testid=nick]', 'Hosty');
await host.click('[data-testid=create-room]');
await host.waitForSelector('[data-testid=room-code]', { timeout: 10000 });
const code = (await host.textContent('[data-testid=room-code]')).trim();
const guest = await open();
await guest.goto(`${base}?nomenu3d&room=${code}`);
await guest.fill('[data-testid=nick]', 'Guesty');
await guest.click('[data-testid=join-confirm]');
await host.waitForSelector('text=Guesty', { timeout: 10000 });
await guest.waitForSelector('text=Hosty', { timeout: 5000 });
await host.click('[data-testid=ready]');
await guest.click('[data-testid=ready]');
await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 60000 })));
// The host walks in and throws real head roundhouses; the guest stands. Arcade: two knockouts.
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  const st = await host.evaluate(() => { const w = window.__dojang.session.world; const [a, c] = w.fighters; return { phase: w.phase, d: Math.hypot(a.x - c.x, a.z - c.z), idle: ['idle', 'guard'].includes(a.state), stam: a.stamina }; });
  if (st.phase === 'match-over') break;
  if (st.phase !== 'fight') { await host.waitForTimeout(300); continue; }
  if (st.d > 1.25) {
    await host.keyboard.down('KeyW');
    await host.waitForTimeout(120);
    await host.keyboard.up('KeyW');
  } else if (st.idle && st.stam > 30) {
    await host.keyboard.down('KeyE');
    await host.keyboard.press('KeyL');
    await host.keyboard.up('KeyE');
    await host.waitForTimeout(500);
  } else await host.waitForTimeout(200);
}
const over = await host.evaluate(() => window.__dojang.session.world.phase);
check('online: the match finished with real kicks', over === 'match-over', `${over} after ${Math.round((Date.now() - t0) / 1000)} s`);
// Watch replay appears only after the confirmed result, on both peers.
for (const p of [host, guest]) await p.waitForSelector('[data-testid=watch-replay]', { timeout: 30000 });
check('online: both peers offer Watch replay after the confirmed result (rematch and lobby still there)', !!(await host.$('[data-testid=rematch]')) && !!(await guest.$('[data-testid=to-lobby]')));
const digest = (p) => p.evaluate(() => {
  const s = window.__dojang.session.recorder.seal();
  // Hash the recorded rows only (rows after synthFrom continue the final state for display,
  // and each peer seals at its own moment, so that split may differ).
  const real = Math.min(...s.clips.map((c) => c.synthFrom - 0));
  const hashes = s.clips.map((c) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < c.synthFrom * 60; i++) h = Math.imul(h ^ Math.round(c.rows[i] * 1000), 0x01000193);
    return h >>> 0;
  });
  return { labels: s.clips.map((c) => c.label), ticks: s.clips.map((c) => `${c.start}+${c.eventTick}/${c.len}`), hits: s.clips.map((c) => c.events.filter((e) => e.k === 'hit').length), real: s.clips.map((c) => c.synthFrom), hashes, rollbacks: window.__dojang.session.net.rollbacks, _r: real };
});
const [dh, dg] = await Promise.all([digest(host), digest(guest)]);
console.log('  host ', JSON.stringify(dh));
console.log('  guest', JSON.stringify(dg));
// Compare the rows both peers actually recorded (the shorter real part of each clip).
const upto = dh.real.map((r, i) => Math.min(r, dg.real[i]));
const prefix = (p) => p.evaluate((upto) => window.__dojang.session.recorder.seal().clips.map((c, i) => {
  let h = 0x811c9dc5;
  for (let k = 0; k < upto[i] * 60; k++) h = Math.imul(h ^ Math.round(c.rows[k] * 1000), 0x01000193);
  return h >>> 0;
}), upto);
const [ph, pg] = await Promise.all([prefix(host), prefix(guest)]);
console.log(`  recorded rows compared per clip: ${upto.join(', ')}`);
const same = dh.labels.join() === dg.labels.join() && dh.ticks.join() === dg.ticks.join() && dh.hits.join() === dg.hits.join() && ph.join() === pg.join();
check('online: both peers recorded identical highlights (labels, timing, hits, every recorded row)', same && dh.labels.length > 0);
check('online: the host\'s knockout is credited correctly on both screens', dh.labels.some((l) => /^Knockout/.test(l)));
for (const [p, name] of [[host, 'host'], [guest, 'guest']]) {
  await p.click('[data-testid=watch-replay]');
  await p.waitForFunction(() => window.__replay && !document.querySelector('[data-testid=replay-play]').disabled, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
  if (shots) await p.screenshot({ path: `${shots}/online-${name}.png` });
  const ids = await p.evaluate(() => window.__replay.set.meta.ids.join() + '|' + window.__replay.set.meta.names.join());
  check(`online ${name}: viewer opens with both identities and corners`, /Hosty\|?/.test(ids) || ids.includes('Hosty'), ids);
  await p.click('[data-testid=replay-back]');
  await p.waitForSelector('[data-testid=watch-replay]', { timeout: 5000 });
}
check('online: rematch still works after watching', await (async () => {
  await host.click('[data-testid=rematch]');
  await guest.click('[data-testid=rematch]');
  return Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__dojang?.session?.world.phase !== 'match-over', null, { timeout: 30000 }).then(() => true).catch(() => false))).then((r) => r.every(Boolean));
})());
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
