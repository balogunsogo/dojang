import * as THREE from 'three';
import { FighterAnimator } from '../game/anim/FighterAnimator';
import { CombatWorld } from '../game/combat/CombatWorld';
import { emptyIntent, type FighterIntent } from '../game/input/actions';
import { CHARACTERS, createCharacter, loadFighterAsset } from '../game/render/characterFactory';
import { ArcadeRules } from '../game/rules/rules';

/**
 * Dev tool (?lab=motion): runs scripted exchanges through the real
 * simulation and animator, one tick at a time, and renders filmstrips.
 * Deterministic, so before/after animation changes compare like for like.
 */
type Script = (tick: number, w: CombatWorld) => [FighterIntent, FighterIntent];
interface Seq {
  name: string;
  gap: number;
  ticks: number;
  frames: number[];
  script: Script;
}

const I = (p: Partial<FighterIntent> = {}): FighterIntent => ({ ...emptyIntent(), ...p });
const towards = (w: CombatWorld, i: 0 | 1, k = 1): Partial<FighterIntent> => {
  const a = w.fighters[i];
  const b = w.fighters[1 - i];
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { moveX: ((b.x - a.x) / d) * k, moveZ: ((b.z - a.z) / d) * k };
};
const lateral = (w: CombatWorld, i: 0 | 1, k = 1): Partial<FighterIntent> => {
  const a = w.fighters[i];
  const b = w.fighters[1 - i];
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { moveX: ((b.z - a.z) / d) * k, moveZ: (-(b.x - a.x) / d) * k };
};

const SEQS: Seq[] = [
  {
    name: 'Footwork: idle → advance → retreat → circle',
    gap: 2.2,
    ticks: 150,
    frames: [8, 26, 38, 50, 70, 86, 104, 122, 140],
    script: (t, w) => [I(t < 20 ? {} : t < 60 ? towards(w, 0) : t < 95 ? towards(w, 0, -1) : lateral(w, 0)), I()],
  },
  {
    name: 'Roundhouse lands (body)',
    gap: 1.0,
    ticks: 70,
    frames: [2, 6, 9, 12, 15, 20, 28, 38, 50],
    script: (t) => [I(t === 1 ? { attack: 'round' } : {}), I()],
  },
  {
    name: 'Side kick blocked',
    gap: 1.15,
    ticks: 70,
    frames: [3, 8, 13, 16, 19, 24, 32, 42, 55],
    script: (t) => [I(t === 1 ? { attack: 'side' } : {}), I({ guard: true })],
  },
  {
    name: 'Front kick misses (out of range)',
    gap: 2.0,
    ticks: 60,
    frames: [2, 6, 9, 12, 15, 20, 26, 34, 44],
    script: (t) => [I(t === 1 ? { attack: 'front' } : {}), I()],
  },
  {
    name: 'Back kick lands',
    gap: 1.05,
    ticks: 80,
    frames: [4, 9, 14, 18, 21, 26, 34, 46, 60],
    script: (t) => [I(t === 1 ? { attack: 'back' } : {}), I()],
  },
  {
    name: 'Head roundhouse taken (defender view)',
    gap: 1.0,
    ticks: 70,
    frames: [8, 12, 14, 16, 18, 22, 28, 36, 48],
    script: (t) => [I(), I(t === 1 ? { attack: 'round', height: 'head' } : {})],
  },
];

export async function runMotionLab(root: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const only = params.get('seq');
  const seqs = only ? only.split(',').map((i) => SEQS[Number(i)]) : SEQS;
  const cols = 9;
  const W = 1620;
  const cellW = W / cols;
  const cellH = 230;
  const H = cellH * seqs.length;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setScissorTest(true);
  root.appendChild(renderer.domElement);
  root.style.position = 'relative';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#d9d4cb');
  scene.add(new THREE.HemisphereLight('#ffffff', '#776655', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 2.0);
  sun.position.set(2, 5, 3);
  scene.add(sun, new THREE.GridHelper(8, 16, '#888', '#aaa'));

  const gltf = await loadFighterAsset();
  const a = createCharacter(gltf, CHARACTERS.jae, 'chung', 'green');
  const b = createCharacter(gltf, CHARACTERS.hana, 'hong', 'yellow');
  scene.add(a.group, b.group);
  const camera = new THREE.PerspectiveCamera(30, cellW / cellH, 0.1, 50);
  const labels: string[] = [];

  seqs.forEach((seq, row) => {
    const anims = [new FighterAnimator(a.group, a.model, a.clips, 1), new FighterAnimator(b.group, b.model, b.clips, 2)];
    const w = new CombatWorld(ArcadeRules, [CHARACTERS.jae.stats, CHARACTERS.hana.stats]);
    w.skipIntro = true;
    w.resetMatch();
    const [f0, f1] = w.fighters;
    f0.x = 0;
    f0.z = 0;
    f1.x = 0;
    f1.z = seq.gap;
    f0.yaw = 0;
    f1.yaw = Math.PI;
    let col = 0;
    for (let t = 0; t <= seq.ticks && col < cols; t++) {
      if (t > 0) w.step(seq.script(t, w));
      w.events.length = 0;
      w.fighters.forEach((f, i) => anims[i].update(f, 0, f.x, f.z, f.yaw, w.hitstop > 0 ? 0 : 1 / 60));
      if (t === seq.frames[col]) {
        const mx = (f0.x + f1.x) / 2;
        const mz = (f0.z + f1.z) / 2;
        camera.position.set(mx - 5.2, 1.25, mz);
        camera.lookAt(mx, 0.95, mz);
        const x = col * cellW;
        const y = H - (row + 1) * cellH;
        renderer.setViewport(x, y, cellW, cellH);
        renderer.setScissor(x, y, cellW, cellH);
        renderer.render(scene, camera);
        col++;
      }
    }
    anims.forEach((an) => an.dispose());
    labels.push(`<div style="position:absolute;left:6px;top:${row * cellH + 4}px">${seq.name} — ticks ${seq.frames.join(', ')}</div>`);
  });
  const label = document.createElement('div');
  label.style.cssText = 'position:absolute;left:0;top:0;font:12px monospace;color:#222;pointer-events:none';
  label.innerHTML = labels.join('');
  root.appendChild(label);
  (window as unknown as { __labReady: boolean }).__labReady = true;
}
