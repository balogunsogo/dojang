import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { Difficulty } from '../game/ai/AIController';
import { audio } from '../game/audio/AudioEngine';
import { BELT_ORDER, BELT_REQUIREMENTS, nextBelt, type Progress } from '../game/progress/progress';
import { BELT_COLORS, CHARACTERS, type CharacterId } from '../game/render/characterFactory';
import { isTouchDevice } from '../game/render/quality';
import { ACTIVITIES, activityById, type Activity } from '../game/training/activities';
import { type MenuPanel, useGameStore } from '../store/useGameStore';
import { MenuBackdrop, prefersReducedMotion } from './MenuBackdrop';
import { PwaHint } from './PwaHint';
import { SettingsPanel } from './SettingsPanel';
import { BeltChip } from './Training';

const DIFFS: { id: Difficulty; label: string; note: string; belt: keyof typeof BELT_COLORS }[] = [
  { id: 'easy', label: 'White belt', note: 'Slow reactions, predictable, simple combinations', belt: 'white' },
  { id: 'normal', label: 'Red belt', note: 'Better spacing and blocking, some counters', belt: 'red' },
  { id: 'hard', label: 'Black belt', note: 'Reads your habits, counters, plays the score', belt: 'black' },
];

/** Relative difficulty of each training activity (1–3), shown as pips. */
const LEVEL: Record<string, number> = {
  practice: 1,
  body10: 1,
  head5: 2,
  alternate: 2,
  moving: 3,
  'combo-front-round': 2,
  'combo-lead-rear': 2,
  'combo-side-back': 3,
  'block-counter': 3,
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function goFullscreenOnTouch() {
  if (isTouchDevice() && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => undefined);
  }
}

/** The activity that moves the player toward their next belt (or the next unfinished one). */
export function recommendedActivity(p: Progress): Activity {
  const nb = nextBelt(p.belt);
  const map: Record<string, () => string | null> = {
    'practice-basics': () => 'practice',
    'challenge-body10': () => 'body10',
    'accuracy-60': () => 'body10',
    combos: () => ['combo-front-round', 'combo-lead-rear', 'combo-side-back'].find((c) => !p.completed.includes(c)) ?? null,
    'accuracy-75': () => 'alternate',
    defense: () => 'block-counter',
  };
  if (nb) {
    for (const r of BELT_REQUIREMENTS[nb]) {
      if (r.done(p)) continue;
      const id = map[r.id]?.();
      if (id) return activityById(id);
    }
  }
  return ACTIVITIES.find((a) => a.kind !== 'practice' && !p.completed.includes(a.id)) ?? ACTIVITIES[0];
}

/** Fade the menu out before a match starts (skipped under reduced motion). */
function useLeave(): [boolean, (fn: () => void) => void] {
  const [leaving, setLeaving] = useState(false);
  const leave = (fn: () => void) => {
    audio.unlock();
    goFullscreenOnTouch();
    if (prefersReducedMotion()) return fn();
    setLeaving(true);
    window.setTimeout(fn, 280);
  };
  return [leaving, leave];
}

/** Main menu: a cinematic home over the live dojang, plus side-sheet panels. */
export function Menu() {
  const panel = useGameStore((s) => s.menuPanel);
  const [leaving, leave] = useLeave();
  const setPanel = (p: MenuPanel) => {
    audio.click();
    useGameStore.getState().setMenuPanel(p);
  };
  return (
    <div className={`menu ${panel === 'home' ? 'at-home' : 'at-sub'} ${leaving ? 'leaving' : ''}`}>
      <MenuBackdrop />
      {panel === 'home' ? <Home setPanel={setPanel} /> : <Sub key={panel === 'controls' ? 'settings' : panel} panel={panel} setPanel={setPanel} leave={leave} />}
    </div>
  );
}

interface NavItem {
  id: string;
  label: string;
  sub: string;
  testid: string;
  go(): void;
}

