import { type ReactNode, useEffect, useRef, useState } from 'react';
import { audio } from '../game/audio/AudioEngine';
import { CHARACTERS, type CharacterId } from '../game/render/characterFactory';
import {
  type Bout,
  type BoutId,
  nextPlayerBout,
  type OpenBracket,
  opponentIn,
  type OpenRecord,
  PLAYER_PATH,
  playerLoss,
  playerResult,
  playerWins,
  RESULT_NAME,
  type RoundSeconds,
  seedOf,
  type Stage,
  STAGE_NAME,
  STAGE_OF,
  STAGE_PLURAL,
} from '../game/tournament/tournament';
import { type MenuPanel, useGameStore } from '../store/useGameStore';
import { bracketInView, useTournament } from '../store/useTournament';
import { BackButton, BeltMarker, GroupLabel, OptionGroup, OptionRow, PrimaryButton, QuietButton, ScreenShell, Segmented, usePadButton } from './kit';
import { DIFFS, LEVEL_BELT, LEVEL_NAME } from './levels';
import { PromotionNote } from './Overlays';
import './tournament.css';

/* ── Shared helpers ───────────────────────────────────────────────── */

export const fname = (id: CharacterId | null) => (id ? CHARACTERS[id].name : '');
export const fmtLen = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** "2–1" (or "2 – 1" with thin spaces for large titles). */
export const dash = (x: number, y: number, wide = false) => (wide ? `${x} – ${y}` : `${x}–${y}`);
const lower = (s: string) => s.toLowerCase();

/** Rounds won and per-round points from one fighter's side. */
export function sideOf(b: Bout, id: CharacterId) {
  const flip = b.a !== id;
  return {
    score: (flip ? [b.score[1], b.score[0]] : b.score) as [number, number],
    rounds: b.rounds.map(([p, q]) => (flip ? [q, p] : [p, q]) as [number, number]),
  };
}
export const roundsLine = (r: [number, number][]) => r.map(([p, q]) => dash(p, q)).join(' · ');
/** Winner-first score of a decided bout ("2–1"; "w/o" for a walkover). */
export function winnerScore(b: Bout, wide = false) {
  if (b.source === 'walkover') return 'w/o';
  const s = sideOf(b, b.winner!).score;
  return dash(s[0], s[1], wide);
}
const seedTag = (o: OpenBracket, id: CharacterId | null) => {
  const s = seedOf(o, id);
  return s ? `Seed ${s}` : '';
};
const boutNumber = (o: OpenBracket) => Math.min(3, playerWins(o) + 1);

/* ── Layout hook: classic tree on desktop/tablet, stage pager on phones ── */

type Layout = 'desktop' | 'tablet' | 'pager';
function layoutFor(w: number, h: number): Layout {
  if (w < 900 || h < 600) return 'pager';
  // The side column plus the 890 px tree need about 1400 px.
  return w >= 1400 && h >= 760 ? 'desktop' : 'tablet';
}
function useLayout(): Layout {
  const [l, setL] = useState<Layout>(() => layoutFor(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const f = () => setL(layoutFor(window.innerWidth, window.innerHeight));
    window.addEventListener('resize', f);
    window.addEventListener('orientationchange', f);
    return () => {
      window.removeEventListener('resize', f);
      window.removeEventListener('orientationchange', f);
    };
  }, []);
  return l;
}

/* ── Your path (three rows) ───────────────────────────────────────── */

function pathRows(o: OpenBracket) {
  const cur = nextPlayerBout(o);
  const lost = playerLoss(o);
  const lostIdx = lost ? PLAYER_PATH.indexOf(lost.id as (typeof PLAYER_PATH)[number]) : -1;
  return PLAYER_PATH.map((id, i) => {
    const b = o.bouts[id];
    const stage = STAGE_NAME[STAGE_OF[id]];
    const mine = b.a === o.fighter || b.b === o.fighter;
    let opp: string;
    let status = '';
    let state: 'done' | 'next' | 'future' | 'out' = 'future';
    if (mine && b.winner) {
      const s = sideOf(b, o.fighter).score;
      opp = `v ${fname(opponentIn(o, b))}`;
      status = b.source === 'walkover' ? 'Abandoned' : b.winner === o.fighter ? `Won ${dash(s[0], s[1])}` : `Lost ${dash(s[0], s[1])}`;
      state = 'done';
    } else if (mine && cur?.id === id) {
      opp = `v ${fname(opponentIn(o, b))}`;
      status = 'Next';
      state = 'next';
    } else if (lostIdx >= 0 && i > lostIdx) {
      // After the player is out: who played this stage.
      opp = b.a && b.b ? `${fname(b.a)} v ${fname(b.b)}` : '';
      state = 'out';
    } else if (id === 'sf1') {
      opp = `v ${fname(o.bouts.sf1.a)}`;
    } else {
      // The final: the other semifinal's winner, or its candidates.
      const sf2 = o.bouts.sf2;
      opp = sf2.winner ? `v ${fname(sf2.winner)}` : `v ${fname(sf2.a)} or ${sf2.b ? fname(sf2.b) : 'the quarterfinal 2 winner'}`;
    }
    return { id, stage, opp, status, state };
  });
}

