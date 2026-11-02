import { useEffect, useState } from 'react';
import type { GameSession } from '../game/GameSession';
import { BELT_ORDER, BELT_REQUIREMENTS, nextBelt } from '../game/progress/progress';
import { useGameStore } from '../store/useGameStore';
import { BackButton, BeltMarker, Hints, Menu as MenuList, PrimaryButton, QuietButton, useGamepadNav } from './kit';
import { SettingsPanel } from './SettingsPanel';

const OPP_BELT = { easy: 'White belt', normal: 'Red belt', hard: 'Black belt' } as const;
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/** "Competitive · Red belt" / "Training · Body kick challenge" context line. */
function useContextLine(session: GameSession) {
  const mode = useGameStore((s) => s.mode);
  const difficulty = useGameStore((s) => s.difficulty);
  if (session.training) return `Training · ${session.training.activity.title}`;
  return `${mode === 'competitive' ? 'Competitive' : 'Arcade'} · ${OPP_BELT[difficulty]}`;
}

/** In-match panel: a solid ink column at the menu edge (no box, no blur). */
function MatchPanel({ label, children, testid }: { label: string; children: React.ReactNode; testid?: string }) {
  return (
    <div className="overlay match-panel" role="dialog" aria-modal="true" aria-label={label} data-testid={testid}>
      <div className="panel-col">{children}</div>
    </div>
  );
}

export function PauseMenu({ session }: { session: GameSession }) {
  const paused = useGameStore((s) => s.paused);
  const hud = useGameStore((s) => s.hud);
  const setPaused = useGameStore((s) => s.setPaused);
  const toMenu = useGameStore((s) => s.toMenu);
  const [showSettings, setShowSettings] = useState(false);
  const context = useContextLine(session);
  useGamepadNav(paused ? () => (showSettings ? setShowSettings(false) : setPaused(false)) : undefined);
  useEffect(() => {
    if (!paused) setShowSettings(false);
  }, [paused]);
  if (!paused) return null;
  const comp = !!session.competitive;
  return (
    <MatchPanel label="Paused">
      <p className="context">{context}</p>
      <h1 className="title">{showSettings ? 'Settings' : 'Paused'}</h1>
      {hud && !session.training && !showSettings && (
        <p className="scoreline" aria-label={comp ? `Points ${hud.points[0]} to ${hud.points[1]}` : `Rounds ${hud.wins[0]} to ${hud.wins[1]}`}>
          <span className="corner-tag chung">{hud.shortNames[0]}</span>
          <span className="num">
            {comp ? hud.points[0] : hud.wins[0]} – {comp ? hud.points[1] : hud.wins[1]}
          </span>
          <span className="corner-tag hong end">{hud.shortNames[1]}</span>
          <span className="caption">
            Round {hud.round} · {fmtClock(hud.seconds)} left
          </span>
        </p>
      )}
      {showSettings ? (
        <>
          <BackButton onClick={() => setShowSettings(false)} label="Pause menu" />
          <div className="panel-scroll">
            <SettingsPanel compact />
          </div>
        </>
      ) : (
        <>
          <MenuList
            label="Pause menu"
            items={[
              { id: 'resume', label: 'Resume', onSelect: () => setPaused(false), testid: 'resume' },
              {
                id: 'restart',
                label: session.training ? 'Restart activity' : 'Restart match',
                onSelect: () => {
                  session.rematch();
                  setPaused(false);
                },
              },
              ...(session.training
                ? [
                    {
                      id: 'end',
                      label: 'End activity & see summary',
                      testid: 'end-activity',
                      onSelect: () => {
                        session.finishTraining();
                        setPaused(false);
                      },
                    },
                  ]
                : []),
              { id: 'settings', label: 'Settings & controls', testid: 'pause-settings', onSelect: () => setShowSettings(true) },
              { id: 'quit', label: 'Quit to menu', testid: 'quit-to-menu', onSelect: toMenu },
            ]}
          />
          <Hints
            items={[
              ['↑↓', 'Select'],
              ['Enter', 'Confirm'],
              ['Esc', 'Resume'],
            ]}
          />
        </>
      )}
    </MatchPanel>
  );
}

