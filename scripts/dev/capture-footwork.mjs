// Deterministic capture: the app's render loop is paused; we step the game
// at a fixed dt, render, and screenshot each frame (true 30 fps), and also
// record a 60 Hz trace of hips/feet heights for both fighters.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
const [tag] = process.argv.slice(2);
// Usage: node <script> <tag> [outDir]  (needs `npx vite preview --port 4173`)
const out = process.argv[3] ?? 'artifacts/capture';
mkdirSync(out, { recursive: true });
const fdir = `${out}/frames-${tag}`;
rmSync(fdir, { recursive: true, force: true }); mkdirSync(fdir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
await p.goto('http://localhost:4173/?start=normal&ai=off&nomenu3d');
await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
await p.evaluate(() => {
  const s = window.__dojang.session;
  window.__step = s.frame.bind(s);
  s.frame = () => {}; // stop the app loop from advancing time
  const [a, c] = s.world.fighters;
  a.x = 0; a.z = -1.1; c.x = 0; c.z = 1.1;
  s.camRig.update = () => {};
  const cam = s.o.camera;
  cam.fov = 34; cam.position.set(3.6, 1.05, 0); cam.updateProjectionMatrix(); cam.lookAt(0, 0.85, 0);
  for (let i = 0; i < 240; i++) window.__step(1 / 60); // skip the round intro
  window.__trace = [];
  window.__adv = (dt, n) => {
    for (let i = 0; i < n; i++) {
      window.__step(dt / n);
      const V = s.o.camera.position.constructor;
      const row = [];
      for (const an of s.anims) row.push(an.boneWorld('hips', new V()).y, an.group.getObjectByName('DEF-toeL').getWorldPosition(new V()).y - an.boneWorld('footL', new V()).y, an.group.getObjectByName('DEF-toeR').getWorldPosition(new V()).y - an.boneWorld('footR', new V()).y);
      window.__trace.push(row);
    }
    s.o.gl.render(s.o.scene, s.o.camera);
    return s.o.gl.domElement.toDataURL('image/jpeg', 0.82);
  };
});
// Script: idle 4 s, advance 0.7 s, idle 2 s, retreat 0.7 s, idle 2 s, roundhouse, recover 3 s.
const plan = [['idle', 8], ['KeyD', 0.7], ['idle', 2], ['KeyA', 0.7], ['idle', 2], ['kick', 0], ['idle', 3]];
let f = 0;
for (const [what, secs] of plan) {
  if (what === 'kick') { await p.keyboard.press('KeyL'); continue; }
  if (what !== 'idle') await p.keyboard.down(what);
  const n = Math.round(secs * 25);
  for (let i = 0; i < n; i++) {
    const url = await p.evaluate(() => window.__adv(1 / 25, 3));
    writeFileSync(`${fdir}/${String(f++).padStart(4, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  }
  if (what !== 'idle') await p.keyboard.up(what);
}
const trace = await p.evaluate(() => window.__trace);
writeFileSync(`${out}/trace-${tag}.json`, JSON.stringify(trace));
await b.close();
execSync(`ffmpeg -loglevel error -y -framerate 25 -i ${fdir}/%04d.jpg -c:v libx264 -pix_fmt yuv420p -crf 24 ${out}/move-${tag}.mp4`);
console.log(tag, 'frames', f, 'trace', trace.length);
