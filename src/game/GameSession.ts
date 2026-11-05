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
import { type NetMsg, Rollback } from './netplay/Rollback';
import { PerfMonitor } from './perf/PerfMonitor';
import { type BeltColor, CHARACTERS, type CharacterDef, type CharacterId, type CharacterInstance, createCharacter, loadFighterAsset } from './render/characterFactory';
import { buildDojang, type DojangHandle } from './render/Dojang';
import { Effects } from './render/Effects';
import { DynamicResolution, type QualityProfile } from './render/quality';
import { CompetitiveRules } from './rules/competitive/CompetitiveRules';
import { ArcadeRules, type Ruleset } from './rules/rules';
import type { Belt, TrainingResult } from './progress/progress';
import { activityById } from './training/activities';
import { Coach, type CoachTip, type InputScheme } from './training/Coach';
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
  /** Training coach: the visible tip (or null) and the active input scheme. */
  onCoach?(tip: CoachTip | null, scheme: InputScheme): void;
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
  /** Who controls the other fighter (default: the AI). */
  opponent?: 'ai' | 'local' | 'online';
  /** Fighters for both corners (versus modes). Overrides playerCharacter. */
  characters?: [CharacterId, CharacterId];
  belts?: [Belt, Belt];
  /** Couch: second player's controls. */
  input2?: InputManager;
  /** Online: which corner this player controls, and the link to the other peer. */
  me?: 0 | 1;
  net?: NetLink;
  /** Online: this player hosts the room (its state wins on a desync). */
  netHost?: boolean;
  /** Player names shown on the HUD (couch / online). */
  names?: [string, string];
  callbacks: SessionCallbacks;
}

/** Message link to the other player (online). */
export interface NetLink {
  send(m: NetMsg): void;
  onMessage: ((m: NetMsg) => void) | null;
}

/** Opponent belt by AI difficulty (presentation; matches the menu labels). */
const AI_BELT: Record<Difficulty, BeltColor> = { easy: 'white', normal: 'red', hard: 'black' };

