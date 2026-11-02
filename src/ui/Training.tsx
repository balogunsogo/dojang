import type { GameSession } from '../game/GameSession';
import { BELT_REQUIREMENTS, nextBelt, type Progress } from '../game/progress/progress';
import { BELT_COLORS } from '../game/render/characterFactory';
import { ACTIVITIES, activityById } from '../game/training/activities';
import { useGameStore } from '../store/useGameStore';

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
      <div className="toasts">
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

/** Requirements checklist for the next belt. */
export function BeltRequirements({ progress }: { progress: Progress }) {
  const nb = nextBelt(progress.belt);
  if (!nb) return <p className="muted">Green belt reached: every milestone in this version is complete.</p>;
  return (
    <ul className="reqs" data-testid="belt-reqs">
      {BELT_REQUIREMENTS[nb].map((r) => {
        const ok = r.done(progress);
        return (
          <li key={r.id} className={ok ? 'ok' : ''}>
            <span className="tick" aria-hidden>
              {ok ? '✓' : '○'}
            </span>
            <span>{r.label}</span>
            <span className="st">{r.status(progress)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function BeltChip({ belt }: { belt: string }) {
  return (
    <span className="belt-chip" style={{ ['--belt' as string]: BELT_COLORS[belt as keyof typeof BELT_COLORS] }}>
      {belt[0].toUpperCase() + belt.slice(1)} belt
    </span>
  );
}

/** End-of-activity summary with what to improve and what unlocks next. */
export function TrainingSummary({ session }: { session: GameSession }) {
  const r = useGameStore((s) => s.trainingResult);
  const progress = useGameStore((s) => s.progress);
  const startTraining = useGameStore((s) => s.startTraining);
  const toMenu = useGameStore((s) => s.toMenu);
  const promotion = useGameStore((s) => s.promotion);
  if (!r || promotion) return null;
  const a = activityById(r.activity);
  const rec = progress.records[r.activity];
  const idx = ACTIVITIES.findIndex((x) => x.id === a.id);
  const next = ACTIVITIES[idx + 1];
  const tip =
    r.attempts === 0
      ? 'Throw some techniques at the target!'
      : r.accuracy < 0.5
        ? 'Many techniques missed: step closer before kicking, and wait for the partner to be in range.'
        : r.accuracy < 0.75
          ? 'Good. Tighten your range: stop just outside the partner, then kick.'
          : 'Excellent accuracy.';
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Training summary" data-testid="training-summary">
      <div className="panel wide">
        <h2 className={r.completed ? 'win' : ''}>{a.kind === 'practice' ? 'Practice summary' : r.completed ? 'Complete!' : "Time's up"}</h2>
        <p className="muted">{a.title}</p>
        <div className="stat-grid">
          <div>
            <b>{r.attempts}</b>
            <span>techniques</span>
          </div>
          <div>
            <b>{r.hits}</b>
            <span>valid hits</span>
          </div>
          <div>
            <b>{pct(r.accuracy)}</b>
            <span>accuracy</span>
          </div>
          <div>
            <b>{r.bestCombo}</b>
            <span>best combo</span>
          </div>
          {r.time !== null && (
            <div>
              <b>{r.time.toFixed(1)} s</b>
              <span>time</span>
            </div>
          )}
          {rec && (
            <div>
              <b>{pct(rec.bestAccuracy)}</b>
              <span>best accuracy</span>
            </div>
          )}
        </div>
        <p className="tip">{tip}</p>
        <h3>Next belt</h3>
        <BeltRequirements progress={progress} />
        <div className="row">
          <button className="primary" onClick={() => session.rematch()} data-testid="retry-activity" autoFocus>
            Retry
          </button>
          {next && (
            <button onClick={() => startTraining(next.id)} data-testid="next-activity">
              Next: {next.title}
            </button>
          )}
          <button
            onClick={() => {
              toMenu();
              useGameStore.getState().setMenuPanel('training');
            }}
          >
            Training menu
          </button>
          <button onClick={toMenu}>Main menu</button>
        </div>
      </div>
    </div>
  );
}

/** Shown once when a belt is earned. */
export function PromotionOverlay() {
  const belt = useGameStore((s) => s.promotion);
  const clear = useGameStore((s) => s.clearPromotion);
  if (!belt) return null;
  return (
    <div className="overlay promo" role="dialog" aria-modal="true" aria-label="Belt promotion" data-testid="promotion">
      <div className="panel">
        <div className="belt-band" style={{ background: BELT_COLORS[belt] }} aria-hidden />
        <h2 className="win">Promoted!</h2>
        <p>
          You earned the <b>{belt[0].toUpperCase() + belt.slice(1)} belt</b>. It now appears on your dobok.
        </p>
        <p className="muted small">A gameplay milestone inspired by Taekwondo training, not an official grading.</p>
        <button className="primary" onClick={clear} autoFocus data-testid="promotion-ok">
          Continue
        </button>
      </div>
    </div>
  );
}
