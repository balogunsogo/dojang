import * as THREE from 'three';
import { FighterAnimator } from '../game/anim/FighterAnimator';
import { attackKeys, GUARD, mirrorPose, sampleKeys, STANCE } from '../game/anim/poses';
import type { AttackState } from '../game/combat/Fighter';
import { MOVES, moveTotal, startupOf } from '../game/combat/moves';
import type { AttackKind, TargetHeight } from '../game/input/actions';
import { CHARACTERS, createCharacter, loadFighterAsset } from '../game/render/characterFactory';

/**
 * Dev tool: renders key frames of every technique side by side so animation
 * quality can be reviewed in screenshots (?lab=poses&view=side|front|quarter).
 */
export async function runPoseLab(root: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const view = params.get('view') ?? 'quarter';
  const only = params.get('moves');
  const mirror = params.get('southpaw') === '1';
  const W = 1600;
  const rows: { kind: AttackKind; height: TargetHeight }[] = [
    { kind: 'front', height: 'body' },
    { kind: 'round', height: 'body' },
    { kind: 'side', height: 'body' },
    { kind: 'back', height: 'body' },
    { kind: 'punch', height: 'body' },
    { kind: 'round', height: 'head' },
    { kind: 'leadFront', height: 'body' },
    { kind: 'leadRound', height: 'body' },
    { kind: 'leadSide', height: 'body' },
  ].filter((r) => !only || only.split(',').includes(`${r.kind}${r.height === 'head' ? '-head' : ''}`)) as { kind: AttackKind; height: TargetHeight }[];
  const cols = ['stance', 's0.5', 'chamber', 'impact', 'r0.4', 'r0.8'];
  const cellW = Math.floor(W / cols.length);
  const cellH = 300;
  const H = cellH * (rows.length + 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setScissorTest(true);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#d9d4cb');
  scene.add(new THREE.HemisphereLight('#ffffff', '#776655', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 2.0);
  sun.position.set(2, 5, 3);
  scene.add(sun);
  const grid = new THREE.GridHelper(6, 12, '#888', '#aaa');
  scene.add(grid);

  const gltf = await loadFighterAsset();
  const att = createCharacter(gltf, CHARACTERS.jae, 'chung', 'green');
  const def = createCharacter(gltf, CHARACTERS.hana, 'hong', 'yellow');
  scene.add(att.group, def.group);
  const animA = new FighterAnimator(att.group, att.model, att.clips);
  const animD = new FighterAnimator(def.group, def.model, def.clips);
  const dist = Number(params.get('dist') ?? 1.15);

  const camera = new THREE.PerspectiveCamera(30, cellW / cellH, 0.1, 50);
  const focus = new THREE.Vector3(0, 0.95, dist / 2);
  const camPos =
    view === 'side' ? new THREE.Vector3(-4.6, 1.1, dist / 2) : view === 'front' ? new THREE.Vector3(0, 1.2, -4.2) : new THREE.Vector3(-3.4, 1.6, -2.4);
  camera.position.copy(camPos);
  camera.lookAt(focus);

  const label = document.createElement('div');
  label.style.cssText = 'position:absolute;left:0;top:0;font:12px monospace;color:#222;pointer-events:none';
  root.style.position = 'relative';
  root.appendChild(label);

  const drawCell = (r: number, c: number) => {
    const x = c * cellW;
    const y = H - (r + 1) * cellH;
    renderer.setViewport(x, y, cellW, cellH);
    renderer.setScissor(x, y, cellW, cellH);
    renderer.render(scene, camera);
  };

  const fakeAttack = (kind: AttackKind, height: TargetHeight): AttackState => {
    const move = MOVES[kind];
    const imp = [...move.impact[height]] as [number, number, number];
    imp[2] = Math.min(imp[2], Math.max(move.chamber[2] + 0.18, dist - (height === 'head' ? 0.08 : 0.14)));
    return { move, height, startup: startupOf(move, height), total: moveTotal(move, height), hasHit: false, blocked: false, impact: imp, tired: false };
  };

  const texts: string[] = [];
  // Row 0: stance, guard, mirrored stance, hit reactions are clip-driven (not shown).
  const row0 = [STANCE, GUARD, mirrorPose(STANCE), mirrorPose(GUARD)];
  animD.overridePose = STANCE;
  def.group.position.set(0, 0, dist);
  def.group.rotation.y = Math.PI;
  for (let c = 0; c < cols.length; c++) {
    const p = row0[c % row0.length];
    animA.overridePose = mirror ? mirrorPose(p) : p;
    for (let i = 0; i < 12; i++) {
      animA.update(dummyFighter(), 0, 0, 0, 0);
      animD.update(dummyFighter(), 0, 0, dist, Math.PI);
    }
    drawCell(0, c);
  }
  texts.push(`<div style="position:absolute;left:4px;top:4px">stance | guard | southpaw stance | southpaw guard</div>`);

  rows.forEach((row, ri) => {
    const atk = fakeAttack(row.kind, row.height);
    const S = atk.startup;
    const A = atk.move.active;
    const R = atk.total - S - A;
    const times = [0, S * 0.5, S * 0.85, S + A * 0.7, S + A + R * 0.4, S + A + R * 0.8];
    const keys = attackKeys(atk);
    times.forEach((t, c) => {
      const p = sampleKeys(keys, t);
      animA.overridePose = mirror ? mirrorPose(p) : p;
      animA.update(dummyFighter(), 0, 0, 0, 0);
      drawCell(ri + 1, c);
    });
    texts.push(`<div style="position:absolute;left:4px;top:${(ri + 1) * cellH + 4}px">${atk.move.name} (${row.height}) — ${cols.join(' | ')}</div>`);
  });
  label.innerHTML = texts.join('');
  (window as unknown as { __labReady: boolean }).__labReady = true;
}

function dummyFighter() {
  // The lab drives poses through overridePose; the fighter is unused but required.
  return {} as never;
}
