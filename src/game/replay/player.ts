/**
 * Replay playback (presentation only). It never touches a CombatWorld, a
 * GameSession or any progress: it reads a sealed clip and draws it.
 *
 * 1. Bake: the clip's tick rows are fed, at 60 Hz, through the same
 *    procedural FighterAnimator the match uses (with its own foot planting,
 *    bounce and blend history), and every bone's pose is stored per tick.
 *    Done once per clip, in short chunks so the page stays responsive.
 * 2. Play / seek: the pose at any time is read straight from the baked
 *    arrays (interpolated between ticks), so seeking is immediate and never
 *    accumulates error, and pausing freezes the exact pose.
 * 3. Effects and sound fire when playback crosses an event moving forward;
 *    seeking never fires them, and sounds use seeded variation so a replayed
 *    moment sounds the same each time.
 */
import * as THREE from 'three';
import type { Fighter } from '../combat/Fighter';
import { FighterAnimator } from '../anim/FighterAnimator';
import { audio } from '../audio/AudioEngine';
import { TICK_HZ } from '../config';
import { approachAngle } from '../math';
import { type BeltColor, CHARACTERS, type CharacterId, type CharacterInstance, createCharacter } from '../render/characterFactory';
import { Effects } from '../render/Effects';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FighterView, rowHitstop, rowPhase, rowState, rowX, rowZ } from './format';
import type { ReplayClip, ReplaySet } from './recorder';

export type CameraPreset = 'broadcast' | 'side' | 'close';

const DT = 1 / TICK_HZ;
/** Inside the hall (its half-size is 6.6 m and the ceiling 4.2 m). */
const ROOM = 5.9;
const CEIL = 3.5;
/** Animator warm-up on the first row, so the first frame has settled blend history. */
const WARMUP = 24;

type Cue =
  | { t: number; k: 'attack'; who: 0 | 1; kind: 'kick' | 'leadKick' | 'turning' | 'punch'; strikeIn: number }
  | { t: number; k: 'whiff'; who: 0 | 1 }
  | { t: number; k: 'hit'; d: 0 | 1; impact: 'punch' | 'head' | 'body'; heavy: boolean; fx: 'hit' | 'heavy'; point: [number, number, number]; score: number }
  | { t: number; k: 'block'; d: 0 | 1; punch: boolean; guardBreak: boolean; point: [number, number, number] }
  | { t: number; k: 'ko' | 'thud' | 'land' | 'dash'; who: 0 | 1 }
  | { t: number; k: 'step'; who: 0 | 1; pivot: boolean };

interface Baked {
  clip: ReplayClip;
  /** Per fighter: len × nodes × 7 (position xyz, quaternion xyzw). */
  poses: [Float32Array, Float32Array];
  cues: Cue[];
  /** Camera side for this clip (+1 / -1), fixed so the view never flips mid-clip. */
  side: number;
  /** Where the moment happened (xz), for the close-up. */
  focus: [number, number];
}

