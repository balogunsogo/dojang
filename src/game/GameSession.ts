import * as THREE from 'three';
import { AIController, type Difficulty } from './ai/AIController';
import { FighterAnimator } from './anim/FighterAnimator';
import { audio } from './audio/AudioEngine';
import { CameraRig } from './camera/CameraRig';
import { type CombatEvent, CombatWorld } from './combat/CombatWorld';
import { DT, MAX_STEPS_PER_FRAME } from './config';
import { type ActionState, emptyIntent, type FighterIntent } from './input/actions';
import type { InputManager } from './input/InputManager';
import { approachAngle, wrapAngle } from './math';
import { PerfMonitor } from './perf/PerfMonitor';
import { type BeltColor, CHARACTERS, type CharacterDef, type CharacterId, type CharacterInstance, createCharacter, loadFighterAsset } from './render/characterFactory';
import { buildDojang, type DojangHandle } from './render/Dojang';
import { Effects } from './render/Effects';
import { DynamicResolution, type QualityProfile } from './render/quality';
import { CompetitiveRules } from './rules/competitive/CompetitiveRules';
import { ArcadeRules, type Ruleset } from './rules/rules';
import type { Belt, TrainingResult } from './progress/progress';
import { activityById } from './training/activities';
import { TrainingController, type TrainingHud } from './training/TrainingController';
import { TrainingRules } from './training/TrainingRules';
import type { HudState, Toast } from '../store/useGameStore';
import type { PerfSnapshot } from './perf/PerfMonitor';

export interface SessionCallbacks {
  onHud(h: HudState): void;
  onToast(t: Omit<Toast, 'id'>, ms?: number): void;
  onPerf(p: PerfSnapshot): void;
  onPauseToggle(): void;
  /** Training HUD snapshot (training mode only). */
  onTrainingHud?(h: TrainingHud): void;
  /** Training activity finished (completed, failed or ended by the player). */
  onTrainingEnd?(r: TrainingResult): void;
  /** Arcade/Competitive match finished; `won` is from the player's side. */
  onMatchEnd?(won: boolean): void;
}

export interface SessionOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  gl: THREE.WebGLRenderer;
  input: InputManager;
  quality: QualityProfile;
  difficulty: Difficulty;
  aiEnabled: boolean;
  mode: MatchMode;
  /** Competitive round length (s). */
  roundSeconds?: 60 | 90 | 120;
  /** Fighter controlled by the player (the other one is the opponent / partner). */
  playerCharacter?: CharacterId;
  /** Player belt (progression), shown on the dobok. */
  playerBelt?: Belt;
  /** Training activity id (training mode). */
  activity?: string;
  callbacks: SessionCallbacks;
}

/** Opponent belt by AI difficulty (presentation; matches the menu labels). */
const AI_BELT: Record<Difficulty, BeltColor> = { easy: 'white', normal: 'red', hard: 'black' };

export type MatchMode = 'arcade' | 'competitive' | 'training';

interface Prev {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Orchestrates one sparring session: fixed-step simulation, AI, input
 * mapping, animation, camera, effects, audio and HUD publishing. React only
 * mounts it; nothing here runs inside React render.
 */
export class GameSession {
  readonly world: CombatWorld;
  readonly ai: AIController;
  readonly camRig = new CameraRig();
  readonly perf = new PerfMonitor();
  private readonly o: SessionOptions;
  private chars: CharacterInstance[] = [];
  private anims: FighterAnimator[] = [];
  private env: DojangHandle | null = null;
  private fx: Effects | null = null;
  private acc = 0;
  private prev: [Prev, Prev] = [
    { x: 0, z: 0, yaw: 0 },
    { x: 0, z: 0, yaw: 0 },
  ];
  private hudTimer = 0;
  private perfTimer = 0;
  private lastPhase = '';
  private dynRes: DynamicResolution;
  paused = false;
  ready = false;
  /** Visual yaw per fighter, smoothed toward the sim yaw. */
  private visYaw = [0, Math.PI];
  readonly defs: [CharacterDef, CharacterDef];
  /** Training activity controller (training mode only). */
  training: TrainingController | null = null;
  private trainingReported = false;
  private matchReported = false;

  constructor(o: SessionOptions) {
    this.o = o;
    const me = o.playerCharacter ?? 'jae';
    this.defs = [CHARACTERS[me], CHARACTERS[me === 'jae' ? 'hana' : 'jae']];
    const rules: Ruleset =
      o.mode === 'competitive'
        ? new CompetitiveRules(o.roundSeconds ? { roundSeconds: o.roundSeconds } : {})
        : o.mode === 'training'
          ? new TrainingRules()
          : ArcadeRules;
    this.world = new CombatWorld(rules, [this.defs[0].stats, this.defs[1].stats]);
    if (o.mode === 'training') {
      this.training = new TrainingController(activityById(o.activity ?? 'practice'));
      this.world.skipIntro = true;
      this.resetTraining();
    }
    this.ai = new AIController(o.difficulty, (Date.now() & 0xffff) + 1);
    this.dynRes = new DynamicResolution(o.quality, window.devicePixelRatio || 1);
  }

