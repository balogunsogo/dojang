// Deterministic KO / knockdown capture: the app loop is paused, the game is
// stepped at a fixed dt and each frame is rendered and saved (true 25 fps).
// Also records per-tick numbers for the falling fighter: lowest bone height,
// hips height and ground drift, so floor clipping, floating and sliding show
// up as numbers, not just pictures.
// Usage: npx vite preview --port 4173, then
//   node scripts/dev/capture-ko.mjs <tag> [arcade|competitive|side|front] [outDir]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';

const tag = process.argv[2] ?? 'ko';
const scene = process.argv[3] ?? 'arcade';
const out = process.argv[4] ?? 'artifacts/capture';
const base = process.env.BASE ?? 'http://localhost:4173/';
mkdirSync(out, { recursive: true });
const fdir = `${out}/frames-${tag}`;
rmSync(fdir, { recursive: true, force: true });
mkdirSync(fdir, { recursive: true });

const competitive = scene === 'competitive';
// Which technique finishes the fight: head roundhouse (sideways hit), side kick (straight push), back kick (heavy, straight).
const kick = { arcade: 'KeyL', competitive: 'KeyL', side: 'KeyU', front: 'KeyK' }[scene] ?? 'KeyL';
const head = scene === 'arcade' || scene === 'competitive';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
await p.goto(`${base}?start=normal&ai=off&nomenu3d${competitive ? '&mode=competitive' : ''}`);
await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
await p.evaluate(([competitive, scene, cam_]) => {
  const s = window.__dojang.session;
  window.__step = s.frame.bind(s);
  s.frame = () => {};
  s.camRig.update = () => {};
  const cam = s.o.camera;
  cam.fov = 40;
  // CAM=front films from behind the attacker's shoulder (shows the fall direction).
  const front = cam_ === 'front';
  cam.position.set(front ? 1.0 : 3.4, front ? 1.5 : 1.05, front ? -2.4 : 0.4);
  cam.updateProjectionMatrix();
  cam.lookAt(0, 0.55, 0.7);
  for (let i = 0; i < 240; i++) window.__step(1 / 60); // skip the intro
  const [a, c] = s.world.fighters;
  const dist = { side: 1.05, front: 0.95 }[scene] ?? 0.9;
  a.x = 0; a.z = 0; a.yaw = 0; c.x = 0; c.z = dist; c.yaw = Math.PI;
  a.vx = a.vz = c.vx = c.vz = 0;
  a.stamina = 100;
  if (competitive) c.stamina = 0; // a head or turning kick on a tired fighter knocks them down
  else c.health = 4; // the next clean hit is a KO
  for (let i = 0; i < 20; i++) window.__step(1 / 60);
  if (competitive) c.stamina = 0;
  const V = cam.position.constructor;
  window.__trace = [];
  window.__adv = (n) => {
    for (let i = 0; i < n; i++) {
      window.__step(1 / 60);
      const an = s.anims[1];
      let low = 9;
      an.group.traverse((o) => { if (o.isBone && o.name !== 'root') low = Math.min(low, o.getWorldPosition(new V()).y); });
      const h = an.boneWorld('hips', new V());
      const f = s.world.fighters[1];
      window.__trace.push({ t: s.world.tick, state: f.state, low: +low.toFixed(3), hipsY: +h.y.toFixed(3), x: +f.x.toFixed(3), z: +f.z.toFixed(3) });
    }
    s.o.gl.render(s.o.scene, s.o.camera);
    return s.o.gl.domElement.toDataURL('image/jpeg', 0.85);
  };
}, [competitive, scene, process.env.CAM ?? 'side']);

let f = 0;
const shoot = async (frames, step = 2) => {
  for (let i = 0; i < frames; i++) {
    const url = await p.evaluate((n) => window.__adv(n), step);
    writeFileSync(`${fdir}/${String(f++).padStart(4, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  }
};
await shoot(6);
if (head) await p.keyboard.down('KeyE');
await p.keyboard.press(kick);
if (head) await p.keyboard.up('KeyE');
// Arcade: the KO and the rest pose. Competitive: down, the count, and the rise back to stance.
await shoot(competitive ? 140 : 95);
const trace = await p.evaluate(() => window.__trace);
writeFileSync(`${out}/trace-${tag}.json`, JSON.stringify(trace));
await b.close();
execSync(`ffmpeg -loglevel error -y -framerate 30 -i ${fdir}/%04d.jpg -c:v libx264 -pix_fmt yuv420p -crf 23 ${out}/ko-${tag}.mp4`);
const states = [...new Set(trace.map((r) => r.state))].join(' > ');
const down = trace.filter((r) => r.state === 'ko' || r.state === 'down');
const tail = down.slice(-30);
const minLow = Math.min(...down.map((r) => r.low));
const drift = tail.length ? Math.hypot(tail.at(-1).x - tail[0].x, tail.at(-1).z - tail[0].z) : 0;
console.log(JSON.stringify({ tag, frames: f, states, minBoneY: minLow, restHipsY: tail.at(-1)?.hipsY, restDriftLast30Ticks: +drift.toFixed(3) }));
