// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [waitForGlobal]
import { chromium } from 'playwright';
const [url, out, w = '1600', h = '2100', waitFor = '__labReady'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
try { await page.waitForFunction((g) => window[g], waitFor, { timeout: 60000 }); } catch (e) { logs.push('timeout waiting for ' + waitFor); }
await page.screenshot({ path: out, ...(out.endsWith('.jpg') ? { type: 'jpeg', quality: 78 } : {}) });
console.log(logs.filter(l=>!l.includes('[vite]')).join('\n'));
await browser.close();
