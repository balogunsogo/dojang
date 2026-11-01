import type * as THREE from 'three';

export interface PerfSnapshot {
  fps: number;
  frameMs: number;
  p95Ms: number;
  simMs: number;
  animMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  dpr: number;
  heapMB: number | null;
  tier: string;
}

const N = 120;

/** Rolling frame-time statistics plus renderer counters. */
export class PerfMonitor {
  private times = new Float32Array(N);
  private idx = 0;
  private count = 0;
  private sim = 0;
  private anim = 0;
  snapshot: PerfSnapshot = { fps: 0, frameMs: 0, p95Ms: 0, simMs: 0, animMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, dpr: 1, heapMB: null, tier: '' };

  frame(dtSec: number, simMs: number, animMs: number) {
    this.times[this.idx] = dtSec * 1000;
    this.idx = (this.idx + 1) % N;
    this.count = Math.min(N, this.count + 1);
    this.sim += (simMs - this.sim) * 0.1;
    this.anim += (animMs - this.anim) * 0.1;
  }

  /** Average frame time over the window (ms). */
  get avgMs(): number {
    if (!this.count) return 0;
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.times[i];
    return s / this.count;
  }

  sample(gl: THREE.WebGLRenderer, tier: string): PerfSnapshot {
    const arr = Array.from(this.times.subarray(0, this.count)).sort((a, b) => a - b);
    const avg = this.avgMs;
    const info = gl.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    this.snapshot = {
      fps: avg > 0 ? 1000 / avg : 0,
      frameMs: avg,
      p95Ms: arr.length ? arr[Math.floor(arr.length * 0.95)] : 0,
      simMs: this.sim,
      animMs: this.anim,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      dpr: gl.getPixelRatio(),
      heapMB: mem ? mem.usedJSHeapSize / 1048576 : null,
      tier,
    };
    return this.snapshot;
  }

  reset() {
    this.count = 0;
    this.idx = 0;
  }
}
