import { useState } from 'react';
import type { GameSession } from '../game/GameSession';
import { useGameStore } from '../store/useGameStore';
import { SettingsPanel } from './SettingsPanel';

export function PauseMenu({ session }: { session: GameSession }) {
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const toMenu = useGameStore((s) => s.toMenu);
  const [showSettings, setShowSettings] = useState(false);
  if (!paused) return null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Paused">
      <div className={`panel ${showSettings ? 'wide' : ''}`}>
        <h2>Paused</h2>
        <button className="primary" onClick={() => setPaused(false)} autoFocus>
          Resume
        </button>
        <button
          onClick={() => {
            session.rematch();
            setPaused(false);
          }}
        >
          {session.training ? 'Restart activity' : 'Restart match'}
        </button>
        {session.training && (
          <button
            onClick={() => {
              session.finishTraining();
              setPaused(false);
            }}
            data-testid="end-activity"
          >
            End activity &amp; see summary
          </button>
        )}
        <button onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} data-testid="pause-settings">
          {showSettings ? 'Hide settings' : 'Settings'}
        </button>
        {showSettings && <SettingsPanel compact />}
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
  const comp = session.competitive;
  return (
    <div className="overlay result" data-testid="result">
      <div className={`panel ${comp ? 'wide' : ''}`}>
        <h2 className={w === 0 ? 'win' : w === 1 ? 'lose' : ''}>{title}</h2>
        <p>
          Rounds {hud.wins[0]} – {hud.wins[1]}
        </p>
        <p className="muted">{w === null ? 'Even match.' : `${hud.names[w]} takes the match.`}</p>
        {comp && <CompetitiveSummary session={session} />}
        <button className="primary" onClick={() => session.rematch()} data-testid="rematch">
          Rematch
        </button>
        <button onClick={toMenu} data-testid="to-menu">
          Main menu
        </button>
      </div>
    </div>
  );
}

const KINDS = ['turningHead', 'turningTrunk', 'kickHead', 'kickTrunk', 'punchTrunk'] as const;
const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  turningHead: 'Turning head kick (6)',
  turningTrunk: 'Turning body kick (4)',
  kickHead: 'Head kick (3)',
  kickTrunk: 'Body kick (2)',
  punchTrunk: 'Punch (1)',
};

function CompetitiveSummary({ session }: { session: GameSession }) {
  const rules = session.competitive!;
  const hist = rules.history;
  const [a, b] = session.defs;
  const total = (i: 0 | 1, k: (typeof KINDS)[number]) => hist.reduce((s, h) => s + h.stats[i].scored[k], 0);
  const penalties = (i: 0 | 1) => hist.flatMap((h) => h.stats[i].gamjeomReasons);
  return (
    <div data-testid="comp-summary">
      <table className="result-table">
        <thead>
          <tr>
            <th>Round</th>
            <th className="chung">{a.short}</th>
            <th className="hong">{b.short}</th>
            <th>Winner</th>
          </tr>
        </thead>
        <tbody>
          {hist.map((h) => (
            <tr key={h.round}>
              <td>
                {`R${h.round}`}
                <div className="result-why">{h.detail ?? h.reason}</div>
              </td>
              <td className="chung">{h.stats[0].points}</td>
              <td className="hong">{h.stats[1].points}</td>
              <td>{h.winner === null ? 'Draw' : session.defs[h.winner].short}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="result-table">
        <thead>
          <tr>
            <th>Valid techniques</th>
            <th className="chung">{a.short}</th>
            <th className="hong">{b.short}</th>
          </tr>
        </thead>
        <tbody>
          {KINDS.map((k) => (
            <tr key={k}>
              <td>{KIND_LABEL[k]}</td>
              <td className="chung">{total(0, k)}</td>
              <td className="hong">{total(1, k)}</td>
            </tr>
          ))}
          <tr>
            <td>Gam-jeom (match total)</td>
            <td className="chung" title={penalties(0).join(', ')}>
              {penalties(0).length}
            </td>
            <td className="hong" title={penalties(1).join(', ')}>
              {penalties(1).length}
            </td>
          </tr>
        </tbody>
      </table>
      {[0, 1].map((i) =>
        penalties(i as 0 | 1).length ? (
          <p key={i} className="result-why">
            {session.defs[i].short} gam-jeom: {penalties(i as 0 | 1).join(' · ')}
          </p>
        ) : null,
      )}
    </div>
  );
}
