// "Play without the browser bars" hint: shown on touch-first devices with the right steps, hidden on desktop.
// Usage: npm run build && npx vite preview --port 4173, then node scripts/dev/pwa-hint-check.mjs [baseUrl]
import { chromium, devices } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const cases = [
  ['iPhone', devices['iPhone 13 landscape'], /Share.*Add to Home Screen/],
  ['iPhone (portrait)', devices['iPhone 13'], /Share.*Add to Home Screen/],
  ['Android phone (portrait)', devices['Pixel 7'], /⋮.*Add to Home screen/],
  ['iPad', devices['iPad Pro 11 landscape'], /Share.*Add to Home Screen/],
  ['Android phone (Chrome)', devices['Pixel 7 landscape'], /⋮.*Add to Home screen/],
  ['Android tablet (Chrome)', devices['Galaxy Tab S4 landscape'], /⋮.*Add to Home screen/],
  ['Android phone (Samsung Internet)', { ...devices['Galaxy S9+ landscape'], userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36' }, /≡.*Add page to.*Home screen/],
  ['Desktop', { viewport: { width: 1280, height: 720 } }, null],
];
const b = await chromium.launch();
for (const [name, dev, want] of cases) {
  const ctx = await b.newContext(dev);
  const p = await ctx.newPage();
  await p.goto(`${base}?nomenu3d`);
  await p.waitForSelector('.home-menu');
  const el = await p.$('[data-testid=pwa-hint]');
  const text = el ? await el.textContent() : '';
  const visible = el ? await el.isVisible() : false;
  const box = el ? await el.boundingBox() : null;
  const vp = p.viewportSize();
  const onScreen = !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1;
  if (want) check(`${name}: hint visible on screen with the right steps`, visible && onScreen && want.test(text), `${text} ${JSON.stringify(box)} in ${vp.width}x${vp.height}`);
  else check(`${name}: no hint`, !el, text);
  if (process.env.SHOT && want) await p.screenshot({ path: `${process.env.SHOT}-${name.replace(/\W+/g, '-')}.png` });
  await ctx.close();
}
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
