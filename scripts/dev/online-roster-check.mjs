// Phase 10 online roster check: two new fighters fight online, and a peer
// with an unknown fighter id is rejected in the lobby (never substituted).
// Usage: (cd server && npx wrangler dev) ; build with VITE_NET_URL=http://127.0.0.1:8787 VITE_ONLINE=1 and serve it, then
//   node scripts/dev/online-roster-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch({ args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const errors = [];
// `spoof`: rewrite this page's outgoing fighter id to one the other build doesn't know.
const open = async (spoof) => {
  const ctx = await b.newContext({ viewport: { width: 900, height: 560 } });
  await ctx.addInitScript(() => localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false })));
  if (spoof)
    await ctx.addInitScript((id) => {
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (d) {
        return send.call(this, typeof d === 'string' && d.includes('"t":"info"') ? d.replace(/"fighter":"[a-z]+"/, `"fighter":"${id}"`) : d);
      };
    }, spoof);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
};
const room = async (spoofGuest) => {
  const host = await open();
  await host.goto(base + '?nomenu3d');
  await host.click('[data-testid=mode-friend]');
  await host.click('[data-testid=friend-where-online]');
  await host.fill('[data-testid=nick]', 'Hosty');
  await host.click('[data-testid=create-room]');
  await host.waitForSelector('[data-testid=room-code]', { timeout: 10000 });
  const code = (await host.textContent('[data-testid=room-code]')).trim();
  const guest = await open(spoofGuest);
  await guest.goto(`${base}?nomenu3d&room=${code}`);
  await guest.fill('[data-testid=nick]', 'Guesty');
  await guest.click('[data-testid=join-confirm]');
  await host.waitForSelector('text=Guesty', { timeout: 10000 });
  await guest.waitForSelector('text=Hosty', { timeout: 5000 });
  return { host, guest };
};

// 1. Unknown fighter id from the peer: blocked before the match, with a refresh message.
{
  const { host, guest } = await room('zed');
  await guest.click('[data-testid=online-fighter-amara]');
  await host.waitForSelector('[data-testid=net-compat]', { timeout: 5000 }).catch(() => {});
  const hostMsg = await host.textContent('[data-testid=net-compat]').catch(() => '');
  await guest.waitForSelector('[data-testid=net-compat]', { timeout: 5000 }).catch(() => {});
  const guestMsg = await guest.textContent('[data-testid=net-compat]').catch(() => '');
  check('unknown fighter: the receiving player is told to refresh', /Refresh the page/.test(hostMsg ?? ''), hostMsg ?? '');
  check('unknown fighter: the other player is told their friend needs to refresh', /needs to refresh/.test(guestMsg ?? ''), guestMsg ?? '');
  check('unknown fighter: lobby lists it as unknown (no substitute)', /Unknown fighter/.test((await host.textContent('.lobby-players')) ?? ''));
  const disabled = await Promise.all([host, guest].map((p) => p.$eval('[data-testid=ready]', (e) => e.disabled)));
  check('unknown fighter: Ready is disabled for both players', disabled.every(Boolean), JSON.stringify(disabled));
  // Force both ready flags anyway (bypassing the disabled button): still no match.
  await Promise.all([host, guest].map((p) => p.evaluate(() => document.querySelector('[data-testid=ready]').removeAttribute('disabled'))));
  await host.click('[data-testid=ready]');
  await guest.click('[data-testid=ready]');
  await host.waitForTimeout(5000);
  const started = await Promise.all([host, guest].map((p) => p.evaluate(() => !!window.__dojang?.session)));
  check('unknown fighter: the match never starts', started.every((s) => !s), JSON.stringify(started));
  await host.context().close();
  await guest.context().close();
}

// 2. Two new fighters online: Tunde (host, blue) vs Amara (guest, red).
{
  const { host, guest } = await room();
  await host.click('[data-testid=online-fighter-tunde]');
  await guest.click('[data-testid=online-fighter-amara]');
  await host.waitForTimeout(800);
  check('new fighters: no compatibility warning', !(await host.$('[data-testid=net-compat]')) && !(await guest.$('[data-testid=net-compat]')));
  await host.click('[data-testid=ready]');
  await guest.click('[data-testid=ready]');
  await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 60000 })));
  const defs = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__dojang.session.defs.map((d) => d.id).join())));
  check('new fighters: both peers build tunde (blue) vs amara (red)', defs.every((d) => d === 'tunde,amara'), JSON.stringify(defs));
  await host.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
  await host.keyboard.down('KeyW');
  await host.waitForTimeout(600);
  await host.keyboard.up('KeyW');
  for (let i = 0; i < 6; i++) {
    await host.keyboard.press(i % 2 ? 'KeyL' : 'KeyK');
    await guest.keyboard.press('KeyJ');
    await host.waitForTimeout(350);
  }
  await host.waitForTimeout(1500);
  const st = await Promise.all([host, guest].map((p) => p.evaluate(() => { const s = window.__dojang.session; return { frame: s.net.frame, desync: s.net.desyncs, st: s.world.fighters.map((x) => Math.round(x.stamina)) }; })));
  check('new fighters: both peers simulate with no desyncs', st.every((x) => x.frame > 200 && x.desync === 0), JSON.stringify(st));
  check('new fighters: stamina agrees on both peers', Math.abs(st[0].st[0] - st[1].st[0]) <= 3 && st[0].st[0] < 100, JSON.stringify(st));
  await host.context().close();
  await guest.context().close();
}
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
