import * as THREE from 'three';
import type { CharacterId } from './characterFactory';

/**
 * Face parameters per fighter. The first eight shape every face; the
 * optional fields (Phase 10) add fidelity, and their defaults reproduce the
 * original faces. Approved values: docs/PHASE_10.md (from the design handoff).
 */
export interface FaceParams {
  /** Brow thickness (m) and arch (0 straight .. 1 arched). */
  browThick: number;
  browArch: number;
  /** Nose tip prominence and width (m). */
  nose: number;
  noseWidth: number;
  /** 0 = tapered jaw, 1 = square jaw. */
  jaw: number;
  /** Lip fullness scale. */
  lips: number;
  /** Eye size scale. */
  eye: number;
  /** Lip tint strength (0..1). */
  lipTint: number;
  /** Cheekbone prominence multiplier (default 1). */
  cheek?: number;
  /** Chin prominence multiplier (default 1). */
  chin?: number;
  /** Short beard / moustache shadow strength (0..1, default 0). */
  beard?: number;
  /** Eye spacing multiplier (default 1). */
  eyeGap?: number;
  /** Brow height offset (m, default 0; + raises). */
  browLift?: number;
  /** Nose length offset (m, default 0; + longer, moves the tip down). */
  noseLen?: number;
  /** Mouth width multiplier (default 1). */
  mouthW?: number;
  /** Lower-face length offset (m, default 0; + longer chin). */
  chinLen?: number;
  /** Highlight on brow, nose bridge and cheekbones so deep skin tones keep their modelling (0..1). */
  sheen?: number;
  /** Lip colour derived from skin (true) instead of the fixed pink-red tint. */
  skinLips?: boolean;
  /** Brow-ridge relief multiplier (default 1; ~0.5 reads softer). */
  browRidge?: number;
  /** Upper-lid crease: 0 = monolid, 1 = defined double lid (default 0.4). */
  lidCrease?: number;
  /** Upper lash line weight and outer flick (0..1, default 0.3). */
  lash?: number;
  /** Iris colour (sRGB hex, default dark brown). */
  iris?: string;
  /** Nasal bridge height multiplier (default 1). */
  bridge?: number;
  /** Nose-to-mouth fold depth (0..1, default 0.35). */
  nasolabial?: number;
  /** Upper-lip bow (0..1, default 0.5). */
  cupid?: number;
  /** Outer eye corner lift (m, default 0). */
  eyeTilt?: number;
  /** Lower-face width at the jaw: reshapes the head silhouette (default 1). */
  jawWidth?: number;
}

