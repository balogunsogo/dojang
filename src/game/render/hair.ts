import * as THREE from 'three';

/**
 * Lightweight hair: a scalp cap (built only for the bare-head fighter-select
 * preview) and back pieces that emerge below the headgear rim in matches
 * (bun, braid; the ponytail lives in face.ts). One grid each, vertex
 * colours, skinned to the head (and neck) bone: no strands, no textures.
 */
export type HairStyle = 'crop' | 'coily' | 'part' | 'sleek' | 'fringe' | 'cornrows';
export type HairBack = 'none' | 'ponytail' | 'bun' | 'braid';

type W = [number, number][];
interface B {
  vert(p: THREE.Vector3, c: THREE.Color, w: W): number;
  quad(a: number, b: number, c: number, d: number): void;
}

const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export function addHairCap(
  b: B,
  head: { c: THREE.Vector3; r: THREE.Vector3 },
  iHead: number,
  pts: THREE.Vector3[],
  style: HairStyle,
  hair: THREE.Color,
  skin: THREE.Color,
) {
  const { c, r } = head;
  const w: W = [[iHead, 1]];
  const LAT = 36;
  const LON = 72;
  const rel = pts.map((p) => p.clone().sub(c)).filter((q) => q.y > -0.09);
  const len = rel.map((q) => q.length());
  const d = new THREE.Vector3();
  const radius = (dir: THREE.Vector3) => {
    let best = -1;
    for (let i = 0; i < rel.length; i++) {
      const cos = rel[i].dot(dir) / (len[i] || 1);
      if (cos > 0.955) best = Math.max(best, len[i] * cos);
    }
    const ell = 1 / Math.sqrt((dir.x / r.x) ** 2 + (dir.y / r.y) ** 2 + (dir.z / r.z) ** 2);
    if (best > 0) return Math.min(best, ell * 1.12);
    return ell;
  };
  // Hairline height (relative to head centre) by direction: front, side, back.
  const hairline = (dz: number, dx: number) => {
    let h = dz >= 0 ? THREE.MathUtils.lerp(0.014, 0.066, dz) : THREE.MathUtils.lerp(0.014, -0.075, Math.pow(-dz, 1.6));
    if (style === 'fringe' && dz > 0.2) h -= 0.022 * THREE.MathUtils.smoothstep(dx, -0.6, 0.4); // fringe swept to one side
    if (style === 'cornrows' && dz > 0.2) h += 0.004;
    return h;
  };
  const grid: number[][] = [];
  const col = new THREE.Color();
  const dirAt = (th: number, ph: number, out: THREE.Vector3) => out.set(Math.sin(th) * Math.sin(ph), Math.cos(th), -Math.sin(th) * Math.cos(ph));
  // Per meridian, the polar angle where the scalp meets the hairline: the
  // cap ends exactly there, so the hairline is a smooth curve, not steps.
  const thMax: number[] = [];
  for (let k = 0; k <= LON; k++) {
    const ph = (k / LON) * Math.PI * 2;
    let lo = 0.2;
    let hi = 2.4;
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2;
      dirAt(mid, ph, d);
      if (d.y * radius(d) > hairline(d.z, d.x)) lo = mid;
      else hi = mid;
    }
    thMax.push(lo);
  }
  for (let i = 0; i <= LAT; i++) {
    const row: number[] = [];
    for (let k = 0; k <= LON; k++) {
      const ph = (k / LON) * Math.PI * 2;
      const th = (i / LAT) * thMax[k];
      dirAt(th, ph, d);
      const rr = radius(d);
      const y = d.y * rr;
      const hl = hairline(d.z, d.x);
      const edgeT = i / LAT;
      // Thickness and surface texture per style.
      let off = 0.004;
      col.copy(hair);
      const n = hash(i * 3.1, k * 1.7);
      if (style === 'crop') {
        off = 0.0065 + 0.0012 * n;
      } else if (style === 'coily') {
        off = 0.0105 + 0.003 * (0.5 + 0.5 * Math.sin(ph * 31 + th * 23) * Math.sin(th * 29 - ph * 17));
        col.multiplyScalar(0.85 + 0.3 * n);
      } else if (style === 'part') {
        off = 0.0095;
        const part = Math.exp(-((d.x / 0.012) ** 2)) * (d.z > 0 && d.y > 0.4 ? 1 : 0);
        col.lerp(skin, 0.3 * part);
        col.multiplyScalar(0.92 + 0.12 * Math.sin(Math.atan2(d.x, d.y) * 40));
      } else if (style === 'sleek') {
        off = 0.0085;
        col.multiplyScalar(0.9 + 0.14 * (0.5 + 0.5 * Math.sin(Math.atan2(d.x, d.z + 1.2) * 46)));
      } else if (style === 'fringe') {
        const top = THREE.MathUtils.smoothstep(d.y, 0.25, 0.75);
        const front = THREE.MathUtils.smoothstep(d.z, -0.2, 0.7);
        const undercut = 1 - THREE.MathUtils.smoothstep(y - hl, 0.012, 0.045);
        const sides = Math.abs(d.x) > 0.62 || d.z < -0.35 ? 1 : 0;
        off = 0.007 + 0.02 * top * (0.6 + 0.4 * front) + (sides ? -0.004 * undercut : 0);
        if (sides) col.lerp(skin, 0.22 * undercut);
        col.multiplyScalar(0.9 + 0.16 * (0.5 + 0.5 * Math.sin(Math.atan2(d.x + 0.5, d.z) * 30)));
      } else if (style === 'cornrows') {
        const a = Math.atan2(d.x, d.y);
        const ridge = Math.abs(Math.sin(a * 9));
        off = 0.005 + 0.0045 * ridge;
        col.lerp(skin, 0.38 * (1 - ridge) ** 3);
        col.multiplyScalar(0.88 + 0.18 * Math.abs(Math.sin(d.z * 70 + a * 3)));
      }
      const p = c.clone().addScaledVector(d, rr + off * (1 - 0.7 * THREE.MathUtils.smoothstep(edgeT, 0.86, 1)));
      row.push(b.vert(p, col, w));
    }
    grid.push(row);
  }
  for (let i = 0; i < LAT; i++) for (let k = 0; k < LON; k++) b.quad(grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1]);
}

