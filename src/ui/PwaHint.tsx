import { useEffect, useState } from 'react';
import { useGameStore } from '../store/useGameStore';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.matchMedia?.('(display-mode: fullscreen)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Optional "play fullscreen" hint. Installing is never required: the game
 * runs the same in the browser. iOS Safari has no install prompt API, so it
 * gets instructions; Chromium browsers get an Install button when offered.
 */
export function PwaHint() {
  const dismissed = useGameStore((s) => s.settings.pwaHintDismissed);
  const update = useGameStore((s) => s.updateSettings);
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  if (dismissed || isStandalone()) return null;
  const ios = isIOS();
  if (!ios && !evt) return null;
  return (
    <div className="pwa-hint" data-testid="pwa-hint">
      <span>
        {ios ? (
          <>
            Play without the browser bars: tap <b>Share</b> → <b>Add to Home Screen</b>. Optional.
          </>
        ) : (
          <>Install DOJANG to play fullscreen. Optional.</>
        )}
      </span>
      {evt && (
        <button className="primary" onClick={() => evt.prompt().finally(() => setEvt(null))}>
          Install
        </button>
      )}
      <button onClick={() => update({ pwaHintDismissed: true })} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