const _ap = new THREE.Vector3();

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
  /** Training coach (observes only; never changes outcomes). */
  coach: Coach | null = null;
  private coachPrefs = { enabled: true, showTouch: false, controlScheme: 'compact' as 'compact' | 'classic' };
  private lastScheme: InputScheme | null = null;
  private trainingReported = false;
  private matchReported = false;
  /** Corner this player controls (0 unless playing online as the guest). */
  readonly me: 0 | 1;
  /** Online rollback (null offline). */
  readonly net: Rollback | null = null;
  private seenEvents = new Map<string, number>();
  private overFrame: number | null = null;

  constructor(o: SessionOptions) {
    this.o = o;
    this.me = o.me ?? 0;
    const pc = o.playerCharacter ?? 'jae';
    const ids = o.characters ?? [pc, pc === 'jae' ? 'hana' : 'jae'];
    this.defs = [CHARACTERS[ids[0]], CHARACTERS[ids[1]]];
    const rules: Ruleset =
      o.mode === 'competitive'
        ? new CompetitiveRules(o.roundSeconds ? { roundSeconds: o.roundSeconds } : {})
        : o.mode === 'training'
          ? new TrainingRules()
          : ArcadeRules;
    this.world = new CombatWorld(rules, [this.defs[0].stats, this.defs[1].stats]);
    if (o.mode === 'training') {
      this.training = new TrainingController(activityById(o.activity ?? 'practice'));
      this.coach = new Coach(this.training.activity, 'keyboard', true);
      this.world.skipIntro = true;
      this.resetTraining();
    }
    this.ai = new AIController(o.difficulty, (Date.now() & 0xffff) + 1);
    if (o.opponent === 'online' && o.net) {
      const net = new Rollback(this.world, this.me, (m) => o.net!.send(m), { host: !!o.netHost });
      this.net = net;
      o.net.onMessage = (m) => net.receive(m);
    }
    this.dynRes = new DynamicResolution(o.quality, window.devicePixelRatio || 1);
  }

  async init() {
    const gltf = await loadFighterAsset();
    this.env = buildDojang(this.o.quality);
    this.o.scene.add(this.env.group);
    const corners = ['chung', 'hong'] as const;
    for (let i = 0; i < 2; i++) {
      const belt: BeltColor = this.o.belts?.[i] ?? (i === 0 ? (this.o.playerBelt ?? 'white') : this.training ? 'black' : AI_BELT[this.o.difficulty]);
      const c = createCharacter(gltf, this.defs[i], corners[i], belt);
      this.o.scene.add(c.group);
      this.chars.push(c);
      this.anims.push(new FighterAnimator(c.group, c.model, c.clips, i + 1));
    }
    this.fx = new Effects(!this.o.quality.shadows, this.world.rules.boundary);
    this.o.scene.add(this.fx.group);
    this.syncPrev();
    this.ready = true;
    audio.player = this.me;
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
      this.coach = new Coach(this.training.activity, this.inputScheme(), this.coachPrefs.enabled);
      this.publishCoach(true);
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
    this.coach?.stop();
    this.publishCoach();
    this.o.callbacks.onTrainingEnd?.(this.training.result());
  }

  /** Which controls the player is using: gamepad or keyboard once used, otherwise the touch layout if shown. */
  inputScheme(): InputScheme {
    const inp = this.o.input;
    if (inp.lastDevice === 'gamepad') return 'gamepad';
    if (inp.lastDevice === 'keyboard' && inp.keyboardUsed) return 'keyboard';
    return this.coachPrefs.showTouch ? this.coachPrefs.controlScheme : 'keyboard';
  }

  /** Training tips preferences and the touch layout (for input-aware wording). */
  setCoachPrefs(p: { enabled: boolean; showTouch: boolean; controlScheme: 'compact' | 'classic' }) {
    this.coachPrefs = p;
    if (this.coach) {
      this.coach.enabled = p.enabled;
      if (!p.enabled && this.coach.current && !this.coach.current.manual) this.coach.dismiss();
    }
    this.publishCoach(true);
  }

  /** Manual help: always available, even with automatic tips off. */
  coachHint() {
    if (!this.coach || !this.training || this.training.finished) return;
    this.coach.scheme = this.inputScheme();
    this.coach.hint(this.training);
    this.publishCoach();
  }

  coachDismiss() {
    this.coach?.dismiss();
    this.publishCoach();
  }

  private publishCoach(force = false) {
    const c = this.coach;
    if (!c) return;
    const scheme = this.inputScheme();
    if (force || c.changed || scheme !== this.lastScheme) {
      c.changed = false;
      this.lastScheme = scheme;
      this.o.callbacks.onCoach?.(c.current, scheme);
    }
  }

  private shakeScale = 1;
  private lastSteps = [0, 0];
  private prevState: string[] = ['', ''];
  private lastWasKick = [false, false];
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
  private readonly p2Intent: FighterIntent = emptyIntent();

  /** Map device actions (camera-relative) to a world-space fighter intent (reused object: no per-tick allocation). */
  private playerIntent(a: ActionState, intent = this.pIntent): FighterIntent {
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
    if (actions.hint) this.coachHint();
    this.camRig.input(actions.camYaw, actions.camPitch, actions.camZoom);

    const w = this.world;
    let p = w.fighters[this.me];
    let o = w.fighters[1 - this.me];
    const a2 = this.o.input2?.poll();
    if (a2?.pause) this.o.callbacks.onPauseToggle();
    if (this.net) this.netFrame(dt, actions);
    else if (!this.paused) {
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
        let ai: FighterIntent;
        if (a2) {
          ai = this.playerIntent(a2, this.p2Intent);
          if (!first) ai.attack = null;
          if (!first) ai.dash = ai.switchStance = false;
        } else ai = this.training ? this.training.partnerIntent(w) : this.o.aiEnabled ? this.ai.think(w, o, p) : emptyIntent();
        w.step([pi, ai]);
        this.trainingTick();
        if (first) this.o.input.consumeEdges();
        if (first) this.o.input2?.consumeEdges();
        first = false;
        this.acc -= DT;
        steps++;
        this.handleEvents();
      }
      if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    } else {
      this.o.input.consumeEdges();
      this.o.input2?.consumeEdges();
    }
    // A rollback replaces the fighter objects: read them again.
    p = w.fighters[this.me];
    o = w.fighters[1 - this.me];
    const t1 = performance.now();

    // Render interpolation.
    const frozen = this.paused && !this.net;
    const alpha = w.hitstop > 0 || frozen ? 1 : this.acc / DT;
    const animAlpha = w.hitstop > 0 || frozen ? 0 : this.acc / DT;
    w.fighters.forEach((f, i) => {
      const pr = this.prev[i];
      const x = pr.x + (f.x - pr.x) * alpha;
      const z = pr.z + (f.z - pr.z) * alpha;
      const yaw = pr.yaw + wrapAngle(f.yaw - pr.yaw) * alpha;
      this.visYaw[i] = approachAngle(this.visYaw[i], yaw, 14 * dt);
      this.anims[i].update(f, animAlpha, x, z, this.visYaw[i], w.hitstop > 0 || frozen ? 0 : dt);
    });
    const t2 = performance.now();
    this.audioCues();

    const el = this.o.gl.domElement;
    this.camRig.update(this.o.camera, dt, p.x, p.z, o.x, o.z, el.clientWidth, el.clientHeight);
    // Stereo placement and distance for each fighter, from the camera.
    {
      const cam = this.o.camera;
      _ap.set(p.x, 1.0, p.z).project(cam);
      const pan0 = _ap.x;
      const d0 = cam.position.distanceTo(_ap.set(p.x, 1.0, p.z));
      _ap.set(o.x, 1.0, o.z).project(cam);
      const pan1 = _ap.x;
      const d1 = cam.position.distanceTo(_ap.set(o.x, 1.0, o.z));
      audio.setPositions(pan0, d0, pan1, d1);
    }
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

  /**
   * Online: step through the rollback controller. No pause; a press is kept
   * until a tick actually uses it. Events from re-simulated ticks play once.
   */
  private netFrame(dt: number, actions: ActionState) {
    const net = this.net!;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= DT && steps < MAX_STEPS_PER_FRAME) {
      this.syncPrevPositions();
      const pi = this.playerIntent(actions);
      if (net.tick(pi)) {
        this.o.input.consumeEdges();
        actions.attack = null;
        actions.dash = actions.switchStance = false;
      }
      this.acc -= DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    net.flush();
    for (const { f, e } of net.events) {
      const who = 'fighter' in e ? e.fighter : 'attacker' in e ? e.attacker : '';
      const key = `${f}|${e.type}|${who}`;
      if (this.seenEvents.has(key) || e.type === 'match-end') continue;
      this.seenEvents.set(key, f);
      this.onEvent(e);
    }
    net.events.length = 0;
    if (this.seenEvents.size > 400) for (const [k, f] of this.seenEvents) if (f < net.frame - 240) this.seenEvents.delete(k);
    this.handleEvents();
    // The result counts only once every input up to the end of the match is confirmed.
    const w = this.world;
    if (w.phase !== 'match-over') this.overFrame = null;
    else if (this.overFrame === null) this.overFrame = net.frame;
    if (this.overFrame !== null && net.remoteHead >= this.overFrame && !net.pending && !this.matchReported) {
      this.matchReported = true;
      audio.matchEnd(w.matchWinner === this.me);
      this.o.callbacks.onMatchEnd?.(w.matchWinner === this.me);
    }
  }

  /** Online: ms since the other player was last heard from. */
  get netSilentMs() {
    return this.net ? performance.now() - this.net.lastHeard : 0;
  }

  /** Feed this tick's events to the training controller and surface its feedback. */
  private trainingTick() {
    const t = this.training;
    if (!t) return;
    t.update(this.world);
    if (this.coach) {
      this.coach.scheme = this.inputScheme();
      this.coach.tick(t, t.feedback, this.world);
      this.publishCoach();
    }
    for (const f of t.feedback) {
      // Restrained training audio: a tock for hits and steps, a soft tick for misses.
      if (f.code === 'hit') {
        audio.trainHit(0);
        const a = t.activity;
        if (a.kind === 'challenge' && t.hits === Math.ceil(a.goal / 2) && t.hits < a.goal) audio.milestone();
      } else if (f.code === 'step') audio.trainHit(1);
      else if (f.code === 'rep') audio.comboDone();
      else if (!f.good && f.code !== 'timeup') audio.trainMiss();
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
      // Footsteps sound when a foot actually plants (pivots scuff instead).
      const n = this.anims[i].plants;
      if (n !== this.lastSteps[i]) {
        this.lastSteps[i] = n;
        audio.footstep(i as 0 | 1, this.anims[i].lastPlantPivot);
      }
      const f = this.world.fighters[i];
      const st = f.state;
      if (st !== this.prevState[i]) {
        // Weight comes back down after a kick; a dash slides on the mat.
        if (this.prevState[i] === 'attack' && this.lastWasKick[i] && st !== 'hitstun' && st !== 'down' && st !== 'ko') audio.land(i as 0 | 1);
        if (st === 'dash') audio.dash(i as 0 | 1);
        this.prevState[i] = st;
      }
      if (st === 'attack' && f.attack) this.lastWasKick[i] = f.attack.move.limb !== 'rearHand';
    }
    const p = this.world.fighters[this.me];
    if (this.world.phase === 'fight' && p.stamina < 15 && !this.staminaWarned && !this.o.input2) {
      this.staminaWarned = true;
      audio.staminaWarning();
      this.o.callbacks.onToast({ text: 'Low stamina', sub: 'Step back and breathe', side: this.me, kind: 'info' }, 1200);
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
      case 'attack': {
        // The whoosh peaks when the technique actually extends (end of startup).
        const atk = this.world.fighters[e.fighter].attack;
        const strikeIn = (atk?.startup ?? 8) / 60;
        const kind = e.move.limb === 'rearHand' ? 'punch' : e.move.id === 'back' || e.move.id === 'side' ? 'turning' : e.move.limb === 'leadFoot' ? 'leadKick' : 'kick';
        audio.technique({ kind, strikeIn, who: e.fighter });
        break;
      }
      case 'whiff':
        audio.whiff(e.fighter);
        break;
      case 'hit': {
        const heavy = e.counter || e.zone === 'head' || e.move.pushback > 3;
        audio.impact(e.move.limb === 'rearHand' ? 'punch' : e.zone, e.counter || !!e.move.turning || (e.zone === 'head' && e.move.limb === 'rearFoot'), e.defender);
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
        audio.blocked(e.move.limb === 'rearHand', e.guardBreak, e.defender);
        this.fx?.spawn(e.point, 'block');
        if (e.guardBreak) toast({ text: 'Guard break!', side: e.attacker, kind: 'hit' });
        break;
      case 'ko':
        audio.knockout(e.fighter);
        toast({ text: 'K.O.', side: e.fighter === 0 ? 1 : 0, kind: 'call' }, 2000);
        this.shake(0.1);
        break;
      case 'round-start': {
        if (this.training) break;
        const w = this.world;
        const need = w.rules.roundsToWin - 1;
        audio.roundStart(!!this.competitive, need > 0 && (w.roundWins[0] >= need || w.roundWins[1] >= need));
        break;
      }
      case 'round-end': {
        if (!this.training) audio.roundEnd(!!this.competitive);
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
        audio.thud(e.fighter);
        this.shake(0.06);
        if (e.cause === 'knockdown') toast({ text: 'Knockdown', sub: `${this.defs[e.fighter].short} is down`, side: null, kind: 'call' }, 1400);
        break;
      case 'match-end':
        if (!this.matchReported && !this.training) {
          this.matchReported = true;
          audio.matchEnd(e.winner === this.me);
          this.o.callbacks.onMatchEnd?.(e.winner === this.me);
        }
        break;
    }
  }

  private publishHud(a: ActionState) {
    if (this.training) this.o.callbacks.onTrainingHud?.(this.training.hud());
    const w = this.world;
    const [p, o] = w.fighters;
    const mine = w.fighters[this.me];
    this.o.callbacks.onHud({
      names: this.o.names ?? [this.defs[0].name, this.defs[1].name],
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
      stance: mine.stance,
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
