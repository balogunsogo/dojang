// Focused KO / knockdown animation checks (presentation only).
// Usage: npm run build && npx vite preview --port 4173, then node scripts/dev/ko-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch();

// Shared page helpers: pause the app loop and step the game deterministically.
async function open(mode) {
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  p.on('pageerror', (e) => check('no page errors', false, e.message));
  await p.goto(`${base}?start=normal&ai=off&nomenu3d${mode === 'competitive' ? '&mode=competitive' : ''}`);
  await p.waitForFunction(() => window.__dojang?.session?.ready, null, { timeout: 90000 });
  await p.evaluate(() => {
    const s = window.__dojang.session;
    window.__st = s.frame.bind(s);
    s.frame = () => {};
    const V = s.o.camera.position.constructor;
    const meshes = [];
    s.anims[1].group.traverse((o) => o.isSkinnedMesh && meshes.push(o));
    window.__low = () => {
      let m = 9;
      const v = new V();
      for (const mesh of meshes) for (let i = 0, n = mesh.geometry.attributes.position.count; i < n; i += 3) { mesh.getVertexPosition(i, v); mesh.localToWorld(v); if (v.y < m) m = v.y; }
      return m;
    };
    window.__hips = (i = 1) => s.anims[i].boneWorld('hips', new V()).y;
    window.__place = (tired) => {
      const [a, c] = s.world.fighters;
      a.x = 0; a.z = 0; a.yaw = 0; c.x = 0; c.z = 0.9; c.yaw = Math.PI; a.stamina = 100;
      a.vx = a.vz = c.vx = c.vz = 0;
      if (tired) c.stamina = 0; else c.health = 4;
    };
    for (let i = 0; i < 240; i++) window.__st(1 / 60);
  });
  return p;
}
const headRoundhouse = async (p) => {
  await p.keyboard.down('KeyE');
  await p.keyboard.press('KeyL');
  await p.keyboard.up('KeyE');
};

// ── Arcade: KO falls, settles on the mat, stays down; the next round resets.
{
  const p = await open('arcade');
  await p.evaluate(() => { window.__place(false); for (let i = 0; i < 20; i++) window.__st(1 / 60); window.__place(false); });
  await headRoundhouse(p);
  const r = await p.evaluate(() => {
    const s = window.__dojang.session; const c = s.world.fighters[1];
    const out = { hips: [], low: [], states: new Set(), xz: [], tick: [] };
    for (let i = 0; i < 150; i++) {
      window.__st(1 / 60);
      out.states.add(c.state);
      out.tick.push(window.__hips());
      if (i % 5 === 0) { out.hips.push(+window.__hips().toFixed(3)); out.low.push(+window.__low().toFixed(3)); }
      if (i >= 120) out.xz.push([c.x, c.z]);
    }
    const drift = Math.hypot(out.xz.at(-1)[0] - out.xz[0][0], out.xz.at(-1)[1] - out.xz[0][1]);
    // Per tick: a body falling from standing moves at most ~4 m/s (0.067 m a tick); a snap would exceed it.
    const steps = out.tick.slice(1).map((h, i) => Math.abs(h - out.tick[i]));
    return { ...out, states: [...out.states], drift, maxStep: Math.max(...steps), phase: s.world.phase, src: s.anims[1].sourceKey, yaw: s.anims[1].fallYaw };
  });
  check('Arcade: the finishing hit is a KO and the round ends', r.states.includes('ko') && r.phase === 'round-over', `${r.states.join('>')} / ${r.phase}`);
  check('KO: the body falls to the mat within 1.5 s', Math.min(...r.hips) < 0.3, `hips ${r.hips[0]} -> ${Math.min(...r.hips)}`);
  check('KO: impact reaction, then the fall, then settled (no clip-from-T-pose)', r.src === 'ko-fall' && r.hips[1] > 0.6, `source ${r.src}, hips at 5 ticks ${r.hips[1]}`);
  check('KO: no part of the body sinks into the mat (≤ 1 cm, sampled)', Math.min(...r.low) > -0.01, `lowest vertex ${Math.min(...r.low)} m`);
  check('KO: resting on the mat, not floating', r.low.at(-1) < 0.02 && r.low.at(-1) > -0.01, `rest lowest vertex ${r.low.at(-1)} m`);
  check('KO: no sliding once down (last 0.5 s)', r.drift < 0.005, `${r.drift.toFixed(4)} m`);
  check('KO: no snaps (hips move ≤ 0.08 m per tick, about free-fall speed)', r.maxStep < 0.08, `max ${r.maxStep.toFixed(3)} m per tick`);
  // The next round starts after the round-over pause: both fighters back in stance, the fall cleared.
  const n = await p.evaluate(() => { const s = window.__dojang.session; for (let i = 0; i < 120; i++) window.__st(1 / 60); return { phase: s.world.phase, round: s.world.round, state: s.world.fighters[1].state, hips: +window.__hips().toFixed(3), yaw: s.anims[1].fallYaw, src: s.anims[1].sourceKey }; });
  check('Next round: the KO fighter is back in stance (fall state cleared)', n.round === 2 && n.state === 'idle' && n.hips > 0.75 && n.yaw === 0, JSON.stringify(n));
  // Final round KO: match over, result panel, rematch resets.
  await p.evaluate(() => { const s = window.__dojang.session; s.world.roundWins = [1, 0]; for (let i = 0; i < 200; i++) window.__st(1 / 60); window.__place(false); for (let i = 0; i < 20; i++) window.__st(1 / 60); window.__place(false); });
  await headRoundhouse(p);
  const m = await p.evaluate(() => { const s = window.__dojang.session; for (let i = 0; i < 150; i++) window.__st(1 / 60); s.publishHud ? null : null; s['publishHud']({ high: false, lead: false }); return { phase: s.world.phase, winner: s.world.matchWinner, hips: +window.__hips().toFixed(3) }; });
  await p.waitForSelector('[data-testid=result]', { timeout: 5000 }).catch(() => {});
  check('Final KO: match over, winner recorded, result panel shown, loser stays down', m.phase === 'match-over' && m.winner === 0 && m.hips < 0.3 && !!(await p.$('[data-testid=result]')), JSON.stringify(m));
  await p.click('[data-testid=rematch]');
  const rm = await p.evaluate(() => { const s = window.__dojang.session; for (let i = 0; i < 30; i++) window.__st(1 / 60); return { phase: s.world.phase, round: s.world.round, state: s.world.fighters[1].state, health: s.world.fighters[1].health, hips: +window.__hips().toFixed(3), yaw: s.anims[1].fallYaw }; });
  check('Rematch: fresh match, fighter standing in stance', rm.round === 1 && rm.state === 'idle' && rm.health === 100 && rm.hips > 0.75 && rm.yaw === 0, JSON.stringify(rm));
  await p.close();
}

