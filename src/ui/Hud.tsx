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
 * health bar (Arcade) or point totals beside the clock (Competitive), an
 * even thinner stamina bar and the clock. Status is one compact line.
 * Competitive adds gam-jeom pips; nothing grows vertically.
 */
export function Hud() {
  const hud = useGameStore((s) => s.hud);
  const toasts = useGameStore((s) => s.toasts);
  if (!hud) return null;
  const comp = hud.mode === 'competitive';
  const pips = (n: number) => Array.from({ length: hud.roundsToWin }, (_, i) => <i key={i} className={`pip ${i < n ? 'on' : ''}`} />);
  const gj = (n: number, who: number) =>
    comp && n > 0 ? (
      <span className="gj" title={`${n} gam-jeom`} data-testid={`gj-${who}`}>
        GJ{n}
      </span>
    ) : null;
  const status = [hud.lead ? 'LEAD' : hud.high ? 'HEAD' : 'BODY', hud.stance === 'orthodox' ? 'ORTH' : 'SOUTH', hud.lockOn ? 'LOCK' : 'FREE'];
  return (
    <div className={`hud ${comp ? 'comp' : ''}`} data-testid="hud">
      <div className="hud-top">
        <div className="side left">
          <div className="name">
            <span className="dot" style={{ background: CORNER_COLORS.chung }} />
            <span className="full">{hud.names[0]}</span>
            <span className="short">{hud.shortNames[0]}</span>
            <span className="pips">{pips(hud.wins[0])}</span>
            {gj(hud.gamjeom[0], 0)}
          </div>
          {!comp && <Bar value={hud.health[0]} max={hud.maxHealth[0]} cls="hp" />}
          <Bar value={hud.stamina[0]} max={100} cls="st" />
        </div>
        {comp && (
          <div className="pts chung" data-testid="score-0">
            {hud.points[0]}
          </div>
        )}
        <div className="clock" data-testid="clock">
          <span className="row">
            <span className="round">{hud.round > hud.roundsToWin * 2 - 1 ? 'GOLD' : `R${hud.round}`}</span>
            <span className="time">{hud.seconds}</span>
          </span>
          <span className="status" data-testid="status">
            <b className={hud.high || hud.lead ? 'on' : ''}>{status[0]}</b>·{status[1]}·<b className={hud.lockOn ? '' : 'off'}>{status[2]}</b>
          </span>
        </div>
        {comp && (
          <div className="pts hong" data-testid="score-1">
            {hud.points[1]}
          </div>
        )}
        <div className="side right">
          <div className="name right">
            {gj(hud.gamjeom[1], 1)}
            <span className="pips">{pips(hud.wins[1])}</span>
            <span className="full">{hud.names[1]}</span>
            <span className="short">{hud.shortNames[1]}</span>
            <span className="dot" style={{ background: CORNER_COLORS.hong }} />
          </div>
          {!comp && <Bar value={hud.health[1]} max={hud.maxHealth[1]} cls="hp" flip />}
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
