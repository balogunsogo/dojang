import { useEffect, useRef, useState } from 'react';
import { MenuStage, type MenuShot } from '../game/menu/MenuStage';
import { resolveQuality } from '../game/render/quality';
import { webglAvailable } from '../game/render/webgl';
import { type MenuPanel, useGameStore } from '../store/useGameStore';
import { bracketInView, useTournament } from '../store/useTournament';
import { nextPlayerBout, opponentIn } from '../game/tournament/tournament';
import type { BeltColor, CharacterId } from '../game/render/characterFactory';

const AI_BELT = { easy: 'white', normal: 'red', hard: 'black' } as const satisfies Record<string, BeltColor>;

const SHOT: Record<MenuPanel, MenuShot> = {
  home: 'home',
  spar: 'spar',
  training: 'training',
  fighter: 'fighter',
  progress: 'progress',
  settings: 'settings',
  controls: 'settings',
  friend: 'spar',
  online: 'spar',
  tournament: 'spar',
  bracket: 'spar',
  prematch: 'spar',
  champion: 'fighter',
  openHistory: 'spar',
};

/**
 * Who stands on the mats for the Dojang Open screens: the Open's own fighter
 * (it may differ from the menu's current fighter), and on Pre-match the real
 * opponent at the Open's AI belt.
 */
function useOpenCast(panel: MenuPanel, menuFighter: CharacterId): { fighter: CharacterId; opponent: { id: CharacterId; belt: BeltColor } | null } {
  const t = useTournament();
  const active = t.save.active;
  if (panel === 'tournament' || panel === 'prematch') {
    const b = active && nextPlayerBout(active);
    const opp = panel === 'prematch' && active && b ? opponentIn(active, b) : null;
    return { fighter: active?.fighter ?? menuFighter, opponent: opp && active ? { id: opp, belt: AI_BELT[active.difficulty] } : null };
  }
  if (panel === 'bracket' || panel === 'champion') return { fighter: bracketInView(t)?.fighter ?? menuFighter, opponent: null };
  return { fighter: menuFighter, opponent: null };
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
  const menuFighter = useGameStore((s) => s.progress.fighter);
  const belt = useGameStore((s) => s.progress.belt);
  // Fighter swaps happen behind a brief dim of the stage (120 ms in, swap at
  // the darkest point, 180 ms out). Repeated input restarts the dim instead
  // of queueing swaps. Reduced motion: no dim, instant swap.
  const [dim, setDim] = useState(false);
  const dimTimer = useRef(0);
  const behindDim = (fn: () => void) => {
    if (!live || prefersReducedMotion()) return fn();
    setDim(true);
    window.clearTimeout(dimTimer.current);
    dimTimer.current = window.setTimeout(() => {
      fn();
      setDim(false);
    }, 120);
  };
  useEffect(() => () => window.clearTimeout(dimTimer.current), []);
  const lastShot = useRef<MenuShot | null>(null);
  const cast = useOpenCast(panel, menuFighter);
  const fighter = cast.fighter;
  const oppKey = cast.opponent ? `${cast.opponent.id}:${cast.opponent.belt}` : '';

  useEffect(() => {
    if (!enabled || !canvas.current || !webglAvailable() || new URLSearchParams(location.search).has('nomenu3d')) return;
    let s: MenuStage;
    try {
      const st = useGameStore.getState();
      s = new MenuStage(canvas.current, { quality: resolveQuality(quality), fighter, belt: st.progress.belt, reducedMotion: prefersReducedMotion() });
    } catch {
      return; // Context creation failed: keep the still backdrop.
    }
    stage.current = s;
    s.setOpponent(cast.opponent);
    s.setShot(SHOT[useGameStore.getState().menuPanel]);
    lastShot.current = SHOT[useGameStore.getState().menuPanel];
    s.init()
      .then(() => s.start(() => setLive(true)))
      .catch(() => setLive(false));
    return () => {
      setLive(false);
      s.dispose();
      stage.current = null;
    };
  }, [enabled, quality]);

  // Entering or leaving Choose fighter swaps the player's headgear: hide it behind the dim.
  useEffect(() => {
    const shot = SHOT[panel];
    const swap = (shot === 'fighter') !== (lastShot.current === 'fighter') && lastShot.current !== null;
    lastShot.current = shot;
    if (swap) behindDim(() => stage.current?.setShot(shot));
    else stage.current?.setShot(shot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    if (st.bare) behindDim(() => st.setFighter(fighter, belt));
    else st.setFighter(fighter, belt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fighter, belt]);
  useEffect(() => {
    const st = stage.current;
    if (!st) return;
    // A new opponent swaps behind the dim (Pre-match), like a fighter change.
    behindDim(() => st.setOpponent(cast.opponent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppKey]);

  return (
    <div className={`menu-backdrop ${live ? 'live' : ''}`} aria-hidden>
      <div className="still" />
      {enabled && <canvas key={quality} ref={canvas} className="stage" />}
      <div className={`stage-dim ${dim ? 'on' : ''}`} data-testid="stage-dim" />
    </div>
  );
}
