import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FighterStats } from '../combat/Fighter';

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
export const BELT_COLORS = { white: '#f2f2ee', yellow: '#e8c12c', green: '#2f8f3a', black: '#141414' } as const;
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
 * Build one fighter: clone the shared CC0 mannequin, then paint a dobok,
 * trunk protector (hogu), headgear and belt into vertex colors so the whole
 * fighter is a single skinned draw call with no textures.
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
  paintVertexColors(skinned, def, corner, belt);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.0 });
  skinned.material = material;
  skinned.castShadow = true;
  skinned.receiveShadow = false;
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
      group.removeFromParent();
    },
  };
}

function paintVertexColors(mesh: THREE.SkinnedMesh, def: CharacterDef, corner: 'chung' | 'hong', belt: BeltColor) {
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
      // Headgear with an open face.
      const rel = p.clone().sub(head);
      const face = rel.z > 0.035 && rel.y < 0.15 && rel.y > -0.07 && Math.abs(rel.x) < 0.075;
      const ear = Math.abs(rel.x) > 0.075 && rel.y < 0.07 && rel.y > -0.02;
      if (face) c.copy(skin);
      else if (rel.y < -0.06) c.copy(hair);
      else c.copy(ear ? gearDark : gear);
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
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
