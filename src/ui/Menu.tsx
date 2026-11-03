import { useState } from 'react';
import type { Difficulty } from '../game/ai/AIController';
import { audio } from '../game/audio/AudioEngine';
import { BELT_ORDER, BELT_REQUIREMENTS, nextBelt, type Progress } from '../game/progress/progress';
import { BELT_COLORS, CHARACTERS, type CharacterId } from '../game/render/characterFactory';
import { isTouchDevice } from '../game/render/quality';
import { ACTIVITIES, activityById, type Activity } from '../game/training/activities';
import { type MenuPanel, useGameStore } from '../store/useGameStore';
import { BeltMarker, GroupLabel, Hints, Menu as MenuList, type MenuEntry, OptionGroup, OptionRow, PrimaryButton, QuietButton, ScreenShell, Segmented, useGamepadNav, Wordmark } from './kit';
import { MenuBackdrop, prefersReducedMotion } from './MenuBackdrop';
import { PwaHint } from './PwaHint';
import { ControlsReference, SettingsPanel } from './SettingsPanel';

const DIFFS: { id: Difficulty; label: string; note: string; belt: keyof typeof BELT_COLORS }[] = [
  { id: 'easy', label: 'White belt', note: 'Slow reactions, predictable, simple combinations', belt: 'white' },
  { id: 'normal', label: 'Red belt', note: 'Better spacing and blocking, some counters', belt: 'red' },
  { id: 'hard', label: 'Black belt', note: 'Reads your habits, counters, plays the score', belt: 'black' },
];

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

/** Fade the menu out before play starts (skipped under reduced motion). */
function useLeave(): [boolean, (fn: () => void) => void] {
  const [leaving, setLeaving] = useState(false);
  const leave = (fn: () => void) => {
    audio.unlock();
    audio.start();
    goFullscreenOnTouch();
    if (prefersReducedMotion()) return fn();
    setLeaving(true);
    window.setTimeout(fn, 200);
  };
  return [leaving, leave];
}

/**
 * Main menu shell: the live dojang at z 0, one scrim, one edge. Screens
 * swap inside the shell so the scrim and edge never move.
 */
export function Menu() {
  const panel = useGameStore((s) => s.menuPanel);
  const [leaving, leave] = useLeave();
  const go = (p: MenuPanel) => useGameStore.getState().setMenuPanel(p);
  const home = () => {
    audio.back();
    go('home');
  };
  useGamepadNav(panel === 'home' ? undefined : home);
  return (
    <div className={`menu-root ${panel === 'home' ? 'at-home' : 'at-screen'} ${leaving ? 'leaving' : ''}`}>
      <MenuBackdrop />
      <div className="scrim" aria-hidden />
      <main className="menu-layer" key={panel}>
        {panel === 'home' && <Home go={go} />}
        {panel === 'spar' && <SparSetup onBack={home} leave={leave} />}
        {panel === 'training' && <TrainingSelect onBack={home} leave={leave} />}
        {panel === 'fighter' && <FighterSelect onBack={home} go={go} />}
        {panel === 'progress' && <BeltProgression onBack={home} go={go} />}
        {(panel === 'settings' || panel === 'controls') && <SettingsScreen onBack={home} />}
      </main>
    </div>
  );
}

