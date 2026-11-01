import { useEffect } from 'react';
import { useGameStore } from './store/useGameStore';
import { MatchScreen } from './ui/MatchScreen';
import { Menu } from './ui/Menu';

export function App() {
  const screen = useGameStore((s) => s.screen);
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
    if (auto === 'easy' || auto === 'normal' || auto === 'hard') useGameStore.getState().startMatch(auto);
    // Block iOS pinch-zoom gestures inside the game.
    const block = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', block);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('gesturestart', block);
    };
  }, []);
  return screen === 'menu' ? <Menu /> : <MatchScreen />;
}