export const FACES: Record<CharacterId, FaceParams> = {
  jae: { browThick: 0.0075, browArch: 0.15, nose: 0.023, noseWidth: 0.0125, jaw: 0.85, lips: 0.85, eye: 1.0, lipTint: 0.25, browRidge: 1.1, lidCrease: 0.15, lash: 0.25, iris: '#4a2e1a', bridge: 0.85, nasolabial: 0.45, cupid: 0.4, eyeTilt: 0.0015, jawWidth: 1.03 },
  hana: { browThick: 0.0047, browArch: 0.6, nose: 0.019, noseWidth: 0.0105, jaw: 0.25, lips: 1.08, eye: 1.07, lipTint: 0.55, browRidge: 0.5, lidCrease: 0.35, lash: 0.85, iris: '#4f311c', bridge: 0.75, nasolabial: 0.15, cupid: 0.75, eyeTilt: 0.002, jawWidth: 0.89, chin: 0.85, cheek: 1.1 },
  tunde: { browThick: 0.0085, browArch: 0.18, nose: 0.019, noseWidth: 0.0168, jaw: 1.0, lips: 1.3, eye: 0.96, lipTint: 0.15, cheek: 1.15, chin: 1.35, beard: 0.45, sheen: 1, skinLips: true, eyeGap: 1.05, browLift: -0.003, noseLen: -0.003, mouthW: 1.14, chinLen: 0.007, browRidge: 1.35, lidCrease: 0.7, lash: 0.25, iris: '#3d2414', bridge: 0.65, nasolabial: 0.7, cupid: 0.55, eyeTilt: 0, jawWidth: 1.07 },
  sofia: { browThick: 0.005, browArch: 0.62, nose: 0.027, noseWidth: 0.0108, jaw: 0.32, lips: 1.05, eye: 1.06, lipTint: 0.55, cheek: 1.5, chin: 1.0, sheen: 0.35, eyeGap: 0.96, browLift: 0.003, noseLen: 0.005, mouthW: 0.95, chinLen: 0.002, browRidge: 0.55, lidCrease: 0.95, lash: 0.9, iris: '#6b4422', bridge: 1.35, nasolabial: 0.3, cupid: 0.85, eyeTilt: 0.001, jawWidth: 0.89 },
  minjun: { browThick: 0.0074, browArch: 0.0, nose: 0.0165, noseWidth: 0.0102, jaw: 0.45, lips: 0.78, eye: 0.88, lipTint: 0.15, cheek: 0.7, chin: 0.85, eyeGap: 1.08, browLift: -0.004, noseLen: -0.004, mouthW: 0.9, chinLen: -0.005, browRidge: 0.8, lidCrease: 0.0, lash: 0.3, iris: '#45291a', bridge: 0.6, nasolabial: 0.2, cupid: 0.3, eyeTilt: 0.003, jawWidth: 0.95 },
  amara: { browThick: 0.0046, browArch: 0.85, nose: 0.018, noseWidth: 0.015, jaw: 0.25, lips: 1.38, eye: 1.14, lipTint: 0.5, cheek: 1.45, chin: 0.85, sheen: 0.85, skinLips: true, eyeGap: 1.02, browLift: 0.004, noseLen: -0.003, mouthW: 1.06, chinLen: -0.003, browRidge: 0.45, lidCrease: 0.8, lash: 0.95, iris: '#432816', bridge: 0.6, nasolabial: 0.15, cupid: 0.85, eyeTilt: 0.0018, jawWidth: 0.88 },
};

type W = [number, number][];
interface B {
  vert(p: THREE.Vector3, c: THREE.Color, w: W): number;
  quad(a: number, b: number, c: number, d: number): void;
}

const g2 = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
const sst = THREE.MathUtils.smoothstep;
/** Distance from (x, y) to the segment a-b. */
const segD = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const vx = bx - ax;
  const vy = by - ay;
  const t = THREE.MathUtils.clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(x - ax - vx * t, y - ay - vy * t);
};

/**
 * Stylized face for the CC0 mannequin, whose head is a featureless egg.
 *
 * A sculpted mask (one smooth grid) sits just over the front of the head:
 * brow ridge, sockets, lids, nose (bridge, tip, alae), cheek planes,
 * nose-to-mouth folds, philtrum, a bowed upper lip, chin and jaw are smooth
 * height offsets, coloured per vertex (no textures). Eyeballs carry a
 * coloured iris, limbal ring and catchlight; lids, lashes and soft-edged
 * brows are thin strips. Everything is rigid on the head bone inside the
 * existing gear mesh: no extra draw call. Close to life, never photographic.
 */
