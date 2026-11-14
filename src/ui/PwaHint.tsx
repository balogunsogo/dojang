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

/** Touch is the main way this device is used (phones and tablets, not touchscreen laptops). */
const touchFirst = () => isIOS() || /Android/i.test(navigator.userAgent) || !!window.matchMedia?.('(pointer: coarse)').matches;

/** Which add-to-home-screen steps to show. */
function platform(): 'ios' | 'samsung' | 'android' | 'touch' {
  const ua = navigator.userAgent;
  if (isIOS()) return 'ios';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Android/i.test(ua)) return 'android';
  return 'touch';
}

/**
 * Optional "play fullscreen" hint for touch-first devices (phones and
 * tablets). Installing is never required: the game runs the same in the
 * browser. Each platform gets its own steps; when the browser offers an
 * install prompt (Chromium on Android), a one-tap Install button is added.
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
  if (!touchFirst() && !evt) return null;
  const p = platform();
  return (
    <div className="pwa-hint" data-testid="pwa-hint" data-platform={p}>
      <span>
        {evt ? (
          <>Install DOJANG to play fullscreen, without the browser bars. Optional.</>
        ) : p === 'ios' ? (
          <>
            Play without the browser bars: tap <b>Share</b> → <b>Add to Home Screen</b>. Optional.
          </>
        ) : p === 'samsung' ? (
          <>
            Play without the browser bars: tap <b>≡</b> → <b>Add page to</b> → <b>Home screen</b>. Optional.
          </>
        ) : p === 'android' ? (
          <>
            Play without the browser bars: tap <b>⋮</b> → <b>Add to Home screen</b> (or <b>Install app</b>). Optional.
          </>
        ) : (
          <>Play without the browser bars: add DOJANG to your home screen from your browser's menu. Optional.</>
        )}
      </span>
      {evt && (
        <button className="btn-quiet" onClick={() => evt.prompt().finally(() => setEvt(null))}>
          Install
        </button>
      )}
      <button className="btn-quiet" onClick={() => update({ pwaHintDismissed: true })} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