  async init() {
    const gltf = await loadFighterAsset();
    this.env = buildDojang(this.o.quality);
    this.o.scene.add(this.env.group);
    const corners = ['chung', 'hong'] as const;
    for (let i = 0; i < 2; i++) {
      const belt: BeltColor = i === 0 ? (this.o.playerBelt ?? 'white') : this.training ? 'black' : AI_BELT[this.o.difficulty];
      const c = createCharacter(gltf, this.defs[i], corners[i], belt);
      this.o.scene.add(c.group);
      this.chars.push(c);
      this.anims.push(new FighterAnimator(c.group, c.model, c.clips, i + 1));
    }
    this.fx = new Effects(!this.o.quality.shadows, this.world.rules.boundary);
    this.o.scene.add(this.fx.group);
    this.syncPrev();
    this.ready = true;
    audio.setAmbient(true);
  }

  private syncPrev() {
    this.world.fighters.forEach((f, i) => {
      this.prev[i] = { x: f.x, z: f.z, yaw: f.yaw };
      this.visYaw[i] = f.yaw;
    });
  }

  rematch() {
    if (this.training) {
      this.training = new TrainingController(this.training.activity);
      this.trainingReported = false;
      this.resetTraining();
    } else this.world.resetMatch();
    this.matchReported = false;
    this.syncPrev();
    this.lastPhase = '';
  }

  /** Training: partner stands in kicking range in front of the player. */
  private resetTraining() {
    this.world.resetMatch();
    const [p, partner] = this.world.fighters;
    p.z = -0.8;
    partner.z = 0.8;
    this.world.events.length = 0;
  }

  /** End the current training activity now (practice has no end condition). */
  finishTraining() {
    if (!this.training || this.trainingReported) return;
    this.trainingReported = true;
    this.o.callbacks.onTrainingEnd?.(this.training.result());
  }

  private shakeScale = 1;
  private lastSteps = [0, 0];
  private staminaWarned = false;

  /** Comfort and camera preferences (applied live from settings). */
  setPrefs(p: { cameraAssist: boolean; reduceShake: boolean; reduceFlash: boolean }) {
    this.camRig.assist = p.cameraAssist;
    this.shakeScale = p.reduceShake ? 0.15 : 1;
    if (this.fx) this.fx.reduced = p.reduceFlash;
  }

  private shake(amount: number) {
    this.camRig.addShake(amount * this.shakeScale);
  }

  /** Competitive rules instance (null in Arcade). */
  get competitive(): CompetitiveRules | null {
    return this.world.rules instanceof CompetitiveRules ? this.world.rules : null;
  }

  private readonly pIntent: FighterIntent = emptyIntent();

  /** Map device actions (camera-relative) to a world-space fighter intent (reused object: no per-tick allocation). */
  private playerIntent(a: ActionState): FighterIntent {
    const intent = this.pIntent;
    const yaw = this.camRig.viewYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // Camera right = (-fz, fx).
    intent.moveX = -fz * a.moveX + fx * a.moveY;
    intent.moveZ = fx * a.moveX + fz * a.moveY;
    intent.guard = a.guard;
    intent.attack = a.attack;
    intent.height = a.attackHeight ?? (a.high ? 'head' : 'body');
    intent.dash = a.dash;
    intent.switchStance = a.switchStance;
    return intent;
  }

