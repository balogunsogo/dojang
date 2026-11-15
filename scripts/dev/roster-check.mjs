// Roster checks against the real modules (Vite dev server): every fighter builds
// with headgear on and off, no invalid positions, two skinned meshes, vertex
// counts within the Phase 10 budget, and build time.
// Usage: npx vite --port 5175, then node scripts/dev/roster-check.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5175/';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(`${base}?nomenu3d`);
await p.waitForSelector('.home-menu', { timeout: 60000 });
const r = await p.evaluate(async () => {
  const cf = await import('/src/game/render/characterFactory.ts');
  const { FACES } = await import('/src/game/render/face.ts');
  const gltf = await cf.loadFighterAsset();
  const out = { roster: [...cf.ROSTER], keys: Object.keys(cf.CHARACTERS), faces: Object.keys(FACES), fighters: [] };
  for (const id of cf.ROSTER) {
    for (const headgear of [true, false]) {
      const t0 = performance.now();
      const c = cf.createCharacter(gltf, cf.CHARACTERS[id], 'chung', 'yellow', { headgear });
      const ms = performance.now() - t0;
      const meshes = [];
      c.group.traverse((o) => o.isSkinnedMesh && meshes.push(o));
      let nan = 0;
      const verts = meshes.map((m) => m.geometry.attributes.position.count);
      for (const m of meshes) { const a = m.geometry.attributes.position.array; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) nan++; }
      const s = c.group.scale;
      out.fighters.push({ id, headgear, ms: +ms.toFixed(1), meshes: meshes.length, verts, nan, scale: [+s.x.toFixed(4), +s.y.toFixed(4), +s.z.toFixed(4)] });
      c.dispose();
    }
  }
  out.isId = [cf.isCharacterId('amara'), cf.isCharacterId('bob'), cf.isCharacterId(undefined)];
  out.next = cf.ROSTER.map((id) => cf.nextFighter(id));
  return out;
});
const want = ['jae', 'hana', 'tunde', 'sofia', 'minjun', 'amara'];
check('roster: six fighters in the approved order', JSON.stringify(r.roster) === JSON.stringify(want) && JSON.stringify(r.keys) === JSON.stringify(want), r.roster.join(','));
check('roster: CHARACTERS and FACES have identical keys', JSON.stringify(r.keys) === JSON.stringify(r.faces), r.faces.join(','));
check('roster: next fighter wraps in roster order', JSON.stringify(r.next) === JSON.stringify(['hana', 'tunde', 'sofia', 'minjun', 'amara', 'jae']), r.next.join(','));
check('roster: id validation (known / unknown / missing)', JSON.stringify(r.isId) === '[true,false,false]', JSON.stringify(r.isId));
for (const f of r.fighters) {
  const gear = f.verts[1];
  // Measured Phase 10 implementation: match ~7.3-7.5k (main: 5.1k), preview ~8.9-9.1k.
  const budget = f.headgear ? gear <= 8000 : gear <= 9600;
  check(`build ${f.id} (headgear ${f.headgear ? 'on' : 'off'}): two skinned meshes, no invalid positions, gear within budget`, f.meshes === 2 && f.nan === 0 && budget, `gear ${gear} verts, body ${f.verts[0]}, ${f.ms} ms, scale ${f.scale.join('/')}`);
}
console.log(JSON.stringify(r.fighters.map((f) => [f.id, f.headgear ? 'on' : 'off', f.verts[1], f.ms])));
await b.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