/* ── Home ──────────────────────────────────────────────────────────── */
function Home({ go }: { go: (p: MenuPanel) => void }) {
  const progress = useGameStore((s) => s.progress);
  const saveFailed = useGameStore((s) => s.saveFailed);
  const c = CHARACTERS[progress.fighter];
  const started = progress.completed.length > 0 || Object.keys(progress.records).length > 0;
  const rec = recommendedActivity(progress);
  const nb = nextBelt(progress.belt);
  const reqs = nb ? BELT_REQUIREMENTS[nb] : [];
  const spar = (m: 'arcade' | 'competitive') => {
    useGameStore.setState({ mode: m });
    go('spar');
  };
  const items: MenuEntry[] = [
    {
      id: 'training',
      label: started ? 'Continue training' : 'Training',
      description: started ? `Next: ${rec.title}` : 'Target practice, timed challenges and combination drills',
      testid: 'mode-training',
      onSelect: () => go('training'),
    },
    { id: 'arcade', label: 'Arcade sparring', description: 'Health-based · knock out or lead on time · best of three', testid: 'mode-arcade', onSelect: () => spar('arcade') },
    { id: 'competitive', label: 'Competitive sparring', description: 'WT-style points and gam-jeom · best of three', testid: 'mode-competitive', onSelect: () => spar('competitive') },
    { id: 'fighter', tier: 2, label: 'Choose fighter', description: `${c.name}`, testid: 'open-fighter', onSelect: () => go('fighter') },
    {
      id: 'progress',
      tier: 2,
      label: 'Belt progression',
      description: nb ? `${reqs.filter((r) => r.done(progress)).length} of ${reqs.length} toward ${nb} belt` : 'Every milestone complete',
      testid: 'open-progress',
      onSelect: () => go('progress'),
    },
    { id: 'settings', tier: 2, label: 'Settings & controls', description: 'Touch layout, camera, comfort, audio, graphics', testid: 'open-settings', onSelect: () => go('settings') },
  ];
  return (
    <div className="home">
      <header className="home-head">
        <Wordmark />
        <p className="tagline">Train with discipline. Spar with respect.</p>
      </header>
      <MenuList label="Main menu" items={items} className="home-menu" />
      <div className="home-notes">
        <PwaHint />
        {saveFailed && (
          <p className="feedback warn" role="status">
            Progress can’t be saved in this browser (private mode or storage full) — it will be lost on reload.
          </p>
        )}
      </div>
      <footer className="home-foot">
        <p className="player" data-testid="current-fighter">
          <strong>{c.name}</strong>{' '}
          <span lang="ko" className="ko">
            {c.hangul}
          </span>
          <BeltMarker belt={progress.belt} />
        </p>
        <Hints
          items={[
            ['↑↓', 'Select'],
            ['Enter', 'Confirm'],
          ]}
        />
      </footer>
    </div>
  );
}

/* ── Sparring setup ────────────────────────────────────────────────── */
function SparSetup({ onBack, leave }: { onBack(): void; leave(fn: () => void): void }) {
  const mode = useGameStore((s) => s.mode);
  const difficulty = useGameStore((s) => s.difficulty);
  const rounds = useGameStore((s) => s.settings.compRoundSeconds);
  const update = useGameStore((s) => s.updateSettings);
  const startMatch = useGameStore((s) => s.startMatch);
  const [opp, setOpp] = useState<Difficulty>(difficulty);
  const comp = mode === 'competitive';
  const start = () => leave(() => startMatch(opp, comp ? 'competitive' : 'arcade'));
  return (
    <ScreenShell
      title="Sparring"
      titleId="t-spar"
      onBack={onBack}
      footer={
        <PrimaryButton onClick={start} hint="Enter" testid="start-match">
          Start match
        </PrimaryButton>
      }
    >
      <Segmented
        label="Rules"
        testid="rules"
        value={comp ? 'competitive' : 'arcade'}
        onChange={(m) => useGameStore.setState({ mode: m })}
        options={[
          ['arcade', 'Arcade'],
          ['competitive', 'Competitive'],
        ]}
      />
      <p className="body-copy">
        {comp
          ? 'Score with clean techniques: punch 1, body kick 2, head kick 3, turning body 4, turning head 6. Stay inside the boundary — each gam-jeom gives your opponent a point. Win two of three rounds; tied rounds go to the tie-break criteria.'
          : 'Land clean techniques to drain your opponent’s health. Knock out, or lead on health when time runs out. Win two of three rounds.'}
      </p>
      <GroupLabel>Opponent</GroupLabel>
      <OptionGroup label="Opponent">
        {DIFFS.map((d) => (
          <OptionRow
            key={d.id}
            group="opponent"
            name={d.id}
            checked={opp === d.id}
            onSelect={() => setOpp(d.id)}
            marker={<BeltMarker belt={d.belt} label={false} />}
            title={d.label}
            description={d.note}
            testid={`opp-${d.id}`}
          />
        ))}
      </OptionGroup>
      {comp && (
        <>
          <GroupLabel>Round length</GroupLabel>
          <Segmented
            label="Round length"
            testid="round"
            value={rounds}
            onChange={(v) => update({ compRoundSeconds: v })}
            options={[
              [60, '1:00'],
              [90, '1:30'],
              [120, '2:00'],
            ]}
          />
          <p className="caption">1:30 is the default; 2:00 is the WT senior standard.</p>
        </>
      )}
    </ScreenShell>
  );
}

