import { useEffect, useState } from 'react';

/**
 * Friendly portrait prompt. We do not depend on screen.orientation.lock()
 * (unsupported on iOS Safari); we only try it where available and otherwise
 * ask the player to rotate, with an option to continue in portrait.
 */
export function RotatePrompt() {
  const [portrait, setPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener('change', update);
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    so?.lock?.('landscape').catch(() => {
      /* not supported / not fullscreen: the prompt covers it */
    });
    return () => mq.removeEventListener('change', update);
  }, []);
  if (!portrait || dismissed) return null;
  return (
    <div className="overlay rotate" data-testid="rotate-prompt">
      <div className="panel">
        <div className="phone-icon" aria-hidden>
          ⟳
        </div>
        <h2>Turn your device sideways</h2>
        <p>Sparring plays best in landscape: movement on the left thumb, techniques on the right.</p>
        <button onClick={() => setDismissed(true)}>Continue in portrait</button>
      </div>
    </div>
  );
}
