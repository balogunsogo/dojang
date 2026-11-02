import type { CombatWorld } from '../combat/CombatWorld';
import { TICK_HZ } from '../config';
import { type AttackKind, emptyIntent, type FighterIntent } from '../input/actions';
import { createRng } from '../math';
import type { TrainingResult } from '../progress/progress';
import { type Activity } from './activities';

export interface TrainingFeedback {
  text: string;
  sub?: string;
  good: boolean;
}

export interface TrainingHud {
  title: string;
  kind: Activity['kind'];
  /** e.g. "4 / 10" or "Rep 1 / 3". */
  progress: string;
  secondsLeft: number | null;
  attempts: number;
  hits: number;
  accuracy: number;
  combo: number;
  /** Current lit target zone, or null when any zone counts. */
  target: 'body' | 'head' | null;
  /** Drill: the next required step. */
  nextStep: string | null;
  done: boolean;
  failed: boolean;
}

const KICK_NAME: Record<AttackKind, string> = {
  punch: 'Punch',
  front: 'Front kick',
  round: 'Roundhouse',
  side: 'Side kick',
  back: 'Back kick',
  leadFront: 'Lead front kick',
  leadRound: 'Lead roundhouse',
  leadSide: 'Lead side kick',
};

/**
 * Runs one training activity on top of the shared combat simulation. It
 * reads the same combat events a match produces (attack, hit with validity,
 * whiff, block), so targets are hit with the real contact mechanics.
 * Fighter 1 is the training partner holding the target; this controller
 * supplies its intents. Pure TypeScript: no rendering.
 */
export class TrainingController {
  readonly activity: Activity;
  private ticks = 0;
  attempts = 0;
  hits = 0;
  combo = 0;
  bestCombo = 0;
  done = false;
  failed = false;
  doneAt: number | null = null;
  readonly landed: Partial<Record<AttackKind, number>> = {};
  /** Lit target zone (alternating challenge switches it after each hit). */
  target: 'body' | 'head' | null;
  private step = 0;
  private stepTick = 0;
  reps = 0;
  readonly feedback: TrainingFeedback[] = [];
  private rng = createRng(7);
  private partnerTimer = 60;
  private partnerDir = 1;
  private readonly intent: FighterIntent = emptyIntent();

  constructor(activity: Activity) {
    this.activity = activity;
    this.target = activity.target === 'head' ? 'head' : activity.target === 'body' || activity.target === 'alternate' ? 'body' : null;
  }

  get elapsed() {
    return this.ticks / TICK_HZ;
  }
  get accuracy() {
    return this.attempts ? this.hits / this.attempts : 0;
  }
  get finished() {
    return this.done || this.failed;
  }

  /** Process this tick's combat events (call after world.step, before events are cleared). */
  update(world: CombatWorld) {
    if (this.finished) return;
    this.ticks++;
    const a = this.activity;
    for (const e of world.events) {
      if (e.type === 'attack' && e.fighter === 0) this.attempts++;
      else if (e.type === 'whiff' && e.fighter === 0) this.miss('Miss', 'Step in: you were out of range');
      else if (e.type === 'block' && e.defender === 0) this.drillStep('block', world.tick);
      else if (e.type === 'block' && e.attacker === 0) this.miss('Blocked', 'Your partner guarded');
      else if (e.type === 'hit' && e.attacker === 0) {
        const kind = e.move.id;
        if (!e.valid) {
          this.miss('No point', e.reason === 'Insufficient impact' ? 'Too close — no impact. Give the kick room to extend' : e.reason);
          continue;
        }
        if (this.target && e.zone !== this.target) {
          this.miss('Wrong target', `Aim for the ${this.target}${this.target === 'head' ? ' (hold E / Head)' : ''}`);
          continue;
        }
        this.landed[kind] = (this.landed[kind] ?? 0) + 1;
        this.hits++;
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        if (a.kind === 'drill') this.drillStep(kind, world.tick);
        else this.good(`${KICK_NAME[kind]} ✓`, `${e.zone}${this.combo > 2 ? ` · combo ${this.combo}` : ''}`);
        if (a.target === 'alternate') this.target = this.target === 'body' ? 'head' : 'body';
      }
    }
    // Drill timing window.
    if (a.kind === 'drill' && this.step > 0 && a.window && world.tick - this.stepTick > a.window * TICK_HZ) {
      this.step = 0;
      this.miss('Too slow', `Follow up within ${a.window} s`);
    }
    // Objectives.
    if (a.kind === 'challenge' && this.hits >= a.goal) this.complete();
    if (a.kind === 'drill' && this.reps >= a.goal) this.complete();
    if (a.seconds !== null && !this.done && this.elapsed >= a.seconds) {
      this.failed = true;
      this.feedback.push({ text: "Time's up", sub: `${this.hits} / ${a.goal}`, good: false });
    }
  }

