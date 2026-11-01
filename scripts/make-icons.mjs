// Renders the app icons (PNG) with headless Chromium. Original artwork:
// a red/blue taegeuk on a dark field. Usage: node scripts/make-icons.mjs
import { chromium } from 'playwright';
const sizes = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, maskable] of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<canvas id=c width=${size} height=${size}></canvas><style>body{margin:0}</style>`);
  await page.evaluate(({ size, maskable }) => {
    const g = document.getElementById('c').getContext('2d');
    g.fillStyle = '#1d1712';
    g.fillRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2;
    const R = size * (maskable ? 0.27 : 0.34);
    g.fillStyle = '#f2ece0';
    g.beginPath(); g.arc(cx, cy, R * 1.12, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(cx, cy); g.rotate(Math.atan2(2, 3));
    g.fillStyle = '#cd2e3a'; g.beginPath(); g.arc(0, 0, R, Math.PI, 0); g.fill();
    g.fillStyle = '#0047a0'; g.beginPath(); g.arc(0, 0, R, 0, Math.PI); g.fill();
    g.fillStyle = '#cd2e3a'; g.beginPath(); g.arc(-R / 2, 0, R / 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0047a0'; g.beginPath(); g.arc(R / 2, 0, R / 2, 0, Math.PI * 2); g.fill();
    g.restore();
  }, { size, maskable });
  await page.locator('#c').screenshot({ path: `public/icons/${name}` });
}
await browser.close();
console.log('icons written');