/** Low bun at the nape, below the headgear rim. */
export function addBun(b: B, head: { c: THREE.Vector3; r: THREE.Vector3 }, iHead: number, iNeck: number, hair: THREE.Color, headgear: boolean) {
  const { c, r } = head;
  const ctr = new THREE.Vector3(0, c.y - (headgear ? 0.128 : 0.1), c.z - r.z * 0.92 - 0.012);
  const rad = new THREE.Vector3(0.036, 0.028, 0.026);
  const LAT = 8;
  const LON = 14;
  const rows: number[][] = [];
  const col = new THREE.Color();
  for (let i = 0; i <= LAT; i++) {
    const th = (i / LAT) * Math.PI;
    const row: number[] = [];
    for (let k = 0; k <= LON; k++) {
      const ph = (k / LON) * Math.PI * 2;
      const twist = 1 + 0.06 * Math.sin(ph * 3 + th * 4);
      const p = new THREE.Vector3(ctr.x + Math.sin(th) * Math.cos(ph) * rad.x * twist, ctr.y + Math.cos(th) * rad.y, ctr.z - Math.abs(Math.sin(th) * Math.sin(ph)) * rad.z * twist * (Math.sin(ph) < 0 ? 1 : 0.35));
      col.copy(hair).multiplyScalar(0.85 + 0.25 * (0.5 + 0.5 * Math.sin(ph * 5 + th * 3)));
      row.push(b.vert(p, col, [[iHead, 0.7], [iNeck, 0.3]]));
    }
    rows.push(row);
  }
  for (let i = 0; i < LAT; i++) for (let k = 0; k < LON; k++) b.quad(rows[i][k], rows[i + 1][k], rows[i + 1][k + 1], rows[i][k + 1]);
}

/** One thick plait gathered from the cornrows, hanging below the headgear rim. */
export function addBraid(b: B, head: { c: THREE.Vector3; r: THREE.Vector3 }, iHead: number, iNeck: number, hair: THREE.Color) {
  const { c, r } = head;
  const top = new THREE.Vector3(0, c.y - r.y * 0.3, c.z - r.z * 0.95);
  const SEG = 16;
  const RING = 8;
  const rings: number[][] = [];
  const col = new THREE.Color();
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const ctr = new THREE.Vector3(0, top.y - t * 0.2, top.z - 0.016 - Math.sin(t * 1.3) * 0.03);
    const lobe = 0.5 + 0.5 * Math.cos(t * Math.PI * 2 * 5.5);
    const rad = (0.016 * (1 - 0.45 * t) + 0.004) * (0.82 + 0.28 * lobe);
    const w: W = t < 0.35 ? [[iHead, 1]] : [[iHead, Math.max(0, 1 - (t - 0.35) * 1.4)], [iNeck, Math.min(1, (t - 0.35) * 1.4)]];
    const ring: number[] = [];
    for (let k = 0; k <= RING; k++) {
      const a = (k / RING) * Math.PI * 2;
      col.copy(hair).multiplyScalar(0.78 + 0.34 * lobe);
      ring.push(b.vert(new THREE.Vector3(ctr.x + Math.cos(a) * rad, ctr.y, ctr.z + Math.sin(a) * rad * 0.85), col, w));
    }
    rings.push(ring);
  }
  for (let i = 0; i < SEG; i++) for (let k = 0; k < RING; k++) b.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]);
}