function Home({ setPanel }: { setPanel: (p: MenuPanel) => void }) {
  const progress = useGameStore((s) => s.progress);
  const saveFailed = useGameStore((s) => s.saveFailed);
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const c = CHARACTERS[progress.fighter];
  const started = progress.completed.length > 0 || Object.keys(progress.records).length > 0;
  const rec = recommendedActivity(progress);
  const items: NavItem[] = [
    {
      id: 'training',
      label: started ? 'Continue Training' : 'Training',
      sub: started ? `Next: ${rec.title}` : 'Targets, timed challenges and combination drills',
      testid: 'mode-training',
      go: () => setPanel('training'),
    },
    {
      id: 'arcade',
      label: 'Arcade Sparring',
      sub: 'Health and knockouts · best of three',
      testid: 'mode-arcade',
      go: () => {
        useGameStore.setState({ mode: 'arcade' });
        setPanel('spar');
      },
    },
    {
      id: 'competitive',
      label: 'Competitive Sparring',
      sub: 'WT-style points and gam-jeom · best of three',
      testid: 'mode-competitive',
      go: () => {
        useGameStore.setState({ mode: 'competitive' });
        setPanel('spar');
      },
    },
    { id: 'fighter', label: 'Choose Fighter', sub: `${c.name} · ${cap(progress.belt)} belt`, testid: 'open-fighter', go: () => setPanel('fighter') },
    { id: 'progress', label: 'Belt Progression', sub: progressLine(progress), testid: 'open-progress', go: () => setPanel('progress') },
    { id: 'settings', label: 'Settings & Controls', sub: 'Touch layout, camera, comfort, audio, graphics', testid: 'open-settings', go: () => setPanel('settings') },
  ];
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (active + d + items.length) % items.length;
    setActive(n);
    refs.current[n]?.focus();
  };
  useEffect(() => {
    // Keyboard players land on the first item; touch users never see a focus ring.
    if (!isTouchDevice()) refs.current[0]?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="home">
      <header className="title-block">
        <p className="eyebrow">
          <span lang="ko">태권도</span> · Taekwondo
        </p>
        <h1>
          DOJANG
          <span className="hangul" lang="ko">
            도장
          </span>
        </h1>
        <p className="tagline">Train with discipline. Spar with respect.</p>
      </header>
      <nav className="main-nav" aria-label="Main menu" onKeyDown={onKey}>
        {items.map((it, i) => (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={`nav-item ${i === active ? 'active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={it.go}
            data-testid={it.testid}
          >
            <span className="label">{it.label}</span>
            <span className="sub">{it.sub}</span>
          </button>
        ))}
      </nav>
      <PwaHint />
      {saveFailed && <p className="warn-line">Progress could not be saved in this browser (private mode or storage full). It will be lost on reload.</p>}
      <footer className="home-foot">
        <div className="player" data-testid="current-fighter">
          <span className="who">
            <strong>{c.name}</strong>{' '}
            <span className="hangul" lang="ko">
              {c.hangul}
            </span>
          </span>
          <BeltChip belt={progress.belt} />
        </div>
        <p className="legal">Inspired by Taekwondo — not an official rules reference or grading. Character: CC0 Quaternius mannequin.</p>
      </footer>
    </div>
  );
}

function progressLine(p: Progress) {
  const nb = nextBelt(p.belt);
  if (!nb) return `${cap(p.belt)} belt · every milestone complete`;
  const reqs = BELT_REQUIREMENTS[nb];
  return `${reqs.filter((r) => r.done(p)).length} / ${reqs.length} toward ${cap(nb)} belt`;
}

function Sub({ panel, setPanel, leave }: { panel: MenuPanel; setPanel: (p: MenuPanel) => void; leave: (fn: () => void) => void }) {
  const mode = useGameStore((s) => s.mode);
  const head: Record<MenuPanel, [string, string]> = {
    home: ['', ''],
    spar: ['Sparring', mode === 'competitive' ? 'Competitive' : 'Arcade'],
    training: ['Training', 'Choose an activity'],
    fighter: ['Fighter', 'Choose your fighter'],
    progress: ['Progression', 'Belt progression'],
    settings: ['Options', 'Settings & Controls'],
    controls: ['Options', 'Settings & Controls'],
  };
  const [eyebrow, title] = head[panel];
  return (
    <div className="sheet" role="region" aria-label={title}>
      <header className="sheet-head">
        <button className="back" onClick={() => setPanel('home')} aria-label="Back to main menu" data-testid="menu-back">
          <span aria-hidden>←</span> Back
        </button>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </header>
      <div className="sheet-body">
        {panel === 'spar' && <SparSetup leave={leave} />}
        {panel === 'training' && <TrainingMenu leave={leave} />}
        {panel === 'fighter' && <FighterSelect setPanel={setPanel} />}
        {panel === 'progress' && <ProgressPanel setPanel={setPanel} />}
        {(panel === 'settings' || panel === 'controls') && <OptionsPanel panel={panel} setPanel={setPanel} />}
      </div>
    </div>
  );
}

function Seg<T extends string | number>({ value, options, onChange, label, testid }: { value: T; options: [T, ReactNode][]; onChange(v: T): void; label: string; testid?: string }) {
  return (
    <div className="seg2" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} data-testid={testid ? `${testid}-${v}` : undefined}>
          {text}
        </button>
      ))}
    </div>
  );
}

function SparSetup({ leave }: { leave: (fn: () => void) => void }) {
  const mode = useGameStore((s) => s.mode);
  const difficulty = useGameStore((s) => s.difficulty);
  const settings = useGameStore((s) => s.settings);
  const update = useGameStore((s) => s.updateSettings);
  const startMatch = useGameStore((s) => s.startMatch);
  const [opp, setOpp] = useState<Difficulty>(difficulty);
  const comp = mode === 'competitive';
  return (
    <section className="spar">
      <Seg
        label="Rules"
        value={comp ? 'competitive' : 'arcade'}
        testid="rules"
        onChange={(m) => {
          audio.click();
          useGameStore.setState({ mode: m });
        }}
        options={[
          ['arcade', 'Arcade'],
          ['competitive', 'Competitive'],
        ]}
      />
      <ul className="rules">
        {comp ? (
          <>
            <li>Punch 1 · body kick 2 · head kick 3 · turning body 4 · turning head 6</li>
            <li>Stay inside the boundary; each gam-jeom gives your opponent a point</li>
            <li>Win two rounds; tied rounds go to the tie-break criteria</li>
          </>
        ) : (
          <>
            <li>Land clean techniques to drain your opponent's health</li>
            <li>Knock out, or lead on health when time runs out</li>
            <li>Win two of three rounds</li>
          </>
        )}
      </ul>
      <h3>Opponent</h3>
      <div className="opps" role="radiogroup" aria-label="Opponent">
        {DIFFS.map((d) => (
          <button key={d.id} role="radio" aria-checked={opp === d.id} className={`opp ${opp === d.id ? 'on' : ''}`} onClick={() => setOpp(d.id)} data-testid={`opp-${d.id}`}>
            <span className="belt-dot" style={{ background: BELT_COLORS[d.belt] }} aria-hidden />
            <span className="txt">
              <strong>{d.label}</strong>
              <span>{d.note}</span>
            </span>
          </button>
        ))}
      </div>
      {comp && (
        <>
          <h3>Round length</h3>
          <Seg
            label="Round length"
            value={settings.compRoundSeconds}
            testid="round"
            onChange={(v) => update({ compRoundSeconds: v })}
            options={[
              [60, '60 s'],
              [90, '90 s'],
              [120, '120 s · senior'],
            ]}
          />
        </>
      )}
      <button className="cta" onClick={() => leave(() => startMatch(opp, comp ? 'competitive' : 'arcade'))} data-testid="start-match">
        Start match
      </button>
    </section>
  );
}

function Pips({ n, of = 3, label }: { n: number; of?: number; label: string }) {
  return (
    <span className="pips3" aria-label={label} title={label}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

function objective(a: Activity) {
  if (a.kind === 'practice') return 'Untimed';
  if (a.kind === 'challenge') return `${a.goal} hits · ${a.seconds} s`;
  return `${a.goal} reps${a.window ? ` · ${a.window} s window` : ''}`;
}

function TrainingMenu({ leave }: { leave: (fn: () => void) => void }) {
  const progress = useGameStore((s) => s.progress);
  const startTraining = useGameStore((s) => s.startTraining);
  const rec = recommendedActivity(progress);
  const go = (id: string) => leave(() => startTraining(id));
  const groups: [Activity['kind'], string][] = [
    ['practice', 'Free practice'],
    ['challenge', 'Target challenges'],
    ['drill', 'Combination drills'],
  ];
  return (
    <section className="training-menu">
      <p className="lede">A partner holds the target. Hits count only when they would score in Competitive: clean, well extended and on the right zone.</p>
      <button className="recommend" onClick={() => go(rec.id)} data-testid="continue-training">
        <span className="k">Recommended next</span>
        <strong>{rec.title}</strong>
        <span className="sub">{objective(rec)}</span>
      </button>
      {groups.map(([kind, label]) => (
        <div key={kind} className="act-group">
          <h3>{label}</h3>
          <ul className="acts">
            {ACTIVITIES.filter((a) => a.kind === kind).map((a) => {
              const r = progress.records[a.id];
              const done = progress.completed.includes(a.id);
              return (
                <li key={a.id}>
                  <button className={`act-row ${done ? 'done' : ''}`} onClick={() => go(a.id)} data-testid={`activity-${a.id}`}>
                    <span className="state" aria-label={done ? 'completed' : 'not completed'}>
                      {done ? '✓' : ''}
                    </span>
                    <span className="main">
                      <strong>{a.title}</strong>
                      <span className="brief">{a.brief}</span>
                    </span>
                    <span className="meta">
                      <span className="obj">{objective(a)}</span>
                      <Pips n={LEVEL[a.id] ?? 1} label={`Difficulty ${LEVEL[a.id] ?? 1} of 3`} />
                      {r && (
                        <span className="best">
                          Best {a.kind === 'drill' ? `${r.bestScore} reps` : `${r.bestScore} hits`}
                          {r.bestAccuracy > 0 ? ` · ${Math.round(r.bestAccuracy * 100)}%` : ''}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function StatBar({ label, v }: { label: string; v: number }) {
  // Stats sit around 0.85–1.15; map that range to the bar.
  const w = Math.max(0.08, Math.min(1, (v - 0.7) / 0.5));
  return (
    <div className="statbar">
      <span>{label}</span>
      <i>
        <b style={{ width: `${w * 100}%` }} />
      </i>
    </div>
  );
}

function FighterSelect({ setPanel }: { setPanel: (p: MenuPanel) => void }) {
  const progress = useGameStore((s) => s.progress);
  const setFighter = useGameStore((s) => s.setFighter);
  const c = CHARACTERS[progress.fighter];
  return (
    <section className="fighter-select">
      <div className="fighter-tabs" role="radiogroup" aria-label="Fighter">
        {(Object.keys(CHARACTERS) as CharacterId[]).map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={progress.fighter === id}
            className={`ftab ${progress.fighter === id ? 'on' : ''}`}
            onClick={() => {
              audio.click();
              setFighter(id);
            }}
            data-testid={`fighter-${id}`}
          >
            <strong>{CHARACTERS[id].name}</strong>
            <span className="hangul" lang="ko">
              {CHARACTERS[id].hangul}
            </span>
          </button>
        ))}
      </div>
      <div className="fighter-detail" aria-live="polite">
        <p className="blurb">{c.blurb}</p>
        <StatBar label="Power" v={c.stats.power} />
        <StatBar label="Speed" v={c.stats.speed} />
        <StatBar label="Recovery" v={c.stats.staminaRegen} />
        <p className="belt-line">
          <BeltChip belt={progress.belt} /> <span className="muted">Your belt is shared by both fighters.</span>
        </p>
        <p className="muted small">You fight in the blue (chung) corner; the other fighter is your opponent or training partner.</p>
      </div>
      <div className="sheet-actions">
        <button className="cta" onClick={() => setPanel('spar')}>
          Spar as {c.short}
        </button>
        <button className="ghost-cta" onClick={() => setPanel('training')}>
          Train
        </button>
      </div>
    </section>
  );
}

function ProgressPanel({ setPanel }: { setPanel: (p: MenuPanel) => void }) {
  const progress = useGameStore((s) => s.progress);
  const reset = useGameStore((s) => s.resetProgress);
  const idx = BELT_ORDER.indexOf(progress.belt);
  const nb = nextBelt(progress.belt);
  const reqs = nb ? BELT_REQUIREMENTS[nb] : [];
  const doneN = reqs.filter((r) => r.done(progress)).length;
  return (
    <section className="progress-panel">
      <ol className="belt-track" aria-label="Belts">
        {BELT_ORDER.map((b, i) => (
          <li key={b} className={i < idx ? 'earned' : i === idx ? 'current' : 'locked'} aria-current={i === idx ? 'step' : undefined}>
            <span className="knot" style={{ ['--belt' as string]: BELT_COLORS[b] }} aria-hidden />
            <strong>{cap(b)}</strong>
            <small>{i < idx ? 'Earned' : i === idx ? 'Current' : 'Locked'}</small>
          </li>
        ))}
      </ol>
      {nb ? (
        <>
          <h3>
            Toward {cap(nb)} belt <span className="count">{doneN} / {reqs.length}</span>
          </h3>
          <div className="meter" aria-hidden>
            <b style={{ width: `${(doneN / reqs.length) * 100}%`, background: BELT_COLORS[nb] }} />
          </div>
          <ul className="reqs" data-testid="belt-reqs">
            {reqs.map((r) => {
              const ok = r.done(progress);
              return (
                <li key={r.id} className={ok ? 'ok' : ''}>
                  <span className="tick" aria-label={ok ? 'done' : 'not done'}>
                    {ok ? '✓' : ''}
                  </span>
                  <span>{r.label}</span>
                  <span className="st">{r.status(progress)}</span>
                </li>
              );
            })}
          </ul>
          <button className="ghost-cta" onClick={() => setPanel('training')}>
            Continue training
          </button>
        </>
      ) : (
        <p className="lede">Green belt reached: every milestone in this version is complete.</p>
      )}
      <h3>Record</h3>
      <div className="records">
        <div>
          <b>{progress.matches.played}</b>
          <span>matches</span>
        </div>
        <div>
          <b>{progress.matches.won}</b>
          <span>wins</span>
        </div>
        <div>
          <b>{progress.completed.length}</b>
          <span>activities done</span>
        </div>
      </div>
      <p className="muted small">Belts are gameplay milestones inspired by Taekwondo training, not official grading. Progress is saved in this browser only.</p>
      <button
        className="ghost small"
        onClick={() => {
          if (confirm('Reset belt, records and match history? Your fighter choice and settings are kept.')) reset();
        }}
      >
        Reset progress
      </button>
    </section>
  );
}

function OptionsPanel({ panel, setPanel }: { panel: MenuPanel; setPanel: (p: MenuPanel) => void }) {
  return (
    <section className="options">
      <Seg
        label="Section"
        value={panel === 'controls' ? 'controls' : 'settings'}
        onChange={(v) => setPanel(v)}
        options={[
          ['settings', 'Settings'],
          ['controls', 'Controls'],
        ]}
      />
      {panel === 'controls' ? <ControlsHelp /> : <SettingsPanel />}
    </section>
  );
}

function ControlsHelp() {
  return (
    <div className="controls-help">
      <h3>Keyboard</h3>
      <ul>
        <li>
          <kbd>W A S D</kbd> footwork (camera-relative; <kbd>D</kbd> steps toward the opponent in the default view) · <kbd>Shift</kbd> dash (no direction = back-step)
        </li>
        <li>
          <kbd>J</kbd> punch · <kbd>K</kbd> front kick · <kbd>L</kbd> roundhouse · <kbd>U</kbd> side kick · <kbd>I</kbd> back kick (turning)
        </li>
        <li>
          Hold <kbd>F</kbd> + <kbd>K</kbd>/<kbd>L</kbd>/<kbd>U</kbd> for the <b>lead-leg</b> kicks · hold <kbd>E</kbd> to aim at the head · hold <kbd>Space</kbd> to guard
        </li>
        <li>
          <kbd>Q</kbd> switch stance · <kbd>Tab</kbd> lock-on · mouse drag / wheel camera · <kbd>Esc</kbd> pause
        </li>
      </ul>
      <h3>Touch — Compact (default)</h3>
      <ul>
        <li>Thumb anywhere on your movement side: floating joystick</li>
        <li>
          <b>Kick</b>: tap to throw the selected kick. Slide from it (or hold) to open the wheel: <b>inner ring</b> lead-leg kicks, <b>outer ring</b> rear-leg Front / Round / Side / Back,
          past the dashed ring = head. The choice is remembered.
        </li>
        <li>
          Hold <b>Guard</b> · <b>Dash</b> · <b>Punch</b> · <b>⇄</b> switch stance · <b>Body/Head</b> chip · ◎ lock-on · ❚❚ pause · drag anywhere else to orbit the camera
        </li>
      </ul>
      <h3>Touch — Classic</h3>
      <ul>
        <li>One button per technique, plus Guard, Dash, Body/Head, a Rear/Lead chip and ⇄. Opacity, size and left-handed layout are in Settings.</li>
      </ul>
      <h3>Gamepad</h3>
      <ul>
        <li>Left stick move · right stick camera · X punch · A front · B round · Y side · RB back · D-pad ↑ → ← lead-leg kicks</li>
        <li>LB guard · RT head target · LT dash · R3 switch stance · Start pause</li>
      </ul>
    </div>
  );
}