  frame(dtRaw: number) {
    if (!this.ready) return;
    const dt = Math.min(dtRaw, 0.1);
    const t0 = performance.now();
    const actions = this.o.input.poll();
    if (actions.pause) {
      this.o.input.consumeEdges();
      this.o.callbacks.onPauseToggle();
    }
    if (actions.toggleLock) this.camRig.lockOn = !this.camRig.lockOn;
    this.camRig.input(actions.camYaw, actions.camPitch, actions.camZoom);

    const w = this.world;
    const [p, o] = w.fighters;
    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      let first = true;
      while (this.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
        this.syncPrevPositions();
        const pi = this.playerIntent(actions);
        if (!first) {
          pi.attack = null;
          pi.dash = false;
          pi.switchStance = false;
        }
        const ai = this.training ? this.training.partnerIntent(w) : this.o.aiEnabled ? this.ai.think(w, o, p) : emptyIntent();
        w.step([pi, ai]);
        this.trainingTick();
        if (first) this.o.input.consumeEdges();
        first = false;
        this.acc -= DT;
        steps++;
        this.handleEvents();
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    } else {
      this.o.input.consumeEdges();
    }
    const t1 = performance.now();

    // Render interpolation.
    const alpha = w.hitstop > 0 || this.paused ? 1 : this.acc / DT;
    const animAlpha = w.hitstop > 0 || this.paused ? 0 : this.acc / DT;
    w.fighters.forEach((f, i) => {
      const pr = this.prev[i];
      const x = pr.x + (f.x - pr.x) * alpha;
      const z = pr.z + (f.z - pr.z) * alpha;
      const yaw = pr.yaw + wrapAngle(f.yaw - pr.yaw) * alpha;
      this.visYaw[i] = approachAngle(this.visYaw[i], yaw, 14 * dt);
      this.anims[i].update(f, animAlpha, x, z, this.visYaw[i], w.hitstop > 0 || this.paused ? 0 : dt);
    });
    const t2 = performance.now();
    this.audioCues();

    const el = this.o.gl.domElement;
    this.camRig.update(this.o.camera, dt, p.x, p.z, o.x, o.z, el.clientWidth, el.clientHeight);
    if (this.training && this.fx) {
      const t = this.training;
      this.fx.setTarget(t.finished ? null : t.target ?? (t.activity.target === 'any' ? 'body' : null), o.x, o.z, o.yaw);
    }
    this.fx?.update(dt, this.o.camera, w.fighters);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / 12;
      this.publishHud(actions);
    }
    this.perf.frame(dtRaw, t1 - t0, t2 - t1);
    this.perfTimer -= dt;
    if (this.perfTimer <= 0) {
      this.perfTimer = 0.5;
      this.o.callbacks.onPerf(this.perf.sample(this.o.gl, this.o.quality.tier));
      const newDpr = this.dynRes.update(0.5, this.perf.avgMs, window.devicePixelRatio || 1);
      if (newDpr !== null) this.o.gl.setPixelRatio(newDpr);
    }
  }

  /** Feed this tick's events to the training controller and surface its feedback. */
  private trainingTick() {
    const t = this.training;
    if (!t) return;
    t.update(this.world);
    for (const f of t.feedback) {
      audio.feedback(f.good);
      this.o.callbacks.onToast({ text: f.text, sub: f.sub, side: null, kind: f.good ? 'score' : 'info' }, f.good ? 900 : 1100);
    }
    t.feedback.length = 0;
    if (t.finished && !this.trainingReported) {
      if (t.done) audio.fanfare();
      this.finishTraining();
    }
  }

  /** Footsteps and the low-stamina warning. */
  private audioCues() {
    for (let i = 0; i < 2; i++) {
      const n = this.anims[i].steps;
      if (n !== this.lastSteps[i]) {
        this.lastSteps[i] = n;
        audio.footstep(i === 0 ? 1 : 0.6);
      }
    }
    const p = this.world.fighters[0];
    if (this.world.phase === 'fight' && p.stamina < 15 && !this.staminaWarned) {
      this.staminaWarned = true;
      audio.staminaWarning();
      this.o.callbacks.onToast({ text: 'Low stamina', sub: 'Step back and breathe', side: 0, kind: 'info' }, 1200);
    } else if (p.stamina > 35) this.staminaWarned = false;
  }

  private syncPrevPositions() {
    this.world.fighters.forEach((f, i) => {
      const pr = this.prev[i];
      pr.x = f.x;
      pr.z = f.z;
      pr.yaw = f.yaw;
    });
  }

  private handleEvents() {
    const w = this.world;
    const toast = this.o.callbacks.onToast;
    if (w.phase !== this.lastPhase) {
      if (w.phase === 'intro') toast({ text: `Round ${w.round}`, sub: 'Joon-bi! (Ready)', side: null, kind: 'call' }, 1600);
      if (w.phase === 'fight' && this.lastPhase === 'intro') toast({ text: 'Shi-jak!', sub: 'Begin', side: null, kind: 'call' }, 900);
      if (w.phase === 'fight' && this.lastPhase === 'break') toast({ text: 'Kye-sok!', sub: 'Continue', side: null, kind: 'call' }, 800);
      this.lastPhase = w.phase;
    }
    for (const e of w.events) this.onEvent(e);
    w.events.length = 0;
  }

