import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { audio } from '../game/audio/AudioEngine';
import { GameSession } from '../game/GameSession';
import { InputManager } from '../game/input/InputManager';
import { isTouchDevice, resolveQuality } from '../game/render/quality';
import { useGameStore } from '../store/useGameStore';
import { Hud } from './Hud';
import { PauseMenu, ResultOverlay } from './Overlays';
import { PerfOverlay } from './PerfOverlay';
import { RotatePrompt } from './RotatePrompt';
import { TouchControls } from './TouchControls';

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
      callbacks: {
        onHud: (h) => useGameStore.getState().setHud(h),
        onToast: (t, ms) => useGameStore.getState().pushToast(t, ms),
        onPerf: (p) => useGameStore.getState().setPerf(p),
        onPauseToggle: () => {
          const s = useGameStore.getState();
          if (s.hud?.phase !== 'match-over') s.setPaused(!s.paused);
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
  }, [difficulty, quality]);

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
  const profile = useMemo(() => resolveQuality(settings.quality), [settings.quality]);
  const touch = useMemo(() => isTouchDevice(), []);
  const showTouch = touch || settings.forceTouch || new URLSearchParams(location.search).get('touch') === '1';

  useEffect(() => {
    audio.setVolume(settings.volume);
  }, [settings.volume]);

  return (
    <div className="match">
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
      {loading && <div className="loading">Entering the dojang…</div>}
      {loadError && <div className="loading error">Could not load fighters: {loadError}</div>}
      {session && <Hud />}
      {session && showTouch && <TouchControls input={input} />}
      {session && <PauseMenu session={session} />}
      {session && <ResultOverlay session={session} />}
      {settings.showPerf && <PerfOverlay />}
      {touch && <RotatePrompt />}
    </div>
  );
}
