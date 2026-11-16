import { useEffect, useState } from 'react';
import { audio } from '../game/audio/AudioEngine';
import type { GameSession } from '../game/GameSession';
import { BELT_ORDER, BELT_REQUIREMENTS, nextBelt } from '../game/progress/progress';
import { net } from '../game/netplay/NetClient';
import { useGameStore } from '../store/useGameStore';
import { useTournament } from '../store/useTournament';
import { CHARACTERS } from '../game/render/characterFactory';
import { type Bout, nextPlayerBout, type OpenBracket, opponentIn, PLAYER_PATH, playerResult, seedOf, STAGE_NAME, STAGE_OF, STAGE_PLURAL } from '../game/tournament/tournament';
import { dash, fname, roundsLine, sideOf, winnerScore } from './Tournament';
import { WatchReplay } from './Replay';
import { useReplay } from '../store/useReplay';
import { useNet } from './Friend';
import { BackButton, BeltMarker, Hints, Menu as MenuList, PrimaryButton, QuietButton, useGamepadNav } from './kit';
import { SettingsPanel } from './SettingsPanel';

const OPP_BELT = { easy: 'White belt', normal: 'Red belt', hard: 'Black belt' } as const;
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/** "Competitive · Red belt" / "Training · Body kick challenge" context line. */
function useContextLine(session: GameSession) {
  const mode = useGameStore((s) => s.mode);
  const difficulty = useGameStore((s) => s.difficulty);
  const versus = useGameStore((s) => s.versus);
  const tb = useGameStore((s) => s.tournament);
  if (tb) return `Dojang Open No. ${tb.number} · ${STAGE_NAME[STAGE_OF[tb.bout]]}`;
  if (versus) return `${mode === 'competitive' ? 'Competitive' : 'Arcade'} · ${versus.kind === 'online' ? 'online' : 'same device'}`;
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
  const ns = useNet();
  const [, tick] = useState(0);
  const onlinePause = !!session.net && !!ns.pause;
  useEffect(() => {
    if (!onlinePause) return;
    const id = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [onlinePause]);
  useGamepadNav(paused ? () => (showSettings ? setShowSettings(false) : setPaused(false)) : undefined);
  useEffect(() => {
    if (!paused) setShowSettings(false);
  }, [paused]);
  if (!paused) return null;
  const comp = !!session.competitive;
  const online = !!session.net;
  const inOpen = !!useGameStore.getState().tournament;
  const quit = () => {
    if (online) net.leave();
    // A Dojang Open bout left midway is replayed in full; the Open is saved.
    toMenu(online ? 'friend' : inOpen ? 'bracket' : 'home');
  };
  return (
    <MatchPanel label="Paused">
      <p className="context">{context}</p>
      <h1 className="title">{showSettings ? 'Settings' : 'Paused'}</h1>
      {online && ns.pause && !showSettings && (
        <p className="caption" role="status" data-testid="online-pause">
          {ns.pause.by === 'me' ? 'You paused' : `${ns.peer?.nick || 'Your friend'} paused`} the match for both of you · resumes in {Math.max(0, Math.ceil((ns.pause.until - Date.now()) / 1000))} s
        </p>
      )}
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
      {inOpen && !showSettings && (
        <p className="caption" data-testid="open-pause-note">
          Leave the bout? It will restart from round one. Your Open is saved.
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
              ...(online
                ? []
                : [
              {
                id: 'restart',
                label: session.training ? 'Restart activity' : inOpen ? 'Restart bout' : 'Restart match',
                onSelect: () => {
                  session.rematch();
                  setPaused(false);
                },
              },
                  ]),
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
              { id: 'quit', label: online ? 'Leave the match' : inOpen ? 'Leave the bout' : 'Quit to menu', testid: 'quit-to-menu', onSelect: quit },
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
  useEffect(() => {
    if (belt) audio.promotion();
  }, [belt]);
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
  const online = !!session.net;
  useEffect(() => {
    if (!over || online) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && toMenu();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [over, toMenu, online]);
  useGamepadNav(over && !online ? toMenu : undefined);
  if (!hud || !over) return null;
  if (session.net) return <OnlineResult session={session} context={context} />;
  if (useGameStore.getState().tournament) return <OpenResult session={session} />;
  const w = hud.matchWinner;
  const couch = !!useGameStore.getState().versus;
  const title = w === null ? 'Draw' : couch ? `${hud.names[w]} wins` : w === 0 ? 'You win' : 'You lose';
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
        <WatchReplay onWatch={() => useReplay.getState().open({ kind: 'match' })} />
        <QuietButton hint="Esc" onClick={toMenu} testid="to-menu">
          Back to menu
        </QuietButton>
      </div>
    </MatchPanel>
  );
}

/** Online result: rematch when both agree (corners swap), back to the lobby, or leave. */
function OnlineResult({ session, context }: { session: GameSession; context: string }) {
  const hud = useGameStore((s) => s.hud)!;
  const s = useNet();
  const w = hud.matchWinner;
  const title = w === null ? 'Draw' : w === session.me ? 'You win' : 'You lose';
  const peerName = s.peer?.nick || 'Your friend';
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
        {session.competitive ? <CompetitiveSummary session={session} /> : <p className="body-copy">{w === null ? 'An even match.' : `${hud.names[w]} takes the match.`}</p>}
        <p className="caption" role="status">
          {!s.peerPresent ? `${peerName} left.` : s.rematch.me ? `Waiting for ${peerName}…` : s.rematch.peer ? `${peerName} wants a rematch.` : 'Corners swap on a rematch.'}
        </p>
        <PromotionNote />
      </div>
      <div className="actions">
        <PrimaryButton hint="Enter" autoFocus testid="rematch" disabled={s.rematch.me || !s.peerPresent} onClick={() => net.requestRematch()}>
          Rematch
        </PrimaryButton>
        <WatchReplay onWatch={() => useReplay.getState().open({ kind: 'match' })} />
        <QuietButton onClick={() => net.backToLobby()} testid="to-lobby">
          Back to lobby
        </QuietButton>
        <QuietButton
          onClick={() => {
            net.leave();
            useGameStore.getState().toMenu('friend');
          }}
          testid="leave-room"
        >
          Leave
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
  const total = (i: 0 | 1, k: (typeof KINDS)[number]) => hist.reduce((s, h) => s + h.stats[i].scored[k], 0);
  const penalties = (i: 0 | 1) => hist.flatMap((h) => h.stats[i].gamjeomReasons);
  return (
    <div data-testid="comp-summary">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Round</th>
            <th scope="col">
              <span className="corner-tag chung">{session.shortName(0)}</span>
            </th>
            <th scope="col">
              <span className="corner-tag hong">{session.shortName(1)}</span>
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
              <td className="end">{h.winner === null ? 'Draw' : session.shortName(h.winner)}</td>
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
              <th scope="col">{session.shortName(0)}</th>
              <th scope="col">{session.shortName(1)}</th>
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
              {session.shortName(i as 0 | 1)} gam-jeom: {penalties(i as 0 | 1).join(' · ')}
            </p>
          ) : null,
        )}
      </details>
    </div>
  );
}

/* ── The Dojang Open: result panel with the Open block ─────────────── */

/** "stage · winner · score · loser" rows. */
function OpenLines({ o, ids, stage = false }: { o: OpenBracket; ids: Bout['id'][]; stage?: boolean }) {
  return (
    <ol className="open-lines">
      {ids.map((id) => {
        const b = o.bouts[id];
        if (!b.winner) return null;
        const loser = b.winner === b.a ? b.b : b.a;
        return (
          <li key={id} data-bout={id} data-source={b.source ?? ''}>
            {stage && <span className="stage">{STAGE_NAME[STAGE_OF[id]]}</span>}
            <span className="w">
              {fname(b.winner)}
              {b.winner === o.fighter && <span className="tag"> You</span>}
            </span>
            <span className="sc">{winnerScore(b, true)}</span>
            <span className="l">{fname(loser)}</span>
          </li>
        );
      })}
    </ol>
  );
}

const OUT_TITLE = { quarterfinalist: 'Out in the quarterfinal', semifinalist: 'Out in the semifinal', 'runner-up': 'Runner-up', champion: 'Champion' } as const;

/**
 * A Dojang Open bout's result. It waits (no spinner) until the bout and the
 * AI-only fixtures it triggers are decided and saved, so it can name the
 * next opponent. Winning the final goes straight to the Champion screen.
 */
function OpenResult({ session }: { session: GameSession }) {
  const tb = useGameStore((s) => s.tournament)!;
  const toMenu = useGameStore((s) => s.toMenu);
  const t = useTournament();
  const [details, setDetails] = useState(false);
  const ready = !t.busy && t.lastOutcome?.number === tb.number && t.lastOutcome.bout === tb.bout;
  const o: OpenBracket | null = ready ? (t.save.active?.number === tb.number ? t.save.active : (t.save.history.find((h) => h.number === tb.number) ?? null)) : null;
  const wonFinal = ready && t.lastOutcome!.won && tb.bout === 'f';
  useEffect(() => {
    if (!wonFinal) return;
    // Keep a belt promotion earned by this bout for the Champion screen.
    const promo = useGameStore.getState().promotion;
    toMenu('champion');
    useGameStore.setState({ promotion: promo });
  }, [wonFinal, toMenu]);
  if (!ready || !o || wonFinal) return null;
  const b = o.bouts[tb.bout];
  const stage = STAGE_OF[tb.bout];
  const opp = opponentIn(o, b)!;
  const mine = sideOf(b, o.fighter);
  const won = b.winner === o.fighter;
  const context = `Dojang Open No. ${o.number} · ${STAGE_NAME[stage]} · match over`;
  const go = (p: 'prematch' | 'bracket' | 'tournament' | 'home', review = false) => {
    useGameStore.getState().clearPromotion();
    useTournament.getState().setReview(review ? o.number : null);
    toMenu(p);
  };
  const roundsRow = (
    <p className="open-rounds">
      Rounds {roundsLine(mine.rounds)}
      {won ? ` against ${fname(opp)}` : ''} ·{' '}
      <button type="button" className="link" aria-expanded={details} onClick={() => setDetails(!details)} data-testid="round-details">
        Round details
      </button>
    </p>
  );
  if (won) {
    const nb = nextPlayerBout(o)!;
    const nextOpp = nb ? opponentIn(o, nb) : null;
    const seed = seedOf(o, nextOpp);
    const nextStage = nb ? STAGE_OF[nb.id] : 'f';
    const other = stage === 'qf' ? o.bouts.qf2 : o.bouts.sf2;
    const note = seed && nextStage === 'sf' ? `${CHARACTERS[nextOpp!].short} is Seed ${seed} and starts the tournament here.` : other.winner ? `${fname(other.winner)} beat ${fname(other.winner === other.a ? other.b : other.a)} ${winnerScore(other)} in the other ${STAGE_NAME[stage].toLowerCase()}.` : '';
    return (
      <MatchPanel label="Match result" testid="result">
        <p className="context">{context}</p>
        <div className="result-head">
          <h1 className="title" aria-live="polite">
            You win
          </h1>
          <p className="big-score" aria-label={`${mine.score[0]} rounds to ${mine.score[1]}`}>
            {dash(mine.score[0], mine.score[1], true)}
          </p>
        </div>
        <div className="panel-scroll">
          {roundsRow}
          {details && <CompetitiveSummary session={session} />}
          <p className="group-label">{STAGE_PLURAL[stage]} complete</p>
          <OpenLines o={o} ids={stage === 'qf' ? ['qf1', 'qf2'] : ['sf1', 'sf2']} />
          {nb && nextOpp && (
            <div className="open-next" data-testid="open-next">
              <p className="group-label">
                Next · {STAGE_NAME[nextStage]} · bout {nextStage === 'sf' ? 2 : 3} of 3
              </p>
              <p className="pair">
                <span className="corner-tag chung">{fname(o.fighter)}</span> <span className="v">v</span> <span className="corner-tag hong end">{fname(nextOpp)}</span>
              </p>
              {note && <p className="caption">{note}</p>}
            </div>
          )}
          <PromotionNote />
        </div>
        <div className="actions row">
          <PrimaryButton hint="Enter" autoFocus testid="open-next-bout" onClick={() => go('prematch')}>
            Next: {STAGE_NAME[nextStage]}
          </PrimaryButton>
          <WatchReplay onWatch={() => useReplay.getState().open({ kind: 'match' })} />
          <QuietButton onClick={() => go('bracket')} testid="open-bracket">
            Bracket
          </QuietButton>
          <QuietButton hint="Esc" onClick={() => go('home')} testid="to-menu">
            Menu
          </QuietButton>
        </div>
      </MatchPanel>
    );
  }
  const result = playerResult(o);
  const champ = o.bouts.f.winner;
  const body =
    stage === 'f' ? (
      <>
        {fname(opp)} won the final {dash(mine.score[1], mine.score[0])}. Your result: <strong>runner-up</strong>.
      </>
    ) : (
      <>
        {fname(opp)} won {dash(mine.score[1], mine.score[0])} and went through. Your result: <strong>{result}</strong>
        {stage === 'sf' ? ', one bout from the final.' : '.'}
      </>
    );
  return (
    <MatchPanel label="Match result" testid="result">
      <p className="context">{context}</p>
      <h1 className="title" aria-live="polite" data-testid="open-out-title">
        {OUT_TITLE[result]}
      </h1>
      <div className="panel-scroll">
        <p className="body-copy strong">{body}</p>
        {roundsRow}
        {details && <CompetitiveSummary session={session} />}
        <p className="group-label">How the Open finished</p>
        <OpenLines o={o} ids={[...PLAYER_PATH]} stage />
        <p className="caption">
          {stage === 'f' ? `${fname(champ)} is the champion of the Dojang Open No. ${o.number}.` : <>The remaining bouts were decided straight away, so the Open ends here with a champion: <span className="fg">{fname(champ)}</span>.</>}
        </p>
      </div>
      <div className="actions row">
        <PrimaryButton hint="Enter" autoFocus testid="new-open" onClick={() => go('tournament')}>
          Enter a new Open
        </PrimaryButton>
        <WatchReplay onWatch={() => useReplay.getState().open({ kind: 'match' })} />
        <QuietButton onClick={() => go('bracket', true)} testid="open-bracket">
          Bracket
        </QuietButton>
        <QuietButton hint="Esc" onClick={() => go('home')} testid="to-menu">
          Menu
        </QuietButton>
      </div>
    </MatchPanel>
  );
}