export function addFace(
  b: B,
  head: { c: THREE.Vector3; r: THREE.Vector3 },
  iHead: number,
  f: FaceParams,
  skin: THREE.Color,
  hair: THREE.Color,
  /** Front surface of the head (bind metres) at (x, y). */
  surfaceZ: (x: number, y: number) => number,
) {
  const { c } = head;
  const w: W = [[iHead, 1]];
  const eyeY = c.y + 0.012;
  const browY = eyeY + 0.019 + (f.browLift ?? 0);
  const noseY = eyeY - 0.056 - (f.noseLen ?? 0); // tip
  const mouthY = eyeY - 0.092 - (f.noseLen ?? 0) * 0.6 - (f.chinLen ?? 0) * 0.3;
  const chinY = eyeY - 0.13 - (f.chinLen ?? 0);
  const eyeX = 0.031 * (f.eyeGap ?? 1);
  const lw = 0.022 * (0.9 + 0.1 * f.lips) * (f.mouthW ?? 1); // lip half-width
  const crease = f.lidCrease ?? 0.4;
  const lash = f.lash ?? 0.3;
  const naso = f.nasolabial ?? 0.35;
  const cupid = f.cupid ?? 0.5;
  const ridge = f.browRidge ?? 1;
  const bridgeK = f.bridge ?? 1;
  const tilt = f.eyeTilt ?? 0;
  const alaX = f.noseWidth * 1.05;

  /** Sculpt: offset along +z from the head surface. */
  const relief = (x: number, y: number) => {
    const ax = Math.abs(x);
    let d = 0;
    d += 0.009 * ridge * g2(ax, y, eyeX - 0.002, browY + 0.002, 0.03, 0.009); // brow ridge
    d += 0.0025 * g2(x, y, 0, browY + 0.004, 0.012, 0.01) * ridge; // glabella
    d -= 0.0025 * g2(ax, y, 0.07, browY + 0.006, 0.01, 0.02); // temple
    d -= 0.01 * g2(ax, y, eyeX, eyeY + tilt * ((ax - eyeX) / 0.02), 0.021 * f.eye, 0.0095 * f.eye); // socket (almond)
    d += 0.0015 * (1 - crease) * g2(ax, y, eyeX, eyeY + 0.011 * f.eye, 0.016, 0.004); // hooded lid fullness
    d -= 0.0012 * g2(ax, y, eyeX + 0.002, eyeY - 0.017, 0.016, 0.006); // under-eye hollow
    d += 0.009 * (f.cheek ?? 1) * g2(ax, y, 0.046, eyeY - 0.03, 0.02, 0.016); // cheekbone
    d -= 0.003 * Math.max(0, (f.cheek ?? 1) - 0.8) * g2(ax, y, 0.052, mouthY + 0.012, 0.014, 0.016); // cheek plane below
    // Nose: bridge rising from the brow into a rounded tip, flared alae.
    const bridgeT = THREE.MathUtils.clamp((browY - 0.004 - y) / (browY - 0.004 - noseY), 0, 1);
    if (y < browY && y > noseY - 0.012) {
      const wdt = 0.0055 + f.noseWidth * 0.5 * bridgeT;
      d += (0.003 * bridgeK + f.nose * 0.55 * bridgeT * (bridgeT * (1 - 0.35 * (bridgeK - 1)) + 0.35 * (bridgeK - 1) * 0.6)) * Math.exp(-((x / wdt) ** 2));
    }
    d += f.nose * 0.5 * g2(x, y, 0, noseY, f.noseWidth * 0.75, 0.009); // tip
    d += 0.0075 * g2(ax, y, alaX * 0.92, noseY - 0.003, 0.0075, 0.0065); // alae
    d -= 0.002 * g2(ax, y, alaX * 1.25, noseY - 0.001, 0.003, 0.006); // ala crease
    // Nose-to-mouth folds: a soft groove from the ala to past the mouth corner.
    const fold = segD(ax, y, alaX * 1.3, noseY - 0.002, lw * 1.25, mouthY - 0.008);
    d -= 0.0032 * naso * Math.exp(-((fold / 0.0035) ** 2));
    d += 0.0016 * naso * Math.exp(-(((fold - 0.006) / 0.004) ** 2)) * sst(ax, lw, lw * 1.6); // cheek fullness beside the fold
    // Philtrum: a shallow channel with two soft ridges.
    if (y < noseY - 0.006 && y > mouthY + 0.005) {
      d -= 0.0022 * Math.exp(-((x / 0.0035) ** 2));
      d += 0.0012 * Math.exp(-(((ax - 0.0045) / 0.0018) ** 2));
    }
    // Lips: bowed upper lip, fuller lower lip, recessed corners.
    const bow = cupid * 0.0022 * (Math.exp(-(((ax - 0.0065) / 0.004) ** 2)) - 0.6 * Math.exp(-((x / 0.0025) ** 2)));
    d += 0.0045 * f.lips * g2(x, y, 0, mouthY + 0.005 * (0.75 + 0.45 * f.lips) + bow * 0.6, lw, 0.0042 * (0.75 + 0.35 * f.lips));
    d += 0.006 * f.lips * g2(x, y, 0, mouthY - 0.0058 * (0.7 + 0.45 * f.lips), lw * 0.85, 0.005 * (0.7 + 0.4 * f.lips));
    d -= 0.0028 * g2(x, y, 0, mouthY, lw * 1.05, 0.0018);
    d -= 0.0025 * g2(ax, y, lw * 1.02, mouthY, 0.003, 0.004); // corners
    d -= 0.0022 * g2(x, y, 0, mouthY - 0.016, lw * 0.7, 0.003); // groove under the lower lip
    d += 0.0075 * (f.chin ?? 1) * g2(x, y, 0, chinY + 0.008, 0.018, 0.012); // chin
    // Jaw angle: square jaws carry a soft ridge at the corner of the jaw.
    d += 0.004 * Math.max(0, f.jaw - 0.4) * g2(ax, y, 0.066, mouthY - 0.022, 0.01, 0.014);
    // Jaw: tapered jaws pull in below the mouth; square jaws stay full.
    d -= (1 - f.jaw) * 0.012 * sst(mouthY - y, -0.01, 0.04) * (ax / 0.07) ** 2;
    return d;
  };

  const lipCol = f.skinLips ? skin.clone().multiplyScalar(0.62).lerp(new THREE.Color(0.2, 0.06, 0.06), 0.25) : skin.clone().multiplyScalar(0.78).lerp(new THREE.Color(0.4, 0.1, 0.1), 0.45);
  const flush = new THREE.Color(0.55, 0.14, 0.1);
  const colour = (x: number, y: number, out: THREE.Color) => {
    const ax = Math.abs(x);
    out.copy(skin);
    // Soft modelling: darker sockets, under the nose and jaw.
    out.multiplyScalar(1 - 0.12 * g2(ax, y, eyeX, eyeY + 0.004, 0.022, 0.014) - 0.08 * g2(x, y, 0, noseY - 0.012, 0.016, 0.006) - 0.1 * sst(chinY + 0.02 - y, 0, 0.03));
    if (f.sheen) {
      const hi = 0.55 * g2(x, y, 0, eyeY - 0.025, 0.007, 0.03) + 0.45 * g2(ax, y, 0.046, eyeY - 0.03, 0.016, 0.01) + 0.35 * g2(x, y, 0, browY + 0.02, 0.04, 0.012) + 0.3 * g2(x, y, 0, chinY + 0.01, 0.012, 0.008);
      out.multiplyScalar(1 + f.sheen * 1.6 * hi);
      out.multiplyScalar(1 + f.sheen * 0.18);
    }
    // Living skin: a little warmth on the cheeks, nose tip and ears' line.
    out.lerp(flush, 0.06 * g2(ax, y, 0.045, eyeY - 0.04, 0.02, 0.016) + 0.05 * g2(x, y, 0, noseY, 0.012, 0.01));
    // Shadow in the folds, under the eyes and on the upper lid.
    const fold = segD(ax, y, alaX * 1.3, noseY - 0.002, lw * 1.25, mouthY - 0.008);
    out.multiplyScalar(1 - 0.12 * naso * Math.exp(-((fold / 0.003) ** 2)) - 0.03 * g2(ax, y, eyeX + 0.002, eyeY - 0.015, 0.014, 0.005) - 0.08 * g2(ax, y, eyeX, eyeY + 0.01 * f.eye, 0.016, 0.004));
    // Lid crease: a soft dark line above the lid (absent on a monolid).
    if (crease > 0.05) {
      const cy = eyeY + 0.0125 * f.eye + tilt * ((ax - eyeX) / 0.02) * 0.6;
      const k = Math.exp(-(((y - cy) / 0.0011) ** 2)) * Math.max(0, 1 - ((ax - eyeX) / (0.017 * f.eye)) ** 2);
      out.multiplyScalar(1 - 0.32 * crease * k);
    }
    // Lips: tint, a lighter centre on the lower lip, darker corners, a bowed line.
    const bowY = mouthY + 0.0058 * (0.75 + 0.45 * f.lips) + cupid * 0.0012 * (Math.exp(-(((ax - 0.0065) / 0.004) ** 2)) - 0.8 * Math.exp(-((x / 0.0025) ** 2)));
    const inUpper = y >= mouthY && y < bowY && ax < lw * (1 - 0.35 * ((y - mouthY) / (bowY - mouthY + 1e-4)) ** 2);
    const inLower = y < mouthY && y > mouthY - 0.0105 * (0.6 + 0.45 * f.lips) * Math.sqrt(Math.max(0, 1 - (ax / (lw * 0.92)) ** 2));
    if (inUpper || inLower) {
      out.lerp(lipCol, (0.5 + 0.4 * f.lipTint) * (inUpper ? 1.0 : 0.88));
      if (inUpper) out.multiplyScalar(0.86);
      if (inLower) out.multiplyScalar(1 + 0.12 * g2(x, y, 0, mouthY - 0.006, lw * 0.4, 0.002));
      out.multiplyScalar(1 - 0.25 * sst(ax, lw * 0.7, lw));
    }
    if (Math.abs(y - mouthY) < 0.0011 && ax < lw * 1.02) out.multiplyScalar(0.5);
    // Short beard and moustache: hair-coloured shadow on jaw, chin and upper lip.
    if (f.beard) {
      const jawBand = sst(mouthY - 0.006 - y, 0, 0.012) * sst(ax, 0.0, 0.01 + 0.04 * sst(mouthY - y, -0.02, 0.03));
      const side = sst(ax, 0.045, 0.062) * sst(eyeY - 0.035 - y, 0, 0.02);
      const stache = g2(x, y, 0, mouthY + 0.011, 0.02, 0.0035);
      const m = Math.min(1, Math.max(jawBand * (1 - 0.6 * g2(x, y, 0, mouthY - 0.008, 0.012, 0.004)), side * 0.5, stache * 0.8));
      out.lerp(hair, m * f.beard * 0.85);
    }
    // Nostrils.
    if (g2(ax, y, f.noseWidth * 0.55, noseY - 0.0065, 0.0035, 0.0022) > 0.5) out.multiplyScalar(0.45);
    return out;
  };

  // Mask grid: brow line to under the chin, cheek to cheek.
  const NX = 44;
  const NY = 66;
  const x0 = -0.072;
  const x1 = 0.072;
  const y0 = chinY - 0.022;
  const y1 = browY + 0.03;
  const grid: number[][] = [];
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  for (let j = 0; j <= NY; j++) {
    const y = y1 + (y0 - y1) * (j / NY);
    const row: number[] = [];
    for (let i = 0; i <= NX; i++) {
      const x = x0 + (x1 - x0) * (i / NX);
      const edge = Math.min(1, (Math.min(i, NX - i) / NX) * 7) * Math.min(1, (Math.min(j, NY - j) / NY) * 7);
      const z = surfaceZ(x, y) + 0.003 * edge + relief(x, y) * edge;
      const under = sst(chinY - y, -0.004, 0.024);
      p.set(x * (1 - 0.12 * under), y + under * 0.003, z - under * 0.02);
      row.push(b.vert(p, colour(x, y, col), w));
    }
    grid.push(row);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) b.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);

  // Brows, lids and mouth: thin strips just above the mask, crisp at any distance.
  const lift = (x: number, y: number, h: number) => surfaceZ(x, y) + 0.003 + relief(x, y) + h;
  const strip = (pts: [number, number][], half: (t: number) => number, h: number, colr: THREE.Color | ((t: number) => THREE.Color)) => {
    const top: number[] = [];
    const bot: number[] = [];
    pts.forEach(([x, y], i) => {
      const t = i / (pts.length - 1);
      const hw = half(t);
      const cc = typeof colr === 'function' ? colr(t) : colr;
      top.push(b.vert(new THREE.Vector3(x, y + hw, lift(x, y + hw, h)), cc, w));
      bot.push(b.vert(new THREE.Vector3(x, y - hw, lift(x, y - hw, h)), cc, w));
    });
    for (let i = 0; i < pts.length - 1; i++) b.quad(bot[i], bot[i + 1], top[i + 1], top[i]);
  };
  // Brows: a soft halo (hair mixed into skin) under a denser core, tapered tail.
  const halo = skin.clone().lerp(hair, 0.4);
  const browCore = hair.clone().lerp(skin, 0.18);
  for (const sgn of [-1, 1]) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const ax = 0.011 + t * 0.043;
      const y = browY + 0.002 + f.browArch * 0.0065 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.9) - 0.004 * t * t;
      pts.push([sgn * ax, y]);
    }
    if (sgn < 0) pts.reverse();
    const prof = (t: number) => {
      const u = sgn < 0 ? 1 - t : t; // 0 inner .. 1 outer
      return (0.55 + 0.6 * (1 - u)) * sst(u, 0, 0.08) * (1 - sst(u, 0.82, 1) * 0.75);
    };
    strip(pts, (t) => (f.browThick / 2) * (prof(t) * 1.35 + 0.15), 0.0011, halo);
    strip(pts, (t) => (f.browThick / 2) * prof(t) * 0.85, 0.0016, browCore);
  }
  // Mouth line, following the bowed upper lip.
  {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const x = -lw + (i / 12) * lw * 2;
      pts.push([x, mouthY + 0.0012 * (x / lw) ** 2]);
    }
    strip(pts, (t) => 0.0008 * (0.5 + 0.5 * Math.sin(t * Math.PI)), 0.0009, new THREE.Color(0.14, 0.05, 0.04));
  }

  // Eyes: spheres set in the sockets with a coloured iris, limbal ring and catchlight.
  const white = new THREE.Color(0.66, 0.6, 0.55);
  const iris = new THREE.Color(f.iris ?? '#2a1a10').convertSRGBToLinear();
  const irisRim = iris.clone().multiplyScalar(0.6);
  iris.multiplyScalar(1.8);
  const irisMid = iris.clone().multiplyScalar(3.2);
  const pupil = new THREE.Color(0.012, 0.01, 0.009);
  const catchC = new THREE.Color(0.95, 0.92, 0.86);
  const lashC = hair.clone().multiplyScalar(0.6).lerp(new THREE.Color(0.02, 0.015, 0.012), 0.5);
  for (const s of [-1, 1]) {
    const er = 0.0118 * f.eye;
    const ex = s * eyeX;
    const ez = surfaceZ(ex, eyeY) + 0.003 + relief(ex, eyeY) - er * 0.5;
    const LAT = 10;
    const LON = 16;
    const rows: number[][] = [];
    for (let i = 0; i <= LAT; i++) {
      const th = (i / LAT) * Math.PI;
      const row: number[] = [];
      for (let k = 0; k <= LON; k++) {
        const ph = (k / LON) * Math.PI * 2;
        const dz = Math.cos(th);
        const dx = Math.sin(th) * Math.cos(ph);
        const dy = Math.sin(th) * Math.sin(ph);
        const cc = th < 0.2 ? pupil : th < 0.46 ? irisMid : th < 0.64 ? iris : th < 0.72 ? irisRim : white;
        row.push(b.vert(new THREE.Vector3(ex + dx * er, eyeY + dy * er * 0.85, ez + dz * er), cc, w));
      }
      rows.push(row);
    }
    for (let i = 0; i < LAT; i++) for (let k = 0; k < LON; k++) b.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]);
    // Catchlight: a tiny bright quad on the cornea, upper-left of the pupil (same side for both eyes).
    {
      const cx = ex - 0.22 * er;
      const cy = eyeY + 0.24 * er;
      const cz = ez + er * 0.99 + 0.0003;
      const q = 0.0011 * f.eye;
      const a = b.vert(new THREE.Vector3(cx - q, cy - q, cz), catchC, w);
      const bb = b.vert(new THREE.Vector3(cx + q, cy - q, cz), catchC, w);
      const cc = b.vert(new THREE.Vector3(cx + q, cy + q, cz), catchC, w);
      const d = b.vert(new THREE.Vector3(cx - q, cy + q, cz), catchC, w);
      b.quad(a, bb, cc, d);
    }
    // Lids over the eyeball: the upper lid hides its top third, the lower lid
    // its bottom edge; a lash line whose weight and outer flick vary per face.
    const front = ez + er + 0.0008;
    const lid = (yc: number, half: number, curve: number, colr: THREE.Color, widthK = 1.25, flick = 0) => {
      const top: number[] = [];
      const bot: number[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const u = t * 2 - 1; // -1 .. 1 across the eye
        const x = ex + u * er * widthK;
        const outer = Math.max(0, u * s); // 0 at inner half, up to 1 at the outer corner
        const bend = curve * Math.sin(t * Math.PI) + tilt * u * s + flick * outer ** 3;
        const z = front - er * 0.55 * u * u;
        const hh = half * (1 + flick * 60 * outer ** 4);
        top.push(b.vert(new THREE.Vector3(x, yc + bend + hh, z), colr, w));
        bot.push(b.vert(new THREE.Vector3(x, yc + bend - hh, z), colr, w));
      }
      for (let i = 0; i < 10; i++) b.quad(bot[i], bot[i + 1], top[i + 1], top[i]);
    };
    const lidSkin = skin.clone().multiplyScalar(0.84);
    const lowLid = skin.clone().multiplyScalar(0.95);
    lid(eyeY + er * 0.66, er * 0.36, er * 0.12, lidSkin);
    lid(eyeY + er * 0.27, er * (0.06 + 0.05 * lash), er * 0.16, lashC, 1.28, 0.0016 * lash);
    lid(eyeY - er * 0.7, er * 0.08, -er * 0.08, lowLid);
    lid(eyeY - er * 0.6, er * 0.016, -er * 0.08, lashC.clone().lerp(lowLid, 0.75), 1.02);
  }
}

