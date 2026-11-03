import * as THREE from 'three';
import { addFace, addPonytail, type FaceParams } from './face';

/**
 * Procedural dobok and sparring equipment, fitted to the CC0 mannequin.
 *
 * Every piece is generated in bind space from the mannequin's own vertices
 * (radii are measured, then given a fabric margin) and skinned to the
 * existing skeleton: limbs blend across the elbow and knee, rigid pieces
 * follow one bone. The result is ONE extra skinned draw call per fighter,
 * no textures, ~2.6k vertices, and it moves with the same procedural
 * animation as the body: nothing new to simulate.
 */

export interface GearColors {
  dobok: THREE.Color;
  skin: THREE.Color;
  gear: THREE.Color;
  belt: THREE.Color;
  hair: THREE.Color;
  face: FaceParams;
  ponytail: boolean;
}

type W = [number, number][]; // [boneIndex, weight]

interface Sample {
  p: THREE.Vector3;
  bone: string;
}

class Builder {
  pos: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  vert(p: THREE.Vector3, c: THREE.Color, w: W) {
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c.r, c.g, c.b);
    const ws = w.slice(0, 4);
    const tot = ws.reduce((s, [, x]) => s + x, 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.si.push(ws[k]?.[0] ?? 0);
      this.sw.push(ws[k] ? ws[k][1] / tot : 0);
    }
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Build the gear mesh for a skinned mannequin in bind pose.
 * `samples` are the body vertices in bind-space metres with their dominant bone.
 */
export function buildGear(mesh: THREE.SkinnedMesh, samples: Sample[], colors: GearColors): THREE.BufferGeometry {
  const bones = mesh.skeleton.bones;
  const bi = (n: string) => {
    const i = bones.findIndex((b) => b.name === n);
    if (i < 0) throw new Error(`gear: bone ${n} missing`);
    return i;
  };
  const bp = (n: string) => bones[bi(n)].getWorldPosition(new THREE.Vector3());
  const B = new Builder();
  const tmp = new THREE.Vector3();
  const c = new THREE.Color();

  /** Max distance of matching body vertices from an axis within a slab. */
  const radiusAt = (center: THREE.Vector3, dir: THREE.Vector3, half: number, match: RegExp) => {
    let r = 0;
    for (const s of samples) {
      if (!match.test(s.bone)) continue;
      tmp.subVectors(s.p, center);
      const along = tmp.dot(dir);
      if (Math.abs(along) > half) continue;
      r = Math.max(r, tmp.addScaledVector(dir, -along).length());
    }
    return r;
  };
  /** Elliptical extents (x, front z, back z, centre z) of the torso in a horizontal slab. */
  const torsoAt = (y: number, half: number, match: RegExp) => {
    let x = 0,
      zf = -1,
      zb = 1;
    for (const s of samples) {
      if (!match.test(s.bone) || Math.abs(s.p.y - y) > half) continue;
      x = Math.max(x, Math.abs(s.p.x));
      zf = Math.max(zf, s.p.z);
      zb = Math.min(zb, s.p.z);
    }
    return { x, zf, zb };
  };

  // ── Limb tube: rings along a bone chain, loose cloth with folds ─────────
  const limbTube = (opts: {
    pts: THREE.Vector3[]; // ring centres
    weights: W[]; // per ring
    match: RegExp;
    margin: (t: number) => number;
    minR: number;
    seg: number;
    color: (t: number, a: number) => THREE.Color;
    fold: number;
    up: THREE.Vector3; // reference for the ring basis
  }) => {
    const { pts, seg } = opts;
    const rings: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const dir = next.clone().sub(prev).normalize();
      const u = opts.up.clone().addScaledVector(dir, -opts.up.dot(dir)).normalize();
      const v = dir.clone().cross(u).normalize();
      const half = prev.distanceTo(next) * 0.5 + 0.02;
      const r = Math.max(opts.minR, radiusAt(pts[i], dir, half, opts.match)) + opts.margin(t);
      const ring: number[] = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        // Soft vertical folds: a small radial ripple that catches the light.
        const rr = r * (1 + opts.fold * Math.sin(a * 5 + t * 2.2) * (0.4 + 0.6 * t));
        const p = pts[i].clone().addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr);
        ring.push(B.vert(p, opts.color(t, a), opts.weights[i]));
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++) B.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]);
  };

  const dobok = colors.dobok;
  const shade = (base: THREE.Color, f: number) => c.copy(base).multiplyScalar(f);

  // ── Trousers ───────────────────────────────────────────────────────────
  for (const side of ['L', 'R'] as const) {
    const thigh = bp(`DEF-thigh${side}`);
    const shin = bp(`DEF-shin${side}`);
    const iT = bi(`DEF-thigh${side}`);
    const iS = bi(`DEF-shin${side}`);
    const iH = bi('DEF-hips');
    const ys = [0.99, 0.92, 0.84, 0.75, 0.66, 0.59, 0.53, 0.47, 0.4, 0.31, 0.22, 0.155];
    const pts = ys.map((y) => new THREE.Vector3(thigh.x, y, THREE.MathUtils.lerp(shin.z, thigh.z, smooth(0.1, 0.93, y))));
    const weights: W[] = ys.map((y) => {
      if (y > 0.95) return [[iH, 0.55], [iT, 0.45]];
      const k = smooth(0.46, 0.62, y); // 1 = thigh, 0 = shin
      return [[iT, k], [iS, 1 - k]];
    });
    const sx = side === 'L' ? 1 : -1;
    limbTube({
      pts,
      weights,
      match: new RegExp(`thigh${side}|shin${side}`),
      margin: (t) => 0.01 + 0.017 * t,
      minR: 0.045,
      seg: 20,
      fold: 0.03,
      up: new THREE.Vector3(sx, 0, 0),
      color: (t, a) => {
        // Outer side seam and a darker hem band.
        const seam = Math.abs(Math.sin(a)) < 0.06 && Math.cos(a) > 0;
        return shade(dobok, (t > 0.93 ? 0.84 : 1) * (seam ? 0.86 : 0.97 + 0.03 * Math.cos(a * 5)));
      },
    });
  }

  // ── Jacket (wrap top with V-neck, skirt below the belt) ──────────────────
  const iHips = bi('DEF-hips');
  const spineY: [number, number][] = [
    [bi('DEF-hips'), 0.917],
    [bi('DEF-spine001'), 1.051],
    [bi('DEF-spine002'), 1.174],
    [bi('DEF-spine003'), 1.315],
    [bi('DEF-neck'), 1.488],
  ];
  const spineW = (y: number): W => {
    if (y <= spineY[0][1]) return [[spineY[0][0], 1]];
    for (let i = 0; i < spineY.length - 1; i++) {
      const [a, ya] = spineY[i];
      const [b, yb] = spineY[i + 1];
      if (y <= yb) {
        const k = (y - ya) / (yb - ya);
        return [[a, 1 - k], [b, k]];
      }
    }
    return [[spineY[spineY.length - 1][0], 1]];
  };
  const iShL = bi('DEF-shoulderL');
  const iShR = bi('DEF-shoulderR');
  const torsoMatch = /hips|spine|shoulder/;
  const jacketYs = [0.8, 0.86, 0.93, 1.0, 1.08, 1.16, 1.24, 1.31, 1.37, 1.42, 1.46, 1.49];
  const seg = 36;
  const jacketRings: number[][] = [];
  for (const y of jacketYs) {
    const e = torsoAt(Math.min(y, 1.44), 0.035, torsoMatch);
    const skirt = y < 0.93;
    const top = smooth(1.4, 1.49, y);
    const mx = 0.018 + (skirt ? 0.02 + (0.93 - y) * 0.25 : 0) - top * 0.02;
    const rx = Math.max(0.1, e.x * (1 - top * 0.45)) + mx;
    const cz = (e.zf + e.zb) / 2;
    const rzf = Math.max(0.08, e.zf - cz) + mx;
    const rzb = Math.max(0.08, cz - e.zb) + mx;
    const ring: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2; // 0 = +x, π/2 = front (+z)
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const p = new THREE.Vector3(ca * rx, y, cz + sa * (sa > 0 ? rzf : rzb));
      // V-neck: skin shows in a V on the chest; lapel edges darker.
      const vHalf = (y - 1.24) * 0.55; // half-width of the V at this height
      const front = sa > 0;
      const xAbs = Math.abs(p.x);
      let col = dobok;
      let f = 0.97 + 0.03 * Math.cos(a * 7 + y * 9);
      if (front && y > 1.24 && xAbs < vHalf) col = colors.skin;
      else if (front && y > 1.2 && xAbs < vHalf + 0.03) f = 0.82; // lapel
      // Wrap front: overlapping edge running diagonally to the belt.
      if (front && y < 1.24 && y > 0.93 && Math.abs(p.x - (y - 0.93) * -0.2) < 0.012) f = 0.86;
      if (y < 0.82) f *= 0.86; // hem
      // Shoulders follow the shoulder bones a little.
      const w = spineW(y);
      if (y > 1.35 && xAbs > 0.1) w.push([p.x > 0 ? iShL : iShR, 0.6 * smooth(0.1, 0.18, xAbs)]);
      ring.push(B.vert(p, shade(col, col === colors.skin ? 1 : f), y < 0.93 ? [[iHips, 1]] : w));
    }
    jacketRings.push(ring);
  }
  for (let i = 0; i < jacketRings.length - 1; i++) for (let k = 0; k < seg; k++) B.quad(jacketRings[i][k], jacketRings[i + 1][k], jacketRings[i + 1][k + 1], jacketRings[i][k + 1]);

  // ── Sleeves ────────────────────────────────────────────────────────────
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const ua = bp(`DEF-upper_arm${side}`);
    const fa = bp(`DEF-forearm${side}`);
    const hd = bp(`DEF-hand${side}`);
    const iU = bi(`DEF-upper_arm${side}`);
    const iF = bi(`DEF-forearm${side}`);
    const iSh = bi(`DEF-shoulder${side}`);
    const xs = [0.12, 0.17, 0.24, 0.31, 0.38, 0.44, 0.5, 0.57, 0.64, 0.7];
    const pts = xs.map((x) => {
      const t = (x - 0.12) / (hd.x * sx - 0.12);
      return new THREE.Vector3(x * sx, THREE.MathUtils.lerp(ua.y, hd.y, t), THREE.MathUtils.lerp(ua.z, hd.z, t));
    });
    const elbow = fa.x * sx;
    const weights: W[] = xs.map((x) => {
      if (x < 0.16) return [[iSh, 0.6], [iU, 0.4]];
      const k = smooth(elbow - 0.06, elbow + 0.06, x); // 0 = upper, 1 = forearm
      return [[iU, 1 - k], [iF, k]];
    });
    limbTube({
      pts,
      weights,
      match: new RegExp(`upper_arm${side}|forearm${side}`),
      margin: (t) => 0.007 + 0.009 * t,
      minR: 0.038,
      seg: 16,
      fold: 0.03,
      up: new THREE.Vector3(0, 1, 0),
      color: (t, a) => shade(dobok, (t > 0.92 ? 0.85 : 1) * (Math.abs(Math.cos(a) + 1) < 0.1 ? 0.88 : 0.97 + 0.03 * Math.sin(a * 5))),
    });
  }

  // ── Belt: band, knot and two tails ───────────────────────────────────────
  {
    const e = torsoAt(0.95, 0.03, torsoMatch);
    const cz = (e.zf + e.zb) / 2;
    const rx = e.x + 0.032;
    const rzf = e.zf - cz + 0.032;
    const rzb = cz - e.zb + 0.032;
    const beltCol = colors.belt;
    const rings: number[][] = [];
    for (const y of [0.925, 0.965]) {
      const ring: number[] = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const sa = Math.sin(a);
        ring.push(B.vert(new THREE.Vector3(Math.cos(a) * rx, y, cz + sa * (sa > 0 ? rzf : rzb)), shade(beltCol, y > 0.95 ? 1 : 0.9), [[iHips, 1]]));
      }
      rings.push(ring);
    }
    for (let k = 0; k < seg; k++) B.quad(rings[0][k], rings[1][k], rings[1][k + 1], rings[0][k + 1]);
    const zFront = cz + rzf;
    box(B, new THREE.Vector3(0, 0.945, zFront + 0.012), new THREE.Vector3(0.05, 0.045, 0.026), shade(beltCol, 0.92), [[iHips, 1]]);
    for (const s of [-1, 1]) {
      // Tails hang slightly apart and splay outward.
      tail(B, new THREE.Vector3(s * 0.022, 0.93, zFront + 0.014), s, shade(beltCol, 0.95), [[iHips, 1]]);
    }
  }

  // ── Hogu (trunk protector): padded shell over the jacket ─────────────────
  {
    const gear = colors.gear;
    const ys = [1.0, 1.05, 1.12, 1.2, 1.28, 1.34, 1.385];
    const rings: number[][] = [];
    for (let j = 0; j < ys.length; j++) {
      const y = ys[j];
      const e = torsoAt(y, 0.035, torsoMatch);
      const cz = (e.zf + e.zb) / 2;
      const pad = 0.04;
      const rx = e.x + pad;
      const ring: number[] = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const sa = Math.sin(a);
        const front = sa > 0;
        // Front panel bulges (padding); the top edge dips at the front for the neck.
        const bulge = front ? 0.012 * Math.sin(Math.PI * (j / (ys.length - 1))) * sa : 0;
        let yy = y;
        if (j === ys.length - 1) yy = y - (front ? 0.06 * Math.pow(sa, 2) : 0);
        const rz = (front ? e.zf - cz : cz - e.zb) + pad + bulge;
        const p = new THREE.Vector3(Math.cos(a) * rx, yy, cz + sa * rz);
        // Quilting: vertical pad lines on the front, darker binding at the edges.
        const edge = j === 0 || j === ys.length - 1;
        const quilt = front && Math.abs(Math.sin(p.x * 52)) < 0.12;
        const f = edge ? 0.62 : quilt ? 0.82 : front ? 1 : 0.92;
        ring.push(B.vert(p, shade(gear, f), spineW(yy)));
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++) B.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]);
    // Shoulder straps.
    const e = torsoAt(1.4, 0.04, torsoMatch);
    for (const s of [-1, 1]) {
      const iSh = s > 0 ? iShL : iShR;
      strap(B, s * 0.11, e.zf + 0.035, e.zb - 0.035, shade(gear, 0.6), [[bi('DEF-spine003'), 0.6], [iSh, 0.4]]);
    }
  }

  // ── Face (sculpted mask + eyes) and headgear ─────────────────────────────
  const iHead = bi('DEF-head');
  const iNeck = bi('DEF-neck');
  const headS = samples.filter((s) => s.bone === 'DEF-head');
  const hlo = new THREE.Vector3(9, 9, 9);
  const hhi = new THREE.Vector3(-9, -9, -9);
  for (const s of headS) {
    hlo.min(s.p);
    hhi.max(s.p);
  }
  const headC = new THREE.Vector3(0, (hlo.y + hhi.y) / 2, (hlo.z + hhi.z) / 2);
  const headR = new THREE.Vector3((hhi.x - hlo.x) / 2, (hhi.y - hlo.y) / 2, (hhi.z - hlo.z) / 2);
  // Real front profile of the head (the egg is flat-fronted, not ellipsoidal).
  const frontAt = (y: number) => {
    let z = -1;
    for (const s of headS) if (Math.abs(s.p.y - y) < 0.03 && Math.abs(s.p.x) < 0.04) z = Math.max(z, s.p.z);
    return z;
  };
  const widthAt = (y: number) => {
    let w = 0;
    for (const s of headS) if (Math.abs(s.p.y - y) < 0.02) w = Math.max(w, Math.abs(s.p.x));
    return w;
  };
  const prof: [number, number, number][] = [];
  for (let y = hlo.y + 0.005; y <= hhi.y; y += 0.01) prof.push([y, frontAt(y), widthAt(y)]);
  const interp = (y: number, k: 1 | 2) => {
    const i = THREE.MathUtils.clamp(Math.floor((y - prof[0][0]) / 0.01), 0, prof.length - 2);
    const t = THREE.MathUtils.clamp((y - prof[i][0]) / 0.01, 0, 1);
    return THREE.MathUtils.lerp(prof[i][k], prof[i + 1][k], t);
  };
  const faceSurface = (x: number, y: number) => {
    const fz = Math.max(interp(y, 1), headC.z);
    const w = Math.max(0.03, interp(y, 2)) + 0.006;
    return headC.z + (fz - headC.z) * Math.sqrt(Math.max(0, 1 - (x / w) ** 2)) - 0.004;
  };
  addFace(B, { c: headC, r: headR }, iHead, colors.face, colors.skin, colors.hair, faceSurface);
  if (colors.ponytail) addPonytail(B, { c: headC, r: headR }, iHead, iNeck, colors.hair);

  // ── Headgear: padded shell, open face, ear pads, chin strap ──────────────
  {
    const head = samples.filter((s) => s.bone === 'DEF-head');
    const lo = new THREE.Vector3(9, 9, 9);
    const hi = new THREE.Vector3(-9, -9, -9);
    for (const s of head) {
      lo.min(s.p);
      hi.max(s.p);
    }
    const ctr = lo.clone().add(hi).multiplyScalar(0.5);
    ctr.y = hi.y - (hi.x - lo.x) * 0.62;
    const rx = (hi.x - lo.x) / 2 + 0.02;
    const ry = hi.y - ctr.y + 0.024;
    const rz = (hi.z - lo.z) / 2 + 0.018;
    const iHead = bi('DEF-head');
    const iNeck = bi('DEF-neck');
    const LAT = 14;
    const LON = 28;
    const grid: number[][] = [];
    const maxTheta = 2.15; // from the crown down past the jaw line
    for (let i = 0; i <= LAT; i++) {
      const th = (i / LAT) * maxTheta;
      const row: number[] = [];
      for (let k = 0; k <= LON; k++) {
        const ph = (k / LON) * Math.PI * 2; // 0 = back (-z)
        const dx = Math.sin(th) * Math.sin(ph);
        const dz = -Math.sin(th) * Math.cos(ph);
        const dy = Math.cos(th);
        // Padded crown: thicker rolls on top, thinner at the cheeks.
        const roll = 1 + 0.05 * Math.max(0, Math.cos(th * 3)) * (dy > 0.3 ? 1 : 0);
        const p = new THREE.Vector3(ctr.x + dx * rx * roll, ctr.y + dy * ry * roll, ctr.z + dz * rz * roll);
        const ear = Math.abs(dx) > 0.82 && dy < 0.15 && dy > -0.55;
        const crownSeam = dy > 0.35 && Math.abs(Math.sin(ph * 2)) < 0.08;
        const rim = i === LAT;
        const f = rim ? 0.6 : ear ? 0.72 : crownSeam ? 0.78 : 1;
        row.push(B.vert(p, shade(colors.gear, f), i > LAT - 2 && dz < 0 ? [[iHead, 0.7], [iNeck, 0.3]] : [[iHead, 1]]));
      }
      grid.push(row);
    }
    for (let i = 0; i < LAT; i++)
      for (let k = 0; k < LON; k++) {
        // Face opening: skip quads in front between brow and chin.
        const th = ((i + 0.5) / LAT) * maxTheta;
        const ph = ((k + 0.5) / LON) * Math.PI * 2;
        const dz = -Math.sin(th) * Math.cos(ph);
        const dx = Math.sin(th) * Math.sin(ph);
        const dy = Math.cos(th);
        if (dz > 0.42 && dy < 0.42 && Math.abs(dx) < 0.62) continue;
        B.quad(grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1]);
      }
  }

  // ── Hand and foot protectors ───────────────────────────────────────────
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const hand = samples.filter((s) => s.bone === `DEF-hand${side}`);
    const lo = new THREE.Vector3(9, 9, 9);
    const hi = new THREE.Vector3(-9, -9, -9);
    for (const s of hand) {
      lo.min(s.p);
      hi.max(s.p);
    }
    const ctr = lo.clone().add(hi).multiplyScalar(0.5);
    ellipsoid(B, ctr, new THREE.Vector3((hi.x - lo.x) / 2 + 0.014, (hi.y - lo.y) / 2 + 0.016, (hi.z - lo.z) / 2 + 0.014), 10, 14, (dy) => shade(colors.gear, dy > 0.2 ? 0.95 : 0.75), [[bi(`DEF-hand${side}`), 1]], -1);
    // Foot protector: a sock over instep and heel, open sole, slightly clear of the floor.
    const foot = samples.filter((s) => s.bone === `DEF-foot${side}` || s.bone === `DEF-toe${side}`);
    const fl = new THREE.Vector3(9, 9, 9);
    const fh = new THREE.Vector3(-9, -9, -9);
    for (const s of foot) {
      fl.min(s.p);
      fh.max(s.p);
    }
    const fc = fl.clone().add(fh).multiplyScalar(0.5);
    fc.y = 0.006;
    ellipsoid(B, fc, new THREE.Vector3((fh.x - fl.x) / 2 + 0.008, fh.y - 0.006 + 0.012, (fh.z - fl.z) / 2 - 0.02), 7, 16, (dy) => shade(new THREE.Color(0x2a2c30), dy > 0.85 ? 1.4 : 1), [[bi(`DEF-foot${side}`), 0.75], [bi(`DEF-toe${side}`), 0.25]], 0);
    void sx;
  }

  // The mannequin's vertices are quantized: its inverse bind matrices also
  // dequantize (bone.matrixWorld * boneInverse = the same matrix D for every
  // bone in bind pose). Express the gear in that raw space so skinning maps
  // it back to metres exactly like the body.
  const g = B.geometry();
  const D = bones[0].matrixWorld.clone().multiply(mesh.skeleton.boneInverses[0]).premultiply(mesh.bindMatrixInverse);
  g.applyMatrix4(D.invert());
  return g;
}