export class ReplayPlayer {
  private chars: CharacterInstance[] = [];
  private anims: FighterAnimator[] = [];
  private nodes: THREE.Object3D[][] = [];
  private fx: Effects;
  private baked = new Map<number, Baked>();
  private cur: Baked | null = null;
  private tick = 0;
  /** Seconds into the clip. */
  time = 0;
  speed = 1;
  playing = false;
  preset: CameraPreset = 'broadcast';
  /** Diagnostics. */
  bakeMs = 0;
  private views: [FighterView, FighterView] = [new FighterView(0), new FighterView(1)];
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private camFov = 42;
  private snapCam = true;
  private disposed = false;
  private readonly q0 = new THREE.Quaternion();
  private readonly q1 = new THREE.Quaternion();
  private readonly tmp = new THREE.Vector3();
  private readonly ap = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    readonly set: ReplaySet,
    gltf: GLTF,
    private readonly o: { blobShadows: boolean; reducedMotion: boolean },
  ) {
    const corners = ['chung', 'hong'] as const;
    for (let i = 0; i < 2; i++) {
      const id = set.meta.ids[i] as CharacterId;
      const c = createCharacter(gltf, CHARACTERS[id], corners[i], set.meta.belts[i] as BeltColor);
      c.group.visible = false; // until the first clip is baked
      scene.add(c.group);
      this.chars.push(c);
      // Same seeds as the match, so procedural variation matches.
      this.anims.push(new FighterAnimator(c.group, c.model, c.clips, i + 1));
      const list: THREE.Object3D[] = [c.group, c.model];
      c.model.traverse((n) => (n as THREE.Bone).isBone && list.push(n));
      this.nodes.push(list);
    }
    this.fx = new Effects(o.blobShadows, set.meta.boundary);
    scene.add(this.fx.group);
  }

  get clip(): ReplayClip | null {
    return this.cur?.clip ?? null;
  }
  get duration() {
    return this.cur ? (this.cur.clip.len - 1) / TICK_HZ : 0;
  }

  /** Bake a clip (once) and show its first frame. */
  async load(index: number, yieldFn: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0))) {
    const clip = this.set.clips[index];
    if (!clip) return;
    let b = this.baked.get(index);
    if (!b) {
      // Baking drives the same bones that are drawn: keep the fighters out of sight meanwhile.
      this.setVisible(false);
      // Nothing else may move those bones between bake chunks.
      this.cur = null;
      this.playing = false;
      b = await this.bake(clip, yieldFn);
      if (this.disposed) return;
      this.baked.set(index, b);
    }
    this.cur = b;
    this.playing = false;
    audio.endReplay();
    this.seek(0);
    this.setVisible(true);
  }

  private setVisible(on: boolean) {
    for (const c of this.chars) c.group.visible = on;
  }

  private async bake(clip: ReplayClip, yieldFn: () => Promise<void>): Promise<Baked> {
    const t0 = performance.now();
    const len = clip.len;
    const stride = (i: number) => this.nodes[i].length * 7;
    const poses: [Float32Array, Float32Array] = [new Float32Array(len * stride(0)), new Float32Array(len * stride(1))];
    const cues: Cue[] = [];
    const visYaw = [0, 0];
    const plants = [0, 0];
    const prevState = ['', ''];
    const lastWasKick = [false, false];
    const byTick = new Map<number, ReplayClip['events']>();
    for (const e of clip.events) (byTick.get(e.t) ?? byTick.set(e.t, []).get(e.t)!).push(e);
    // Fresh animators per clip (no blend history from another clip), warmed up on the first row.
    for (let i = 0; i < 2; i++) {
      const v = this.views[i].read(clip.rows, 0);
      visYaw[i] = v.yaw;
      for (let w = 0; w < WARMUP; w++) this.anims[i].update(v as unknown as Fighter, 0, v.x, v.z, v.yaw, DT);
      plants[i] = this.anims[i].plants;
      prevState[i] = v.state;
    }
    const CHUNK = 90;
    for (let t = 0; t < len; t++) {
      // As in the match: events of a tick reach the animator before it draws that tick.
      for (const e of byTick.get(t) ?? []) {
        if (e.k === 'hit') this.anims[e.d].noteImpact(e.side, e.zone);
        cues.push(...cuesFor(e));
      }
      const hs = rowHitstop(clip.rows, t);
      const ph = rowPhase(clip.rows, t);
      const stopped = hs > 0 && (ph === 'fight' || ph === 'break');
      for (let i = 0; i < 2; i++) {
        const v = this.views[i].read(clip.rows, t);
        visYaw[i] = approachAngle(visYaw[i], v.yaw, 14 * DT);
        this.anims[i].update(v as unknown as Fighter, 0, v.x, v.z, visYaw[i], stopped ? 0 : DT);
        // Footsteps, landings and dashes, as the match derives them.
        const n = this.anims[i].plants;
        if (n !== plants[i]) {
          plants[i] = n;
          cues.push({ t, k: 'step', who: i as 0 | 1, pivot: this.anims[i].lastPlantPivot });
        }
        if (v.state !== prevState[i]) {
          if (prevState[i] === 'attack' && lastWasKick[i] && v.state !== 'hitstun' && v.state !== 'down' && v.state !== 'ko') cues.push({ t, k: 'land', who: i as 0 | 1 });
          if (v.state === 'dash') cues.push({ t, k: 'dash', who: i as 0 | 1 });
          prevState[i] = v.state;
        }
        if (v.state === 'attack' && v.attack) lastWasKick[i] = v.attack.move.limb !== 'rearHand';
        const list = this.nodes[i];
        const p = poses[i];
        let o = t * list.length * 7;
        for (const node of list) {
          p[o++] = node.position.x;
          p[o++] = node.position.y;
          p[o++] = node.position.z;
          p[o++] = node.quaternion.x;
          p[o++] = node.quaternion.y;
          p[o++] = node.quaternion.z;
          p[o++] = node.quaternion.w;
        }
      }
      if (t % CHUNK === CHUNK - 1) {
        await yieldFn();
        if (this.disposed) break;
      }
    }
    cues.sort((a, b) => a.t - b.t);
    // Camera: the side with more room around the moment, kept for the whole clip.
    const et = clip.eventTick;
    const hit = clip.events.find((e) => e.t === et && (e.k === 'hit' || e.k === 'block'));
    const focus: [number, number] = hit && 'point' in hit ? [hit.point[0], hit.point[2]] : [(rowX(clip.rows, et, 0) + rowX(clip.rows, et, 1)) / 2, (rowZ(clip.rows, et, 0) + rowZ(clip.rows, et, 1)) / 2];
    const side = pickSide(clip, et);
    this.bakeMs += performance.now() - t0;
    return { clip, poses, cues, side, focus };
  }

  /** Jump to a time (seconds): the exact pose, no sounds, the camera cut there. */
  seek(seconds: number) {
    if (!this.cur) return;
    this.time = Math.max(0, Math.min(this.duration, seconds));
    this.tick = this.time * TICK_HZ;
    this.scheduled = this.tick - 1e-6;
    audio.endReplay();
    if (this.playing) audio.beginReplay();
    this.applyPose();
    this.snapCam = true;
  }

  play() {
    if (!this.cur) return;
    if (this.time >= this.duration - 1e-3) this.seek(0);
    this.playing = true;
    this.scheduled = this.tick - 1e-6;
    audio.beginReplay();
  }

  /**
   * Sounds are scheduled this far ahead (real seconds) with exact delays, so
   * a slow frame never makes them late. Larger while exporting (frames can
   * be long there); pause and seek cut anything not yet played.
   */
  audioLookahead = 0.12;
  private scheduled = -1;

  pause() {
    this.playing = false;
    // Cut sounds still ringing: a paused replay is silent.
    audio.endReplay();
  }

  setPreset(p: CameraPreset) {
    this.preset = p;
    if (this.o.reducedMotion) this.snapCam = true;
  }

  /** Advance (real seconds) and draw. */
  update(dt: number) {
    if (!this.cur) return;
    const prev = this.tick;
    if (this.playing) {
      this.time = Math.min(this.duration, this.time + dt * this.speed);
      this.tick = this.time * TICK_HZ;
      this.fire(prev, this.tick);
      if (this.time >= this.duration) this.pause();
    }
    this.applyPose();
    this.updateCamera(dt);
    const t = Math.floor(this.tick);
    const pos = [0, 1].map((i) => ({ x: rowX(this.cur!.clip.rows, t, i as 0 | 1), z: rowZ(this.cur!.clip.rows, t, i as 0 | 1) }));
    this.fx.update(this.playing ? dt * this.speed : 0, this.camera, pos);
    // Stereo placement from the replay camera, as in the match.
    const cam = this.camera;
    const pans = pos.map((p) => {
      this.ap.set(p.x, 1, p.z);
      const d = cam.position.distanceTo(this.ap);
      return [this.ap.project(cam).x, d];
    });
    audio.setPositions(pans[0][0], pans[0][1], pans[1][0], pans[1][1]);
  }

  /** Effects when playback crosses an event; sounds scheduled just ahead, at their exact moment. */
  private fire(from: number, to: number) {
    const b = this.cur!;
    const ahead = to + this.audioLookahead * this.speed * TICK_HZ;
    for (const c of b.cues) {
      if (c.t > from && c.t <= to && (c.k === 'hit' || c.k === 'block')) this.fx.spawn(c.point, c.k === 'hit' ? c.fx : 'block');
      if (c.t <= this.scheduled || c.t > ahead) continue;
      const delay = Math.max(0, (c.t - to) / TICK_HZ / this.speed);
      // Seeded by clip and tick: the same moment sounds the same on every replay.
      audio.seeded((b.clip.start * 131 + c.t * 7919) >>> 0, () => playCue(c, this.speed), delay);
    }
    this.scheduled = Math.max(this.scheduled, ahead);
  }

  private applyPose() {
    const b = this.cur!;
    const len = b.clip.len;
    const t0 = Math.min(len - 1, Math.floor(this.tick));
    const t1 = Math.min(len - 1, t0 + 1);
    const k = this.tick - t0;
    for (let i = 0; i < 2; i++) {
      const list = this.nodes[i];
      const p = b.poses[i];
      const a = t0 * list.length * 7;
      const c = t1 * list.length * 7;
      for (let n = 0; n < list.length; n++) {
        const node = list[n];
        const o0 = a + n * 7;
        const o1 = c + n * 7;
        node.position.set(p[o0] + (p[o1] - p[o0]) * k, p[o0 + 1] + (p[o1 + 1] - p[o0 + 1]) * k, p[o0 + 2] + (p[o1 + 2] - p[o0 + 2]) * k);
        this.q0.set(p[o0 + 3], p[o0 + 4], p[o0 + 5], p[o0 + 6]);
        this.q1.set(p[o1 + 3], p[o1 + 4], p[o1 + 5], p[o1 + 6]);
        node.quaternion.slerpQuaternions(this.q0, this.q1, k);
      }
    }
  }

  /** Camera presets from the two fighters' recorded positions and the moment's location. */
  private updateCamera(dt: number) {
    const b = this.cur!;
    const rows = b.clip.rows;
    const t = Math.min(b.clip.len - 1, Math.floor(this.tick));
    const x0 = rowX(rows, t, 0);
    const z0 = rowZ(rows, t, 0);
    const x1 = rowX(rows, t, 1);
    const z1 = rowZ(rows, t, 1);
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    let ax = x1 - x0;
    let az = z1 - z0;
    const d = Math.hypot(ax, az) || 1;
    ax /= d;
    az /= d;
    // Perpendicular to the line between the fighters, on this clip's side.
    const nx = az * b.side;
    const nz = -ax * b.side;
    let dist: number;
    let y: number;
    let ty: number;
    let fov: number;
    let fx = mx;
    let fz = mz;
    if (this.preset === 'broadcast') {
      dist = 4.4 + d * 0.7;
      y = 2.35;
      ty = 0.95;
      fov = 42;
    } else if (this.preset === 'side') {
      dist = 3.4 + d * 0.55;
      y = 1.2;
      ty = 1.0;
      fov = 38;
    } else {
      // Close-up: halfway to where the moment happened, still both fighters in view.
      fx = (mx + b.focus[0]) / 2;
      fz = (mz + b.focus[1]) / 2;
      dist = 2.3 + d * 0.4;
      y = 1.45;
      ty = 1.12;
      fov = 34;
    }
    // Fit both fighters across the frame at any aspect (portrait phones need more distance).
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * Math.max(0.3, this.camera.aspect));
    const span = d / 2 + (this.preset === 'close' ? 0.55 : 0.85);
    dist = Math.max(dist, span / Math.tan(hHalf));
    let px = fx + nx * dist;
    let pz = fz + nz * dist;
    // Keep inside the hall: pull in along the view line if needed.
    const over = Math.max(Math.abs(px), Math.abs(pz)) / ROOM;
    if (over > 1) {
      const k = Math.max(0.45, (ROOM - Math.max(Math.abs(fx), Math.abs(fz))) / (Math.max(Math.abs(px), Math.abs(pz)) - Math.max(Math.abs(fx), Math.abs(fz)) || 1));
      px = fx + (px - fx) * Math.min(1, k);
      pz = fz + (pz - fz) * Math.min(1, k);
    }
    y = Math.min(CEIL, y);
    // Where the hall stops the camera backing off (tall portrait screens), widen the lens instead.
    const actual = Math.hypot(px - fx, pz - fz);
    if (actual < dist - 1e-3) {
      const needH = Math.atan(span / actual);
      const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(needH) / Math.max(0.3, this.camera.aspect)));
      fov = Math.min(75, Math.max(fov, vfov));
    }
    this.tmp.set(px, y, pz);
    // Restrained following; instant cuts on seek or with reduced motion.
    const kk = this.snapCam || this.o.reducedMotion ? 1 : 1 - Math.exp(-5 * dt);
    this.camPos.lerp(this.tmp, kk);
    this.camTarget.lerp(this.tmp.set(fx, ty, fz), kk);
    this.camFov += (fov - this.camFov) * kk;
    this.snapCam = false;
    const cam = this.camera;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camTarget);
    if (Math.abs(cam.fov - this.camFov) > 0.01) {
      cam.fov = this.camFov;
      cam.updateProjectionMatrix();
    }
  }

  /** Bytes held by baked clips (diagnostics). */
  bytes() {
    let n = 0;
    for (const b of this.baked.values()) n += b.poses[0].byteLength + b.poses[1].byteLength;
    return n;
  }

  dispose() {
    this.disposed = true;
    audio.endReplay();
    for (const a of this.anims) a.dispose();
    for (const c of this.chars) {
      c.group.removeFromParent();
      c.dispose();
    }
    this.fx.group.removeFromParent();
    this.fx.dispose();
    this.chars = [];
    this.anims = [];
    this.nodes = [];
    this.baked.clear();
    this.cur = null;
  }
}

