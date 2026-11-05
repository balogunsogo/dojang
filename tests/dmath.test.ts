import { describe, expect, it } from 'vitest';
import { datan2, dcos, dhypot, dsin } from '../src/game/dmath';

describe('deterministic trig', () => {
  it('matches Math to ~1e-9 across the useful range', () => {
    let worst = 0;
    for (let i = -2000; i <= 2000; i++) {
      const a = i * 0.0137;
      worst = Math.max(worst, Math.abs(dsin(a) - Math.sin(a)), Math.abs(dcos(a) - Math.cos(a)));
      const y = Math.sin(i * 0.7) * 3;
      const x = Math.cos(i * 1.3) * 2;
      worst = Math.max(worst, Math.abs(datan2(y, x) - Math.atan2(y, x)), Math.abs(dhypot(x, y) - Math.hypot(x, y)));
    }
    expect(worst).toBeLessThan(1e-9);
    expect(datan2(0, 0)).toBe(0);
    expect(datan2(0, -1)).toBeCloseTo(Math.PI, 12);
  });
});