/* ── Training ──────────────────────────────────────────────────────── */
function objective(a: Activity) {
  if (a.kind === 'practice') return 'Untimed';
  if (a.kind === 'challenge') return `${a.goal} valid hits in ${a.seconds} s`;
  return `${a.goal} clean repetitions${a.window ? `, ${a.window} s between steps` : ''}`;
}

function TrainingSelect({ onBack, leave }: { onBack(): void; leave(fn: () => void): void }) {
  const progress = useGameStore((s) => s.progress);
  const startTraining = useGameStore((s) => s.startTraining);
  const rec = recommendedActivity(progress);
  const [sel, setSel] = useState(rec.id);
  const a = activityById(sel);
  const r = progress.records[a.id];
  const done = progress.completed.includes(a.id);
  const groups: [Activity['kind'], string][] = [
    ['practice', 'Free practice'],
    ['challenge', 'Target challenges'],
    ['drill', 'Combination drills'],
  ];
  const verb = a.kind === 'practice' ? 'Begin practice' : a.kind === 'challenge' ? 'Begin challenge' : 'Begin drill';
  return (
    <ScreenShell
      title="Training"
      titleId="t-training"
      onBack={onBack}
      className="split"
      footer={
        <PrimaryButton onClick={() => leave(() => startTraining(a.id))} hint="Enter" testid="begin-activity">
          {verb}
        </PrimaryButton>
      }
    >
      <div className="col-list">
        {groups.map(([kind, label]) => (
          <div key={kind}>
            <GroupLabel>{label}</GroupLabel>
            <OptionGroup label={label}>
              {ACTIVITIES.filter((x) => x.kind === kind).map((x) => (
                <OptionRow
                  key={x.id}
                  group="activity"
                  name={x.id}
                  checked={sel === x.id}
                  onSelect={() => setSel(x.id)}
                  title={
                    <>
                      {x.title}
                      {progress.completed.includes(x.id) && <span className="done-mark"> · done</span>}
                    </>
                  }
                  description={objective(x)}
                  testid={`activity-${x.id}`}
                />
              ))}
            </OptionGroup>
          </div>
        ))}
      </div>
      <div className="col-detail" aria-live="polite">
        <GroupLabel>Objective</GroupLabel>
        <p className="body-copy strong">{a.brief}</p>
        <dl className="facts">
          <div>
            <dt>Goal</dt>
            <dd>{objective(a)}</dd>
          </div>
          {r && (
            <div>
              <dt>Best</dt>
              <dd>
                {a.kind === 'drill' ? `${r.bestScore} reps` : `${r.bestScore} hits`}
                {r.bestAccuracy > 0 ? ` · ${Math.round(r.bestAccuracy * 100)}% accuracy` : ''}
                {r.bestTime !== null ? ` · ${r.bestTime.toFixed(1)} s` : ''}
              </dd>
            </div>
          )}
          <div>
            <dt>Status</dt>
            <dd>{done ? 'Completed' : a.id === rec.id ? 'Recommended next' : 'Not completed yet'}</dd>
          </div>
        </dl>
        <p className="caption">Hits count only when they would score in Competitive: clean, well extended and on the right zone.</p>
      </div>
    </ScreenShell>
  );
}

/* ── Fighter ───────────────────────────────────────────────────────── */
function FighterSelect({ onBack, go }: { onBack(): void; go(p: MenuPanel): void }) {
  const progress = useGameStore((s) => s.progress);
  const setFighter = useGameStore((s) => s.setFighter);
  const c = CHARACTERS[progress.fighter];
  const stat = (v: number) => Math.round(v * 100);
  return (
    <ScreenShell
      title="Choose fighter"
      titleId="t-fighter"
      onBack={onBack}
      footer={
        <PrimaryButton onClick={() => go('spar')} hint="Enter" testid="fighter-confirm">
          Fight as {c.short}
        </PrimaryButton>
      }
    >
      <p className="body-copy">You fight in the blue Chung corner; the other fighter takes the red Hong corner.</p>
      <OptionGroup label="Fighter">
        {(Object.keys(CHARACTERS) as CharacterId[]).map((id) => (
          <OptionRow
            key={id}
            group="fighter"
            name={id}
            checked={progress.fighter === id}
            onSelect={() => setFighter(id)}
            title={
              <>
                {CHARACTERS[id].name}{' '}
                <span lang="ko" className="ko">
                  {CHARACTERS[id].hangul}
                </span>
              </>
            }
            description={CHARACTERS[id].blurb}
            testid={`fighter-${id}`}
          />
        ))}
      </OptionGroup>
      <dl className="facts stats" aria-live="polite">
        <div>
          <dt>Power</dt>
          <dd>{stat(c.stats.power)}</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{stat(c.stats.speed)}</dd>
        </div>
        <div>
          <dt>Recovery</dt>
          <dd>{stat(c.stats.staminaRegen)}</dd>
        </div>
        <div>
          <dt>Belt</dt>
          <dd>
            <BeltMarker belt={progress.belt} />
          </dd>
        </div>
      </dl>
    </ScreenShell>
  );
}

