// Phase 12A perf: the same AI v AI arcade match on main and on the branch.
import { chromium } from 'playwright';
const [url, label] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const out = { label, runs: [] };
for (let run = 0; run < 3; run++) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem('dojang.settings.v1', JSON.stringify({ quality: 'low', menuScene: false })));
  const p = await ctx.newPage();
  await p.goto(url + '?nomenu3d&start=normal&mode=competitive');
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await p.evaluate(() => (window.__dojang.session.world.skipIntro = true));
  await p.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 60000 });
  // Sample the simulation cost and frame time across 25 s of AI v AI play.
  const r = await p.evaluate(async () => {
    const s = window.__dojang.session;
    const sim = [], fr = [];
    window.gc?.();
    const heap0 = performance.memory.usedJSHeapSize;
    const t0 = performance.now();
    while (performance.now() - t0 < 25000) {
      await new Promise((r) => setTimeout(r, 500));
      sim.push(s.perf.snapshot.simMs);
      fr.push(s.perf.snapshot.frameMs);
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const rec = s.recorder;
    return { simMs: +avg(sim).toFixed(3), frameMs: +avg(fr).toFixed(1), heapDeltaMB: +((window.gc?.(), performance.memory.usedJSHeapSize - heap0) / 1048576).toFixed(2), ticks: s.world.tick, recUsPerTick: rec ? +((rec.costMs / Math.max(1, rec.count)) * 1000).toFixed(1) : null, recKB: rec ? Math.round(rec.bytes() / 1024) : null };
  });
  out.runs.push(r);
  await ctx.close();
}
console.log(JSON.stringify(out));
await b.close();