  private onEvent(e: CombatEvent) {
    const toast = this.o.callbacks.onToast;
    switch (e.type) {
      case 'attack':
        if (e.move.limb === 'rearFoot') audio.whoosh(e.move.id === 'back' || e.move.id === 'side' ? 1.3 : 1);
        else audio.whoosh(0.5);
        break;
      case 'hit': {
        const heavy = e.counter || e.zone === 'head' || e.move.pushback > 3;
        audio.hit(e.zone, heavy);
        this.fx?.spawn(e.point, heavy ? 'heavy' : 'hit');
        this.shake(heavy ? 0.07 : 0.035);
        if (this.training) break; // training gives its own feedback
        if (e.valid !== undefined) {
          // Competitive: say exactly what scored, or why it did not.
          if (e.valid) {
            audio.score(e.points);
            toast({ text: `+${e.points} ${e.label}`, side: e.attacker, kind: 'score' }, 1300);
          } else toast({ text: 'No point', sub: e.reason, side: e.attacker, kind: 'info' }, 1000);
          break;
        }
        if (e.counter) toast({ text: 'Counter!', side: e.attacker, kind: 'hit' });
        else if (e.zone === 'head') toast({ text: 'Head kick!', side: e.attacker, kind: 'hit' });
        else if (e.move.turning) toast({ text: 'Turning kick!', side: e.attacker, kind: 'hit' });
        break;
      }
      case 'block':
        audio.block();
        this.fx?.spawn(e.point, 'block');
        if (e.guardBreak) toast({ text: 'Guard break!', side: e.attacker, kind: 'hit' });
        break;
      case 'ko':
        toast({ text: 'K.O.', side: e.fighter === 0 ? 1 : 0, kind: 'call' }, 2000);
        this.shake(0.1);
        break;
      case 'round-start':
        audio.bell(1);
        break;
      case 'round-end': {
        audio.bell(3);
        const who = e.winner === null ? 'Round drawn' : `${this.defs[e.winner].short} wins the round`;
        const why = e.detail ?? (e.reason === 'time' ? 'Time' : e.reason === 'ko' ? 'K.O.' : '');
        toast({ text: 'Keu-man!', sub: `${who}${why ? ` — ${why}` : ''}`, side: null, kind: 'call' }, 2600);
        break;
      }
      case 'penalty': {
        audio.penalty();
        const opp = 1 - e.fighter;
        toast({ text: `Gam-jeom · ${this.defs[e.fighter].short}`, sub: `${e.label} — +${e.pointsToOpponent} ${this.defs[opp].short}`, side: e.fighter, kind: 'penalty' }, 1800);
        if (e.reason === 'boundary') this.fx?.flashBoundary();
        break;
      }
      case 'stoppage':
        toast({ text: 'Kal-yeo!', sub: e.reason, side: null, kind: 'call' }, 900);
        break;
      case 'down':
        audio.thud();
        this.shake(0.06);
        if (e.cause === 'knockdown') toast({ text: 'Knockdown', sub: `${this.defs[e.fighter].short} is down`, side: null, kind: 'call' }, 1400);
        break;
      case 'match-end':
        if (!this.matchReported && !this.training) {
          this.matchReported = true;
          this.o.callbacks.onMatchEnd?.(e.winner === 0);
        }
        break;
    }
  }

  private publishHud(a: ActionState) {
    if (this.training) this.o.callbacks.onTrainingHud?.(this.training.hud());
    const w = this.world;
    const [p, o] = w.fighters;
    this.o.callbacks.onHud({
      names: [this.defs[0].name, this.defs[1].name],
      shortNames: [this.defs[0].short, this.defs[1].short],
      health: [p.health, o.health],
      maxHealth: [p.stats.maxHealth, o.stats.maxHealth],
      stamina: [p.stamina, o.stamina],
      seconds: w.secondsLeft,
      round: w.round,
      wins: [...w.roundWins] as [number, number],
      roundsToWin: w.rules.roundsToWin,
      phase: w.phase,
      matchWinner: w.matchWinner,
      lastRoundWinner: w.lastRoundWinner,
      high: a.high,
      lockOn: this.camRig.lockOn,
      stance: p.stance,
      mode: this.competitive ? 'competitive' : 'arcade',
      points: [w.points[0], w.points[1]],
      gamjeom: this.competitive ? [this.competitive.stats[0].gamjeom, this.competitive.stats[1].gamjeom] : [0, 0],
      gamjeomMatch: this.competitive ? [this.competitive.matchGamjeom[0], this.competitive.matchGamjeom[1]] : [0, 0],
      lead: a.lead,
    });
  }

  dispose() {
    this.ready = false;
    audio.setAmbient(false);
    for (const a of this.anims) a.dispose();
    for (const c of this.chars) c.dispose();
    this.env?.dispose();
    this.fx?.dispose();
    this.chars = [];
    this.anims = [];
  }
}
