import { CORNER_COLORS } from '../game/render/characterFactory';
import { useGameStore } from '../store/useGameStore';

function Bar({ value, max, color, flip, thin }: { value: number; max: number; color: string; flip?: boolean; thin?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`bar ${thin ? 'thin' : ''} ${flip ? 'flip' : ''}`}>
      <div className="fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function Hud() {
  const hud = useGameStore((s) => s.hud);
  const toasts = useGameStore((s) => s.toasts);
  if (!hud) return null;
  const pips = (n: number) =>
    Array.from({ length: hud.roundsToWin }, (_, i) => <span key={i} className={`pip ${i < n ? 'on' : ''}`} />);
  return (
    <div className="hud" data-testid="hud">
      <div className="hud-top">
        <div className="side left">
          <div className="name" style={{ borderColor: CORNER_COLORS.chung }}>
            <span className="corner" style={{ background: CORNER_COLORS.chung }}>CHUNG</span> {hud.names[0]} <span className="pips">{pips(hud.wins[0])}</span>
          </div>
          <Bar value={hud.health[0]} max={hud.maxHealth[0]} color="linear-gradient(90deg,#e8c34a,#f4e27a)" />
          <Bar value={hud.stamina[0]} max={100} color="#4fb6e8" thin />
        </div>
        <div className="clock" data-testid="clock">
          <div className="round">R{hud.round}</div>
          <div className="time">{hud.seconds}</div>
        </div>
        <div className="side right">
          <div className="name right" style={{ borderColor: CORNER_COLORS.hong }}>
            <span className="pips">{pips(hud.wins[1])}</span> {hud.names[1]} <span className="corner" style={{ background: CORNER_COLORS.hong }}>HONG</span>
          </div>
          <Bar value={hud.health[1]} max={hud.maxHealth[1]} color="linear-gradient(270deg,#e8c34a,#f4e27a)" flip />
          <Bar value={hud.stamina[1]} max={100} color="#4fb6e8" thin flip />
        </div>
      </div>
      <div className="hud-status">
        <span className={hud.high ? 'tag on' : 'tag'}>{hud.high ? 'HEAD' : 'BODY'}</span>
        <span className="tag">{hud.stance === 'orthodox' ? 'Orthodox' : 'Southpaw'}</span>
        <span className={hud.lockOn ? 'tag on' : 'tag'}>{hud.lockOn ? 'Lock-on' : 'Free cam'}</span>
      </div>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind} ${t.side === 0 ? 'p0' : t.side === 1 ? 'p1' : ''}`}>
            <div className="t">{t.text}</div>
            {t.sub && <div className="s">{t.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