function PathList({ o, label, showStatus = true }: { o: OpenBracket; label: ReactNode; showStatus?: boolean }) {
  return (
    <div className="open-path">
      <GroupLabel>{label}</GroupLabel>
      <ol>
        {pathRows(o).map((r) => (
          <li key={r.id} className={`path-row ${r.state}`} aria-current={r.state === 'next' ? 'step' : undefined}>
            <span className="stage">{r.stage}</span>
            <span className="opp">{!showStatus && r.state === 'done' ? `${r.status} ${r.opp}` : r.opp}</span>
            {showStatus && <span className="status">{r.status}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── Inline abandon confirmation ──────────────────────────────────── */

function Abandon({ o, onDone, placement }: { o: OpenBracket; onDone(): void; placement: 'above' | 'below' }) {
  const [open, setOpen] = useState(false);
  const linkRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const abandon = useTournament((s) => s.abandon);
  const stage = STAGE_NAME[STAGE_OF[(nextPlayerBout(o) ?? o.bouts.f).id]];
  useEffect(() => {
    if (open) keepRef.current?.focus();
  }, [open]);
  const cancel = () => {
    setOpen(false);
    requestAnimationFrame(() => linkRef.current?.focus());
  };
  usePadButton((b) => b === 'y' && !open && setOpen(true));
  useEffect(() => {
    if (!open) return;
    // Esc / B cancel the confirm (and nothing else).
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [open]);
  if (!open)
    return (
      <button ref={linkRef} type="button" className={`open-abandon-link ${placement}`} onClick={() => setOpen(true)} data-testid="abandon-open">
        Abandon this Open
      </button>
    );
  return (
    <div className={`open-abandon ${placement}`} role="alertdialog" aria-labelledby="abandon-title" aria-describedby="abandon-desc" data-testid="abandon-confirm">
      <p>
        <strong id="abandon-title">Abandon the Open No. {o.number}?</strong> <span id="abandon-desc">It counts as an entry with your best round reached ({stage}). Your match record and belts are untouched.</span>
      </p>
      <div className="row">
        <button
          type="button"
          className="warn"
          data-testid="abandon-yes"
          onClick={async () => {
            await abandon();
            onDone();
          }}
        >
          Abandon
        </button>
        <button ref={keepRef} type="button" className="keep" onClick={cancel} data-testid="abandon-keep">
          Keep playing
        </button>
      </div>
    </div>
  );
}

/* ── Entry and Resume ─────────────────────────────────────────────── */

export function TournamentEntry({ onBack, go }: { onBack(): void; go(p: MenuPanel): void }) {
  const t = useTournament();
  if (t.save.active) return <Resume onBack={onBack} go={go} />;
  return <Entry onBack={onBack} go={go} />;
}

function Entry({ onBack, go }: { onBack(): void; go(p: MenuPanel): void }) {
  const t = useTournament();
  const progress = useGameStore((s) => s.progress);
  const [level, setLevel] = useState(useGameStore.getState().difficulty);
  const [len, setLen] = useState<RoundSeconds>(useGameStore.getState().settings.compRoundSeconds);
  const groupRef = useRef<HTMLDivElement>(null);
  const c = CHARACTERS[progress.fighter];
  const { totals, history, nextNumber } = t.save;
  const last = history[0];
  useEffect(() => {
    t.probeStorage();
    groupRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const enter = () => {
    t.enter({ fighter: progress.fighter, difficulty: level, roundSeconds: len });
    go('bracket');
  };
  const titles = `${totals.titles} title${totals.titles === 1 ? '' : 's'} from ${totals.entered} entr${totals.entered === 1 ? 'y' : 'ies'}`;
  return (
    <>
      <ScreenShell
        title="The Dojang Open"
        titleId="t-open"
        context={`Tournament · No. ${nextNumber}${totals.entered ? ` · ${titles}` : ''}`}
        onBack={onBack}
        className="open-entry"
        footer={
          <>
            {t.saveUnavailable && (
              <p className="feedback warn open-warn" role="status" data-testid="open-save-warn">
                Progress can’t be saved on this device. You can still play, but leaving ends the Open.
              </p>
            )}
            <PrimaryButton onClick={enter} hint="Enter" testid="enter-open">
              Enter the Open
            </PrimaryButton>
          </>
        }
      >
        <p className="body-copy strong">Six fighters, single elimination. Win three bouts to become champion.</p>
        <p className="open-facts">Competitive rules · best of three · a fresh random draw · two seeds start in the semifinals</p>
        <GroupLabel>
          Opponent level <span className="open-label-note">· fixed for the whole tournament</span>
        </GroupLabel>
        <div ref={groupRef}>
          <OptionGroup label="Opponent level">
            {DIFFS.map((d) => (
              <OptionRow
                key={d.id}
                group="open-level"
                name={d.id}
                checked={level === d.id}
                onSelect={() => setLevel(d.id)}
                marker={<BeltMarker belt={d.belt} label={false} />}
                title={d.label}
                description={d.note}
                testid={`open-level-${d.id}`}
              />
            ))}
          </OptionGroup>
        </div>
        <div className="open-len">
          <span className="group-label">Round length</span>
          <Segmented<RoundSeconds>
            label="Round length"
            testid="open-len"
            value={len}
            onChange={setLen}
            options={[
              [60, '1:00'],
              [90, '1:30'],
              [120, '2:00'],
            ]}
          />
        </div>
        <div className="open-fighter">
          <span className="group-label">Your fighter</span>
          <span className="corner-tag chung">{c.name}</span>
          <span className="origin">{c.origin}</span>
          <button
            type="button"
            className="open-change"
            data-testid="open-change-fighter"
            onClick={() => {
              useGameStore.setState({ fighterFrom: 'tournament' });
              go('fighter');
            }}
          >
            Change
          </button>
        </div>
      </ScreenShell>
      {last && (
        <div className="screen-notes" data-testid="open-notes">
          <p>
            Last champion <strong>{fname(last.champion)}</strong> · {LEVEL_NAME[last.difficulty]}
          </p>
          <p>
            Best result <strong>{totals.best ? RESULT_NAME[totals.best] : '—'}</strong> ·{' '}
            <button type="button" className="link" onClick={() => go('openHistory')} data-testid="open-history-link">
              History
            </button>
          </p>
        </div>
      )}
    </>
  );
}

const AHEAD: Record<Stage, string> = { qf: 'Three bouts from the title.', sf: 'Two bouts from the title.', f: 'One bout from the title.' };

function Resume({ onBack, go }: { onBack(): void; go(p: MenuPanel): void }) {
  const t = useTournament();
  const o = t.save.active!;
  const b = nextPlayerBout(o);
  const stage = b ? STAGE_OF[b.id] : 'qf';
  const primaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    primaryRef.current?.querySelector<HTMLButtonElement>('.btn-primary')?.focus();
  }, []);
  return (
    <ScreenShell
      title={`The Dojang Open No. ${o.number}`}
      titleId="t-open"
      context={`Tournament · in progress · ${LEVEL_NAME[o.difficulty]} · ${fmtLen(o.roundSeconds)} rounds`}
      onBack={onBack}
      className="open-entry open-resume"
      footer={
        <div ref={primaryRef} className="open-foot">
          <Abandon o={o} placement="above" onDone={() => go('tournament')} />
          <PrimaryButton onClick={() => go('prematch')} hint="Enter" testid="continue-open" disabled={!b || t.busy}>
            Continue: {STAGE_NAME[stage]}
          </PrimaryButton>
        </div>
      }
    >
      {b && (
        <>
          <p className="body-copy strong">
            {AHEAD[stage]} The {lower(STAGE_NAME[stage])} against {fname(opponentIn(o, b))} is next.
          </p>
          <p className="open-facts">You’ll start the {lower(STAGE_NAME[stage])} from round one. A bout you left midway is always replayed in full.</p>
        </>
      )}
      <PathList o={o} label={`Your path · fighting as ${fname(o.fighter)}`} />
    </ScreenShell>
  );
}

/* ── Bracket tree (desktop and tablet) ────────────────────────────── */

interface SlotView {
  id: CharacterId | null;
  label: string;
  tag: string;
  you: boolean;
  score: string;
  kind: 'winner' | 'loser' | 'open' | 'tbd';
  bar: 'chung' | 'hong' | null;
}

const PLACEHOLDER: Record<BoutId, [string, string]> = {
  qf1: ['', ''],
  qf2: ['', ''],
  sf1: ['', 'Quarterfinal 1 winner'],
  sf2: ['', 'Quarterfinal 2 winner'],
  f: ['Semifinal 1 winner', 'Semifinal 2 winner'],
};

function fixtureView(o: OpenBracket, id: BoutId, current: boolean) {
  const b = o.bouts[id];
  const slot = (who: 'a' | 'b'): SlotView => {
    const c = b[who];
    const decided = b.winner !== null;
    const sc = decided ? (b.source === 'walkover' ? (b.winner === c ? 'w/o' : '') : String(b.score[who === 'a' ? 0 : 1])) : '';
    return {
      id: c,
      label: c ? fname(c) : PLACEHOLDER[id][who === 'a' ? 0 : 1],
      tag: seedTag(o, c),
      you: c === o.fighter,
      score: sc,
      kind: !c ? 'tbd' : decided ? (b.winner === c ? 'winner' : 'loser') : 'open',
      bar: current && c ? (c === o.fighter ? 'chung' : 'hong') : null,
    };
  };
  // On the current fixture the opponent sits on top (Hong), the player below.
  const rows = [slot('a'), slot('b')];
  return { b, rows, current };
}

function FixtureRows({ rows }: { rows: SlotView[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className={`fx-row ${r.kind} ${r.you ? 'you' : ''}`} data-who={r.id ?? ''}>
          {r.bar && <span className={`bar ${r.bar}`} aria-hidden />}
          <span className="nm">
            {r.label}
            {r.you && <span className="tag"> You</span>}
          </span>
          {r.tag && <span className="tag seed">{r.tag}</span>}
          {r.score && <span className="sc">{r.score}</span>}
        </div>
      ))}
    </>
  );
}

function noteFor(o: OpenBracket, id: BoutId, current: boolean) {
  const b = o.bouts[id];
  if (current) return 'Your bout';
  if (b.winner) return '';
  if (id === 'qf2' && !o.bouts.qf1.winner) return 'Decided after your quarterfinal';
  if (id === 'sf2' && !o.bouts.sf1.winner) return 'Decided after your semifinal';
  return '';
}

function stageHeader(o: OpenBracket, s: Stage, cur: Bout | null) {
  const ids = (Object.keys(STAGE_OF) as BoutId[]).filter((id) => STAGE_OF[id] === s);
  const done = ids.every((id) => o.bouts[id].winner);
  return `${STAGE_PLURAL[s]}${done ? ' · complete' : cur && STAGE_OF[cur.id] === s ? ' · next' : ''}`;
}

/** One sentence that states every result, for the tree's role="img". */
function bracketSentence(o: OpenBracket) {
  const parts = (['qf1', 'qf2', 'sf1', 'sf2', 'f'] as BoutId[]).map((id) => {
    const b = o.bouts[id];
    const st = id === 'f' ? 'Final' : `${STAGE_NAME[STAGE_OF[id]]} ${id.slice(-1)}`;
    if (b.winner) return `${st}: ${fname(b.winner)} beat ${fname(b.winner === b.a ? b.b : b.a)} ${b.source === 'walkover' ? 'by walkover' : winnerScore(b).replace('–', ' to ')}.`;
    if (b.a && b.b) return `${st}: ${fname(b.a)} versus ${fname(b.b)}, to come.`;
    return `${st}: to be decided.`;
  });
  return `Bracket of the Dojang Open No. ${o.number}. ${parts.join(' ')}${o.bouts.f.winner ? ` Champion: ${fname(o.bouts.f.winner)}.` : ''}`;
}

/** Positions from the handoff (relative to the tree origin). */
const POS: Record<BoutId, { x: number; y: number }> = { qf1: { x: 0, y: 60 }, qf2: { x: 0, y: 280 }, sf1: { x: 236, y: 40 }, sf2: { x: 236, y: 260 }, f: { x: 472, y: 150 } };

/** The tree's natural size (the handoff's positions; the champion name ends near 860). */
const TREE_W = 860;
const TREE_H = 390;
/** Below this scale the tree gets hard to read: the stage pager takes over. */
const TREE_MIN_SCALE = 0.8;

/**
 * The tree sits in the space between the header and the bottom row and
 * scales down (never up) to fit it, so fixtures never run under the
 * primary button or the hints on shorter windows.
 */
function TreeBox({ o, cur, onTooSmall }: { o: OpenBracket; cur: Bout | null; onTooSmall(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const s = Math.min(1, el.clientHeight / TREE_H, el.clientWidth / TREE_W);
      if (s < TREE_MIN_SCALE) onTooSmall();
      else setScale(Math.floor(s * 100) / 100);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="tree-box" ref={ref} data-testid="tree-box">
      <Tree o={o} cur={cur} scale={scale} />
    </div>
  );
}

function Tree({ o, cur, scale = 1 }: { o: OpenBracket; cur: Bout | null; scale?: number }) {
  const champ = o.bouts.f.winner;
  return (
    <div className="open-tree" role="img" aria-label={bracketSentence(o)} data-testid="bracket-tree" style={scale < 1 ? { transform: `scale(${scale})` } : undefined}>
      <span className="col-h" style={{ left: 10 }}>{stageHeader(o, 'qf', cur)}</span>
      <span className="col-h" style={{ left: 246 }}>{stageHeader(o, 'sf', cur)}</span>
      <span className="col-h" style={{ left: 482 }}>{stageHeader(o, 'f', cur)}</span>
      <span className="col-h" style={{ left: 700 }}>Champion</span>
      {(Object.keys(POS) as BoutId[]).map((id) => {
        const v = fixtureView(o, id, cur?.id === id);
        const note = noteFor(o, id, false);
        return (
          <div key={id} className={`fx ${v.current ? 'current' : ''}`} style={{ left: POS[id].x, top: POS[id].y }} data-bout={id} data-source={v.b.source ?? ''}>
            <FixtureRows rows={v.rows} />
            <i className="fx-div" aria-hidden />
            {note && <span className="fx-note">{note}</span>}
          </div>
        );
      })}
      {/* Connectors: 1 px hairlines. */}
      <i className="ln" style={{ left: 190, top: 100, width: 46, height: 1 }} />
      <i className="ln" style={{ left: 190, top: 320, width: 46, height: 1 }} />
      <i className="ln" style={{ left: 426, top: 80, width: 28, height: 1 }} />
      <i className="ln" style={{ left: 426, top: 300, width: 28, height: 1 }} />
      <i className="ln" style={{ left: 454, top: 80, width: 1, height: 221 }} />
      <i className="ln" style={{ left: 454, top: 190, width: 18, height: 1 }} />
      <i className="ln" style={{ left: 662, top: 190, width: 28, height: 1 }} />
      <span className={`champ ${champ ? 'won' : ''}`} style={{ left: 700, top: 174 }} data-testid="bracket-champion">
        {champ ? fname(champ) : '—'}
      </span>
    </div>
  );
}

/* ── Bracket hub ──────────────────────────────────────────────────── */

function bracketCopy(o: OpenBracket, cur: Bout | null) {
  if (!cur) {
    const champ = o.bouts.f.winner;
    if (!champ) return { title: 'Semifinal next', sub: '' };
    return {
      title: champ === o.fighter ? 'You won the Open' : 'The Open is over',
      sub: `Champion: ${fname(champ)}. Your result is saved to your Open history.`,
    };
  }
  const s = STAGE_OF[cur.id];
  const opp = fname(opponentIn(o, cur));
  if (s === 'qf') return { title: 'Quarterfinal next', sub: `Your first bout is against ${opp}. Two seeds wait in the semifinals.` };
  const prev = s === 'sf' ? o.bouts.qf1 : o.bouts.sf1;
  const won = `You beat ${fname(opponentIn(o, prev))} ${winnerScore(prev)}.`;
  if (s === 'sf') return { title: 'Semifinal next', sub: `${won} Seed 1 ${opp} is waiting.` };
  return { title: 'Final next', sub: `${won} ${opp} is through to meet you.` };
}

export function Bracket({ go }: { go(p: MenuPanel): void }) {
  const t = useTournament();
  const measured = useLayout();
  // The tree reports when even its smallest readable scale doesn't fit; reset on resize.
  const [tooSmall, setTooSmall] = useState(false);
  useEffect(() => setTooSmall(false), [measured]);
  useEffect(() => {
    const f = () => setTooSmall(false);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const layout: Layout = tooSmall ? 'pager' : measured;
  const o = bracketInView(t);
  const primaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!o) go('tournament');
    primaryRef.current?.querySelector<HTMLButtonElement>('.btn-primary')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!o) return null;
  const active = t.review === null && t.save.active?.number === o.number ? t.save.active : null;
  const cur = active ? nextPlayerBout(active) : null;
  const { title, sub } = bracketCopy(o, cur);
  const done = !active;
  const toMenu = () => {
    t.setReview(null);
    go('home');
  };
  const primary = cur ? (
    <PrimaryButton onClick={() => go('prematch')} hint="Enter" testid="fight-stage" disabled={t.busy}>
      Fight the {lower(STAGE_NAME[STAGE_OF[cur.id]])}
    </PrimaryButton>
  ) : done ? (
    <PrimaryButton
      onClick={() => {
        t.setReview(null);
        go('tournament');
      }}
      hint="Enter"
      testid="new-open"
    >
      Enter a new Open
    </PrimaryButton>
  ) : (
    <PrimaryButton onClick={() => undefined} disabled testid="fight-stage">
      Next bout
    </PrimaryButton>
  );
  const abandon = active && <Abandon o={active} placement="below" onDone={() => go('tournament')} />;
  const hints = (
    <p className="open-hints" aria-hidden>
      {cur && (
        <span>
          Bout <b>{boutNumber(o)}</b> of 3
        </span>
      )}
      {cur && (
        <span>
          <b>Enter</b> Fight
        </span>
      )}
      <span>
        <b>Esc</b> Menu{active ? ' · progress saved' : ''}
      </span>
    </p>
  );
  const ctx = `The Dojang Open · No. ${o.number} · ${LEVEL_NAME[o.difficulty]}`;

  if (layout === 'pager') return <Pager o={o} cur={cur} title={title} sub={sub} primary={primary} abandon={abandon} onBack={toMenu} primaryRef={primaryRef} />;

  return (
    <section className={`open-bracket ${layout}`} aria-labelledby="t-bracket" data-testid="bracket">
      <div className="open-side">
        <BackButton onClick={toMenu} />
        <p className="context">{layout === 'tablet' ? `${ctx} · ${fmtLen(o.roundSeconds)} rounds` : ctx}</p>
        <h1 className="title" id="t-bracket">
          {title}
        </h1>
        <p className="open-sub">{sub}</p>
        {layout === 'desktop' && <PathList o={o} label="Your path" showStatus={false} />}
        {layout === 'desktop' && (
          <div className="open-foot" ref={primaryRef}>
            {primary}
            {abandon}
          </div>
        )}
      </div>
      <TreeBox o={o} cur={cur} onTooSmall={() => setTooSmall(true)} />
      {layout === 'tablet' ? (
        <div className="open-bottom">
          <div className="open-foot" ref={primaryRef}>
            {primary}
          </div>
          <div className="open-bottom-right">
            {abandon}
            {hints}
          </div>
        </div>
      ) : (
        <div className="open-hints-wrap">{hints}</div>
      )}
    </section>
  );
}

function Pager({ o, cur, title, sub, primary, abandon, onBack, primaryRef }: { o: OpenBracket; cur: Bout | null; title: string; sub: string; primary: ReactNode; abandon: ReactNode; onBack(): void; primaryRef: React.RefObject<HTMLDivElement | null> }) {
  const stages: Stage[] = ['qf', 'sf', 'f'];
  const [tab, setTab] = useState<Stage>(cur ? STAGE_OF[cur.id] : 'f');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (d: number) => {
    const n = (stages.indexOf(tab) + d + 3) % 3;
    setTab(stages[n]);
    tabRefs.current[n]?.focus();
  };
  usePadButton((b) => (b === 'lb' ? move(-1) : b === 'rb' ? move(1) : undefined));
  const ids = (Object.keys(STAGE_OF) as BoutId[]).filter((id) => STAGE_OF[id] === tab);
  const complete = (s: Stage) => (Object.keys(STAGE_OF) as BoutId[]).filter((id) => STAGE_OF[id] === s).every((id) => o.bouts[id].winner);
  const portrait = window.innerWidth < 600 && window.innerHeight > window.innerWidth;
  const small = window.innerWidth < 800;
  const prev = cur && STAGE_OF[cur.id] !== 'qf' ? (STAGE_OF[cur.id] === 'sf' ? o.bouts.qf1 : o.bouts.sf1) : null;
  const footLine = prev ? `${STAGE_NAME[STAGE_OF[prev.id]]}: won ${winnerScore(prev)} v ${fname(opponentIn(o, prev))}` : cur ? `Bout 1 of 3 · ${fmtLen(o.roundSeconds)} rounds` : sub;
  const groupLabel = (id: BoutId) => {
    const n = id === 'f' ? 'Final' : `${STAGE_NAME[STAGE_OF[id]]} ${id.slice(-1)}`;
    if (cur?.id === id) return `${n} · your bout`;
    const note = noteFor(o, id, false);
    return note ? `${n} · ${note === 'Decided after your quarterfinal' || note === 'Decided after your semifinal' ? 'after your bout' : lower(note)}` : n;
  };
  return (
    <section className={`open-bracket pager ${portrait ? 'portrait' : ''}`} aria-labelledby="t-bracket" data-testid="bracket">
      <header className="pager-head">
        {portrait ? (
          <BackButton onClick={onBack} />
        ) : (
          <button type="button" className="icon-back" aria-label="Back to menu" onClick={onBack} data-testid="menu-back">
            <span aria-hidden>←</span>
          </button>
        )}
        {portrait && <p className="context">{`Dojang Open No. ${o.number} · ${LEVEL_NAME[o.difficulty]}${cur ? ` · Bout ${boutNumber(o)} of 3` : ''}`}</p>}
        <h1 className="title" id="t-bracket">
          {title}
        </h1>
        {!portrait && (
          <p className="context right">
            {small ? `No. ${o.number}${cur ? ` · Bout ${boutNumber(o)} of 3` : ''}` : `Dojang Open No. ${o.number} · ${LEVEL_NAME[o.difficulty]}`}
            {!small && cur && (
              <>
                {' · Bout '}
                <b>{boutNumber(o)}</b> of 3
              </>
            )}
          </p>
        )}
      </header>
      {portrait && sub && <p className="open-sub">{prev ? `You beat ${fname(opponentIn(o, prev))} ${winnerScore(prev)}.` : sub}</p>}
      <div className="tabs-row">
      <div className="segmented open-tabs" role="tablist" aria-label="Bracket stage">
        {stages.map((s, i) => (
          <button
            key={s}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={`tab-${s}`}
            aria-selected={tab === s}
            aria-controls="open-stage"
            tabIndex={tab === s ? 0 : -1}
            className={tab === s ? 'on' : ''}
            onClick={() => {
              audio.click();
              setTab(s);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                move(e.key === 'ArrowRight' ? 1 : -1);
              }
            }}
            data-testid={`stage-tab-${s}`}
          >
            {STAGE_PLURAL[s]}
            {complete(s) && <span className="check"> ✓</span>}
          </button>
        ))}
      </div>
      {!portrait && <div className="tabs-abandon">{abandon}</div>}
      </div>
      <div className={`pager-fixtures ${ids.length === 1 ? 'single' : ''}`} id="open-stage" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {ids.map((id) => {
          const isCur = cur?.id === id;
          const v = fixtureView(o, id, isCur);
          // The player's fixture lists the player first on phones.
          const rows = isCur ? [...v.rows].sort((x, y) => Number(y.you) - Number(x.you)) : v.rows;
          const note = noteFor(o, id, isCur);
          return (
            <div key={id} className="pager-fx" data-bout={id} data-source={v.b.source ?? ''}>
              {portrait && <p className="group-label">{groupLabel(id)}</p>}
              <div className={`fx ${isCur ? 'current' : ''}`}>
                <FixtureRows rows={rows} />
              </div>
              {!portrait && <p className="fx-note">{isCur ? 'Your bout · winner reaches the ' + (id === 'f' ? 'title' : id.startsWith('qf') ? 'semifinals' : 'final') : note}</p>}
            </div>
          );
        })}
      </div>
      <div className="pager-foot">
        <div className="open-foot" ref={primaryRef}>
          {primary}
        </div>
        {!portrait && <p className="foot-line">{footLine}</p>}
        {portrait && abandon}
      </div>
    </section>
  );
}

/* ── Pre-match ────────────────────────────────────────────────────── */

export function PreMatch({ go, leave }: { go(p: MenuPanel): void; leave(fn: () => void): void }) {
  const t = useTournament();
  const o = t.save.active;
  const b = o && nextPlayerBout(o);
  const primaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!o || !b) go(o ? 'bracket' : 'tournament');
    primaryRef.current?.querySelector<HTMLButtonElement>('.btn-primary')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!o || !b) return null;
  const opp = opponentIn(o, b)!;
  const me = CHARACTERS[o.fighter];
  const them = CHARACTERS[opp];
  const s = STAGE_OF[b.id];
  const sf2 = o.bouts.sf2;
  const after =
    s === 'qf'
      ? `the winner meets Seed 1 ${fname(o.seeds[0])}.`
      : s === 'sf'
        ? sf2.winner
          ? `the winner meets ${fname(sf2.winner)} in the final.`
          : 'the winner reaches the final.'
        : `the winner is champion of the Dojang Open No. ${o.number}.`;
  const tag = seedTag(o, opp);
  return (
    <ScreenShell
      title={STAGE_NAME[s]}
      titleId="t-prematch"
      context={`The Dojang Open · No. ${o.number} · Bout ${boutNumber(o)} of 3`}
      onBack={() => go('bracket')}
      backLabel="Bracket"
      className="open-prematch"
      footer={
        <div ref={primaryRef}>
          <PrimaryButton onClick={() => leave(() => t.startBout())} hint="Enter" testid="fight">
            Fight
          </PrimaryButton>
        </div>
      }
    >
      <div className="corners">
        <div className="corner chung">
          <span className="nm">{me.name}</span>
          <span className="sub">You · Chung · blue corner</span>
        </div>
        <span className="v" aria-hidden>
          v
        </span>
        <div className="corner hong" data-testid="prematch-opponent">
          <span className="nm">
            {them.name}
            {them.hangul && (
              <span lang="ko" className="ko">
                {' '}
                {them.hangul}
              </span>
            )}
          </span>
          <span className="sub">
            Hong · red corner · {LEVEL_NAME[o.difficulty]} AI{tag ? ` · ${tag}` : ''}
          </span>
        </div>
      </div>
      <p className="open-facts">
        Best of three · {fmtLen(o.roundSeconds)} rounds · {after}
      </p>
    </ScreenShell>
  );
}

/* ── Champion ─────────────────────────────────────────────────────── */

/** The record of the Open that just finished (or the latest). */
function justFinished(t: ReturnType<typeof useTournament.getState>): OpenRecord | null {
  const n = t.lastOutcome?.number;
  return (n !== undefined ? t.save.history.find((h) => h.number === n) : undefined) ?? t.save.history[0] ?? null;
}

export function Champion({ go }: { go(p: MenuPanel): void }) {
  const t = useTournament();
  const promotion = useGameStore((s) => s.promotion);
  const rec = justFinished(t);
  const primaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rec || rec.result !== 'champion') {
      go('tournament');
      return;
    }
    primaryRef.current?.querySelector<HTMLButtonElement>('.btn-primary')?.focus();
    // The promotion cue plays once per Open, on first display. A belt
    // promotion earned by the same bout plays its own (the same) cue instead.
    if (!t.celebrated.includes(rec.number)) {
      t.markCelebrated(rec.number);
      if (!useGameStore.getState().promotion) audio.promotion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!rec || rec.result !== 'champion') return null;
  const c = CHARACTERS[rec.fighter];
  const { titles, entered } = t.save.totals;
  const record = (
    <>
      <strong>
        {titles} title{titles === 1 ? '' : 's'}
      </strong>{' '}
      from {entered} entr{entered === 1 ? 'y' : 'ies'}
    </>
  );
  const exit = (p: MenuPanel, review = false) => {
    useGameStore.getState().clearPromotion();
    t.setReview(review ? rec.number : null);
    go(p);
  };
  return (
    <section className="open-champion" role="dialog" aria-labelledby="t-champion" data-testid="champion">
      <div className="col">
        <p className="context">
          The Dojang Open No. {rec.number} · {LEVEL_NAME[rec.difficulty]} · {fmtLen(rec.roundSeconds)} rounds
        </p>
        <h1 className="champ-title" id="t-champion" aria-live="polite">
          Champion
        </h1>
        <p className="champ-name">
          <span className="nm">{c.name}</span> <span className="origin">{c.origin}</span>
          <span className="short-record"> · {titles} title{titles === 1 ? '' : 's'} from {entered}</span>
        </p>
        <p className="open-facts strong">Three bouts, three wins, against the field at {LEVEL_NAME[rec.difficulty]}.</p>
        <ol className="champ-path">
          {PLAYER_PATH.map((id) => {
            const b = rec.bouts[id];
            const opp = opponentIn(rec, b);
            const sc = sideOf(b, rec.fighter).score;
            const tag = seedTag(rec, opp);
            return (
              <li key={id}>
                <span className="stage">{STAGE_NAME[STAGE_OF[id]]}</span>
                <span className="opp">
                  v {fname(opp)}
                  {tag && <span className="tag"> {tag}</span>}
                </span>
                <span className="sc">{dash(sc[0], sc[1], true)}</span>
              </li>
            );
          })}
        </ol>
        <p className="champ-record">Your Open record: {record}.</p>
        {promotion && <PromotionNote />}
        <div className="actions row" ref={primaryRef}>
          <PrimaryButton onClick={() => exit('tournament')} hint="Enter" testid="new-open">
            Enter a new Open
          </PrimaryButton>
          <QuietButton onClick={() => exit('bracket', true)} testid="champion-bracket">
            Bracket
          </QuietButton>
          <QuietButton onClick={() => exit('home')} hint="Esc" testid="champion-menu">
            Menu
          </QuietButton>
        </div>
      </div>
    </section>
  );
}

/* ── History ──────────────────────────────────────────────────────── */

export function OpenHistory({ go }: { go(p: MenuPanel): void }) {
  const t = useTournament();
  const { history, totals } = t.save;
  const latest = history[0];
  return (
    <ScreenShell title="Open history" titleId="t-history" onBack={() => go('tournament')} backLabel="Tournament" className="wide open-history">
      <dl className="open-stats">
        <div>
          <dt>Entered</dt>
          <dd className="num">{totals.entered}</dd>
        </div>
        <div>
          <dt>Titles</dt>
          <dd className="num">{totals.titles}</dd>
        </div>
        <div>
          <dt>Best result</dt>
          <dd>{totals.best ? RESULT_NAME[totals.best] : '—'}</dd>
        </div>
        <div>
          <dt>Latest champion</dt>
          <dd>{latest ? fname(latest.champion) : '—'}</dd>
        </div>
      </dl>
      {history.length > 0 ? (
        <table className="open-table" data-testid="open-history">
          <thead>
            <tr>
              <th scope="col">Open</th>
              <th scope="col" className="c-fighter">
                You fought as
              </th>
              <th scope="col">Level</th>
              <th scope="col">Your result</th>
              <th scope="col" className="c-champ">
                Champion
              </th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.number}>
                <td>
                  <button
                    type="button"
                    className="link"
                    aria-label={`No. ${h.number}: view the bracket`}
                    onClick={() => {
                      t.setReview(h.number);
                      go('bracket');
                    }}
                  >
                    No. {h.number}
                  </button>
                </td>
                <td className="c-fighter">{fname(h.fighter)}</td>
                <td className="lvl">
                  <BeltMarker belt={LEVEL_BELT[h.difficulty]} label={false} /> {LEVEL_NAME[h.difficulty]}
                </td>
                <td className={h.result === 'champion' ? 'won' : ''}>
                  {RESULT_NAME[h.result]}
                  {h.abandoned && <span className="muted"> · abandoned</span>}
                </td>
                <td className="c-champ">{fname(h.champion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="body-copy">No Opens yet.</p>
      )}
      <p className="caption">
        The last 20 Opens are kept on this device. An abandoned Open is recorded with the furthest round you reached. Tournament bouts also count toward your match record and belt progress, as usual.
      </p>
    </ScreenShell>
  );
}

/** Home's menu item text. */
export function homeItem(t: ReturnType<typeof useTournament.getState>) {
  const o = t.save.active;
  if (!o) return { label: 'Tournament', description: 'The Dojang Open · six fighters, three wins' };
  const b = nextPlayerBout(o);
  const s = b ? STAGE_NAME[STAGE_OF[b.id]] : STAGE_NAME[STAGE_OF[(playerLoss(o) ?? o.bouts.f).id]];
  return { label: 'Continue the Open', description: `No. ${o.number} · ${s} next${b ? `, v ${fname(opponentIn(o, b))}` : ''} · ${LEVEL_NAME[o.difficulty]}` };
}

export { playerResult };
