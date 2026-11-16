/**
 * Replay video export (Phase 12B): records the selected highlight as it
 * plays in the replay viewer. Only on request, never during a match.
 *
 * - Rendering: the viewer's own renderer is resized to the export size
 *   (1280x720 or 720x1280, lower on constrained devices) with a camera at
 *   that aspect; the replay camera reframes for it (portrait fits both
 *   fighters). No second WebGL context and no pixel readback.
 * - Capture: the canvas's captureStream (30 fps) plus the replay audio
 *   bus tapped into a MediaStream, recorded by MediaRecorder in whatever
 *   container the browser actually supports (MP4 when it can include
 *   sound, else WebM). A WebM from MediaRecorder carries no duration, so
 *   one is written into it afterwards.
 * - Bounded: chunks of one clip at a capped bitrate; everything is
 *   released when the export ends, fails or is cancelled.
 */
import * as THREE from 'three';
import { audio } from '../audio/AudioEngine';
import type { ReplayPlayer } from './player';

export type ExportAspect = '16:9' | '9:16';

/** Containers in order of preference: MP4 only when it can carry sound, then WebM, then plain MP4. */
const CANDIDATES: { mime: string; ext: 'mp4' | 'webm'; audio: boolean }[] = [
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4', audio: true },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4', audio: true },
  // MP4 only with AAC sound (MP4 with Opus is not accepted by QuickTime / iOS); otherwise WebM.
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', audio: true },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', audio: true },
  { mime: 'video/webm', ext: 'webm', audio: true },
  { mime: 'video/mp4', ext: 'mp4', audio: true },
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4', audio: false },
];

export type ExportSupport = { ok: true; mime: string; ext: 'mp4' | 'webm'; audio: boolean } | { ok: false; reason: string };

/** What this browser can actually record (never claims MP4 where only WebM works). */
export function exportSupport(): ExportSupport {
  if (typeof MediaRecorder === 'undefined') return { ok: false, reason: 'This browser cannot record video (no MediaRecorder).' };
  if (typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) return { ok: false, reason: 'This browser cannot capture the game view as video.' };
  const canAudio = typeof AudioContext !== 'undefined' && 'createMediaStreamDestination' in AudioContext.prototype;
  for (const c of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return { ok: true, mime: c.mime, ext: c.ext, audio: c.audio && canAudio };
    } catch {
      /* keep looking */
    }
  }
  return { ok: false, reason: 'This browser has no supported video format for recording.' };
}

/** Export size: 720p, or 540p on constrained devices (or when the GPU cannot draw 1280 px). */
export function exportSize(aspect: ExportAspect, gl: THREE.WebGLRenderer, constrained: boolean) {
  const long = constrained || gl.capabilities.maxTextureSize < 1280 ? 960 : 1280;
  const short = Math.round((long * 9) / 16 / 2) * 2;
  return aspect === '16:9' ? { width: long, height: short } : { width: short, height: long };
}

/** Constrained device heuristics (no measurement claims; a lower size simply records more smoothly). */
export function isConstrained(tier: string) {
  const n = navigator as Navigator & { deviceMemory?: number };
  return tier === 'low' || (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 3;
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  ext: 'mp4' | 'webm';
  width: number;
  height: number;
  seconds: number;
  audio: boolean;
  /** Frames the browser actually rendered per second while recording (the video's real smoothness). */
  fps: number;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
  }
}

/**
 * Record the player's current clip from start to end at `speed`. The caller
 * keeps the viewer mounted; this resizes and restores the renderer itself.
 */
