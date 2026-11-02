import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA_HALF } from '../config';
import type { QualityProfile } from './quality';

/**
 * A modern Korean Taekwondo dojang with traditional details, built from
 * procedural geometry and small canvas textures (no downloaded assets):
 * wooden floor, blue/red competition mats, white walls with wood wainscoting,
 * dancheong-pattern frieze, changsal lattice windows, the taegeukgi, a
 * calligraphy banner, a belt rack, a mirror wall and hanging heavy bags.
 *
 * Draw calls are kept low by merging static geometry per material and
 * instancing the repeated mats and beams.
 */
const ROOM = 7; // half size
const WALL_H = 4.4;

export interface DojangHandle {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  dispose(): void;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function woodFloor(g: CanvasRenderingContext2D, w: number, h: number) {
  const rows = 8;
  const rh = h / rows;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * w * 0.5;
    while (x < w) {
      const len = w * (0.35 + rnd() * 0.4);
      const tone = 150 + rnd() * 40;
      g.fillStyle = `rgb(${tone + 28},${tone - 10},${tone - 62})`;
      g.fillRect(x, r * rh, len, rh);
      for (let i = 0; i < 10; i++) {
        g.strokeStyle = `rgba(80,45,20,${0.05 + rnd() * 0.08})`;
        g.beginPath();
        const y = r * rh + rnd() * rh;
        g.moveTo(x, y);
        g.bezierCurveTo(x + len * 0.3, y + (rnd() - 0.5) * 6, x + len * 0.6, y + (rnd() - 0.5) * 6, x + len, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(40,20,10,0.55)';
      g.fillRect(x, r * rh, 2, rh);
      x += len;
    }
    g.fillStyle = 'rgba(40,20,10,0.5)';
    g.fillRect(0, r * rh, w, 2);
  }
}

function dancheong(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#1f6b4f';
  g.fillRect(0, 0, w, h);
  const cols = ['#c8372d', '#f2c14e', '#2d5fa8', '#f4efe2', '#c8372d'];
  const n = 16;
  const cw = w / n;
  for (let i = 0; i < n; i++) {
    const x = i * cw;
    cols.forEach((c, k) => {
      g.fillStyle = c;
      const r = (cw * 0.42 * (cols.length - k)) / cols.length;
      g.beginPath();
      g.arc(x + cw / 2, h / 2, r, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#123f2e';
    g.fillRect(x, 0, 3, h);
  }
  g.fillStyle = '#c8372d';
  g.fillRect(0, 0, w, h * 0.1);
  g.fillRect(0, h * 0.9, w, h * 0.1);
}

function taegeukgi(g: CanvasRenderingContext2D, w: number, h: number) {
  // Flag of South Korea (3:2), drawn from its geometric definition.
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const R = h / 4;
  const ang = Math.atan2(2, 3);
  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  g.fillStyle = '#cd2e3a';
  g.beginPath();
  g.arc(0, 0, R, Math.PI, 0);
  g.fill();
  g.fillStyle = '#0047a0';
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI);
  g.fill();
  g.fillStyle = '#cd2e3a';
  g.beginPath();
  g.arc(-R / 2, 0, R / 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0047a0';
  g.beginPath();
  g.arc(R / 2, 0, R / 2, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // Trigrams: geon (☰), gon (☷), gam (☵), ri (☲) — broken bars as pattern [top..bottom].
  const tri: [number, number, boolean[]][] = [
    [-1, -1, [false, false, false]],
    [1, 1, [true, true, true]],
    [1, -1, [true, false, true]],
    [-1, 1, [false, true, false]],
  ];
  const bw = R * 1.0;
  const bh = R / 6;
  for (const [sx, sy, broken] of tri) {
    g.save();
    const dist = R * 2.25;
    const dirx = sx * Math.cos(ang);
    const diry = sy * Math.sin(ang);
    g.translate(cx + dirx * dist, cy + diry * dist);
    g.rotate(Math.atan2(diry, dirx) + Math.PI / 2);
    g.fillStyle = '#000';
    broken.forEach((b, i) => {
      const y = (i - 1) * bh * 1.5 - bh / 2;
      if (b) {
        g.fillRect(-bw / 2, y, bw * 0.46, bh);
        g.fillRect(bw * 0.04, y, bw * 0.46, bh);
      } else g.fillRect(-bw / 2, y, bw, bh);
    });
    g.restore();
  }
}

function banner(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#f3ead6';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#7a2b1f';
  g.lineWidth = 10;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.fillStyle = '#1a1410';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.floor(h * 0.42)}px "Noto Serif KR", "Nanum Myeongjo", "Apple SD Gothic Neo", "Malgun Gothic", serif`;
  g.fillText('跆拳道', w / 2, h * 0.42);
  g.font = `${Math.floor(h * 0.12)}px "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`;
  g.fillStyle = '#7a2b1f';
  g.fillText('예의 · 염치 · 인내 · 극기 · 백절불굴', w / 2, h * 0.8);
}

function lattice(g: CanvasRenderingContext2D, w: number, h: number) {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#fffaf0');
  grd.addColorStop(1, '#f1e4c8');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#5b3a22';
  g.lineWidth = 6;
  const n = 6;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo((i * w) / n, 0);
    g.lineTo((i * w) / n, h);
    g.stroke();
    g.beginPath();
    g.moveTo(0, (i * h) / (n + 3));
    g.lineTo(w, (i * h) / (n + 3));
    g.stroke();
  }
  g.lineWidth = 16;
  g.strokeRect(0, 0, w, h);
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, color: string, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

export function buildDojang(quality: QualityProfile): DojangHandle {
  const group = new THREE.Group();
  group.name = 'dojang';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // Floor.
  const floorTex = track(canvasTex(512, 512, woodFloor, [5, 5]));
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(ROOM * 2, ROOM * 2)),
    track(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Competition mats: instanced 1 m tiles, blue field with a red boundary ring.
  const tiles = Math.round(ARENA_HALF * 2) + 2;
  const matGeo = track(new THREE.BoxGeometry(0.985, 0.035, 0.985));
  const matMat = track(new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 }));
  const mats = new THREE.InstancedMesh(matGeo, matMat, tiles * tiles);
  const m = new THREE.Matrix4();
  const blue = new THREE.Color('#2b5fa6');
  const blue2 = new THREE.Color('#2a5a9d');
  const red = new THREE.Color('#b8322c');
  let i = 0;
  for (let a = 0; a < tiles; a++)
    for (let b = 0; b < tiles; b++) {
      const x = a - tiles / 2 + 0.5;
      const z = b - tiles / 2 + 0.5;
      m.makeTranslation(x, 0.0175, z);
      mats.setMatrixAt(i, m);
      const edge = a === 0 || b === 0 || a === tiles - 1 || b === tiles - 1;
      mats.setColorAt(i, edge ? red : (a + b) % 2 ? blue : blue2);
      i++;
    }
  mats.receiveShadow = true;
  group.add(mats);

  // Center mark.
  const mark = new THREE.Mesh(
    track(new THREE.RingGeometry(0.45, 0.5, 40)),
    track(new THREE.MeshBasicMaterial({ color: '#e9e4d8', transparent: true, opacity: 0.6 })),
  );
  mark.rotation.x = -Math.PI / 2;
  mark.position.y = 0.037;
  group.add(mark);

  // Walls, wainscoting, frames and props merged into one vertex-colored mesh.
  const parts: THREE.BufferGeometry[] = [];
  const wallC = '#ece6da';
  const wood = '#6b4228';
  const woodDark = '#4a2c19';
  for (let s = 0; s < 4; s++) {
    const ry = (s * Math.PI) / 2;
    const place = (w: number, h: number, d: number, along: number, y: number, inset: number, color: string) => {
      const dist = ROOM - inset;
      const x = Math.sin(ry) * dist + Math.cos(ry) * along;
      const z = Math.cos(ry) * dist - Math.sin(ry) * along;
      parts.push(boxAt(w, h, d, x, y, z, color, ry));
    };
    place(ROOM * 2, WALL_H, 0.2, 0, WALL_H / 2, -0.1, wallC);
    place(ROOM * 2, 1.05, 0.06, 0, 0.525, 0.03, wood); // wainscot
    place(ROOM * 2, 0.08, 0.1, 0, 1.08, 0.05, woodDark); // chair rail
    place(ROOM * 2, 0.15, 0.08, 0, 0.075, 0.07, woodDark); // skirting
    place(ROOM * 2, 0.12, 0.12, 0, WALL_H - 0.55, 0.06, woodDark); // frieze rail
    for (let p = -ROOM + 1.75; p < ROOM; p += 3.5) place(0.24, WALL_H, 0.2, p, WALL_H / 2, 0.1, wood); // pillars
  }
  // Belt rack on the left wall.
  const belts = ['#f2f2ee', '#e8c12c', '#2f8f3a', '#2d5fa8', '#b8322c', '#141414'];
  belts.forEach((c, k) => parts.push(boxAt(0.05, 0.9, 0.06, -ROOM + 0.1, 1.75, -1.0 + k * 0.16, c)));
  parts.push(boxAt(0.08, 0.06, 1.2, -ROOM + 0.1, 2.22, -0.6, woodDark));
  // Bench.
  parts.push(boxAt(2.4, 0.08, 0.4, 2.2, 0.45, -ROOM + 0.45, wood));
  parts.push(boxAt(0.08, 0.45, 0.35, 1.1, 0.22, -ROOM + 0.45, woodDark));
  parts.push(boxAt(0.08, 0.45, 0.35, 3.3, 0.22, -ROOM + 0.45, woodDark));
  // Training equipment along the back wall (merged into the static mesh: no extra draw calls).
  // Kicking paddles on a wall rack: red/blue pads on short handles.
  parts.push(boxAt(1.9, 0.06, 0.08, -2.6, 1.55, -ROOM + 0.16, woodDark));
  for (let k = 0; k < 6; k++) {
    const x = -3.35 + k * 0.3;
    parts.push(boxAt(0.2, 0.32, 0.07, x, 1.3, -ROOM + 0.2, k % 2 ? '#2d5fa8' : '#b8322c'));
    parts.push(boxAt(0.04, 0.16, 0.04, x, 1.53, -ROOM + 0.2, '#1c1c1c'));
  }
  // Stacked trunk protectors (hogu) and a pile of folded mats by the bench.
  for (let k = 0; k < 3; k++) parts.push(boxAt(0.5, 0.07, 0.36, 2.6 - k * 0.04, 0.53 + k * 0.075, -ROOM + 0.45, k % 2 ? '#2d5fa8' : '#b8322c'));
  for (let k = 0; k < 4; k++) parts.push(boxAt(1.1, 0.05, 0.6, 4.6, 0.025 + k * 0.05, -ROOM + 0.6, k % 2 ? '#2f6f4a' : '#3a7f56'));
  // Standing kick shield in the near-left corner.
  parts.push(boxAt(0.32, 0.6, 0.12, -5.4, 0.62, -ROOM + 0.9, '#b8322c'));
  parts.push(boxAt(0.28, 0.08, 0.1, -5.4, 0.97, -ROOM + 0.9, '#1c1c1c'));
  const staticGeo = track(mergeGeometries(parts)!);
  parts.forEach((p) => p.dispose());
  const statics = new THREE.Mesh(staticGeo, track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));
  statics.receiveShadow = true;
  group.add(statics);

  // Ceiling with instanced beams.
  const ceil = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM * 2, ROOM * 2)), track(new THREE.MeshStandardMaterial({ color: '#d8cfbf', roughness: 1 })));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  group.add(ceil);
  const beamCount = 7;
  const beams = new THREE.InstancedMesh(track(new THREE.BoxGeometry(ROOM * 2, 0.22, 0.26)), track(new THREE.MeshStandardMaterial({ color: '#5a371f', roughness: 0.7 })), beamCount);
  for (let k = 0; k < beamCount; k++) {
    m.makeTranslation(0, WALL_H - 0.11, -ROOM + ((k + 0.5) * ROOM * 2) / beamCount);
    beams.setMatrixAt(k, m);
  }
  group.add(beams);
  // Light panels (emissive).
  const panels = new THREE.InstancedMesh(track(new THREE.BoxGeometry(1.6, 0.04, 0.5)), track(new THREE.MeshBasicMaterial({ color: '#fff6e6' })), 6);
  for (let k = 0; k < 6; k++) {
    m.makeTranslation((k % 2 ? 1 : -1) * 2.2, WALL_H - 0.25, -3 + Math.floor(k / 2) * 3);
    panels.setMatrixAt(k, m);
  }
  group.add(panels);

  // Dancheong frieze around the top of the walls.
  const dTex = track(canvasTex(1024, 64, dancheong, [3, 1]));
  const dMat = track(new THREE.MeshStandardMaterial({ map: dTex, roughness: 0.7 }));
  for (let s = 0; s < 4; s++) {
    const ry = (s * Math.PI) / 2;
    const band = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM * 2, 0.4)), dMat);
    band.position.set(Math.sin(ry) * (ROOM - 0.11), WALL_H - 0.3, Math.cos(ry) * (ROOM - 0.11));
    band.rotation.y = ry + Math.PI;
    group.add(band);
  }

  // Front wall: flag and calligraphy banner.
  const flag = new THREE.Mesh(track(new THREE.PlaneGeometry(1.8, 1.2)), track(new THREE.MeshStandardMaterial({ map: track(canvasTex(600, 400, taegeukgi)), roughness: 0.9 })));
  flag.position.set(-2.2, 2.55, ROOM - 0.12);
  flag.rotation.y = Math.PI;
  group.add(flag);
  const ban = new THREE.Mesh(track(new THREE.PlaneGeometry(2.6, 1.2)), track(new THREE.MeshStandardMaterial({ map: track(canvasTex(1040, 480, banner)), roughness: 0.95 })));
  ban.position.set(1.4, 2.55, ROOM - 0.12);
  ban.rotation.y = Math.PI;
  group.add(ban);

  // Changsal lattice windows on the right wall (bright, daylight).
  const latTex = track(canvasTex(256, 384, lattice));
  const winMat = track(new THREE.MeshBasicMaterial({ map: latTex }));
  const winGeo = track(new THREE.PlaneGeometry(1.5, 2.1));
  for (const z of [-3.5, 0, 3.5]) {
    const w = new THREE.Mesh(winGeo, winMat);
    w.position.set(ROOM - 0.12, 2.35, z);
    w.rotation.y = -Math.PI / 2;
    group.add(w);
  }

  // Mirror wall (back): dark glossy panel.
  const mirror = new THREE.Mesh(
    track(new THREE.PlaneGeometry(9, 2.4)),
    track(new THREE.MeshStandardMaterial({ color: '#3d4650', roughness: 0.08, metalness: 0.85 })),
  );
  mirror.position.set(0, 2.25, -ROOM + 0.12);
  group.add(mirror);

  // Hanging heavy bags in a corner (instanced).
  const bagGeo = track(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 14));
  const bags = new THREE.InstancedMesh(bagGeo, track(new THREE.MeshStandardMaterial({ color: '#7a1f1c', roughness: 0.6 })), 2);
  m.makeTranslation(-5.6, 1.45, 5.0);
  bags.setMatrixAt(0, m);
  m.makeTranslation(-4.6, 1.45, 5.6);
  bags.setMatrixAt(1, m);
  bags.castShadow = quality.shadows;
  group.add(bags);
  const chain = new THREE.InstancedMesh(track(new THREE.CylinderGeometry(0.012, 0.012, WALL_H - 2.0, 4)), track(new THREE.MeshBasicMaterial({ color: '#333' })), 2);
  m.makeTranslation(-5.6, 2.0 + (WALL_H - 2.0) / 2, 5.0);
  chain.setMatrixAt(0, m);
  m.makeTranslation(-4.6, 2.0 + (WALL_H - 2.0) / 2, 5.6);
  chain.setMatrixAt(1, m);
  group.add(chain);

  // Lighting: warm sky/ground fill + one shadowed key light from the windows.
  const hemi = new THREE.HemisphereLight('#fff4e2', '#6d5a48', 1.25);
  group.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1dc', 2.3);
  sun.position.set(5, 7, 2.5);
  sun.target.position.set(0, 0, 0);
  group.add(sun, sun.target);
  if (quality.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const sc = sun.shadow.camera;
    sc.left = -5;
    sc.right = 5;
    sc.top = 5;
    sc.bottom = -5;
    sc.near = 1;
    sc.far = 20;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
  }
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.5);
  fill.position.set(-4, 5, -5);
  group.add(fill);

  return {
    group,
    sun,
    dispose() {
      for (const d of disposables) d.dispose();
      group.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      });
      group.removeFromParent();
    },
  };
}