/** Axis-aligned box (bind space). */
function box(B: Builder, c: THREE.Vector3, s: THREE.Vector3, col: THREE.Color, w: W) {
  const h = s.clone().multiplyScalar(0.5);
  const faces: [number[], THREE.Vector3][] = [];
  void faces;
  const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => B.vert(new THREE.Vector3(c.x + x * h.x, c.y + y * h.y, c.z + z * h.z), col, w))));
  // index = (x?4:0) + (y?2:0) + (z?1:0)
  const q = (a: number, b: number, cc: number, d: number) => B.quad(corners[a], corners[b], corners[cc], corners[d]);
  q(1, 5, 7, 3); // +z
  q(4, 0, 2, 6); // -z
  q(4, 6, 7, 5); // +x
  q(0, 1, 3, 2); // -x
  q(2, 3, 7, 6); // +y
  q(0, 4, 5, 1); // -y
}

/** A belt tail hanging from the knot. */
function tail(B: Builder, top: THREE.Vector3, side: number, col: THREE.Color, w: W) {
  const len = 0.24;
  const wid = 0.04;
  const a = [] as number[];
  const b = [] as number[];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const x = top.x + side * (0.012 + t * 0.045);
    const y = top.y - t * len;
    const z = top.z + 0.01 * Math.sin(t * Math.PI);
    a.push(B.vert(new THREE.Vector3(x - wid / 2, y, z), col, w));
    b.push(B.vert(new THREE.Vector3(x + wid / 2, y, z), col, w));
  }
  for (let i = 0; i < 4; i++) B.quad(a[i], a[i + 1], b[i + 1], b[i]);
}

