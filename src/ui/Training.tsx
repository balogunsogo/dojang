import type { GameSession } from '../game/GameSession';
import { BELT_REQUIREMENTS, nextBelt, type Progress } from '../game/progress/progress';
import { ACTIVITIES, activityById } from '../game/training/activities';
import { useGameStore } from '../store/useGameStore';
import { PrimaryButton, QuietButton, useGamepadNav } from './kit';
import { PromotionNote } from './Overlays';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Compact top bar for training: activity, objective, clock, accuracy, combo, target. */
export function TrainingHudView() {
  const h = useGameStore((s) => s.trainingHud);
  const toasts = useGameStore((s) => s.toasts);
  const session = typeof window !== 'undefined' ? window.__dojang?.session : undefined;
  if (!h) return null;
  return (
    <div className="hud training" data-testid="training-hud">
      <div className="hud-top train-bar">
        <div className="train-title">
          <span className="kind">{h.kind === 'practice' ? 'Practice' : h.kind === 'challenge' ? 'Challenge' : 'Drill'}</span>
          <span className="name">{h.title}</span>
        </div>
        <div className="train-goal" data-testid="training-progress">
          {h.progress}
        </div>
        {h.secondsLeft !== null && (
          <div className={`clock ${h.secondsLeft <= 10 ? 'warn' : ''}`}>
            <span className="time">{h.secondsLeft}</span>
          </div>
        )}
        <div className="train-stats">
          <span>Acc {pct(h.accuracy)}</span>
          {h.combo > 1 && <span className="combo">×{h.combo}</span>}
        </div>
        {h.kind === 'practice' && session && (
          <button className="tbtn finish" onPointerDown={() => session.finishTraining()} data-testid="finish-practice">
            Finish
          </button>
        )}
      </div>
      <div className="train-hint">
        {h.nextStep ? (
          <>
            Next: <b>{h.nextStep}</b>
          </>
        ) : h.target ? (
          <>
            Target: <b className={`tgt ${h.target}`}>{h.target === 'head' ? 'HEAD (hold E / Head)' : 'BODY'}</b>
          </>
        ) : (
          'Any technique on the target'
        )}
      </div>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <div className="t">{t.text}</div>
            {t.sub && <div className="s">{t.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact requirements checklist for the next belt (summary screen). */
export function BeltRequirements({ progress }: { progress: Progress }) {
  const nb = nextBelt(progress.belt);
  if (!nb) return <p className="caption">Green belt reached: every milestone in this version is complete.</p>;
  return (
    <ul className="reqs compact" data-testid="belt-reqs" aria-label={`Toward ${nb} belt`}>
      {BELT_REQUIREMENTS[nb].map((r) => {
        const ok = r.done(progress);
        return (
          <li key={r.id} className={ok ? 'ok' : ''}>
            <span className="req-label">{r.label}</span>
            <span className="req-status">{ok ? 'Done' : r.status(progress)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** End-of-activity summary: what happened, one tip, what unlocks next. */
export function TrainingSummary({ session }: { session: GameSession }) {
  const r = useGameStore((s) => s.trainingResult);
  const progress = useGameStore((s) => s.progress);
  const startTraining = useGameStore((s) => s.startTraining);
  const toMenu = useGameStore((s) => s.toMenu);
  const clearPromotion = useGameStore((s) => s.clearPromotion);
  useGamepadNav(r ? toMenu : undefined);
  if (!r) return null;
  const a = activityById(r.activity);
  const rec = progress.records[r.activity];
  const idx = ACTIVITIES.findIndex((x) => x.id === a.id);
  const next = ACTIVITIES[idx + 1];
  const nb = nextBelt(progress.belt);
  const tip =
    r.attempts === 0
      ? 'Throw some techniques at the target.'
      : r.accuracy < 0.5
        ? 'Many techniques missed: step closer before kicking, and wait for the partner to be in range.'
        : r.accuracy < 0.75
          ? 'Good. Tighten your range: stop just outside the partner, then kick.'
          : 'Excellent accuracy.';
  const kind = a.kind === 'practice' ? 'Practice' : a.kind === 'challenge' ? 'Challenge' : 'Drill';
  return (
    <div className="overlay match-panel" role="dialog" aria-modal="true" aria-label="Training summary" data-testid="training-summary">
      <div className="panel-col">
        <p className="context">
          Training · {kind} · {a.title}
        </p>
        <h1 className="title">{a.kind === 'practice' ? 'Practice summary' : r.completed ? 'Complete' : "Time's up"}</h1>
        <div className="panel-scroll">
          <dl className="facts results">
            <div>
              <dt>Techniques</dt>
              <dd>{r.attempts}</dd>
            </div>
            <div>
              <dt>Valid hits</dt>
              <dd>{r.hits}</dd>
            </div>
            <div>
              <dt>Accuracy</dt>
              <dd>{pct(r.accuracy)}</dd>
            </div>
            <div>
              <dt>Best combo</dt>
              <dd>{r.bestCombo}</dd>
            </div>
            {r.time !== null && (
              <div>
                <dt>Time</dt>
                <dd>{r.time.toFixed(1)} s</dd>
              </div>
            )}
            {rec && (
              <div>
                <dt>Best accuracy</dt>
                <dd>{pct(rec.bestAccuracy)}</dd>
              </div>
            )}
          </dl>
          <p className="body-copy">{tip}</p>
          <PromotionNote />
          {nb && <h2 className="group-label">Toward {nb} belt</h2>}
          <BeltRequirements progress={progress} />
        </div>
        <div className="actions">
          <PrimaryButton
            hint="Enter"
            autoFocus
            testid="retry-activity"
            onClick={() => {
              clearPromotion();
              session.rematch();
            }}
          >
            Retry
          </PrimaryButton>
          <div className="foot-row">
            {next && (
              <QuietButton onClick={() => startTraining(next.id)} testid="next-activity">
                Next: {next.title}
              </QuietButton>
            )}
            <QuietButton
              onClick={() => {
                toMenu();
                useGameStore.getState().setMenuPanel('training');
              }}
            >
              Training menu
            </QuietButton>
            <QuietButton onClick={toMenu}>Main menu</QuietButton>
          </div>
        </div>
      </div>
    </div>
  );
}
