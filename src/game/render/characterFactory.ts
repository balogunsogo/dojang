import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FighterStats } from '../combat/Fighter';
import { FACES } from './face';
import { buildGear } from './gear';
import type { HairBack, HairStyle } from './hair';

export const FIGHTER_URL = `${import.meta.env?.BASE_URL ?? '/'}assets/fighter.glb`;

export type CharacterId = 'jae' | 'hana' | 'tunde' | 'sofia' | 'minjun' | 'amara';

export interface CharacterDef {
  id: CharacterId;
  name: string;
  /** Short HUD label. */
  short: string;
  /** Native-script name, only where it is the fighter's real name (Hangul); '' otherwise. */
  hangul: string;
  /** Shown where there is no native-script name. */
  origin: string;
  blurb: string;
  /** Height relative to the mannequin. */
  scale: number;
  /** Horizontal build (x/z) relative to height; visual only (hitboxes are shared). */
  build: number;
  skin: string;
  dobok: string;
  hair: string;
  /** Scalp hair, built only for the bare-head fighter-select preview. */
  hairStyle: HairStyle;
  /** What hangs below the headgear rim; always built. */
  hairBack: HairBack;
  stats: FighterStats;
}

/** The roster in its approved order (selection lists, defaults, "next fighter"). */
export const ROSTER: readonly CharacterId[] = ['jae', 'hana', 'tunde', 'sofia', 'minjun', 'amara'];

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  jae: {
    id: 'jae', name: 'Kim Jae-won', short: 'Jae', hangul: '김재원', origin: 'Korea',
    blurb: 'Powerful and patient. Heavier kicks, steady stamina.',
    scale: 1.0, build: 1.0, skin: '#c99a76', dobok: '#f1efe9', hair: '#151110', hairStyle: 'crop', hairBack: 'none',
    stats: { speed: 1.02, power: 1.08, staminaRegen: 1.03, maxHealth: 100 },
  },
  hana: {
    id: 'hana', name: 'Park Ha-na', short: 'Ha-na', hangul: '박하나', origin: 'Korea',
    blurb: 'Fast footwork and quick recovery. Lighter strikes.',
    scale: 0.95, build: 1.0, skin: '#e0b494', dobok: '#f4f3ef', hair: '#20140f', hairStyle: 'part', hairBack: 'ponytail',
    stats: { speed: 1.09, power: 0.94, staminaRegen: 1.1, maxHealth: 100 },
  },
  tunde: {
    id: 'tunde', name: 'Tunde Adeyemi', short: 'Tunde', hangul: '', origin: 'Nigeria',
    blurb: 'Relentless pressure. Walks you down; deep stamina.',
    scale: 1.02, build: 1.04, skin: '#8f5c3e', dobok: '#f1efe9', hair: '#0f0c0b', hairStyle: 'coily', hairBack: 'none',
    stats: { speed: 0.98, power: 1.06, staminaRegen: 1.05, maxHealth: 100 },
  },
  sofia: {
    id: 'sofia', name: 'Sofia Reyes', short: 'Sofia', hangul: '', origin: 'Mexico',
    blurb: 'Precise and disciplined. Clean technique, never rushed.',
    scale: 0.965, build: 1.0, skin: '#b98262', dobok: '#f3f1ec', hair: '#2b1a12', hairStyle: 'sleek', hairBack: 'bun',
    stats: { speed: 1.04, power: 1.03, staminaRegen: 1.04, maxHealth: 100 },
  },
  minjun: {
    id: 'minjun', name: 'Seo Min-jun', short: 'Min-jun', hangul: '서민준', origin: 'Korea',
    blurb: 'Light on his feet. Sharp angles, lighter strikes.',
    scale: 0.985, build: 0.95, skin: '#d2a07e', dobok: '#f2f1ed', hair: '#191513', hairStyle: 'fringe', hairBack: 'none',
    stats: { speed: 1.12, power: 0.96, staminaRegen: 1.07, maxHealth: 100 },
  },
  amara: {
    id: 'amara', name: 'Amara Okafor', short: 'Amara', hangul: '', origin: 'Nigeria',
    blurb: 'Quick and adaptable. Fast hands and feet, no weak side.',
    scale: 0.945, build: 0.98, skin: '#9c6444', dobok: '#f4f3ef', hair: '#140f0d', hairStyle: 'cornrows', hairBack: 'braid',
    stats: { speed: 1.08, power: 0.99, staminaRegen: 1.06, maxHealth: 100 },
  },
};

