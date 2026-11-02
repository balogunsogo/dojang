import { useEffect, useRef, useState } from 'react';
import { MenuStage, type MenuShot } from '../game/menu/MenuStage';
import { resolveQuality } from '../game/render/quality';
import { type MenuPanel, useGameStore } from '../store/useGameStore';

const SHOT: Record<MenuPanel, MenuShot> = {
  home: 'home',
  spar: 'spar',
  training: 'training',
  fighter: 'fighter',
  progress: 'progress',
  settings: 'settings',
  controls: 'settings',
};

function canUseWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export const prefersReducedMotion = () => {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * Cinematic background for the menu: the live dojang (MenuStage) when
 * enabled and WebGL is available, otherwise a still, painted backdrop.
 * The CSS backdrop is always underneath, so the menu is readable from the
 * first frame and the 3D fades in only once it has rendered.
 */
export function MenuBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<MenuStage | null>(null);
  const [live, setLive] = useState(false);
  const enabled = useGameStore((s) => s.settings.menuScene);
  const quality = useGameStore((s) => s.settings.quality);
  const panel = useGameStore((s) => s.menuPanel);
  const fighter = useGameStore((s) => s.progress.fighter);
  const belt = useGameStore((s) => s.progress.belt);

  useEffect(() => {
    if (!enabled || !canvas.current || !canUseWebGL() || new URLSearchParams(location.search).has('nomenu3d')) return;
    let s: MenuStage;
    try {
      const st = useGameStore.getState();
      s = new MenuStage(canvas.current, { quality: resolveQuality(quality), fighter: st.progress.fighter, belt: st.progress.belt, reducedMotion: prefersReducedMotion() });
    } catch {
      return; // Context creation failed: keep the still backdrop.
    }
    stage.current = s;
    s.setShot(SHOT[useGameStore.getState().menuPanel]);
    s.init()
      .then(() => s.start(() => setLive(true)))
      .catch(() => setLive(false));
    return () => {
      setLive(false);
      s.dispose();
      stage.current = null;
    };
  }, [enabled, quality]);

  useEffect(() => stage.current?.setShot(SHOT[panel]), [panel]);
  useEffect(() => stage.current?.setFighter(fighter, belt), [fighter, belt]);

  return (
    <div className={`menu-backdrop ${live ? 'live' : ''}`} aria-hidden>
      <div className="still" />
      {enabled && <canvas key={quality} ref={canvas} className="stage" />}
    </div>
  );
}
