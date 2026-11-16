import * as THREE from 'three';
import { FighterAnimator } from '../anim/FighterAnimator';
import { CombatWorld } from '../combat/CombatWorld';
import { DT } from '../config';
import { type AttackKind, emptyIntent, type FighterIntent } from '../input/actions';
import { createRng } from '../math';
import type { Belt } from '../progress/progress';
import { type BeltColor, CHARACTERS, type CharacterId, nextFighter, ROSTER, type CharacterInstance, createCharacter, loadFighterAsset } from '../render/characterFactory';
import { buildDojang, type DojangHandle } from '../render/Dojang';
import type { QualityProfile } from '../render/quality';
import { TrainingRules } from '../training/TrainingRules';

/** Camera shots used behind each menu panel. */
export type MenuShot = 'home' | 'spar' | 'training' | 'fighter' | 'progress' | 'settings';

interface Shot {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// The fighters stand on the z axis (player at z = -1.3 facing +z). The
// windows are on the +x wall, so shots from -x are softly backlit.
const SHOTS: Record<MenuShot, Shot> = {
  home: { pos: v(-5.4, 0.95, -0.9), target: v(0, 1.18, 0.1), fov: 36 },
  spar: { pos: v(-3.6, 0.6, -4.4), target: v(0.3, 1.25, 0.6), fov: 38 },
  training: { pos: v(2.3, 1.45, 1.6), target: v(-1.4, 1.05, -3.4), fov: 42 },
  // Head to shin, face never cropped (Phase 10).
  fighter: { pos: v(-2.9, 1.32, 0.35), target: v(0, 1.1, -1.3), fov: 34 },
  progress: { pos: v(-4.2, 1.65, 1.9), target: v(-6.9, 1.55, -0.6), fov: 40 },
  settings: { pos: v(4.6, 3.1, 4.4), target: v(0, 0.9, 0), fov: 44 },
};

/** Cached fighter instances kept at most (six bare-head previews plus the headgear-on pair and a little slack). */
const CACHE_MAX = 10;

interface Cached {
  inst: CharacterInstance;
  anim: FighterAnimator;
}

const SHADOW_KICKS: AttackKind[] = ['round', 'leadRound', 'front', 'side', 'punch', 'leadFront'];

export interface MenuStageOptions {
  quality: QualityProfile;
  fighter: CharacterId;
  belt: Belt;
  reducedMotion: boolean;
}

/**
 * The live dojang behind the main menu: the same environment, character
 * build and procedural animator as a match, but no AI, input, HUD or audio.
 * Two fighters hold their stances and occasionally shadow-spar out of range,
 * while the camera eases between composed shots. One WebGLRenderer, capped
 * at 30 FPS, disposed (with its context) before a match starts.
 */
export class MenuStage {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
  private readonly world = new CombatWorld(new TrainingRules(), [CHARACTERS.jae.stats, CHARACTERS.hana.stats]);
  /** Debug and checks: how many fighter instances are built. */
  get cachedInstances() {
    return this.cache.size;
  }
  private env: DojangHandle | null = null;
  /** Fighter instances by id + headgear + corner + belt: built once, then shown or hidden (never rebuilt on selection). */
  private readonly cache = new Map<string, Cached>();
  /** The two fighters on the mats (player, opponent). */
  private active: [Cached | null, Cached | null] = [null, null];
  private shotName: MenuShot = 'home';
  /** Soft key on the selected fighter's face, fighter shot only (intensity 0 elsewhere: no shader recompiles). */
  private faceLight: THREE.SpotLight | null = null;
  private prebuild: CharacterId[] = [];
  private dust: THREE.Points | null = null;
  private dustVel: Float32Array | null = null;
  private shot: Shot = SHOTS.home;
  private readonly camPos = SHOTS.home.pos.clone();
  private readonly camTarget = SHOTS.home.target.clone();
  private camFov = SHOTS.home.fov;
  private time = 0;
  private acc = 0;
  private nextMove = 4;
  private readonly rng = createRng(11);
  private readonly intents: [FighterIntent, FighterIntent] = [emptyIntent(), emptyIntent()];
  private raf = 0;
  private last = 0;
  private frameAcc = 0;
  private disposed = false;
  private o: MenuStageOptions;
  private gltf: Awaited<ReturnType<typeof loadFighterAsset>> | null = null;

