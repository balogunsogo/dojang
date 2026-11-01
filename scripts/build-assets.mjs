// Builds public/assets/fighter.glb from the CC0 Quaternius "Universal Animation
// Library" (standard/free edition), mirrored on GitHub at a pinned commit.
//
// What it does (see docs/ASSET_MANIFEST.md):
//   1. Downloads the source glTF + bin at a pinned commit and checks SHA-256.
//   2. Keeps only the animation clips the game uses.
//   3. Drops UV sets (the game colors the mesh procedurally, no textures).
//   4. Merges the two primitives into one (one draw call per fighter).
//   5. Resamples/prunes animation keys, quantizes, and meshopt-compresses.
//
// Usage: node scripts/build-assets.mjs [--source <dir>]
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune, resample, dedup, meshopt, joinPrimitives } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = 'e24c23cf2a1323488a3faa226ea7ea21f644b73e';
const BASE = `https://raw.githubusercontent.com/J-Ponzo/gltf-universal-animation-library/${COMMIT}`;
const FILES = {
  'glTF/AnimationLibrary_Godot_Standard.gltf': '0ff075c7ad6855c5c2c37a171592ee8f0d6ab2f58259e2be77a9b63dd8027765',
  'glTF/AnimationLibrary_Godot_Standard.bin': '6e65377d81558333c4093dbb144a48fd19019343d82b1a3a7992a98ec0e0543c',
  LICENSE: 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499',
};
// Clips used by the game. Everything else is discarded.
const KEEP_CLIPS = ['Idle_Loop', 'Hit_Chest', 'Hit_Head', 'Death01', 'Punch_Jab', 'Punch_Cross'];

const args = process.argv.slice(2);
const srcIdx = args.indexOf('--source');
const cacheDir = srcIdx >= 0 ? args[srcIdx + 1] : join(ROOT, '.asset-cache', COMMIT);

async function fetchVerified(rel, sha) {
  const dest = join(cacheDir, rel);
  let buf;
  try {
    await stat(dest);
    buf = await readFile(dest);
  } catch {
    const res = await fetch(`${BASE}/${rel}`);
    if (!res.ok) throw new Error(`Download failed ${rel}: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
  }
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== sha) throw new Error(`Checksum mismatch for ${rel}: ${got}`);
  return dest;
}

for (const [rel, sha] of Object.entries(FILES)) await fetchVerified(rel, sha);

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(join(cacheDir, 'glTF/AnimationLibrary_Godot_Standard.gltf'));
const root = doc.getRoot();

for (const anim of root.listAnimations()) {
  if (!KEEP_CLIPS.includes(anim.getName())) {
    anim.dispose();
    continue;
  }
  // Bone lengths never change: keep rotations everywhere, translation only
  // on the hips (root motion / crouch). Scale tracks are constant.
  for (const ch of anim.listChannels()) {
    const path = ch.getTargetPath();
    const node = ch.getTargetNode();
    if (path === 'scale' || (path === 'translation' && node?.getName() !== 'DEF-hips')) {
      const sampler = ch.getSampler();
      ch.dispose();
      sampler?.dispose();
    }
  }
}

// One neutral material; the runtime replaces it with a vertex-colored one.
const mats = root.listMaterials();
const mat = mats[0];
mat.setName('M_Fighter').setDoubleSided(false);
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    prim.setMaterial(mat);
    for (const sem of ['TEXCOORD_0', 'TEXCOORD_1']) {
      const a = prim.getAttribute(sem);
      if (a) prim.setAttribute(sem, null);
    }
  }
}
for (const m of mats.slice(1)) m.dispose();

for (const mesh of root.listMeshes()) {
  const prims = mesh.listPrimitives();
  if (prims.length > 1) {
    const joined = joinPrimitives(prims);
    for (const p of prims) {
      mesh.removePrimitive(p);
      p.dispose();
    }
    mesh.addPrimitive(joined);
  }
}

await doc.transform(dedup(), resample({ tolerance: 0.0005 }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }), prune());

// Some orphaned accessors survive prune(); keep only the ones still in use.
const used = new Set();
for (const anim of root.listAnimations())
  for (const smp of anim.listSamplers()) used.add(smp.getInput()).add(smp.getOutput());
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) {
    used.add(prim.getIndices());
    for (const a of prim.listAttributes()) used.add(a);
  }
for (const skin of root.listSkins()) used.add(skin.getInverseBindMatrices());
for (const acc of root.listAccessors()) if (!used.has(acc)) acc.dispose();

const outDir = join(ROOT, 'public', 'assets');
await mkdir(outDir, { recursive: true });
const glb = await io.writeBinary(doc);
await writeFile(join(outDir, 'fighter.glb'), glb);
console.log(`fighter.glb written: ${(glb.byteLength / 1024).toFixed(1)} KiB, clips: ${root.listAnimations().map((a) => a.getName()).join(', ')}`);
