import { useGameStore } from '../store/useGameStore';

export function PerfOverlay() {
  const p = useGameStore((s) => s.perf);
  if (!p) return null;
  return (
    <div className="perf" data-testid="perf">
      <div>
        {p.fps.toFixed(0)} fps · {p.frameMs.toFixed(1)} ms (p95 {p.p95Ms.toFixed(1)})
      </div>
      <div>
        sim {p.simMs.toFixed(2)} ms · anim {p.animMs.toFixed(2)} ms
      </div>
      <div>
        draws {p.drawCalls} · tris {(p.triangles / 1000).toFixed(1)}k · geo {p.geometries} · tex {p.textures}
      </div>
      <div>
        dpr {p.dpr.toFixed(2)} · tier {p.tier}
        {p.heapMB !== null ? ` · heap ${p.heapMB.toFixed(0)} MB` : ''}
      </div>
    </div>
  );
}