/**
 * Sculpted ears for the bare-head (no headgear) fighter-select preview: a
 * dish with a raised rim, darker bowl and fuller top, angled back.
 */
export function addEars(b: B, head: { c: THREE.Vector3; r: THREE.Vector3 }, iHead: number, skin: THREE.Color, widthAt: (y: number) => number) {
  const { c } = head;
  const yC = c.y - 0.012;
  const bowl = skin.clone().multiplyScalar(0.62);
  const rimC = skin.clone().lerp(new THREE.Color(0.55, 0.16, 0.12), 0.08);
  for (const s of [-1, 1]) {
    const base = new THREE.Vector3(s * (widthAt(yC) - 0.004), yC, c.z - 0.012);
    const out = new THREE.Vector3(s * Math.cos(0.2), 0, -Math.sin(0.2)).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = out.clone().cross(up).multiplyScalar(-s).normalize();
    const RU = 16;
    const RV = 6;
    const rows: number[][] = [];
    for (let v = 0; v <= RV; v++) {
      const t = v / RV;
      const row: number[] = [];
      for (let u = 0; u <= RU; u++) {
        const a = (u / RU) * Math.PI * 2;
        const ry = 0.027 * (1 + 0.12 * Math.sin(a)); // fuller at the top
        const rx = 0.015 * (1 - 0.25 * Math.max(0, -Math.sin(a))); // narrower lobe
        const h = 0.004 + 0.007 * Math.exp(-(((t - 0.82) / 0.12) ** 2)) - 0.003 * (1 - t);
        const pt = base.clone().addScaledVector(up, Math.sin(a) * ry * t).addScaledVector(fwd, Math.cos(a) * rx * t).addScaledVector(out, h);
        row.push(b.vert(pt, t > 0.7 ? rimC : bowl.clone().lerp(rimC, t / 0.7), [[iHead, 1]]));
      }
      rows.push(row);
    }
    for (let v = 0; v < RV; v++) for (let u = 0; u < RU; u++) (s > 0 ? b.quad(rows[v][u], rows[v][u + 1], rows[v + 1][u + 1], rows[v + 1][u]) : b.quad(rows[v][u], rows[v + 1][u], rows[v + 1][u + 1], rows[v][u + 1]));
  }
}

/** A short, low ponytail below the headgear's rear strap. */
export function addPonytail(b: B, head: { c: THREE.Vector3; r: THREE.Vector3 }, iHead: number, iNeck: number, hair: THREE.Color) {
  const { c, r } = head;
  const top = new THREE.Vector3(0, c.y - r.y * 0.35, c.z - r.z * 0.95);
  const SEG = 6;
  const RING = 8;
  const rings: number[][] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const ctr = new THREE.Vector3(0, top.y - t * 0.12, top.z - 0.012 - Math.sin(t * 1.4) * 0.025);
    const rad = 0.017 * (1 - 0.75 * t) + 0.004;
    const w: W = t < 0.4 ? [[iHead, 1]] : [[iHead, 1 - (t - 0.4)], [iNeck, t - 0.4]];
    const ring: number[] = [];
    for (let k = 0; k <= RING; k++) {
      const a = (k / RING) * Math.PI * 2;
      ring.push(b.vert(new THREE.Vector3(ctr.x + Math.cos(a) * rad, ctr.y, ctr.z + Math.sin(a) * rad * 0.8), hair, w));
    }
    rings.push(ring);
  }
  for (let i = 0; i < SEG; i++) for (let k = 0; k < RING; k++) b.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]);
}