/** The camera side with more room around the moment. */
function pickSide(clip: ReplayClip, t: number) {
  const x0 = rowX(clip.rows, t, 0);
  const z0 = rowZ(clip.rows, t, 0);
  const x1 = rowX(clip.rows, t, 1);
  const z1 = rowZ(clip.rows, t, 1);
  const d = Math.hypot(x1 - x0, z1 - z0) || 1;
  const nx = (z1 - z0) / d;
  const nz = -(x1 - x0) / d;
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  const room = (s: number) => ROOM - Math.max(Math.abs(mx + nx * s * 5), Math.abs(mz + nz * s * 5));
  return room(1) >= room(-1) ? 1 : -1;
}

function cuesFor(e: ReplayClip['events'][number]): Cue[] {
  switch (e.k) {
    case 'attack': {
      const kind = e.move === 'punch' ? 'punch' : e.move === 'back' || e.move === 'side' ? 'turning' : e.move.startsWith('lead') ? 'leadKick' : 'kick';
      return [{ t: e.t, k: 'attack', who: e.who, kind, strikeIn: e.strikeIn }];
    }
    case 'whiff':
      return [{ t: e.t, k: 'whiff', who: e.who }];
    case 'hit':
      return [{ t: e.t, k: 'hit', d: e.d, impact: e.move === 'punch' ? 'punch' : e.zone, heavy: e.counter || e.turning || (e.zone === 'head' && !e.move.startsWith('lead') && e.move !== 'punch'), fx: e.heavy ? 'heavy' : 'hit', point: e.point, score: e.valid ? e.points : 0 }];
    case 'block':
      return [{ t: e.t, k: 'block', d: e.d, punch: e.punch, guardBreak: e.guardBreak, point: e.point }];
    case 'ko':
      return [{ t: e.t, k: 'ko', who: e.who }];
    case 'down':
      return [{ t: e.t, k: 'thud', who: e.who }];
  }
}

/**
 * One cue through the existing sound design. At slow speeds a technique's
 * air is scheduled to its slowed extension; recordings keep their pitch
 * (time-stretching short impacts sounds worse than playing them as they are).
 */
function playCue(c: Cue, speed: number) {
  switch (c.k) {
    case 'attack':
      audio.technique({ kind: c.kind, strikeIn: c.strikeIn / speed, who: c.who });
      break;
    case 'whiff':
      audio.whiff(c.who);
      break;
    case 'hit':
      audio.impact(c.impact, c.heavy, c.d);
      if (c.score > 0) audio.score(c.score);
      break;
    case 'block':
      audio.blocked(c.punch, c.guardBreak, c.d);
      break;
    case 'ko':
      audio.knockout(c.who);
      break;
    case 'thud':
      audio.thud(c.who);
      break;
    case 'land':
      audio.land(c.who);
      break;
    case 'dash':
      audio.dash(c.who);
      break;
    case 'step':
      audio.footstep(c.who, c.pivot);
      break;
  }
}

export { rowState };
