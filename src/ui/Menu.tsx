import type { Difficulty } from '../game/ai/AIController';
import { audio } from '../game/audio/AudioEngine';
import { BELT_ORDER, BELT_REQUIREMENTS } from '../game/progress/progress';
import { BELT_COLORS, CHARACTERS, CORNER_COLORS, type CharacterId } from '../game/render/characterFactory';
import { isTouchDevice } from '../game/render/quality';
import { ACTIVITIES } from '../game/training/activities';
import { type GameMode, type MenuPanel, useGameStore } from '../store/useGameStore';
import { PwaHint } from './PwaHint';
import { SettingsPanel } from './SettingsPanel';
import { BeltChip, BeltRequirements } from './Training';

const DIFFS: { id: Difficulty; label: string; note: string; belt: keyof typeof BELT_COLORS }[] = [
  { id: 'easy', label: 'White belt', note: 'Slow reactions, predictable, simple combos', belt: 'white' },
  { id: 'normal', label: 'Red belt', note: 'Better spacing and blocking, some counters', belt: 'red' },
  { id: 'hard', label: 'Black belt', note: 'Reads habits, counters, plays the score', belt: 'black' },
];

function goFullscreenOnTouch() {
  if (isTouchDevice() && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => undefined);
  }
}

/** Main menu: home + sub-panels. Every panel is a plain, keyboard-navigable form. */
export function Menu() {
  const panel = useGameStore((s) => s.menuPanel);
  const setPanel = (p: MenuPanel) => {
    audio.click();
    useGameStore.getState().setMenuPanel(p);
  };
  return (
    <div className="menu">
      <div className="menu-bg" aria-hidden />
      <div className="menu-inner">
        {panel === 'home' ? <Home setPanel={setPanel} /> : <Sub panel={panel} setPanel={setPanel} />}
        <p className="foot muted">
          A game inspired by Taekwondo — not an official rules reference or grading. Character: CC0 Quaternius mannequin; techniques: original procedural animation.
        </p>
      </div>
    </div>
  );
}

function FighterCard({ id, selected, onSelect }: { id: CharacterId; selected?: boolean; onSelect?: () => void }) {
  const c = CHARACTERS[id];
  const progress = useGameStore((s) => s.progress);
  const inner = (
    <>
      <span className="fc-figure" style={{ ['--skin' as string]: c.skin, ['--gear' as string]: CORNER_COLORS.chung, ['--belt' as string]: BELT_COLORS[progress.belt] }} aria-hidden>
        <i className="head" />
        <i className="body" />
        <i className="belt" />
      </span>
      <span className="fc-text">
        <strong>{c.name}</strong>
        <span className="hangul">{c.hangul}</span>
        <span className="muted">{c.blurb}</span>
        <span className="fc-stats">
          Power {Math.round(c.stats.power * 100)} · Speed {Math.round(c.stats.speed * 100)} · Recovery {Math.round(c.stats.staminaRegen * 100)}
        </span>
      </span>
    </>
  );
  return onSelect ? (
    <button className={`fighter-card ${selected ? 'on' : ''}`} onClick={onSelect} role="radio" aria-checked={!!selected} data-testid={`fighter-${id}`}>
      {inner}
    </button>
  ) : (
    <div className="fighter-card" data-testid="current-fighter">
      {inner}
    </div>
  );
}

