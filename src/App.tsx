import { Component, type ErrorInfo, type ReactNode, useEffect } from 'react';
import { audio } from './game/audio/AudioEngine';
import { useGameStore } from './store/useGameStore';
import { roomFromUrl, useOnlineMatchStarter } from './ui/Friend';
import { MatchScreen } from './ui/MatchScreen';
import { Menu } from './ui/Menu';

/** Can this browser create a WebGL context at all? */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Catches render/runtime errors in the match so the player never gets a blank screen. */
class MatchBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: String(e instanceof Error ? e.message : e) };
  }
  componentDidCatch(e: unknown, info: ErrorInfo) {
    console.error('DOJANG match error', e, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <h2>Something went wrong in the dojang</h2>
        <p className="muted">{this.state.error}</p>
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              this.setState({ error: null });
              useGameStore.getState().toMenu();
            }}
          >
            Back to menu
          </button>
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

export function App() {
  const screen = useGameStore((s) => s.screen);
  const settings = useGameStore((s) => s.settings);

  useEffect(() => {
    audio.setMix({ master: settings.volume, sfx: settings.sfxVolume, ambient: settings.ambientVolume, muted: settings.muted });
  }, [settings.volume, settings.sfxVolume, settings.ambientVolume, settings.muted]);

  useEffect(() => {
    // Keyboard shortcut for the perf overlay (backquote).
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') {
        const s = useGameStore.getState();
        s.updateSettings({ showPerf: !s.settings.showPerf });
      }
    };
    window.addEventListener('keydown', onKey);
    const params = new URLSearchParams(location.search);
    if (params.get('perf') === '1') useGameStore.getState().updateSettings({ showPerf: true });
    const auto = params.get('start');
    const m = params.get('mode');
    const mode = m === 'competitive' || m === 'training' ? m : 'arcade';
    if (auto === 'easy' || auto === 'normal' || auto === 'hard') useGameStore.getState().startMatch(auto, mode);
    // Invite link: open the join screen.
    if (roomFromUrl()) useGameStore.getState().setMenuPanel('online');
    // Block iOS pinch-zoom gestures inside the game.
    const block = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', block);
    // Browsers only allow audio after a gesture: unlock/resume on any tap or key.
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    // Interrupted (app switch, lock screen, tab hidden): pause the match and audio.
    const onVis = () => {
      const s = useGameStore.getState();
      if (document.hidden) {
        audio.suspend();
        if (s.screen === 'match' && s.hud && s.hud.phase !== 'match-over') s.setPaused(true);
      } else audio.resume();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onVis);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('gesturestart', block);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onVis);
    };
  }, []);

  useOnlineMatchStarter();
  if (screen === 'menu') return <Menu />;
  if (!webglAvailable())
    return (
      <div className="fatal" role="alert">
        <h2>3D graphics are not available</h2>
        <p className="muted">DOJANG needs WebGL. Enable hardware acceleration in your browser settings, update the browser, or try another browser (Chrome, Safari, Firefox, Edge).</p>
        <div className="row">
          <button className="primary" onClick={() => useGameStore.getState().toMenu()}>
            Back to menu
          </button>
          <button onClick={() => location.reload()}>Retry</button>
        </div>
      </div>
    );
  return (
    <MatchBoundary>
      <MatchScreen />
    </MatchBoundary>
  );
}