export async function recordClip(o: {
  gl: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  player: ReplayPlayer;
  aspect: ExportAspect;
  speed: number;
  constrained: boolean;
  onProgress?(fraction: number): void;
  signal?: AbortSignal;
  /** Called with the export size once the renderer is resized (for a correct-aspect preview). */
  onSize?(w: number, h: number): void;
}): Promise<ExportResult> {
  const support = exportSupport();
  if (!support.ok) throw new Error(support.reason);
  const { gl, camera, player } = o;
  const { width, height } = exportSize(o.aspect, gl, o.constrained);
  const canvas = gl.domElement;
  // Remember the live renderer state.
  const prevRatio = gl.getPixelRatio();
  const prevSize = gl.getSize(new THREE.Vector2());
  const prevAspect = camera.aspect;
  const prevSpeed = player.speed;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  let audioStream: MediaStream | null = null;
  try {
    player.pause();
    gl.setPixelRatio(1);
    gl.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    o.onSize?.(width, height);
    player.speed = o.speed;
    player.audioLookahead = 0.45;
    player.seek(0);
    await frames(3);
    stream = canvas.captureStream(30);
    if (support.audio) {
      audioStream = audio.replayStream();
      for (const t of audioStream?.getAudioTracks() ?? []) stream.addTrack(t);
    }
    const pixels = width * height;
    recorder = new MediaRecorder(stream, {
      mimeType: support.mime,
      videoBitsPerSecond: pixels >= 1280 * 720 ? 5_000_000 : 3_000_000,
      audioBitsPerSecond: 128_000,
    });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((res, rej) => {
      recorder!.onstop = () => res();
      recorder!.onerror = (e) => rej(new Error(`Recording failed: ${String((e as unknown as { error?: Error }).error?.message ?? 'unknown error')}`));
    });
    recorder.start(1000);
    const started = performance.now();
    player.play();
    let rendered = 0;
    // Follow playback until the clip ends (or the user cancels).
    await new Promise<void>((res, rej) => {
      const tick = () => {
        rendered++;
        if (o.signal?.aborted) return rej(new ExportCancelled());
        o.onProgress?.(player.duration ? player.time / player.duration : 0);
        if (!player.playing && player.time >= player.duration - 1e-3) return res();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // Hold the last frame briefly so players do not cut the final moment.
    await sleep(350);
    recorder.stop();
    await stopped;
    const seconds = (performance.now() - started) / 1000;
    let blob = new Blob(chunks, { type: support.mime.split(';')[0] });
    if (support.ext === 'webm') blob = await withWebmDuration(blob, seconds * 1000);
    if (blob.size === 0) throw new Error('The browser produced an empty recording.');
    const playSeconds = (player.duration / o.speed) || seconds;
    return { blob, mime: support.mime, ext: support.ext, width, height, seconds, audio: !!audioStream?.getAudioTracks().length, fps: Math.min(30, rendered / playSeconds) };
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    for (const t of stream?.getTracks() ?? []) t.stop();
    audio.endReplayStream();
    player.pause();
    player.speed = prevSpeed;
    player.audioLookahead = 0.12;
    gl.setPixelRatio(prevRatio);
    gl.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    if (o.signal?.aborted) chunks.length = 0;
  }
}

const frames = (n: number) => new Promise<void>((res) => {
  const f = () => (--n <= 0 ? res() : requestAnimationFrame(f));
  requestAnimationFrame(f);
});
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── WebM duration ────────────────────────────────────────────────────────

/** Read an EBML variable-size integer at `i`: [value, length]. */
function vint(u: Uint8Array, i: number): [number, number] {
  const b = u[i];
  let len = 1;
  while (len <= 8 && !(b & (0x80 >> (len - 1)))) len++;
  let v = b & (0xff >> len);
  for (let k = 1; k < len; k++) v = v * 256 + u[i + k];
  return [v, len];
}

function encodeVint(v: number, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let x = v;
  for (let k = len - 1; k >= 0; k--) {
    out[k] = x & 0xff;
    x = Math.floor(x / 256);
  }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

function find(u: Uint8Array, id: number[], from = 0, to = u.length) {
  outer: for (let i = from; i < to - id.length; i++) {
    for (let k = 0; k < id.length; k++) if (u[i + k] !== id[k]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Write a Duration into a MediaRecorder WebM's Segment Info (it has none),
 * so players show the length and can seek. Returns the input unchanged if
 * the layout is not the expected one.
 */
export async function withWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  const u = new Uint8Array(await blob.arrayBuffer());
  const out = webmWithDuration(u, durationMs);
  return out === u ? blob : new Blob([out as BlobPart], { type: blob.type });
}

export function webmWithDuration(u: Uint8Array, durationMs: number): Uint8Array {
  const SEGMENT = [0x18, 0x53, 0x80, 0x67];
  const INFO = [0x15, 0x49, 0xa9, 0x66];
  const seg = find(u, SEGMENT, 0, Math.min(u.length, 256));
  if (seg < 0) return u;
  const [segSize, segLen] = vint(u, seg + 4);
  const segUnknown = segSize === Math.pow(2, 7 * segLen) - 1;
  const info = find(u, INFO, seg + 4 + segLen, Math.min(u.length, seg + 4096));
  if (info < 0) return u;
  const [size, len] = vint(u, info + 4);
  const c0 = info + 4 + len;
  // Already has a duration: nothing to do.
  if (find(u, [0x44, 0x89], c0, c0 + size) >= 0) return u;
  const dur = new Uint8Array(11);
  dur[0] = 0x44;
  dur[1] = 0x89;
  dur[2] = 0x88; // 8-byte float
  new DataView(dur.buffer).setFloat64(3, durationMs); // TimecodeScale is 1 ms in MediaRecorder output
  const newSize = size + dur.length;
  const newLen = newSize < Math.pow(2, 7 * len) - 1 ? len : 8;
  const sizeBytes = encodeVint(newSize, newLen);
  const delta = dur.length + (newLen - len);
  const parts: Uint8Array[] = [u.subarray(0, info + 4), sizeBytes, u.subarray(c0, c0 + size), dur, u.subarray(c0 + size)];
  const out = new Uint8Array(u.length + delta);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  // A Segment with a known size grows by the same amount (MediaRecorder normally writes "unknown").
  if (!segUnknown) {
    const grown = segSize + delta;
    if (grown < Math.pow(2, 7 * segLen) - 1) out.set(encodeVint(grown, segLen), seg + 4);
  }
  return out;
}

/** A file name for the export. */
export function exportName(label: string, aspect: ExportAspect, ext: string, speed = 1) {
  const slug = label
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 48);
  const slow = speed === 1 ? '' : speed === 0.5 ? '-half-speed' : '-quarter-speed';
  return `dojang-${slug || 'replay'}-${aspect === '16:9' ? 'landscape' : 'portrait'}${slow}.${ext}`;
}
