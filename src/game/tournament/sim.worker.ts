/// <reference lib="webworker" />
/**
 * Dojang Open background fixtures, off the main thread: one headless
 * Competitive match per message, with its own time budget.
 */
import { HeadlessBout } from './headless';
import type { SimRequest, SimResponse } from './simulate';

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const r = e.data;
  const t0 = performance.now();
  let res: SimResponse;
  try {
    const sim = new HeadlessBout(r.stats, r.difficulty, r.roundSeconds, r.seed);
    while (!sim.over) {
      sim.step(600);
      if (performance.now() - t0 > r.budgetMs) break;
    }
    const out = sim.result();
    res = out ? { id: r.id, ok: true, ...out } : { id: r.id, ok: false, reason: sim.over ? 'frame cap' : 'budget' };
  } catch (err) {
    res = { id: r.id, ok: false, reason: `error: ${String(err)}` };
  }
  (self as unknown as Worker).postMessage(res);
};
