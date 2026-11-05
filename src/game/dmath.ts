/**
 * Deterministic trig for the combat simulation (online play needs both
 * browsers to compute bit-identical fights). Math.sin/cos/atan2/hypot/exp
 * are not guaranteed identical across engines; + - * / and Math.sqrt are
 * (IEEE 754, correctly rounded). Accuracy ~1e-9, far below anything visible.
 */
const PI = Math.PI;
const TAU = 2 * PI;
const HALF_PI = PI / 2;

/** sin on [-pi/4, pi/4] (Taylor to x^15 terms needed: x^13 is enough). */
function sinCore(x: number) {
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))));
}
function cosCore(x: number) {
  const x2 = x * x;
  return 1 + x2 * (-1 / 2 + x2 * (1 / 24 + x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200)))))));
}

export function dsin(a: number): number {
  let x = a - TAU * Math.floor(a / TAU + 0.5); // [-pi, pi]
  const q = Math.round(x / HALF_PI); // -2..2
  x -= q * HALF_PI; // [-pi/4, pi/4]
  switch (((q % 4) + 4) % 4) {
    case 0:
      return sinCore(x);
    case 1:
      return cosCore(x);
    case 2:
      return -sinCore(x);
    default:
      return -cosCore(x);
  }
}

export const dcos = (a: number) => dsin(a + HALF_PI);

export const dhypot = (x: number, y: number) => Math.sqrt(x * x + y * y);

/** atan on [0, 1] via range reduction to |t| <= tan(pi/12) and a series. */
function atanCore(t: number) {
  // atan(t) = pi/6 + atan((t - k) / (1 + k t)), k = 1/sqrt(3)
  let off = 0;
  if (t > 0.2679491924311227) {
    const k = 0.5773502691896257;
    t = (t - k) / (1 + k * t);
    off = PI / 6;
  }
  const t2 = t * t;
  let s = 0;
  for (let n = 15; n >= 0; n--) s = 1 / (2 * n + 1) - t2 * s;
  return off + t * s;
}

export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let r = ay <= ax ? atanCore(ay / ax) : HALF_PI - atanCore(ax / ay);
  if (x < 0) r = PI - r;
  return y < 0 ? -r : r;
}