// ── Competitive: knockdown recovery is unchanged (sim timing), the fighter gets up into stance.
{
  const p = await open('competitive');
  await p.evaluate(() => { window.__place(true); for (let i = 0; i < 20; i++) window.__st(1 / 60); window.__place(true); });
  await headRoundhouse(p);
  const r = await p.evaluate(() => {
    const s = window.__dojang.session; const w = s.world; const c = w.fighters[1];
    let downAt = -1, upAt = -1, minHips = 9, minLow = 9, lowAt = '', stun = 0, downTicks = 0;
    const phases = new Set();
    for (let i = 0; i < 260; i++) {
      window.__st(1 / 60);
      phases.add(w.phase);
      if (c.state === 'down' && downAt < 0) { downAt = w.tick; stun = c.stunTicks; }
      if (downAt >= 0 && upAt < 0 && c.state === 'idle') upAt = w.tick;
      if (c.state === 'down') {
        if (w.hitstop === 0) downTicks++; // the sim's down time pauses during hit stop
        minHips = Math.min(minHips, window.__hips());
        if (i % 2 === 0) { const l = window.__low(); if (l < minLow) { minLow = l; lowAt = `${c.stateTick} ${s.anims[1].sourceKey}`; } }
      }
    }
    return { downAt, upAt, stun, downTicks, lowAt, minHips: +minHips.toFixed(3), minLow: +minLow.toFixed(3), phases: [...phases], points: [...w.points], hipsAfter: +window.__hips().toFixed(3), yaw: s.anims[1].fallYaw, state: c.state };
  });
  check('Competitive: a head kick on a tired fighter is a knockdown, scored as usual', r.downAt > 0 && r.points[0] === 3, `points ${r.points}`);
  check('Knockdown recovery timing is the sim\'s (down for exactly stunTicks, excluding hit stop)', r.downTicks === r.stun, `${r.downTicks} ticks vs stun ${r.stun}`);
  check('Knockdown: reaches the mat (not held mid-fall)', r.minHips < 0.3, `lowest hips ${r.minHips}`);
  check('Knockdown: no part sinks into the mat', r.minLow > -0.01, `${r.minLow} m at tick/source ${r.lowAt}`);
  check('Knockdown: back up in stance when play resumes; referee stoppage and resume unchanged', r.state === 'idle' && r.hipsAfter > 0.75 && r.yaw === 0 && r.phases.includes('break') && r.phases.includes('fight'), JSON.stringify({ state: r.state, hips: r.hipsAfter, phases: r.phases }));
  await p.close();
}
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
