import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { GameSession } from '../game/GameSession';
import { buildDojang } from '../game/render/Dojang';
import { loadFighterAsset } from '../game/render/characterFactory';
import { resolveQuality } from '../game/render/quality';
import { ReplayPlayer } from '../game/replay/player';
import { audio } from '../game/audio/AudioEngine';
import { useGameStore } from '../store/useGameStore';
import { type ReplayCamera, type ReplaySpeed, useReplay } from '../store/useReplay';
import { usePadButton, useGamepadNav, QuietButton, Segmented } from './kit';
import { prefersReducedMotion } from './MenuBackdrop';
import './replay.css';

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/**
 * Drives a ReplayPlayer inside an existing R3F canvas. With a `session`, it
 * borrows that match's scene (the session hides its fighters and stops its
 * camera meanwhile; one WebGL context, nothing rebuilt), and gives it back
 * on close.
 */
export function ReplayHost({ session, blobShadows }: { session?: GameSession | null; blobShadows: boolean }) {
  const { scene, camera } = useThree();
  const playerRef = useRef<ReplayPlayer | null>(null);
  const index = useReplay((s) => s.index);
  const set = useReplay((s) => s.set);
  const lastUi = useRef(0);
  useEffect(() => {
    if (!set) return;
    let alive = true;
    const cam = camera as THREE.PerspectiveCamera;
    const saved = { fov: cam.fov, pos: cam.position.clone(), quat: cam.quaternion.clone() };
    session?.setHeld(true);
    loadFighterAsset().then((gltf) => {
      if (!alive) return;
      const p = new ReplayPlayer(scene, cam, set, gltf, { blobShadows, reducedMotion: prefersReducedMotion() });
      playerRef.current = p;
      // Diagnostics, like window.__dojang for the session.
      (window as unknown as { __replay?: ReplayPlayer; __audio?: typeof audio }).__replay = p;
      (window as unknown as { __audio?: typeof audio }).__audio = audio;
      const r = useReplay.getState();
      r.ui({ ready: false });
      useReplay.setState({
        controller: {
          play: () => (p.play(), useReplay.getState().ui({ playing: true })),
          pause: () => (p.pause(), useReplay.getState().ui({ playing: false, time: p.time })),
          seek: (t) => (p.seek(t), useReplay.getState().ui({ time: p.time })),
          restart: () => (p.seek(0), p.play(), useReplay.getState().ui({ time: 0, playing: true })),
          setSpeed: (sp) => ((p.speed = sp), useReplay.getState().ui({ speed: sp })),
          setCamera: (c) => (p.setPreset(c), useReplay.getState().ui({ camera: c })),
          select: (i) => useReplay.getState().ui({ index: i, ready: false, playing: false, time: 0 }),
        },
      });
    });
    return () => {
      alive = false;
      playerRef.current?.dispose();
      playerRef.current = null;
      delete (window as unknown as { __replay?: ReplayPlayer }).__replay;
      cam.fov = saved.fov;
      cam.position.copy(saved.pos);
      cam.quaternion.copy(saved.quat);
      cam.updateProjectionMatrix();
      session?.setHeld(false);
      useReplay.setState({ controller: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set]);
  // Load (bake) the selected clip.
  useEffect(() => {
    let alive = true;
    const go = async () => {
      // The player is created asynchronously; wait for it.
      for (let i = 0; i < 200 && !playerRef.current && alive; i++) await new Promise((r) => setTimeout(r, 16));
      const p = playerRef.current;
      if (!p || !alive) return;
      const st = useReplay.getState();
      await p.load(index);
      if (!alive) return;
      p.speed = st.speed;
      p.setPreset(st.camera);
      st.ui({ ready: true, duration: p.duration, time: 0, playing: false });
      // Start playing at once (the viewer opened, or the next highlight).
      p.play();
      st.ui({ playing: true });
    };
    void go();
    return () => {
      alive = false;
    };
  }, [index]);
  useFrame((_, dt) => {
    const p = playerRef.current;
    if (!p) return;
    p.update(Math.min(dt, 0.1));
    const now = performance.now();
    const st = useReplay.getState();
    if (now - lastUi.current > 80 || (st.playing && !p.playing)) {
      lastUi.current = now;
      if (st.time !== p.time || st.playing !== p.playing) st.ui({ time: p.time, playing: p.playing });
    }
  });
  return null;
}

/** The viewer's controls (over the scene). */
export function ReplayViewer({ onBack }: { onBack(): void }) {
  const r = useReplay();
  const set = r.set!;
  const clip = set.clips[r.index];
  const c = r.controller;
  const playRef = useRef<HTMLButtonElement>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const wasPlaying = useRef(false);
  const n = set.clips.length;
  const go = (d: number) => c?.select((r.index + d + n) % n);
  useGamepadNav(onBack);
  usePadButton((b) => (b === 'lb' ? go(-1) : b === 'rb' ? go(1) : undefined));
  useEffect(() => {
    playRef.current?.focus();
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!c) return;
      const t = e.target as HTMLElement | null;
      const onRange = t instanceof HTMLInputElement && t.type === 'range';
      if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      } else if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        if (t?.tagName === 'BUTTON' && e.key === ' ') return; // the focused button handles it
        e.preventDefault();
        r.playing ? c.pause() : c.play();
      } else if (!onRange && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(t?.closest('.segmented'))) {
        e.preventDefault();
        c.seek(r.time + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 0.25 : 1));
      } else if (e.key === 'Home') c.restart();
      else if (e.key === 'PageDown' || e.key === ']') go(1);
      else if (e.key === 'PageUp' || e.key === '[') go(-1);
      else if (e.key === 'c' || e.key === 'C') {
        const cams: ReplayCamera[] = ['broadcast', 'side', 'close'];
        c.setCamera(cams[(cams.indexOf(r.camera) + 1) % 3]);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const by = clip.by === null ? null : set.meta.names[clip.by];
  const pct = r.duration ? (r.time / r.duration) * 100 : 0;
  const mark = r.duration ? (clip.eventTick / 60 / r.duration) * 100 : 0;
  return (
    <div className="replay-ui" role="region" aria-label="Replay" data-testid="replay">
      <header className="replay-top">
        <div className="replay-title">
          <p className="context">
            Replay · {r.index + 1} of {n}
          </p>
          <h1 className="replay-label" aria-live="polite" data-testid="replay-label">
            {clip.label}
          </h1>
          {by && <p className="replay-by">{by}</p>}
        </div>
        <QuietButton onClick={onBack} hint="Esc" testid="replay-back" className="replay-back">
          Back to results
        </QuietButton>
      </header>
      <div className="replay-bar">
        <div className="replay-timeline">
          <input
            type="range"
            min={0}
            max={Math.max(0.01, r.duration)}
            step={1 / 60}
            value={r.time}
            aria-label="Replay position"
            aria-valuetext={`${fmt(r.time)} of ${fmt(r.duration)}`}
            disabled={!r.ready}
            style={{ ['--pct' as string]: `${pct}%`, ['--mark' as string]: `${mark}%` }}
            onPointerDown={() => {
              wasPlaying.current = r.playing;
              setScrubbing(true);
              c?.pause();
            }}
            onPointerUp={() => {
              setScrubbing(false);
              if (wasPlaying.current) c?.play();
            }}
            onChange={(e) => c?.seek(Number(e.target.value))}
            data-testid="replay-scrub"
          />
          <i className="replay-mark" aria-hidden style={{ left: `${mark}%` }} />
        </div>
        <div className="replay-controls">
          <div className="replay-transport">
            <button type="button" className="rbtn" aria-label="Previous highlight" onClick={() => go(-1)} disabled={n < 2} data-testid="replay-prev">
              <span aria-hidden>⏮</span>
            </button>
            <button ref={playRef} type="button" className="rbtn play" aria-label={r.playing ? 'Pause' : 'Play'} onClick={() => (r.playing ? c?.pause() : c?.play())} disabled={!r.ready} data-testid="replay-play">
              <span aria-hidden>{r.playing && !scrubbing ? '❚❚' : '▶'}</span>
            </button>
            <button type="button" className="rbtn" aria-label="Next highlight" onClick={() => go(1)} disabled={n < 2} data-testid="replay-next">
              <span aria-hidden>⏭</span>
            </button>
            <button type="button" className="rbtn" aria-label="Restart" onClick={() => c?.restart()} disabled={!r.ready} data-testid="replay-restart">
              <span aria-hidden>↺</span>
            </button>
            <span className="replay-time" aria-hidden data-testid="replay-time">
              {fmt(r.time)} / {fmt(r.duration)}
            </span>
          </div>
          <Segmented<ReplaySpeed>
            small
            label="Playback speed"
            testid="replay-speed"
            value={r.speed}
            onChange={(v) => c?.setSpeed(v)}
            options={[
              [0.25, '0.25×'],
              [0.5, '0.5×'],
              [1, '1×'],
            ]}
          />
          <Segmented<ReplayCamera>
            small
            label="Camera"
            testid="replay-cam"
            value={r.camera}
            onChange={(v) => c?.setCamera(v)}
            options={[
              ['broadcast', 'Broadcast'],
              ['side', 'Side'],
              ['close', 'Close-up'],
            ]}
          />
        </div>
      </div>
    </div>
  );
}

/** Watch replay: offered only when there are real highlights. */
export function WatchReplay({ onWatch, testid = 'watch-replay' }: { onWatch(): void; testid?: string }) {
  useReplay((s) => s.completions + (s.set ? s.set.id : 0) + (s.pending ? 1 : 0));
  const n = useReplay.getState().count();
  if (!n) return null;
  return (
    <QuietButton onClick={onWatch} testid={testid}>
      Watch replay
    </QuietButton>
  );
}

/** Standalone viewer for a replay opened from a menu screen (Champion). The menu's renderer is gone meanwhile. */
export function ReplayScreen() {
  const quality = useGameStore((s) => s.settings.quality);
  const profile = resolveQuality(quality);
  const origin = useReplay((s) => s.origin);
  const back = () => {
    const panel = origin?.kind === 'menu' ? origin.panel : 'home';
    useReplay.getState().close();
    useGameStore.setState({ screen: 'menu', menuPanel: panel });
  };
  return (
    <div className="match ready replay-screen">
      <Canvas
        className="game-canvas"
        dpr={[profile.minDpr, profile.maxDpr]}
        shadows={profile.shadows ? 'soft' : false}
        gl={{ antialias: profile.antialias, powerPreference: 'high-performance', stencil: false, alpha: false }}
        camera={{ fov: 42, near: 0.1, far: 60, position: [0, 2, -5] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={['#1a1510']} />
        <Hall quality={quality} />
        <ReplayHost blobShadows={!profile.shadows} />
      </Canvas>
      <ReplayViewer onBack={back} />
    </div>
  );
}

function Hall({ quality }: { quality: ReturnType<typeof useGameStore.getState>['settings']['quality'] }) {
  const { scene } = useThree();
  useEffect(() => {
    const env = buildDojang(resolveQuality(quality));
    scene.add(env.group);
    return () => {
      env.group.removeFromParent();
      env.dispose();
    };
  }, [scene, quality]);
  return null;
}
