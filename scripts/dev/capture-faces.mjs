import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
const [tag] = process.argv.slice(2);
// Usage: node <script> <tag> [outDir]  (needs `npx vite preview --port 4173`)
const out = process.argv[3] ?? 'artifacts/capture';
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4173/?start=normal&ai=off&nomenu3d');
await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
await p.waitForTimeout(2500);
for (const [who, ang, name] of [[0, 0, 'jae-front'], [0, 40, 'jae-3q'], [1, 0, 'hana-front'], [1, -40, 'hana-3q']]) {
  await p.evaluate(([who, ang]) => {
    const s = window.__dojang.session;
    s.paused = true;
    s.camRig.update = () => {};
    const cam = s.o.camera;
    const head = s.anims[who].boneWorld('head', cam.position.clone());
    head.y += 0.07 * s.chars[who].group.scale.x;
    const f = s.world.fighters[who];
    const yaw = f.yaw + (ang * Math.PI) / 180;
    cam.position.set(head.x + Math.sin(yaw) * 0.62, head.y + 0.02, head.z + Math.cos(yaw) * 0.62);
    cam.fov = 30; cam.updateProjectionMatrix();
    cam.lookAt(head);
  }, [who, ang]);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/${tag}-${name}.jpg`, quality: 88 });
}
console.log('errors', errs);
await b.close();