/** Inline promotion feedback for results and training summaries. */
export function PromotionNote() {
  const belt = useGameStore((s) => s.promotion);
  const progress = useGameStore((s) => s.progress);
  if (!belt) return null;
  const prev = BELT_ORDER[BELT_ORDER.indexOf(belt) - 1] ?? 'white';
  const nb = nextBelt(belt);
  const firstReq = nb ? BELT_REQUIREMENTS[nb].find((r) => !r.done(progress)) : undefined;
  return (
    <div className="promotion" role="status" data-testid="promotion">
      <p className="belt-step" aria-hidden>
        <BeltMarker belt={prev} label={false} /> <span>→</span> <BeltMarker belt={belt} label={false} className="new" />
      </p>
      <p className="promo-title">Promoted to {belt} belt</p>
      <p className="caption">
        It now appears on your dobok.
        {nb ? ` Next: ${nb} belt — ${firstReq ? firstReq.label.charAt(0).toLowerCase() + firstReq.label.slice(1) : 'all requirements met'}.` : ' Every milestone in this version is complete.'}
      </p>
    </div>
  );
}

export function ResultOverlay({ session }: { session: GameSession }) {
  const hud = useGameStore((s) => s.hud);
  const toMenu = useGameStore((s) => s.toMenu);
  const clearPromotion = useGameStore((s) => s.clearPromotion);
  const context = useContextLine(session);
  const over = !!hud && hud.phase === 'match-over';
  useEffect(() => {
    if (!over) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && toMenu();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [over, toMenu]);
  useGamepadNav(over ? toMenu : undefined);
  if (!hud || !over) return null;
  const w = hud.matchWinner;
  const title = w === 0 ? 'You win' : w === 1 ? 'You lose' : 'Draw';
  const comp = session.competitive;
  return (
    <MatchPanel label="Match result" testid="result">
      <p className="context">{context} · match over</p>
      <div className="result-head">
        <h1 className="title">{title}</h1>
        <p className="big-score" aria-label={`Rounds ${hud.wins[0]} to ${hud.wins[1]}`}>
          {hud.wins[0]} – {hud.wins[1]}
        </p>
      </div>
      <div className="panel-scroll">
        {comp ? (
          <CompetitiveSummary session={session} />
        ) : (
          <p className="body-copy">{w === null ? 'An even match.' : `${hud.names[w]} takes the match, ${hud.wins[w]} rounds to ${hud.wins[w === 0 ? 1 : 0]}.`}</p>
        )}
        <PromotionNote />
      </div>
      <div className="actions">
        <PrimaryButton
          hint="Enter"
          autoFocus
          testid="rematch"
          onClick={() => {
            clearPromotion();
            session.rematch();
          }}
        >
          Rematch
        </PrimaryButton>
        <QuietButton hint="Esc" onClick={toMenu} testid="to-menu">
          Back to menu
        </QuietButton>
      </div>
    </MatchPanel>
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
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Round</th>
            <th scope="col">
              <span className="corner-tag chung">{a.short}</span>
            </th>
            <th scope="col">
              <span className="corner-tag hong">{b.short}</span>
            </th>
            <th scope="col" className="end">
              Winner
            </th>
          </tr>
        </thead>
        <tbody>
          {hist.map((h) => (
            <tr key={h.round}>
              <td>
                {h.round}
                <span className="why">{h.detail ?? h.reason}</span>
              </td>
              <td className={h.winner === 0 ? 'won' : ''}>{h.stats[0].points}</td>
              <td className={h.winner === 1 ? 'won' : ''}>{h.stats[1].points}</td>
              <td className="end">{h.winner === null ? 'Draw' : session.defs[h.winner].short}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="breakdown">
        <summary>Technique breakdown and gam-jeom</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Valid techniques</th>
              <th scope="col">{a.short}</th>
              <th scope="col">{b.short}</th>
            </tr>
          </thead>
          <tbody>
            {KINDS.map((k) => (
              <tr key={k}>
                <td>{KIND_LABEL[k]}</td>
                <td>{total(0, k)}</td>
                <td>{total(1, k)}</td>
              </tr>
            ))}
            <tr>
              <td>Gam-jeom (match total)</td>
              <td>{penalties(0).length}</td>
              <td>{penalties(1).length}</td>
            </tr>
          </tbody>
        </table>
        {[0, 1].map((i) =>
          penalties(i as 0 | 1).length ? (
            <p key={i} className="caption">
              {session.defs[i].short} gam-jeom: {penalties(i as 0 | 1).join(' · ')}
            </p>
          ) : null,
        )}
      </details>
    </div>
  );
}
