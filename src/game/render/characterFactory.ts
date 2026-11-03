import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FighterStats } from '../combat/Fighter';
import { FACES } from './face';
import { buildGear } from './gear';

export const FIGHTER_URL = `${import.meta.env?.BASE_URL ?? '/'}assets/fighter.glb`;

export type CharacterId = 'jae' | 'hana';

export interface CharacterDef {
  id: CharacterId;
  name: string;
  /** Short HUD label. */
  short: string;
  hangul: string;
  blurb: string;
  scale: number;
  skin: string;
  dobok: string;
  stats: FighterStats;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  jae: {
    id: 'jae',
    name: 'Kim Jae-won',
    short: 'Jae',
    hangul: '김재원',
    blurb: 'Powerful and patient. Heavier kicks, steady stamina.',
    scale: 1.0,
    skin: '#c99a76',
    dobok: '#f1efe9',
    stats: { speed: 1.0, power: 1.08, staminaRegen: 1.0, maxHealth: 100 },
  },
  hana: {
    id: 'hana',
    name: 'Park Ha-na',
    short: 'Ha-na',
    hangul: '박하나',
    blurb: 'Fast footwork and quick recovery. Lighter strikes.',
    scale: 0.95,
    skin: '#e0b494',
    dobok: '#f4f3ef',
    stats: { speed: 1.1, power: 0.94, staminaRegen: 1.12, maxHealth: 100 },
  },
};

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
export function createCharacter(gltf: GLTF, def: CharacterDef, corner: 'chung' | 'hong', belt: BeltColor): CharacterInstance {
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
    hair: lin(def.id === 'hana' ? '#20140f' : '#151110'),
    face: FACES[def.id],
    ponytail: def.id === 'hana',
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
  group.scale.setScalar(def.scale);
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
    // Recess the front of the featureless head so the sculpted face mask
    // (face.ts) always sits in front of it.
    if (bone === 'DEF-head') {
      const ry = p.y - head.y;
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
