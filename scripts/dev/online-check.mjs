// Two-browser online check against a local server.
// Usage: (cd server && npx wrangler dev) ; build with VITE_NET_URL=http://127.0.0.1:8787 VITE_ONLINE=1 and serve it, then
//   node scripts/dev/online-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
// --relay: no direct link, everything goes through the server.
const relay = process.argv.includes('--relay');
const q = relay ? '?nomenu3d&relay=1' : '?nomenu3d';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch({ args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const errors = [];
const open = async () => {
  // Small and low quality: two software-rendered WebGL pages share this machine.
  const ctx = await b.newContext({ viewport: { width: 900, height: 560 } });
  await ctx.addInitScript(() => localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false })));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
};

const host = await open();
await host.goto(base + q);
await host.click('[data-testid=mode-friend]');
await host.click('[data-testid=friend-where-online]');
await host.fill('[data-testid=nick]', 'Hosty');
await host.click('[data-testid=create-room]');
await host.waitForSelector('[data-testid=room-code]', { timeout: 10000 });
const code = (await host.textContent('[data-testid=room-code]')).trim();
check('host creates a room and sees a code', /^[A-Z0-9]{6}$/.test(code), code);

const guest = await open();
await guest.goto(`${base}${q}&room=${code}`);
await guest.fill('[data-testid=nick]', 'Guesty');
await guest.click('[data-testid=join-confirm]');
await host.waitForSelector('text=Guesty', { timeout: 10000 });
check('guest joins from the invite link; host sees their name', true);
await guest.waitForSelector('text=Hosty', { timeout: 5000 });
await guest.click('[data-testid=online-fighter-jae]');
await host.waitForFunction(() => document.querySelector('.ping')?.textContent?.includes('ms') && !document.querySelector('.ping')?.textContent?.includes('—'), null, { timeout: 8000 }).catch(() => {});
const pingText = await host.textContent('.ping').catch(() => '');
check('ping shows in the lobby', /\d+ ms/.test(pingText ?? ''), pingText ?? '');
await host.waitForFunction(() => !document.querySelector('.ping')?.textContent?.includes('relay'), null, { timeout: 8000 }).catch(() => {});
const direct = !(await host.textContent('.ping'))?.includes('relay');
check(relay ? 'relay mode: traffic goes through the server' : 'direct WebRTC link opens', relay ? !direct : direct, (await host.textContent('.ping')) ?? '');

await host.click('[data-testid=ready]');
await guest.click('[data-testid=ready]');
await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 60000 })));
check('both start the match after the countdown', true);
const info = await Promise.all([host, guest].map((p) => p.evaluate(() => ({ me: window.__dojang.session.me, names: window.__dojang.session.defs.map((d) => d.id) }))));
check('host is blue (0), guest is red (1); mirror match allowed', info[0].me === 0 && info[1].me === 1 && info[0].names.join() === 'jae,jae', JSON.stringify(info));

// Fight a little: the host walks forward and kicks, the guest punches.
const fps = await host.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => (++n, performance.now() - t0 < 1000 ? requestAnimationFrame(f) : r(n)); requestAnimationFrame(f); }));
console.log(`(host renders at ~${fps} fps in this environment)`);
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
const st = await Promise.all(
  [host, guest].map((p) =>
    p.evaluate(() => {
      const s = window.__dojang.session;
      const f = s.world.fighters;
      return { frame: s.net.frame, rb: s.net.rollbacks, desync: s.net.desyncs, z0: +f[0].z.toFixed(2), hp: f.map((x) => Math.round(x.health)), st: f.map((x) => Math.round(x.stamina)) };
    }),
  ),
);
check('both peers simulate (frames advancing)', st[0].frame > 200 && st[1].frame > 200, JSON.stringify(st));
check('host moved forward on both screens', st[0].z0 > -1.15 && Math.abs(st[0].z0 - st[1].z0) < 0.3, `${st[0].z0} vs ${st[1].z0}`);
check('stamina spent by attacks agrees on both', Math.abs(st[0].st[0] - st[1].st[0]) <= 3 && st[0].st[0] < 100, JSON.stringify([st[0].st, st[1].st]));
check('no desyncs', st[0].desync === 0 && st[1].desync === 0);
const dot = await host.textContent('[data-testid=net-dot]');
check('HUD connection dot shows ping', /\d+ ms/.test(dot ?? ''), dot ?? '');

// Esc opens a menu but does not pause online.
const f1 = await host.evaluate(() => window.__dojang.session.net.frame);
await host.keyboard.press('Escape');
await host.waitForTimeout(2000);
const [f2, paused] = await host.evaluate(() => [window.__dojang.session.net.frame, window.__dojang.session.paused]);
check('Esc menu opens but does not pause the online match', paused && f2 > f1 + 10, `${f1} -> ${f2}`);
await host.keyboard.press('Escape');

// Guest disappears: host sees the waiting countdown.
await guest.context().setOffline(true);
await guest.evaluate(() => window.__dojang.session.dispose());
await host.waitForSelector('[data-testid=net-waiting]', { timeout: 6000 }).catch(() => {});
check('host sees "waiting for opponent" when the guest drops', !!(await host.$('[data-testid=net-waiting]')), (await host.textContent('[data-testid=net-waiting]').catch(() => '')) ?? '');
check('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
