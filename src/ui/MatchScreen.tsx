import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GameSession } from '../game/GameSession';
import { InputManager } from '../game/input/InputManager';
import { isTouchDevice, resolveQuality } from '../game/render/quality';
import { useGameStore } from '../store/useGameStore';
import { Hud } from './Hud';
import { PauseMenu, ResultOverlay } from './Overlays';
import { PerfOverlay } from './PerfOverlay';
import { RotatePrompt } from './RotatePrompt';
import { TouchControls } from './TouchControls';
import { TrainingHudView, TrainingSummary } from './Training';

declare global {
  interface Window {
    __dojang?: { session: GameSession; input: InputManager };
  }
}

function SessionDriver({ input, onReady }: { input: InputManager; onReady: (s: GameSession) => void }) {
  const { scene, camera, gl } = useThree();
  const sessionRef = useRef<GameSession | null>(null);
  const difficulty = useGameStore((s) => s.difficulty);
  const quality = useGameStore((s) => s.settings.quality);
  const mode = useGameStore((s) => s.mode);
  const activity = useGameStore((s) => s.activity);
  const fighter = useGameStore((s) => s.progress.fighter);

  useEffect(() => {
    const st = useGameStore.getState();
    const params = new URLSearchParams(location.search);
    const session = new GameSession({
      scene,
      camera: camera as THREE.PerspectiveCamera,
      gl,
      input,
      quality: resolveQuality(quality),
      difficulty,
      aiEnabled: params.get('ai') !== 'off',
      mode: useGameStore.getState().mode,
      roundSeconds: useGameStore.getState().settings.compRoundSeconds,
      playerCharacter: st.progress.fighter,
      playerBelt: st.progress.belt,
      activity: st.activity,
      callbacks: {
        onTrainingHud: (h) => useGameStore.getState().setTrainingHud(h),
        onTrainingEnd: (r) => useGameStore.getState().finishTraining(r),
        onMatchEnd: (won) => useGameStore.getState().recordMatchResult(won),
        onHud: (h) => useGameStore.getState().setHud(h),
        onToast: (t, ms) => useGameStore.getState().pushToast(t, ms),
        onPerf: (p) => useGameStore.getState().setPerf(p),
        onPauseToggle: () => {
          const s = useGameStore.getState();
          if (s.hud?.phase !== 'match-over' && !s.trainingResult) s.setPaused(!s.paused);
        },
      },
    });
    sessionRef.current = session;
    st.setLoading(true);
    input.attach(gl.domElement);
    let alive = true;
    session
      .init()
      .then(() => {
        if (!alive) return;
        st.setLoading(false);
        window.__dojang = { session, input };
        onReady(session);
      })
      .catch((e: unknown) => st.setLoading(false, String(e)));
    return () => {
      alive = false;
      input.detach();
      session.dispose();
      sessionRef.current = null;
      if (window.__dojang?.session === session) delete window.__dojang;
    };
    // Session is rebuilt only when the match configuration changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty, quality, mode, activity, fighter]);

  const paused = useGameStore((s) => s.paused);
  useEffect(() => {
    if (sessionRef.current) sessionRef.current.paused = paused;
  }, [paused]);

  useFrame((_, dt) => sessionRef.current?.frame(dt));
  return null;
}

export function MatchScreen() {
  const input = useMemo(() => new InputManager(), []);
  const [session, setSession] = useState<GameSession | null>(null);
  const settings = useGameStore((s) => s.settings);
  const loading = useGameStore((s) => s.loading);
  const loadError = useGameStore((s) => s.loadError);
  const mode = useGameStore((s) => s.mode);
  const profile = useMemo(() => resolveQuality(settings.quality), [settings.quality]);
  const touch = useMemo(() => isTouchDevice(), []);
  const showTouch = touch || settings.forceTouch || new URLSearchParams(location.search).get('touch') === '1';

  useEffect(() => {
    session?.setPrefs({ cameraAssist: settings.cameraAssist, reduceShake: settings.reduceShake, reduceFlash: settings.reduceFlash });
  }, [session, settings.cameraAssist, settings.reduceShake, settings.reduceFlash]);

  // Tell the camera how much of the screen the HUD and touch controls cover,
  // so it frames both fighters inside the unobstructed region.
  useEffect(() => {
    if (!session) return;
    const measure = () => {
      const H = window.innerHeight || 1;
      const hud = document.querySelector('.hud-top')?.getBoundingClientRect();
      const cluster = document.querySelector('.cluster')?.getBoundingClientRect();
      session.camRig.safe.top = hud ? Math.min(0.3, (hud.bottom + 4) / H) : 0.06;
      session.camRig.safe.bottom = cluster && showTouch ? Math.min(0.6, (H - cluster.top) / H) : 0;
      session.camRig.safe.widthFraction = showTouch ? 0.6 : 0.72;
    };
    measure();
    const id = window.setInterval(measure, 1000);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [session, showTouch, settings.controlScheme]);

  return (
    <div className={`match ${session ? 'ready' : ''}`}>
      <Canvas
        className="game-canvas"
        dpr={[profile.minDpr, profile.maxDpr]}
        shadows={profile.shadows ? 'soft' : false}
        gl={{ antialias: profile.antialias, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 50, near: 0.1, far: 60, position: [0, 2, -5] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={['#1a1510']} />
        <SessionDriver input={input} onReady={setSession} />
      </Canvas>
      {loading && (
        <div className="loading">
          <p className="eyebrow">{mode === 'training' ? 'Training' : mode === 'competitive' ? 'Competitive sparring' : 'Arcade sparring'}</p>
          <p className="enter">Entering the dojang</p>
          <i className="line" aria-hidden />
        </div>
      )}
      {loadError && (
        <div className="loading error" role="alert">
          <p>Could not load the fighters. Check your connection and try again.</p>
          <p className="muted small">{loadError}</p>
          <div className="row">
            <button className="primary" onClick={() => location.reload()}>
              Retry
            </button>
            <button onClick={() => useGameStore.getState().toMenu()}>Back to menu</button>
          </div>
        </div>
      )}
      {session && (mode === 'training' ? <TrainingHudView /> : <Hud />)}
      {session && showTouch && <TouchControls input={input} />}
      {session && <PauseMenu session={session} />}
      {session && mode !== 'training' && <ResultOverlay session={session} />}
      {session && mode === 'training' && <TrainingSummary session={session} />}
      {settings.showPerf && <PerfOverlay />}
      {touch && <RotatePrompt />}
    </div>
  );
}