  constructor(canvas: HTMLCanvasElement, o: MenuStageOptions) {
    this.o = o;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: o.quality.antialias, powerPreference: 'default', stencil: false, alpha: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    // The menu does not need full resolution: it sits behind a gradient.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.quality.tier === 'high' ? 1.5 : o.quality.tier === 'medium' ? 1.25 : 1));
    this.renderer.shadowMap.enabled = o.quality.tier === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color('#120d09');
    this.scene.fog = new THREE.Fog('#140d08', 6, 21);
    this.world.skipIntro = true;
    this.world.resetMatch();
  }

  async init() {
    this.gltf = await loadFighterAsset();
    if (this.disposed) return;
    this.env = buildDojang({ ...this.o.quality, shadows: this.o.quality.tier === 'high', shadowMapSize: 1024 });
    this.scene.add(this.env.group);
    // Menu grade: less flat fill, a warmer and stronger window key, so the
    // room falls off into shadow and the fighters read as lit figures.
    this.env.group.traverse((o) => {
      if ((o as THREE.HemisphereLight).isHemisphereLight) (o as THREE.HemisphereLight).intensity = 0.5;
    });
    this.env.sun.intensity = 3.2;
    this.env.sun.color.set('#ffd7a3');
    const rim = new THREE.PointLight('#ffb070', 6, 9, 1.6);
    rim.position.set(3.5, 2.4, 0.4);
    this.env.group.add(rim);
    // Face light for the fighter shot (deep skin tones need it). Always in the
    // scene so toggling it never changes the light count (that would recompile shaders).
    const fl = new THREE.SpotLight('#ffe2bf', 0, 6, 0.5, 0.8, 1.5);
    fl.position.set(-1.6, 2.1, 0.4);
    fl.target.position.set(0, 1.55, -1.3);
    this.scene.add(fl, fl.target);
    this.faceLight = fl;
    this.showFighters();
    this.buildDust();
  }

  /** A fighter instance from the cache, built on first use. */
  private instance(id: CharacterId, corner: 'chung' | 'hong', belt: BeltColor, headgear: boolean): Cached {
    const key = `${id}:${corner}:${belt}:${headgear ? 'on' : 'off'}`;
    let c = this.cache.get(key);
    if (c) {
      // Most recently used goes last (eviction takes the oldest).
      this.cache.delete(key);
      this.cache.set(key, c);
      return c;
    }
    const inst = createCharacter(this.gltf!, CHARACTERS[id], corner, belt, { headgear });
    inst.group.visible = false;
    this.scene.add(inst.group);
    c = { inst, anim: new FighterAnimator(inst.group, inst.model, inst.clips, corner === 'chung' ? 7 : 8, { floorProbe: false }) };
    this.cache.set(key, c);
    // Bounded: drop the least recently used hidden instance.
    while (this.cache.size > CACHE_MAX) {
      const [oldKey, old] = [...this.cache].find(([, v]) => v !== this.active[0] && v !== this.active[1] && v !== c) ?? [];
      if (!oldKey || !old) break;
      this.cache.delete(oldKey);
      this.drop(old);
    }
    return c;
  }

  private drop(c: Cached) {
    c.anim.dispose();
    c.inst.group.removeFromParent();
    c.inst.dispose();
  }

