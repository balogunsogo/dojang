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
  // Count WebGL contexts created: browsers drop the oldest when too many exist (the game's own).
  await ctx.addInitScript(() => {
    window.__glContexts = 0;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const r = orig.call(this, type, ...rest);
      if (/webgl/.test(type) && r && !this.__counted) { this.__counted = true; window.__glContexts++; }
      return r;
    };
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
};

// A mistyped room code gets a clear message, not "can't reach the server".
{
  const p = await open();
  await p.goto(base + q);
  await p.click('[data-testid=mode-friend]');
  await p.click('[data-testid=friend-where-online]');
  await p.fill('[data-testid=join-code]', 'AB');
  await p.click('[data-testid=join-room]');
  const msg = await p.textContent('[data-testid=net-error]').catch(() => '');
  check('join: a too-short room code explains the code format', /Room codes are/.test(msg ?? ''), msg ?? '');
  await p.context().close();
}

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

const names = await Promise.all([host, guest].map((p) => p.evaluate(() => ({ calls: [window.__dojang.session.shortName(0), window.__dojang.session.shortName(1)], hud: [...document.querySelectorAll('.hud .short')].map((e) => e.textContent) }))));
check('online: calls, HUD and tables use the players\' names, not the fighters\'', names.every((n) => n.calls.join() === 'Hosty,Guesty' && n.hud.join() === 'Hosty,Guesty'), JSON.stringify(names));

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
const glNow = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__glContexts)));
check('no new WebGL contexts during the match (the game canvas is never evicted)', glNow.every((n) => n <= 2), JSON.stringify(glNow));
const dot = await host.textContent('[data-testid=net-dot]');
check('HUD connection dot shows ping', /\d+ ms/.test(dot ?? ''), dot ?? '');

// Pause is shared: Esc pauses both players; either can resume; it resumes on its own after 30 s.
const frames = () => Promise.all([host, guest].map((p) => p.evaluate(() => window.__dojang.session.net.frame)));
await host.keyboard.press('Escape');
await guest.waitForSelector('[data-testid=online-pause]', { timeout: 5000 }).catch(() => {});
const pauseText = await guest.textContent('[data-testid=online-pause]').catch(() => '');
await host.waitForTimeout(500);
const p0 = await frames();
await host.waitForTimeout(2000);
const p1 = await frames();
check('pause: Esc pauses both players (both show the pause menu, neither simulates)', !!(await host.$('[data-testid=online-pause]')) && /paused/.test(pauseText ?? '') && p1[0] === p0[0] && p1[1] === p0[1], `${pauseText} | host ${p0[0]}->${p1[0]}, guest ${p0[1]}->${p1[1]}`);
check('pause: shows who paused and the auto-resume countdown', /Hosty paused/.test(pauseText ?? '') && /resumes in \d+ s/.test(pauseText ?? ''), pauseText ?? '');
check('pause: no "waiting for opponent" countdown while paused', !(await host.$('[data-testid=net-waiting]')) && !(await guest.$('[data-testid=net-waiting]')));
await guest.click('[data-testid=resume]');
await host.waitForSelector('[data-testid=net-resuming]', { timeout: 5000 }).catch(() => {});
const resumingBoth = !!(await host.$('[data-testid=net-resuming]')) && !!(await guest.$('[data-testid=net-resuming]'));
const r0 = await frames();
await host.waitForTimeout(1500);
const r1 = await frames();
check('resume: either player resumes; both count down "Resuming in 3" (still held)', resumingBoth && r1[0] === r0[0] && !(await host.$('[data-testid=online-pause]')), `host ${r0[0]}->${r1[0]}`);
await host.waitForTimeout(3500);
const r2 = await frames();
check('resume: play continues on both after the countdown', r2[0] > r1[0] + 10 && r2[1] > r1[1] + 10, `host ${r1[0]}->${r2[0]}, guest ${r1[1]}->${r2[1]}`);
// Auto-resume: pause and leave it.
await guest.keyboard.press('Escape');
await host.waitForSelector('[data-testid=online-pause]', { timeout: 5000 }).catch(() => {});
await host.waitForTimeout(31000);
const autoGone = !(await host.$('[data-testid=online-pause]')) && !(await guest.$('[data-testid=online-pause]'));
await host.waitForTimeout(4000);
const a1 = await frames();
await host.waitForTimeout(1500);
const a2 = await frames();
check('pause: resumes on its own after 30 s, play continues', autoGone && a2[0] > a1[0] + 10 && a2[1] > a1[1] + 10, `host ${a1[0]}->${a2[0]}`);

// Rematch: both agree, corners swap, and the new match runs and takes input.
await Promise.all([host, guest].map((p) => p.evaluate(() => { window.__old = window.__dojang.session; window.__dojang.net.requestRematch(); })));
await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__dojang?.session && window.__dojang.session !== window.__old && window.__dojang.session.ready, null, { timeout: 60000 })));
await host.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 }).catch(() => {});
const re0 = await Promise.all([host, guest].map((p) => p.evaluate(() => ({ me: window.__dojang.session.me, frame: window.__dojang.session.net.frame, z: window.__dojang.session.world.fighters.map((f) => +f.z.toFixed(2)) }))));
await host.keyboard.down('KeyW');
await host.waitForTimeout(1500);
await host.keyboard.up('KeyW');
await host.waitForTimeout(1500);
const re1 = await Promise.all([host, guest].map((p) => p.evaluate(() => ({ frame: window.__dojang.session.net.frame, z: window.__dojang.session.world.fighters.map((f) => +f.z.toFixed(2)) }))));
check('rematch: corners swap (host now red)', re0[0].me === 1 && re0[1].me === 0, JSON.stringify(re0.map((r) => r.me)));
check('rematch: the new match keeps simulating on both screens (not frozen)', re1[0].frame > re0[0].frame + 30 && re1[1].frame > re0[1].frame + 30, `host ${re0[0].frame}->${re1[0].frame}, guest ${re0[1].frame}->${re1[1].frame}`);
const hz = (r) => r.z[1]; // host is fighter 1 after the swap
check('rematch: host controls work and both screens agree', Math.abs(hz(re1[0]) - hz(re0[0])) > 0.2 && Math.abs(hz(re1[0]) - hz(re1[1])) < 0.3, `host fighter z ${hz(re0[0])} -> ${hz(re1[0])} (guest sees ${hz(re1[1])})`);

// Guest disappears: host sees the waiting countdown.
await guest.context().setOffline(true);
await guest.evaluate(() => window.__dojang.session.dispose());
await host.waitForSelector('[data-testid=net-waiting]', { timeout: 6000 }).catch(() => {});
check('host sees "waiting for opponent" when the guest drops', !!(await host.$('[data-testid=net-waiting]')), (await host.textContent('[data-testid=net-waiting]').catch(() => '')) ?? '');
check('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