/** A hogu strap over the shoulder from front to back. */
function strap(B: Builder, x: number, zf: number, zb: number, col: THREE.Color, w: W) {
  const l: number[] = [];
  const r: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const a = Math.PI * t; // front → over → back
    const z = THREE.MathUtils.lerp(zf, zb, (1 - Math.cos(a)) / 2);
    const y = 1.39 + Math.sin(a) * 0.075;
    l.push(B.vert(new THREE.Vector3(x - 0.02, y, z), col, w));
    r.push(B.vert(new THREE.Vector3(x + 0.02, y, z), col, w));
  }
  for (let i = 0; i < 8; i++) B.quad(l[i], l[i + 1], r[i + 1], r[i]);
}

/** Ellipsoid (or upper part when minDy > -1) for gloves and foot protectors. */
function ellipsoid(B: Builder, c: THREE.Vector3, r: THREE.Vector3, lat: number, lon: number, col: (dy: number) => THREE.Color, w: W, minDy: number) {
  const grid: number[][] = [];
  const maxTh = Math.acos(Math.max(-1, minDy));
  for (let i = 0; i <= lat; i++) {
    const th = (i / lat) * maxTh;
    const row: number[] = [];
    for (let k = 0; k <= lon; k++) {
      const ph = (k / lon) * Math.PI * 2;
      const dy = Math.cos(th);
      const p = new THREE.Vector3(c.x + Math.sin(th) * Math.cos(ph) * r.x, c.y + dy * r.y, c.z + Math.sin(th) * Math.sin(ph) * r.z);
      row.push(B.vert(p, col(dy), w));
    }
    grid.push(row);
  }
  for (let i = 0; i < lat; i++) for (let k = 0; k < lon; k++) B.quad(grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]);
}

