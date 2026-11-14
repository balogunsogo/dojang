// White-flash checks on an emulated phone: a render-resolution change and a
// lost WebGL context must not show a white screen; the scene comes back.
// Usage: npm run build && npx vite preview --port 4173, then node scripts/dev/flash-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 740, height: 360 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(`${base}?start=normal&ai=off&nomenu3d`);
await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
await p.waitForTimeout(1500);
// Mean brightness (0–255) of the middle of the screen, away from the HUD and touch controls.
const bright = async () => {
  const buf = await p.screenshot({ clip: { x: 220, y: 110, width: 300, height: 120 } });
  return p.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 60; c.height = 24;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 60, 24);
    const d = g.getImageData(0, 0, 60, 24).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return Math.round(s / (d.length / 4));
  }, buf.toString('base64'));
};
const normal = await bright();
await p.evaluate(() => { const s = window.__dojang.session; window.__st = s.frame.bind(s); s.frame = () => {}; s.o.gl.setPixelRatio(0.6); });
const dpr = await bright();
check('resolution change: no white frame before the next draw', dpr < 180, `brightness ${normal} -> ${dpr}`);
await p.evaluate(() => { window.__dojang.session.frame = window.__st; });
await p.evaluate(() => { window.__ext = window.__dojang.session.o.gl.getContext().getExtension('WEBGL_lose_context'); window.__ext.loseContext(); });
await p.waitForTimeout(400);
const lost = await bright();
check('lost WebGL context: dark, not white', lost < 120, `brightness ${lost}`);
await p.evaluate(() => window.__ext.restoreContext());
await p.waitForTimeout(1500);
const back = await bright();
check('context restored: the scene draws again', Math.abs(back - normal) < 25, `brightness ${back} (normal ${normal})`);
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