function Home({ setPanel }: { setPanel: (p: MenuPanel) => void }) {
  const progress = useGameStore((s) => s.progress);
  const saveFailed = useGameStore((s) => s.saveFailed);
  const startMode = (m: GameMode) => {
    useGameStore.setState({ mode: m });
    setPanel('spar');
  };
  return (
    <>
      <header className="hero">
        <h1>
          DOJANG <span className="hangul">도장</span>
        </h1>
        <p className="tag">Taekwondo sparring &amp; training</p>
      </header>
      <PwaHint />
      <div className="home-grid">
        <section className="home-fighter" aria-label="Your fighter">
          <FighterCard id={progress.fighter} />
          <div className="row">
            <BeltChip belt={progress.belt} />
            <button className="ghost small" onClick={() => setPanel('fighter')} data-testid="open-fighter">
              Change fighter
            </button>
          </div>
        </section>
        <nav className="home-actions" aria-label="Game modes">
          <button className="mode-btn primary" onClick={() => startMode('arcade')} data-testid="mode-arcade">
            <strong>Arcade Sparring</strong>
            <span>Health bars · K.O. or time · best of 3</span>
          </button>
          <button className="mode-btn" onClick={() => startMode('competitive')} data-testid="mode-competitive">
            <strong>Competitive Sparring</strong>
            <span>WT-style points · gam-jeom · best of 3</span>
          </button>
          <button className="mode-btn" onClick={() => setPanel('training')} data-testid="mode-training">
            <strong>Training</strong>
            <span>Targets, challenges and combination drills</span>
          </button>
          <div className="row small-actions">
            <button onClick={() => setPanel('progress')} data-testid="open-progress">
              Progression
            </button>
            <button onClick={() => setPanel('settings')} data-testid="open-settings">
              Settings
            </button>
            <button onClick={() => setPanel('controls')}>Controls</button>
          </div>
        </nav>
      </div>
      {saveFailed && <p className="warn-line">Progress could not be saved in this browser (private mode or storage full). It will be lost on reload.</p>}
    </>
  );
}

function Sub({ panel, setPanel }: { panel: MenuPanel; setPanel: (p: MenuPanel) => void }) {
  const mode = useGameStore((s) => s.mode);
  const title: Record<MenuPanel, string> = {
    home: '',
    spar: mode === 'competitive' ? 'Competitive Sparring' : 'Arcade Sparring',
    training: 'Training',
    fighter: 'Choose your fighter',
    progress: 'Progression',
    settings: 'Settings',
    controls: 'Controls',
  };
  return (
    <div className="sub">
      <header className="sub-head">
        <button className="back" onClick={() => setPanel('home')} aria-label="Back to main menu" data-testid="menu-back">
          ←
        </button>
        <h2>{title[panel]}</h2>
      </header>
      {panel === 'spar' && <SparSetup />}
      {panel === 'training' && <TrainingMenu />}
      {panel === 'fighter' && <FighterSelect />}
      {panel === 'progress' && <ProgressPanel />}
      {panel === 'settings' && <SettingsPanel />}
      {panel === 'controls' && <ControlsHelp />}
    </div>
  );
}

