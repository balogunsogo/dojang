import * as THREE from 'three';

/**
 * Stylized face for the CC0 mannequin, whose head is a featureless egg.
 *
 * A small sculpted mask (one smooth grid) sits just over the front of the
 * head: brow ridge, eye sockets, nose, cheekbones, lips, chin and jaw are
 * smooth height offsets, coloured per vertex (no textures). Two small
 * eyeballs with painted irises sit in the sockets for depth. Everything is
 * rigid on the head bone inside the existing gear mesh: no extra draw call.
 * Semi-realistic and restrained on purpose: proportions over detail.
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
}

export const FACES: Record<'jae' | 'hana', FaceParams> = {
  jae: { browThick: 0.0075, browArch: 0.15, nose: 0.023, noseWidth: 0.0125, jaw: 0.85, lips: 0.85, eye: 1.0, lipTint: 0.25 },
  hana: { browThick: 0.0055, browArch: 0.6, nose: 0.019, noseWidth: 0.0105, jaw: 0.25, lips: 1.08, eye: 1.07, lipTint: 0.55 },
};

type W = [number, number][];
interface B {
  vert(p: THREE.Vector3, c: THREE.Color, w: W): number;
  quad(a: number, b: number, c: number, d: number): void;
}

const g2 = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));

/**
 * @param head head ellipsoid fitted to the mannequin (centre and radii, bind metres)
 * @param iHead head bone index
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
  // Face landmarks (heights relative to the head centre, metres).
  const eyeY = c.y + 0.012;
  const browY = eyeY + 0.019;
  const noseY = eyeY - 0.056; // tip
  const mouthY = eyeY - 0.092;
  const chinY = eyeY - 0.13;
  const eyeX = 0.031;


  /** Sculpt: offset along +z from the head surface. */
  const relief = (x: number, y: number) => {
    const ax = Math.abs(x);
    let d = 0;
    d += 0.009 * g2(ax, y, eyeX - 0.002, browY + 0.002, 0.03, 0.009); // brow ridge
    d -= 0.01 * g2(ax, y, eyeX, eyeY, 0.021 * f.eye, 0.0095 * f.eye); // eye socket (almond)
    d += 0.009 * g2(ax, y, 0.046, eyeY - 0.03, 0.02, 0.016); // cheekbone
    // Nose: narrow bridge growing into a rounded tip, small alae.
    const bridgeT = THREE.MathUtils.clamp((browY - 0.004 - y) / (browY - 0.004 - noseY), 0, 1);
    if (y < browY && y > noseY - 0.012) {
      const wdt = 0.006 + f.noseWidth * 0.55 * bridgeT;
      d += (0.003 + f.nose * 0.55 * bridgeT * bridgeT) * Math.exp(-((x / wdt) ** 2));
    }
    d += f.nose * 0.5 * g2(x, y, 0, noseY, f.noseWidth * 0.75, 0.009); // tip
    d += 0.007 * g2(ax, y, f.noseWidth * 0.95, noseY - 0.002, 0.0075, 0.006); // alae
    d -= 0.004 * g2(x, y, 0, noseY - 0.016, 0.006, 0.006); // philtrum dip
    // Lips: upper and lower volume, a groove between.
    const lw = 0.022 * (0.9 + 0.1 * f.lips);
    d += 0.0045 * f.lips * g2(x, y, 0, mouthY + 0.0055, lw, 0.0042);
    d += 0.0055 * f.lips * g2(x, y, 0, mouthY - 0.006, lw * 0.85, 0.005);
    d -= 0.0028 * g2(x, y, 0, mouthY, lw * 1.05, 0.0018);
    d += 0.0075 * g2(x, y, 0, chinY + 0.008, 0.018, 0.012); // chin
    // Jaw: tapered jaws pull in below the mouth; square jaws stay full.
    d -= (1 - f.jaw) * 0.012 * THREE.MathUtils.smoothstep(mouthY - y, -0.01, 0.04) * (ax / 0.07) ** 2;
    return d;
  };

  const colour = (x: number, y: number, out: THREE.Color) => {
    const ax = Math.abs(x);
    out.copy(skin);
    // Soft modelling: darker sockets and under the nose/jaw, warmer cheeks.
    out.multiplyScalar(1 - 0.12 * g2(ax, y, eyeX, eyeY + 0.004, 0.022, 0.014) - 0.08 * g2(x, y, 0, noseY - 0.012, 0.016, 0.006) - 0.1 * THREE.MathUtils.smoothstep(chinY + 0.02 - y, 0, 0.03));
    const warm = 0.06 * g2(ax, y, 0.045, eyeY - 0.04, 0.02, 0.016);
    out.r += warm;
    out.g += warm * 0.25;
    // Brows: arched bars of hair colour, thicker toward the inner end.
    const archY = browY + 0.004 + f.browArch * 0.006 * Math.sin(THREE.MathUtils.clamp((ax - 0.012) / 0.038, 0, 1) * Math.PI) - 0.0015 * (ax / 0.05);
    const thick = f.browThick * (1.15 - 0.45 * THREE.MathUtils.clamp((ax - 0.012) / 0.04, 0, 1));
    void archY;
    void thick;
    // Upper eyelid line.
    const lidY = eyeY + 0.0085 * f.eye * Math.sqrt(Math.max(0, 1 - ((ax - eyeX) / (0.017 * f.eye)) ** 2));
    if (Math.abs(ax - eyeX) < 0.017 * f.eye && Math.abs(y - lidY) < 0.0016) out.multiplyScalar(0.45);
    // Lips.
    const inLips = g2(x, y, 0, mouthY, 0.021, 0.008) > 0.45;
    if (inLips) {
      out.lerp(new THREE.Color(0.42, 0.16, 0.14), 0.25 + 0.3 * f.lipTint);
      if (Math.abs(y - mouthY) < 0.0012 && ax < 0.021) out.multiplyScalar(0.55);
    }
    // Nostrils.
    if (g2(ax, y, f.noseWidth * 0.55, noseY - 0.0065, 0.0035, 0.0022) > 0.5) out.multiplyScalar(0.5);
    return out;
  };

  // Mask grid: brow line to under the chin, cheek to cheek.
  const NX = 26;
  const NY = 40;
  const x0 = -0.074;
  const x1 = 0.074;
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
      // Feather the edges onto the head surface so no seam shows.
      const edge = Math.min(1, (Math.min(i, NX - i) / NX) * 7) * Math.min(1, (Math.min(j, NY - j) / NY) * 7);
      const z = surfaceZ(x, y) + 0.003 * edge + relief(x, y) * edge;
      // Under the chin, curl back toward the neck.
      const under = THREE.MathUtils.smoothstep(chinY - y, 0, 0.02);
      p.set(x * (1 - 0.15 * under), y + under * 0.004, z - under * 0.025);
      row.push(b.vert(p, colour(x, y, col), w));
    }
    grid.push(row);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) b.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);

  // Brows and mouth: thin strips just above the mask, crisp at any distance.
  const lift = (x: number, y: number, h: number) => surfaceZ(x, y) + 0.003 + relief(x, y) + h;
  const strip = (pts: [number, number][], half: (t: number) => number, h: number, colr: THREE.Color) => {
    const top: number[] = [];
    const bot: number[] = [];
    pts.forEach(([x, y], i) => {
      const t = i / (pts.length - 1);
      const hw = half(t);
      top.push(b.vert(new THREE.Vector3(x, y + hw, lift(x, y + hw, h)), colr, w));
      bot.push(b.vert(new THREE.Vector3(x, y - hw, lift(x, y - hw, h)), colr, w));
    });
    for (let i = 0; i < pts.length - 1; i++) b.quad(bot[i], bot[i + 1], top[i + 1], top[i]);
  };
  for (const sgn of [-1, 1]) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const ax = 0.011 + t * 0.042;
      const y = browY + 0.002 + f.browArch * 0.0065 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.9) - 0.004 * t * t;
      pts.push([sgn * ax, y]);
    }
    if (sgn < 0) pts.reverse();
    strip(pts, (t) => (f.browThick / 2) * (sgn < 0 ? 0.55 + 0.6 * t : 1.15 - 0.6 * t), 0.0014, hair);
  }
  {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const x = -0.021 + (i / 10) * 0.042;
      pts.push([x, mouthY + 0.0012 * (x / 0.021) ** 2]);
    }
    strip(pts, (t) => 0.0009 * (0.6 + 0.4 * Math.sin(t * Math.PI)), 0.0009, new THREE.Color(0.16, 0.06, 0.05));
  }

  // Eyes: small spheres set deep in the sockets, looking forward.
  const white = new THREE.Color(0.62, 0.58, 0.54);
  const iris = new THREE.Color(0.12, 0.07, 0.04);
  const pupil = new THREE.Color(0.02, 0.015, 0.012);
  for (const s of [-1, 1]) {
    const er = 0.0118 * f.eye;
    const ex = s * eyeX;
    const ez = surfaceZ(ex, eyeY) + 0.003 + relief(ex, eyeY) - er * 0.5;
    const LAT = 8;
    const LON = 12;
    const rows: number[][] = [];
    for (let i = 0; i <= LAT; i++) {
      const th = (i / LAT) * Math.PI;
      const row: number[] = [];
      for (let k = 0; k <= LON; k++) {
        const ph = (k / LON) * Math.PI * 2;
        // Pole of the sphere faces +z (forward).
        const dz = Math.cos(th);
        const dx = Math.sin(th) * Math.cos(ph);
        const dy = Math.sin(th) * Math.sin(ph);
        const ang = th;
        const cc = ang < 0.3 ? pupil : ang < 0.74 ? iris : white;
        row.push(b.vert(new THREE.Vector3(ex + dx * er, eyeY + dy * er * 0.85, ez + dz * er), cc, w));
      }
      rows.push(row);
    }
    for (let i = 0; i < LAT; i++) for (let k = 0; k < LON; k++) b.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]);
    // Eyelids over the eyeball: the upper lid hides its top third, the lower
    // lid its bottom edge, with a dark lash line: an almond, not a ball.
    const front = ez + er + 0.0008;
    const lid = (yc: number, half: number, curve: number, colr: THREE.Color) => {
      const top: number[] = [];
      const bot: number[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const x = ex + (t * 2 - 1) * er * 1.25;
        const bend = curve * Math.sin(t * Math.PI);
        const z = front - er * 0.55 * (t * 2 - 1) ** 2;
        top.push(b.vert(new THREE.Vector3(x, yc + bend + half, z), colr, w));
        bot.push(b.vert(new THREE.Vector3(x, yc + bend - half, z), colr, w));
      }
      for (let i = 0; i < 8; i++) b.quad(bot[i], bot[i + 1], top[i + 1], top[i]);
    };
    const lidSkin = skin.clone().multiplyScalar(0.86);
    lid(eyeY + er * 0.66, er * 0.36, er * 0.12, lidSkin);
    lid(eyeY + er * 0.27, er * 0.07, er * 0.16, new THREE.Color(0.05, 0.03, 0.025));
    lid(eyeY - er * 0.78, er * 0.18, -er * 0.1, lidSkin);
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