/* ── Belt progression ──────────────────────────────────────────────── */
/** Parse a requirement status like "2/4" into a fraction for the bar. */
function fraction(status: string, done: boolean) {
  if (done) return 1;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(status);
  return m ? Number(m[1]) / Number(m[2]) : 0;
}

function BeltProgression({ onBack, go }: { onBack(): void; go(p: MenuPanel): void }) {
  const progress = useGameStore((s) => s.progress);
  const reset = useGameStore((s) => s.resetProgress);
  const idx = BELT_ORDER.indexOf(progress.belt);
  const c = CHARACTERS[progress.fighter];
  return (
    <ScreenShell
      title="Belt progression"
      titleId="t-belts"
      onBack={onBack}
      footer={
        <div className="foot-row">
          <QuietButton onClick={() => go('training')}>Go to training</QuietButton>
          <QuietButton
            className="danger"
            onClick={() => {
              if (confirm('Reset belt, records and match history? Your fighter choice and settings are kept.')) reset();
            }}
          >
            Reset progress
          </QuietButton>
        </div>
      }
    >
      <p className="body-copy">
        <strong>{c.name}</strong>{' '}
        <span lang="ko" className="ko">
          {c.hangul}
        </span>{' '}
        · progress is saved on this device
      </p>
      <ol className="belt-ladder" aria-label="Belts">
        {BELT_ORDER.map((b, i) => {
          const state = i < idx ? 'earned' : i === idx ? 'current' : i === idx + 1 ? 'next' : 'locked';
          const reqs = i > 0 ? BELT_REQUIREMENTS[b as 'yellow' | 'green'] : [];
          return (
            <li key={b} className={state} aria-current={state === 'current' ? 'step' : undefined}>
              <BeltMarker belt={b} label={false} className="big" />
              <div className="belt-text">
                <span className="name">{cap(b)} belt</span>
                <span className="desc">
                  {state === 'earned' ? 'Earned' : state === 'current' ? 'Current belt' : state === 'next' ? 'Next milestone' : `Locked — reach ${BELT_ORDER[i - 1]} belt first`}
                </span>
                {state === 'next' && (
                  <ul className="reqs" data-testid="belt-reqs">
                    {reqs.map((r) => {
                      const ok = r.done(progress);
                      const st = r.status(progress);
                      return (
                        <li key={r.id} className={ok ? 'ok' : ''}>
                          <span className="req-label">{r.label}</span>
                          <span className="req-status">{ok ? 'Done' : st}</span>
                          <span className="bar" aria-hidden>
                            <i style={{ width: `${fraction(st, ok) * 100}%` }} />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="caption">
        {progress.matches.played} matches · {progress.matches.won} wins · {progress.completed.length} training activities completed. Belts are gameplay milestones inspired by Taekwondo training, not an official grading.
      </p>
    </ScreenShell>
  );
}

/* ── Settings & controls ───────────────────────────────────────────── */
function SettingsScreen({ onBack }: { onBack(): void }) {
  const panel = useGameStore((s) => s.menuPanel);
  const go = (p: MenuPanel) => useGameStore.getState().setMenuPanel(p);
  if (panel === 'controls')
    return (
      <ScreenShell title="Control reference" titleId="t-controls" onBack={() => go('settings')} backLabel="Settings" className="wide">
        <ControlsReference />
      </ScreenShell>
    );
  return (
    <ScreenShell
      title="Settings & controls"
      titleId="t-settings"
      onBack={onBack}
      className="wide"
      footer={
        <Hints
          items={[
            ['←→', 'Change'],
            ['Esc', 'Back'],
          ]}
        />
      }
    >
      <SettingsPanel onControls={() => go('controls')} />
    </ScreenShell>
  );
}