  /** Put the right two fighters on the mats: the player bare-headed in the fighter shot, otherwise in headgear. */
  private showFighters() {
    if (!this.gltf) return;
    const me = this.o.fighter;
    const bare = this.shotName === 'fighter';
    // The opponent is out of frame in the fighter shot: it follows the
    // selection when the camera next shows it (behind the same dim), so the
    // cache holds six previews plus one or two opponents, never rebuilding.
    const opp = this.opp ?? { id: nextFighter(me), belt: 'black' as BeltColor };
    const opponent = bare && this.active[1] ? this.active[1] : this.instance(opp.id, 'hong', opp.belt, true);
    const next: [Cached, Cached] = [this.instance(me, 'chung', this.o.belt, !bare), opponent];
    for (let i = 0; i < 2; i++) {
      if (this.active[i] === next[i]) continue;
      if (this.active[i]) this.active[i]!.inst.group.visible = false;
      next[i].inst.group.visible = true;
      this.active[i] = next[i];
    }
    const [a, b] = this.world.fighters;
    if (a.x !== 0 || Math.abs(a.z + 1.3) > 0.5) {
      a.x = b.x = 0;
      a.z = -1.3;
      b.z = 1.3;
    }
  }

  /**
   * Fighter-select: build the six bare-head previews ahead of time, one per
   * idle moment, the selected fighter first, so switching never builds
   * geometry while the player is looking.
   */
  private schedulePrebuild() {
    if (!this.gltf || this.prebuild.length) return;
    const me = this.o.fighter;
    this.prebuild = [me, ...ROSTER.filter((id) => id !== me)];
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o: { timeout: number }) => number }).requestIdleCallback;
    const idle = (fn: () => void) => (ric ? ric(fn, { timeout: 400 }) : window.setTimeout(fn, 60));
    const next = () => {
      if (this.disposed) return;
      const id = this.prebuild.shift();
      if (!id) return;
      this.instance(id, 'chung', this.o.belt, false);
      // Keep the active pair most recently used, so the cache never evicts them.
      for (const a of this.active) if (a) this.touch(a);
      idle(next);
    };
    idle(next);
  }

  private touch(c: Cached) {
    for (const [k, v] of this.cache)
      if (v === c) {
        this.cache.delete(k);
        this.cache.set(k, v);
        return;
      }
  }

  /** Dust motes drifting through the window light (one draw call). */
  private buildDust() {
    const n = this.o.quality.tier === 'low' ? 70 : 160;
    const pos = new Float32Array(n * 3);
    this.dustVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = -2 + this.rng() * 8;
      pos[i * 3 + 1] = 0.2 + this.rng() * 3.4;
      pos[i * 3 + 2] = -3 + this.rng() * 6;
      this.dustVel[i] = 0.02 + this.rng() * 0.05;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: '#ffd9a0', size: 0.022, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    this.dust = new THREE.Points(geo, mat);
    this.scene.add(this.dust);
  }

  /** A specific opponent (a Dojang Open bout, at its AI belt), or null for the next fighter in roster order. */
  private opp: { id: CharacterId; belt: BeltColor } | null = null;
  setOpponent(o: { id: CharacterId; belt: BeltColor } | null) {
    if (o?.id === this.opp?.id && o?.belt === this.opp?.belt) return;
    this.opp = o;
    this.showFighters();
  }

  /** Show another fighter (a cached instance: no rebuild once built). */
  setFighter(id: CharacterId, belt: Belt) {
    if (id === this.o.fighter && belt === this.o.belt) return;
    this.o = { ...this.o, fighter: id, belt };
    this.showFighters();
  }

  /** The player's headgear is off only in the fighter shot; the face light follows it. */
  get bare() {
    return this.shotName === 'fighter';
  }

  setShot(s: MenuShot) {
    const wasBare = this.bare;
    this.shotName = s;
    this.shot = SHOTS[s];
    if (this.faceLight) this.faceLight.intensity = s === 'fighter' ? 9 : 0;
    if (s === 'fighter') this.schedulePrebuild();
    if (this.bare !== wasBare) this.showFighters();
    if (this.o.reducedMotion) {
      this.camPos.copy(this.shot.pos);
      this.camTarget.copy(this.shot.target);
      this.camFov = this.shot.fov;
    }
  }

  start(onFirstFrame?: () => void) {
    let first = true;
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 30;
      this.last = now;
      this.frameAcc += dt;
      // 30 FPS cap: slow cinematic motion does not need more, and it halves GPU work.
      if (this.frameAcc < 1 / 31 && !first) return;
      const step = this.frameAcc;
      this.frameAcc = 0;
      this.update(step);
      this.renderer.render(this.scene, this.camera);
      if (first) {
        first = false;
        onFirstFrame?.();
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  private update(dt: number) {
    this.time += dt;
    this.resize();
    const w = this.world;
    // Fixed-step simulation with idle intents and the odd shadow-sparring technique.
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      const [ia, ib] = this.intents;
      ia.attack = ib.attack = null;
      ia.moveZ = ib.moveZ = 0;
      if (!this.o.reducedMotion && (this.nextMove -= DT) <= 0) {
        this.nextMove = 5 + this.rng() * 4;
        const who = this.rng() < 0.6 ? 0 : 1;
        this.intents[who].attack = SHADOW_KICKS[Math.floor(this.rng() * SHADOW_KICKS.length)];
      }
      // Drift back to the marks so the composition holds (well out of range).
      const [a, b] = w.fighters;
      if (a.actionable && Math.abs(a.z + 1.3) > 0.12) ia.moveZ = a.z < -1.3 ? 0.5 : -0.5;
      if (b.actionable && Math.abs(b.z - 1.3) > 0.12) ib.moveZ = b.z > 1.3 ? -0.5 : 0.5;
      for (const f of w.fighters) f.stamina = 100;
      w.step(this.intents);
      w.events.length = 0;
    }
    // Only the two fighters on the mats animate; cached ones stay hidden and idle.
    w.fighters.forEach((f, i) => this.active[i]?.anim.update(f, 0, f.x, f.z, f.yaw, dt));

    // Camera: ease toward the panel's shot with a slow handheld drift.
    const k = 1 - Math.exp(-dt * 2.4);
    this.camPos.lerp(this.shot.pos, k);
    this.camTarget.lerp(this.shot.target, k);
    this.camFov += (this.shot.fov - this.camFov) * k;
    const t = this.o.reducedMotion ? 0 : this.time;
    const cam = this.camera;
    // Barely-there drift: the room should feel alive, never seasick.
    cam.position.set(this.camPos.x + Math.sin(t * 0.09) * 0.08, this.camPos.y + Math.sin(t * 0.15) * 0.015, this.camPos.z + Math.cos(t * 0.08) * 0.06);
    const portrait = cam.aspect < 0.9;
    // Portrait: pull back and lower the aim so the fighters sit above the menu.
    if (portrait) {
      cam.position.lerp(this.camTarget, -0.3);
      cam.position.y += 0.7;
    }
    cam.fov = this.camFov * (portrait ? 1.7 : 1);
    cam.lookAt(this.camTarget.x, this.camTarget.y - (portrait ? 1.35 : 0), this.camTarget.z);
    // Wide screens: shift the subject right of centre, leaving the left for the menu.
    cam.filmOffset = cam.aspect > 1.15 ? -0.2 * cam.getFilmWidth() : 0;
    cam.updateProjectionMatrix();

    if (this.dust && this.dustVel && !this.o.reducedMotion) {
      const p = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = p.array as Float32Array;
      for (let i = 0; i < this.dustVel.length; i++) {
        arr[i * 3 + 1] += this.dustVel[i] * dt;
        arr[i * 3] += Math.sin(this.time * 0.3 + i) * 0.01 * dt;
        if (arr[i * 3 + 1] > 3.6) arr[i * 3 + 1] = 0.2;
      }
      p.needsUpdate = true;
    }
  }

  private resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const c of this.cache.values()) this.drop(c);
    this.cache.clear();
    this.active = [null, null];
    this.env?.dispose();
    if (this.dust) {
      this.dust.geometry.dispose();
      (this.dust.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
    // Free the GL context now so the match canvas never competes with it. A
    // lost context paints the canvas white, so hide it first (no white frame).
    this.renderer.domElement.style.visibility = 'hidden';
    this.renderer.forceContextLoss();
  }
}