/** Is this a fighter id this build knows (saves, the network)? */
export const isCharacterId = (v: unknown): v is CharacterId => typeof v === 'string' && (ROSTER as readonly string[]).includes(v);

/** The fighter after `id` in roster order (default opponent, couch player 2). */
export const nextFighter = (id: CharacterId): CharacterId => ROSTER[(ROSTER.indexOf(id) + 1) % ROSTER.length];

/** Competition colors: chung (blue) and hong (red) trunk protectors/headgear. */
export const CORNER_COLORS = { chung: '#1f4fb8', hong: '#c42b2b' } as const;
export const BELT_COLORS = { white: '#f2f2ee', yellow: '#e8c12c', green: '#2f8f3a', red: '#b8322c', black: '#141414' } as const;
export type BeltColor = keyof typeof BELT_COLORS;

let gltfPromise: Promise<GLTF> | null = null;

export function loadFighterAsset(url = FIGHTER_URL): Promise<GLTF> {
  if (!gltfPromise) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    gltfPromise = loader.loadAsync(url);
  }
  return gltfPromise;
}

export interface CharacterInstance {
  group: THREE.Group;
  model: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  clips: THREE.AnimationClip[];
  dispose(): void;
}

/**
 * Build one fighter: clone the shared CC0 mannequin, colour its skin, and
 * dress it with a fitted dobok, belt, hogu, headgear, gloves and foot
 * protectors (gear.ts): two skinned draw calls on one skeleton, no textures.
 */
export function createCharacter(gltf: GLTF, def: CharacterDef, corner: 'chung' | 'hong', belt: BeltColor, opts: { headgear?: boolean } = {}): CharacterInstance {
  const model = cloneSkinned(gltf.scene);
  let mesh: THREE.SkinnedMesh | null = null;
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) throw new Error('fighter.glb has no skinned mesh');
  const skinned = mesh as THREE.SkinnedMesh;
  skinned.geometry = skinned.geometry.clone();
  model.updateMatrixWorld(true);
  const samples = paintVertexColors(skinned, def, corner, belt);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0 });
  skinned.material = material;
  skinned.castShadow = true;
  skinned.receiveShadow = false;

  // Dobok, belt, hogu, headgear, gloves and foot protectors: one extra
  // skinned mesh on the same skeleton (see gear.ts).
  const lin = (hex: string) => new THREE.Color(hex).convertSRGBToLinear();
  const gearGeo = buildGear(skinned, samples, {
    dobok: lin(def.dobok),
    skin: lin(def.skin),
    gear: lin(CORNER_COLORS[corner]),
    belt: lin(BELT_COLORS[belt]),
    hair: lin(def.hair),
    face: FACES[def.id],
    hairStyle: def.hairStyle,
    hairBack: def.hairBack,
    headgear: opts.headgear,
  });
  const gearMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
  const gearMesh = new THREE.SkinnedMesh(gearGeo, gearMat);
  gearMesh.name = 'gear';
  gearMesh.castShadow = true;
  gearMesh.frustumCulled = false;
  skinned.parent!.add(gearMesh);
  gearMesh.position.copy(skinned.position);
  gearMesh.quaternion.copy(skinned.quaternion);
  gearMesh.scale.copy(skinned.scale);
  gearMesh.bind(skinned.skeleton, skinned.bindMatrix);
  // The skinned bounds are computed from the bind pose; animation moves limbs
  // far outside them, so skip per-object frustum culling (2 fighters only).
  skinned.frustumCulled = false;

  const group = new THREE.Group();
  group.name = `fighter-${def.id}`;
  // Build is a group transform only: the simulation, hitboxes and reach are shared.
  group.scale.set(def.scale * def.build, def.scale, def.scale * def.build);
  group.add(model);
  group.updateMatrixWorld(true);

  return {
    group,
    model,
    mesh: skinned,
    clips: gltf.animations,
    dispose() {
      skinned.geometry.dispose();
      material.dispose();
      gearGeo.dispose();
      gearMat.dispose();
      group.removeFromParent();
    },
  };
}

