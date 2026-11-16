// Phase 11: background-fixture cost in the browser (production build).
// Typical: win the quarterfinal => QF2 is simulated. Worst case: 2:00
// rounds, lose the quarterfinal => QF2, SF2, SF1 and the final at once. Measures each fixture (ms, frames, sim vs
// fallback) and the longest frame while they run, at 1x and 4x CPU throttle.
//   node scripts/dev/open-sim-perf.mjs [baseUrl]
import { chromium } from 'playwright';
const base = process.argv.slice(2).find((a) => a.startsWith('http')) ?? 'http://localhost:4180/';
const b = await chromium.launch();
const out = [];
for (const [rate, level, scenario] of [[1, 'normal', 'winQF'], [1, 'hard', 'loseQF'], [4, 'normal', 'winQF'], [4, 'hard', 'loseQF']]) {
  for (let run = 0; run < 3; run++) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false }));
      window.__gaps = [];
      let last = 0;
      const f = (t) => { if (last) window.__gaps.push([t, t - last]); last = t; requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    const p = await ctx.newPage();
    let diag = null;
    p.on('console', (m) => m.text().includes('[Dojang Open] fixtures') && (diag = JSON.parse(m.text().split('fixtures ')[1])));
    await p.goto(base + '?nomenu3d');
    await p.click('[data-testid=mode-tournament]');
    await p.click(`[data-testid=open-level-${level}]`);
    await p.click('[data-testid=open-len-120]');
    await p.click('[data-testid=enter-open]');
    await p.click('[data-testid=fight-stage]');
    await p.click('[data-testid=fight]');
    await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
    await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    for (const r of scenario === 'winQF' ? [[0, 5, 3], [0, 6, 4]] : [[1, 3, 5], [1, 4, 6]]) {
      await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
      if (r === undefined) break;
      // The last round end starts the batch: note the time first.
      await p.evaluate(([w, a, c]) => {
        const s = window.__dojang.session;
        s.competitive.stats[0].points = a;
        s.competitive.stats[1].points = c;
        window.__t0 = performance.now();
        s.world.endRound(w, 'time');
      }, r);
    }
    await p.waitForSelector(scenario === 'winQF' ? '[data-testid=open-next]' : '[data-testid=open-out-title]', { timeout: 60000 });
    const m = await p.evaluate(() => {
      const t1 = performance.now();
      const g = window.__gaps.filter(([t]) => t >= window.__t0 && t <= t1).map(([, d]) => d);
      const base = window.__gaps.filter(([t]) => t < window.__t0).slice(-120).map(([, d]) => d).sort((x, y) => x - y);
      return { panelAfterMs: Math.round(t1 - window.__t0), maxFrameMs: Math.round(Math.max(0, ...g)), medianFrameBeforeMs: Math.round(base[Math.floor(base.length / 2)] ?? 0) };
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const row = { scenario, cpu: `${rate}x`, level, run, ...m, fixtures: diag?.map((d) => `${d.id}:${d.source}:${d.ms}ms:${d.frames}f`).join(' '), totalSimMs: diag?.reduce((s, d) => s + d.ms, 0) };
    out.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
}
await b.close();
