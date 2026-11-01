// Captures screenshots, perf counters and UI coverage for before/after
// comparisons. Usage: node scripts/ux-capture.mjs <baseUrl> <outDir> [label]
// UI coverage = share of the viewport covered by the bounding boxes of
// visible HUD and touch controls (union, approximated on a 4 px grid).
// Fighter visibility = fraction of both fighters' head/hip/foot points that
// project inside the viewport and outside every UI box.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base = 'http://localhost:4173/', out = 'artifacts/ux', label = 'run'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const devices = [
  { name: 'iphone-se-landscape', width: 667, height: 375, dpr: 2 },
  { name: 'iphone-15-landscape', width: 852, height: 393, dpr: 3, insets: { left: 59, right: 59, bottom: 21 } },
  { name: 'iphone-15-pro-max-landscape', width: 932, height: 430, dpr: 3, insets: { left: 59, right: 59, bottom: 21 } },
  { name: 'pixel-8-landscape', width: 915, height: 412, dpr: 2.6 },
];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = [];
for (const d of devices) {
  const ctx = await browser.newContext({ viewport: { width: d.width, height: d.height }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    try {
      const raw = localStorage.getItem('dojang.settings.v1');
      const s = raw ? JSON.parse(raw) : {};
      localStorage.setItem('dojang.settings.v1', JSON.stringify({ ...s, quality: 'low', showPerf: false, volume: 0 }));
    } catch {}
  });
  const page = await ctx.newPage();
  // Simulate iPhone safe-area insets (Chromium has no notch): inject as CSS variables override.
  if (d.insets) {
    await page.addInitScript((ins) => {
      const st = document.createElement('style');
      st.textContent = `:root{--sal:${ins.left}px !important;--sar:${ins.right}px !important;--sab:${ins.bottom}px !important;}`;
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
    }, d.insets);
  }
  await page.goto(`${base}?start=normal&seed=7`);
  await page.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__dojang.session.world.phase === 'fight', null, { timeout: 90000 });
  // Let the fight develop.
  await page.evaluate(() => new Promise((r) => { const w = window.__dojang.session.world; const t = w.tick; const id = setInterval(() => { if (w.tick - t > 240) { clearInterval(id); r(); } }, 50); }));
  const data = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight, G = 4;
    const sel = '.hud-top, .hud-status, .hud-mini, .tb, .tbtn, .kick-main, .wheel, .chip, .stick-base';
    const boxes = [...document.querySelectorAll(sel)]
      .filter((e) => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05; })
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    let covered = 0, total = 0;
    for (let y = 0; y < H; y += G) for (let x = 0; x < W; x += G) { total++; if (boxes.some((b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom)) covered++; }
    const s = window.__dojang.session;
    const cam = s.o?.camera ?? null;
    let visible = null;
    try {
      const THREEcam = cam;
      const pts = [];
      for (const f of s.world.fighters) for (const h of [0.1, 0.95, 1.75]) pts.push([f.x, h, f.z]);
      let ok = 0;
      for (const p of pts) {
        const v = { x: p[0], y: p[1], z: p[2] };
        const e = THREEcam.matrixWorldInverse.elements, pm = THREEcam.projectionMatrix.elements;
        const vx = e[0]*v.x+e[4]*v.y+e[8]*v.z+e[12], vy = e[1]*v.x+e[5]*v.y+e[9]*v.z+e[13], vz = e[2]*v.x+e[6]*v.y+e[10]*v.z+e[14];
        const cx = pm[0]*vx+pm[4]*vy+pm[8]*vz+pm[12], cy = pm[1]*vx+pm[5]*vy+pm[9]*vz+pm[13], cw = pm[3]*vx+pm[7]*vy+pm[11]*vz+pm[15];
        const sx = (cx / cw * 0.5 + 0.5) * W, sy = (1 - (cy / cw * 0.5 + 0.5)) * H;
        const inView = sx >= 0 && sx <= W && sy >= 0 && sy <= H;
        const blocked = boxes.some((b) => sx >= b.left && sx < b.right && sy >= b.top && sy < b.bottom);
        if (inView && !blocked) ok++;
      }
      visible = ok / pts.length;
    } catch { visible = null; }
    const p = s.perf.snapshot;
    return { uiCoverage: covered / total, fighterPointsVisible: visible, hudHeight: document.querySelector('.hud-top')?.getBoundingClientRect().height ?? null, draws: p.drawCalls, tris: p.triangles, animMs: p.animMs, simMs: p.simMs };
  });
  await page.screenshot({ path: `${out}/${label}-${d.name}.jpg`, type: 'jpeg', quality: 80 });
  report.push({ device: d.name, ...data });
  console.log(d.name, JSON.stringify(data));
  await ctx.close();
}
writeFileSync(`${out}/${label}-report.json`, JSON.stringify(report, null, 2));
await browser.close();