function SparSetup() {
  const mode = useGameStore((s) => s.mode);
  const settings = useGameStore((s) => s.settings);
  const update = useGameStore((s) => s.updateSettings);
  const startMatch = useGameStore((s) => s.startMatch);
  const start = (d: Difficulty) => {
    audio.unlock();
    goFullscreenOnTouch();
    startMatch(d, mode === 'competitive' ? 'competitive' : 'arcade');
  };
  return (
    <section>
      <p className="muted">
        {mode === 'competitive'
          ? 'Score valid techniques: punch 1, body kick 2, head kick 3, turning body 4, turning head 6. Stay inside the boundary; gam-jeom give your opponent points.'
          : 'Knock your opponent out or have more health when time runs out. Best of three rounds.'}
      </p>
      {mode === 'competitive' && (
        <label className="set-row inline">
          <span>Round length</span>
          <select value={settings.compRoundSeconds} onChange={(e) => update({ compRoundSeconds: Number(e.target.value) as 60 | 90 | 120 })} data-testid="round-length">
            <option value={60}>60 s</option>
            <option value={90}>90 s (default)</option>
            <option value={120}>120 s (WT senior standard)</option>
          </select>
        </label>
      )}
      <h3>Opponent</h3>
      <div className="diffs">
        {DIFFS.map((d) => (
          <button key={d.id} className="diff" onClick={() => start(d.id)} data-testid={`start-${d.id}`}>
            <span className="belt-dot" style={{ background: BELT_COLORS[d.belt] }} aria-hidden />
            <strong>{d.label}</strong>
            <span>{d.note}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TrainingMenu() {
  const progress = useGameStore((s) => s.progress);
  const startTraining = useGameStore((s) => s.startTraining);
  const go = (id: string) => {
    audio.unlock();
    goFullscreenOnTouch();
    startTraining(id);
  };
  const groups: [string, string][] = [
    ['practice', 'Free practice'],
    ['challenge', 'Target challenges'],
    ['drill', 'Combination drills'],
  ];
  return (
    <section>
      <p className="muted">Train with a partner holding the target. Targets use the same contact rules as Competitive: a clean, well-extended technique on the right zone.</p>
      {groups.map(([kind, label]) => (
        <div key={kind}>
          <h3>{label}</h3>
          <div className="act-list">
            {ACTIVITIES.filter((a) => a.kind === kind).map((a) => {
              const rec = progress.records[a.id];
              const done = progress.completed.includes(a.id);
              return (
                <button key={a.id} className={`act ${done ? 'done' : ''}`} onClick={() => go(a.id)} data-testid={`activity-${a.id}`}>
                  <strong>
                    {done && <span aria-label="completed">✓ </span>}
                    {a.title}
                  </strong>
                  <span>{a.brief}</span>
                  {rec && (
                    <span className="rec">
                      Best: {a.kind === 'drill' ? `${rec.bestScore} reps` : `${rec.bestScore} hits`}
                      {rec.bestAccuracy > 0 ? ` · ${Math.round(rec.bestAccuracy * 100)}%` : ''}
                      {rec.bestTime !== null ? ` · ${rec.bestTime.toFixed(1)} s` : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

function FighterSelect() {
  const progress = useGameStore((s) => s.progress);
  const setFighter = useGameStore((s) => s.setFighter);
  const scheme = useGameStore((s) => s.settings.controlScheme);
  return (
    <section>
      <div className="fighter-list" role="radiogroup" aria-label="Fighter">
        {(Object.keys(CHARACTERS) as CharacterId[]).map((id) => (
          <FighterCard key={id} id={id} selected={progress.fighter === id} onSelect={() => setFighter(id)} />
        ))}
      </div>
      <p className="muted">
        You fight in the blue (chung) corner; your opponent is the other fighter. Your belt: <BeltChip belt={progress.belt} /> · Touch layout: {scheme === 'compact' ? 'Compact' : 'Classic'} (change in Settings).
      </p>
    </section>
  );
}

function ProgressPanel() {
  const progress = useGameStore((s) => s.progress);
  const reset = useGameStore((s) => s.resetProgress);
  const idx = BELT_ORDER.indexOf(progress.belt);
  return (
    <section>
      <ol className="belt-ladder" aria-label="Belts">
        {BELT_ORDER.map((b, i) => (
          <li key={b} className={i < idx ? 'past' : i === idx ? 'now' : 'future'}>
            <span className="band" style={{ background: BELT_COLORS[b] }} aria-hidden />
            {b[0].toUpperCase() + b.slice(1)}
            {i === idx && <small> — current</small>}
          </li>
        ))}
      </ol>
      <h3>Next milestone</h3>
      <BeltRequirements progress={progress} />
      {BELT_ORDER.slice(idx + 2).map((b) => (
        <p key={b} className="muted small">
          Then {b}: {BELT_REQUIREMENTS[b as 'green'].length} more milestones.
        </p>
      ))}
      <h3>Record</h3>
      <p>
        Matches {progress.matches.played} · won {progress.matches.won} · training activities completed {progress.completed.length}
      </p>
      <p className="muted small">Belts are gameplay milestones inspired by Taekwondo training, not official grading requirements. Progress is saved in this browser only.</p>
      <button
        className="ghost"
        onClick={() => {
          if (confirm('Reset belt, records and match history? Your fighter choice and settings are kept.')) reset();
        }}
      >
        Reset progress
      </button>
    </section>
  );
}

function ControlsHelp() {
  return (
    <section className="controls-help">
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
    </section>
  );
}
