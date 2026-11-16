import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { GameSession } from '../game/GameSession';
import { buildDojang } from '../game/render/Dojang';
import { loadFighterAsset } from '../game/render/characterFactory';
import { resolveQuality } from '../game/render/quality';
import { ReplayPlayer } from '../game/replay/player';
import { type ExportAspect, type ExportResult, ExportCancelled, exportName, exportSize, exportSupport, isConstrained, recordClip } from '../game/replay/exporter';
import { audio } from '../game/audio/AudioEngine';
import { useGameStore } from '../store/useGameStore';
import { type ReplayCamera, type ReplaySpeed, useReplay } from '../store/useReplay';
import { usePadButton, useGamepadNav, PrimaryButton, QuietButton, Segmented } from './kit';
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
  const { scene, camera, gl } = useThree();
  const tier = resolveQuality(useGameStore.getState().settings.quality).tier;
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
          exportVideo: async ({ aspect, speed, onProgress, signal }) => {
            const el = gl.domElement;
            const saved = el.getAttribute('style') ?? '';
            useReplay.getState().ui({ exporting: true });
            try {
              return await recordClip({
                gl,
                camera: cam,
                player: p,
                aspect,
                speed,
                constrained: isConstrained(tier),
                onProgress: (f) => {
                  onProgress(f);
                  useReplay.getState().ui({ time: p.time });
                },
                signal,
                // Preview: show the canvas at the export's aspect, centred, while it records.
                onSize: (w, h) => {
                  const box = el.parentElement!.getBoundingClientRect();
                  const k = Math.min((box.width * 0.86) / w, (box.height * 0.62) / h);
                  el.style.position = 'absolute';
                  el.style.width = `${Math.round(w * k)}px`;
                  el.style.height = `${Math.round(h * k)}px`;
                  el.style.left = `${Math.round((box.width - w * k) / 2)}px`;
                  el.style.top = `${Math.round(box.height * 0.08)}px`;
                },
              });
            } finally {
              el.setAttribute('style', saved);
              useReplay.getState().ui({ exporting: false, playing: false, time: p.time });
            }
          },
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
    // Export records in real time: follow the wall clock (frames can be long); otherwise clamp hiccups.
    p.update(Math.min(dt, useReplay.getState().exporting ? 0.5 : 0.1));
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
  const [exportOpen, setExportOpen] = useState(false);
  useGamepadNav(exportOpen ? undefined : onBack);
  usePadButton((b) => (b === 'lb' ? go(-1) : b === 'rb' ? go(1) : undefined));
  useEffect(() => {
    playRef.current?.focus();
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!c || useReplay.getState().exporting || exportOpen) return;
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
        <div className="replay-top-actions">
          <QuietButton onClick={() => setExportOpen(true)} testid="replay-export" className="replay-export">
            Export video
          </QuietButton>
          <QuietButton onClick={onBack} hint="Esc" testid="replay-back" className="replay-back">
            Back to results
          </QuietButton>
        </div>
      </header>
      {exportOpen && <ExportPanel label={clip.label} speed={r.speed} onClose={() => setExportOpen(false)} />}
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

const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/**
 * Export the current highlight (Phase 12B): format, speed, progress,
 * cancel, then save or share. States what the browser can actually do.
 */
function ExportPanel({ label, speed, onClose }: { label: string; speed: number; onClose(): void }) {
  const support = exportSupport();
  const [aspect, setAspect] = useState<ExportAspect>('16:9');
  const [useSpeed, setUseSpeed] = useState<'normal' | 'selected'>('normal');
  const [phase, setPhase] = useState<'setup' | 'recording' | 'done' | 'error'>('setup');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<(ExportResult & { url: string; name: string }) | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const tier = resolveQuality(useGameStore.getState().settings.quality).tier;
  const duration = useReplay.getState().duration;
  const sp = useSpeed === 'selected' ? speed : 1;
  // A rough size label for the setup screen (the renderer is not resized yet).
  const size = (() => {
    const long = isConstrained(tier) ? 960 : 1280;
    const short = Math.round((long * 9) / 16 / 2) * 2;
    return aspect === '16:9' ? `${long} × ${short}` : `${short} × ${long}`;
  })();
  useEffect(() => () => {
    abort.current?.abort();
    if (result) URL.revokeObjectURL(result.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (phase === 'recording') abort.current?.abort();
      else close();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });
  const close = () => {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    onClose();
  };
  const start = async () => {
    const c = useReplay.getState().controller;
    if (!c || !support.ok) return;
    abort.current = new AbortController();
    setPhase('recording');
    setProgress(0);
    try {
      const r = await c.exportVideo({ aspect, speed: sp, onProgress: setProgress, signal: abort.current.signal });
      setResult({ ...r, url: URL.createObjectURL(r.blob), name: exportName(label, aspect, r.ext, sp) });
      setPhase('done');
    } catch (e) {
      if (e instanceof ExportCancelled) setPhase('setup');
      else {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    }
  };
  const save = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const file = result ? new File([result.blob], result.name, { type: result.blob.type }) : null;
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  return (
    <div className={`replay-export-panel ${phase}`} role="dialog" aria-modal="true" aria-labelledby="export-title" data-testid="export-panel">
      <div className="panel">
        <h2 id="export-title" className="export-title">
          {phase === 'recording' ? 'Exporting video' : phase === 'done' ? 'Your video is ready' : 'Export video'}
        </h2>
        {!support.ok ? (
          <>
            <p className="body-copy" role="alert" data-testid="export-unsupported">
              {support.reason} You can still watch the replay here.
            </p>
            <div className="row">
              <QuietButton onClick={close} testid="export-close">
                Close
              </QuietButton>
            </div>
          </>
        ) : phase === 'setup' ? (
          <>
            <p className="caption">{label}</p>
            <div className="export-row">
              <span className="group-label">Format</span>
              <Segmented<ExportAspect>
                small
                label="Format"
                testid="export-aspect"
                value={aspect}
                onChange={setAspect}
                options={[
                  ['16:9', 'Landscape 16:9'],
                  ['9:16', 'Portrait 9:16'],
                ]}
              />
            </div>
            {speed !== 1 && (
              <div className="export-row">
                <span className="group-label">Speed</span>
                <Segmented<'normal' | 'selected'>
                  small
                  label="Speed"
                  testid="export-speed"
                  value={useSpeed}
                  onChange={setUseSpeed}
                  options={[
                    ['normal', 'Normal'],
                    ['selected', `${speed}× slow motion`],
                  ]}
                />
              </div>
            )}
            <p className="caption" data-testid="export-info">
              {size} · {support.ext.toUpperCase()}
              {support.audio ? ' with sound' : ' (no sound in this browser)'} · about {Math.round(duration / sp)} s · records in real time
            </p>
            <div className="row">
              <PrimaryButton onClick={start} hint="Enter" testid="export-start" autoFocus>
                Export
              </PrimaryButton>
              <QuietButton onClick={close} hint="Esc" testid="export-close">
                Cancel
              </QuietButton>
            </div>
          </>
        ) : phase === 'recording' ? (
          <>
            <div className="export-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Export progress">
              <i style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="caption" aria-live="polite" data-testid="export-progress">
              Recording {Math.round(progress * 100)}% · keep this tab open
            </p>
            <div className="row">
              <QuietButton onClick={() => abort.current?.abort()} hint="Esc" testid="export-cancel">
                Cancel
              </QuietButton>
            </div>
          </>
        ) : phase === 'done' && result ? (
          <>
            <p className="caption" data-testid="export-done">
              {result.width} × {result.height} · {result.ext.toUpperCase()}
              {result.audio ? ' with sound' : ''} · {result.seconds.toFixed(1)} s · about {Math.round(result.fps)} fps · {fmtSize(result.blob.size)}
            </p>
            {result.fps < 20 && (
              <p className="caption warn-note" data-testid="export-choppy">
                This device drew the replay slowly while recording, so the video may look choppy. Closing other apps and tabs, or charging the device, helps it record more smoothly.
              </p>
            )}
            <div className="row">
              <PrimaryButton onClick={save} hint="Enter" testid="export-save" autoFocus>
                Save video
              </PrimaryButton>
              {canShare && (
                <QuietButton onClick={() => void navigator.share({ files: [file!], title: label }).catch(() => undefined)} testid="export-share">
                  Share
                </QuietButton>
              )}
              <QuietButton onClick={close} hint="Esc" testid="export-close">
                Done
              </QuietButton>
            </div>
          </>
        ) : (
          <>
            <p className="body-copy" role="alert" data-testid="export-error">
              The video couldn’t be made: {error}
            </p>
            <div className="row">
              <QuietButton onClick={close} testid="export-close">
                Close
              </QuietButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { exportSize };