function paintVertexColors(mesh: THREE.SkinnedMesh, def: CharacterDef, corner: 'chung' | 'hong', belt: BeltColor): { p: THREE.Vector3; bone: string }[] {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const bones = mesh.skeleton.bones;
  const names = bones.map((b) => b.name);
  const headIdx = names.indexOf('DEF-head');
  const head = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  bones[headIdx].getWorldPosition(head);

  const skin = new THREE.Color(def.skin).convertSRGBToLinear();
  const dobok = new THREE.Color(def.dobok).convertSRGBToLinear();
  const dobokShade = dobok.clone().multiplyScalar(0.9);
  const gear = new THREE.Color(CORNER_COLORS[corner]).convertSRGBToLinear();
  const gearDark = gear.clone().multiplyScalar(0.55);
  const beltC = new THREE.Color(BELT_COLORS[belt]).convertSRGBToLinear();
  const hair = new THREE.Color('#1b1512').convertSRGBToLinear();

  const boneMats = bones.map((b, i) => b.matrixWorld.clone().multiply(mesh.skeleton.boneInverses[i]));
  // Phase 10: the mannequin's head is flat-fronted with hard corners, which
  // shows as a seam beside the face mask. Pre-pass: per 1 cm slab, the head's
  // half-width, front and centre, so the front corners can be rounded into
  // an ellipse that the mask's own surface follows.
  const slabs = new Map<number, { x: number; zf: number; zb: number }>();
  {
    const q = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      let best = 0;
      let bw = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bw) {
          bw = w;
          best = si.getComponent(i, k);
        }
      }
      if (best !== headIdx) continue;
      q.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(boneMats[best]);
      const key = Math.round(q.y * 100);
      const sl = slabs.get(key) ?? { x: 0, zf: -9, zb: 9 };
      sl.x = Math.max(sl.x, Math.abs(q.x));
      sl.zf = Math.max(sl.zf, q.z);
      sl.zb = Math.min(sl.zb, q.z);
      slabs.set(key, sl);
    }
  }
  const slabAt = (y: number) => {
    let x = 0, zf = 0, zb = 0, ws = 0;
    for (let k = -2; k <= 2; k++) {
      const sl = slabs.get(Math.round(y * 100) + k);
      if (!sl) continue;
      const wk = Math.exp(-((k / 1.4) ** 2));
      x += sl.x * wk; zf += sl.zf * wk; zb += sl.zb * wk; ws += wk;
    }
    return ws ? { x: x / ws, zf: zf / ws, zb: zb / ws } : null;
  };
  const colors = new Float32Array(pos.count * 3);
  const samples: { p: THREE.Vector3; bone: string }[] = [];
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Dominant joint for this vertex.
    let best = 0;
    let bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) {
        bw = w;
        best = si.getComponent(i, k);
      }
    }
    const bone = names[best] ?? '';
    // Positions are quantized; the dequantization lives in the inverse bind
    // matrices, so go through the dominant bone to get bind-pose metres.
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(boneMats[best]);
    if (bone === 'DEF-head') {
      const ry0 = p.y - head.y;
      const sl = slabAt(p.y);
      const band = THREE.MathUtils.smoothstep(ry0, -0.06, -0.02) * (1 - THREE.MathUtils.smoothstep(ry0, 0.16, 0.2));
      if (sl && band > 0) {
        const cz = (sl.zf + sl.zb) / 2;
        const dz = p.z - cz;
        if (dz > 0) {
          const rzf = sl.zf - cz;
          const r = Math.hypot(p.x / sl.x, dz / rzf);
          if (r > 1) {
            const k = 1 + (Math.pow(r, -0.9) - 1) * band;
            const sx = new THREE.Vector3().setFromMatrixScale(boneMats[best]).x;
            pos.setX(i, pos.getX(i) + (p.x * (k - 1)) / sx);
            pos.setZ(i, pos.getZ(i) + (dz * (k - 1)) / sx);
            p.x *= k;
            p.z = cz + dz * k;
          }
        }
      }
    }
    // Recess the front of the featureless head so the sculpted face mask
    // (face.ts) always sits in front of it.
    if (bone === 'DEF-head') {
      const ry = p.y - head.y;
      // Phase 10: jaw width reshapes the lower head silhouette (cheeks to jaw).
      const jw = FACES[def.id].jawWidth ?? 1;
      if (jw !== 1) {
        const kx = 1 + (jw - 1) * THREE.MathUtils.smoothstep(0.1 - ry, 0, 0.07) * (1 - THREE.MathUtils.smoothstep(-ry, 0.02, 0.07));
        const sx = new THREE.Vector3().setFromMatrixScale(boneMats[best]).x;
        pos.setX(i, pos.getX(i) + (p.x * (kx - 1)) / sx);
        p.x *= kx;
      }
      const k = THREE.MathUtils.smoothstep(p.z, 0.0, 0.06) * THREE.MathUtils.smoothstep(ry, -0.04, 0.0) * (1 - THREE.MathUtils.smoothstep(ry, 0.17, 0.21)) * (1 - THREE.MathUtils.smoothstep(Math.abs(p.x), 0.06, 0.085));
      if (k > 0) {
        const scale = new THREE.Vector3().setFromMatrixScale(boneMats[best]).x;
        pos.setZ(i, pos.getZ(i) - (0.016 * k) / scale);
      }
    }
    samples.push({ p: p.clone(), bone });
    if (bone === 'DEF-head') {
      // Face (the headgear is a separate shell with an opening); hair at the nape.
      const rel = p.clone().sub(head);
      c.copy(rel.z < -0.04 && rel.y > 0.0 ? hair : skin);
      void gearDark;
    } else if (bone === 'DEF-neck') {
      c.copy(skin);
    } else if (/hand|f_|thumb/.test(bone)) {
      c.copy(skin);
    } else if (/foot|toe/.test(bone)) {
      c.copy(skin);
    } else if (/spine|hips/.test(bone)) {
      if (p.y > 0.99 && p.y < 1.395) {
        // Trunk protector: colored shell with a darker rim.
        const rim = p.y < 1.02 || p.y > 1.365;
        c.copy(rim ? gearDark : gear);
      } else if (p.y > 0.925 && p.y <= 0.99) {
        c.copy(beltC);
      } else {
        c.copy(p.z > 0.06 && p.y > 1.395 && Math.abs(p.x) < 0.06 ? skin : dobokShade);
      }
    } else if (/forearm/.test(bone) && Math.abs(p.x) > 0.66) {
      c.copy(skin);
    } else {
      c.copy(dobok);
      // Sleeve and trouser hems read as a slightly heavier fabric band.
      const hem = (/forearm/.test(bone) && Math.abs(p.x) > 0.62) || (/shin/.test(bone) && p.y < 0.2);
      if (hem) c.multiplyScalar(0.86);
    }
    // Dobok fabric: soft vertical folds on the trousers and sleeves, and a
    // darker V-neck lapel edge (vertex colors only: no textures, no draw calls).
    if (c.equals(dobok) || c.equals(dobokShade)) {
      const fold = 0.93 + 0.07 * (0.5 + 0.5 * Math.sin(p.x * 61 + p.z * 23)) * (0.6 + 0.4 * Math.sin(p.y * 9));
      c.multiplyScalar(fold);
      const lapel = /spine/.test(bone) && p.z > 0.04 && p.y > 1.36 && Math.abs(Math.abs(p.x) - (p.y - 1.36) * 0.9) < 0.022;
      if (lapel) c.multiplyScalar(0.78);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return samples;
}
