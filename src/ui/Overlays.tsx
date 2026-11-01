import type { GameSession } from '../game/GameSession';
import { useGameStore } from '../store/useGameStore';

export function PauseMenu({ session }: { session: GameSession }) {
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const toMenu = useGameStore((s) => s.toMenu);
  const scheme = useGameStore((s) => s.settings.controlScheme);
  const update = useGameStore((s) => s.updateSettings);
  if (!paused) return null;
  return (
    <div className="overlay">
      <div className="panel">
        <h2>Paused</h2>
        <button className="primary" onClick={() => setPaused(false)}>
          Resume
        </button>
        <button
          onClick={() => {
            session.rematch();
            setPaused(false);
          }}
        >
          Restart match
        </button>
        <div className="seg" role="group" aria-label="Touch controls">
          <button className={scheme === 'compact' ? 'on' : ''} onClick={() => update({ controlScheme: 'compact' })}>
            Compact
          </button>
          <button className={scheme === 'classic' ? 'on' : ''} onClick={() => update({ controlScheme: 'classic' })}>
            Classic
          </button>
        </div>
        <button onClick={toMenu}>Main menu</button>
      </div>
    </div>
  );
}

export function ResultOverlay({ session }: { session: GameSession }) {
  const hud = useGameStore((s) => s.hud);
  const toMenu = useGameStore((s) => s.toMenu);
  if (!hud || hud.phase !== 'match-over') return null;
  const w = hud.matchWinner;
  const title = w === 0 ? 'Victory' : w === 1 ? 'Defeat' : 'Draw';
  return (
    <div className="overlay result" data-testid="result">
      <div className="panel">
        <h2 className={w === 0 ? 'win' : w === 1 ? 'lose' : ''}>{title}</h2>
        <p>
          Rounds {hud.wins[0]} – {hud.wins[1]}
        </p>
        <p className="muted">{w === null ? 'Even match.' : `${hud.names[w]} takes the match.`}</p>
        <button className="primary" onClick={() => session.rematch()} data-testid="rematch">
          Rematch
        </button>
        <button onClick={toMenu}>Main menu</button>
      </div>
    </div>
  );
}