  private drillStep(kind: AttackKind | 'block', tick: number) {
    const steps = this.activity.steps;
    if (!steps) return;
    const want = steps[this.step];
    if (want.accept.includes(kind)) {
      this.step++;
      this.stepTick = tick;
      if (this.step >= steps.length) {
        this.step = 0;
        this.reps++;
        this.good(`Repetition ${this.reps} / ${this.activity.goal}`, steps.map((s) => s.label).join(' → '));
      } else this.good(`${want.label} ✓`, `now: ${steps[this.step].label}`);
    } else if (kind !== 'block') {
      // A technique that isn't the next step breaks the combination; it may start a new one.
      this.step = steps[0].accept.includes(kind) ? 1 : 0;
      this.stepTick = tick;
      this.miss('Combination broken', `Expected ${want.label}`);
    }
  }

  private good(text: string, sub?: string) {
    this.feedback.push({ text, sub, good: true });
  }
  private miss(text: string, sub?: string) {
    this.combo = 0;
    this.feedback.push({ text, sub, good: false });
  }
  private complete() {
    this.done = true;
    this.doneAt = this.elapsed;
    this.feedback.push({ text: 'Complete!', sub: this.activity.title, good: true });
  }

  /** Training partner behaviour (fighter 1). */
  partnerIntent(world: CombatWorld): FighterIntent {
    const it = this.intent;
    it.moveX = it.moveZ = 0;
    it.attack = null;
    it.guard = false;
    it.dash = false;
    it.switchStance = false;
    it.height = 'body';
    const [p, me] = world.fighters;
    const dx = p.x - me.x;
    const dz = p.z - me.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    const mode = this.finished ? 'still' : this.activity.partner;
    if (mode === 'moving') {
      if (--this.partnerTimer <= 0) {
        this.partnerTimer = 40 + Math.floor(this.rng() * 50);
        this.partnerDir = this.rng() < 0.5 ? -1 : 1;
      }
      const want = 1.6;
      it.moveX = uz * this.partnerDir * 0.8 + ux * (d - want) * 0.6;
      it.moveZ = -ux * this.partnerDir * 0.8 + uz * (d - want) * 0.6;
    } else if (mode === 'attacking') {
      if (d > 1.15) {
        it.moveX = ux * 0.6;
        it.moveZ = uz * 0.6;
      }
      if (--this.partnerTimer <= 0 && d < 1.35 && me.actionable) {
        this.partnerTimer = 120 + Math.floor(this.rng() * 50);
        it.attack = 'front';
      }
    }
    // Stay well inside the mat.
    if (Math.abs(me.x) > 2.8) it.moveX -= Math.sign(me.x);
    if (Math.abs(me.z) > 2.8) it.moveZ -= Math.sign(me.z);
    return it;
  }

  hud(): TrainingHud {
    const a = this.activity;
    const steps = a.steps;
    return {
      title: a.title,
      kind: a.kind,
      progress: a.kind === 'challenge' ? `${this.hits} / ${a.goal}` : a.kind === 'drill' ? `Rep ${Math.min(this.reps + 1, a.goal)} / ${a.goal}` : `${this.hits} hits`,
      secondsLeft: a.seconds === null ? null : Math.max(0, Math.ceil(a.seconds - this.elapsed)),
      attempts: this.attempts,
      hits: this.hits,
      accuracy: this.accuracy,
      combo: this.combo,
      target: this.target,
      nextStep: steps ? steps[this.step].label : null,
      done: this.done,
      failed: this.failed,
    };
  }

  result(): TrainingResult {
    return {
      activity: this.activity.id,
      completed: this.done || (this.activity.kind === 'practice' && this.hits > 0),
      attempts: this.attempts,
      hits: this.hits,
      accuracy: this.accuracy,
      score: this.activity.kind === 'drill' ? this.reps : this.hits,
      time: this.doneAt,
      bestCombo: this.bestCombo,
      landed: { ...this.landed },
    };
  }
}
