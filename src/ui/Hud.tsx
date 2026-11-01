import { CORNER_COLORS } from '../game/render/characterFactory';
import { useGameStore } from '../store/useGameStore';

function Bar({ value, max, cls, flip }: { value: number; max: number; cls: string; flip?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`bar ${cls} ${flip ? 'flip' : ''}`}>
      <div className="fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Slim scoreboard: one row with corner dot, short name, round pips, a thin
 * health bar with an even thinner stamina bar underneath, and the clock.
 * Targeting, stance and lock-on are consolidated into one small status line.
 */
export function Hud() {
  const hud = useGameStore((s) => s.hud);
  const toasts = useGameStore((s) => s.toasts);
  if (!hud) return null;
  const pips = (n: number) => Array.from({ length: hud.roundsToWin }, (_, i) => <i key={i} className={`pip ${i < n ? 'on' : ''}`} />);
  const status = [hud.high ? 'HEAD' : 'BODY', hud.stance === 'orthodox' ? 'ORTH' : 'SOUTH', hud.lockOn ? 'LOCK' : 'FREE'];
  return (
    <div className="hud" data-testid="hud">
      <div className="hud-top">
        <div className="side left">
          <div className="name">
            <span className="dot" style={{ background: CORNER_COLORS.chung }} />
            <span className="full">{hud.names[0]}</span>
            <span className="short">{hud.shortNames[0]}</span>
            <span className="pips">{pips(hud.wins[0])}</span>
          </div>
          <Bar value={hud.health[0]} max={hud.maxHealth[0]} cls="hp" />
          <Bar value={hud.stamina[0]} max={100} cls="st" />
        </div>
        <div className="clock" data-testid="clock">
          <span className="row">
            <span className="round">R{hud.round}</span>
            <span className="time">{hud.seconds}</span>
          </span>
          <span className="status" data-testid="status">
            <b className={hud.high ? 'on' : ''}>{status[0]}</b>·{status[1]}·<b className={hud.lockOn ? '' : 'off'}>{status[2]}</b>
          </span>
        </div>
        <div className="side right">
          <div className="name right">
            <span className="pips">{pips(hud.wins[1])}</span>
            <span className="full">{hud.names[1]}</span>
            <span className="short">{hud.shortNames[1]}</span>
            <span className="dot" style={{ background: CORNER_COLORS.hong }} />
          </div>
          <Bar value={hud.health[1]} max={hud.maxHealth[1]} cls="hp" flip />
          <Bar value={hud.stamina[1]} max={100} cls="st" flip />
        </div>
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
