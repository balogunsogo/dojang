import type { CombatWorld } from '../combat/CombatWorld';
import { TICK_HZ } from '../config';
import type { AttackKind } from '../input/actions';
import type { Activity } from './activities';
import type { TrainingController, TrainingFeedback } from './TrainingController';

/** The control scheme the player is using right now. */
export type InputScheme = 'keyboard' | 'gamepad' | 'compact' | 'classic';

export type CoachAction = AttackKind | 'head' | 'body' | 'guard' | 'move' | 'switch' | 'block';

export interface CoachTip {
  /** Stable id (cooldowns, tests). */
  id: string;
  text: string;
  /** fix = corrective, info = objective/instruction, good = brief positive, warn = time. */
  tone: 'fix' | 'info' | 'good' | 'warn';
  /** Manual hint (shown even when automatic tips are off). */
  manual?: boolean;
}

const NAME: Record<AttackKind, string> = {
  punch: 'Punch',
  front: 'Front kick',
  round: 'Roundhouse',
  side: 'Side kick',
  back: 'Back kick',
  leadFront: 'Lead front kick',
  leadRound: 'Lead roundhouse',
  leadSide: 'Lead side kick',
};
const WHEEL: Partial<Record<AttackKind, string>> = { front: 'Front', round: 'Round', side: 'Side', back: 'Back', leadFront: 'Front', leadRound: 'Round', leadSide: 'Side' };
const KEY: Record<AttackKind, string> = { punch: 'J', front: 'K', round: 'L', side: 'U', back: 'I', leadFront: 'F + K', leadRound: 'F + L', leadSide: 'F + U' };
const PAD: Record<AttackKind, string> = { punch: 'X', front: 'A', round: 'B', side: 'Y', back: 'RB', leadFront: 'D-pad ↑', leadRound: 'D-pad →', leadSide: 'D-pad ←' };

/**
 * How to perform an action with the given scheme, as a short phrase.
 * Only real bindings (see InputManager, TouchControls and the Controls
 * reference); touch phrasing names the on-screen controls.
 */
export function how(a: CoachAction, scheme: InputScheme): string {
  const lead = a === 'leadFront' || a === 'leadRound' || a === 'leadSide';
  switch (scheme) {
    case 'keyboard':
      if (a === 'head') return 'hold E while you kick';
      if (a === 'body') return 'kick without holding E';
      if (a === 'guard' || a === 'block') return 'hold Space';
      if (a === 'move') return 'W A S D';
      if (a === 'switch') return 'Q';
      return lead ? `hold F, press ${KEY[a].slice(-1)}` : `press ${KEY[a]}`;
    case 'gamepad':
      if (a === 'head') return 'hold RT while you kick';
      if (a === 'body') return 'kick without holding RT';
      if (a === 'guard' || a === 'block') return 'hold LB';
      if (a === 'move') return 'the left stick';
      if (a === 'switch') return 'R3';
      return `press ${PAD[a]}`;
    case 'compact':
      if (a === 'head') return 'slide past the dashed ring, or set the chip to Head';
      if (a === 'body') return 'set the chip to Body';
      if (a === 'guard' || a === 'block') return 'hold Guard';
      if (a === 'move') return 'the joystick';
      if (a === 'switch') return 'tap ⇄';
      if (a === 'punch') return 'tap Punch';
      return `slide from Kick to ${WHEEL[a]} on the ${lead ? 'inner' : 'outer'} ring`;
    case 'classic':
      if (a === 'head') return 'set the Body/Head chip to Head';
      if (a === 'body') return 'set the Body/Head chip to Body';
      if (a === 'guard' || a === 'block') return 'hold Guard';
      if (a === 'move') return 'the joystick';
      if (a === 'switch') return 'tap ⇄';
      if (lead) return `set the Rear/Lead chip to Lead, then tap ${WHEEL[a]}`;
      return `tap ${a === 'punch' ? 'Punch' : WHEEL[a]}`;
  }
}

const technique = (k: AttackKind, s: InputScheme) => `${NAME[k]} (${how(k, s)})`;
const stepAction = (accept: (AttackKind | 'block')[]): CoachAction => accept[0];

const GAP = 4; // s between automatic tips
const SAME_TIP = 22; // s before the same tip may repeat
const MAX_REPEATS = 3;
const SHOW: Record<CoachTip['tone'], number> = { info: 7, fix: 5.5, warn: 4, good: 2.6 };
const PRIORITY: Record<CoachTip['tone'], number> = { warn: 3, fix: 2, info: 1, good: 0 };
const BASICS: AttackKind[] = ['front', 'round', 'side', 'punch'];

/**
 * Deterministic training coach. It only observes: the controller's
 * feedback codes, its counters and the tick's combat events. One tip at a
 * time, with a global gap, per-tip cooldowns and a repeat cap; corrective
 * tips outrank encouragement; nothing new appears mid-technique, and it
 * stops when the activity ends.
 */
export class Coach {
  readonly activity: Activity;
  scheme: InputScheme;
  enabled: boolean;
  current: CoachTip | null = null;
  private until = 0;
  private t = 0;
  private lastShown = -99;
  private shownAt = new Map<string, number>();
  private shownN = new Map<string, number>();
  private pending: CoachTip | null = null;
  private pendingAt = 0;
  private whiffs = 0;
  private broken = 0;
  private partnerHits = 0;
  private lowAccuracySeen = false;
  private lastAttackAt = 0;
  private stopped = false;
  private nudge = 0;
  /** Set when the visible tip changes (read and clear by the session). */
  changed = false;

  constructor(activity: Activity, scheme: InputScheme, enabled: boolean) {
    this.activity = activity;
    this.scheme = scheme;
    this.enabled = enabled;
  }

  /** Call once per fixed tick, after TrainingController.update and before its feedback is drained. */
  tick(ctrl: TrainingController, feedback: readonly TrainingFeedback[], world: CombatWorld) {
    if (this.stopped) return;
    this.t += 1 / TICK_HZ;
    const a = this.activity;
    const me = world.fighters[0];
    for (const e of world.events) {
      if (e.type === 'attack' && e.fighter === 0) this.lastAttackAt = this.t;
      if (e.type === 'hit' && e.attacker === 1) this.partnerHits++;
    }
    if (this.partnerHits > 0 && a.partner === 'attacking') {
      this.offer({ id: 'raise-guard', tone: 'fix', text: `You were hit. Watch for the knee coming up and ${how('guard', this.scheme)} to block.` });
      this.partnerHits = 0;
    }
    for (const f of feedback) this.observe(f, ctrl);
    if (ctrl.finished) {
      this.stop();
      return;
    }
    // Opening objective.
    if (this.t > 0.6) this.offer(this.intro());
    // Time warning for timed challenges (once).
    if (a.seconds !== null && ctrl.elapsed >= a.seconds - 10 && ctrl.hits < a.goal) {
      const left = a.goal - ctrl.hits;
      this.offer({ id: 'time', tone: 'warn', text: `10 seconds left — ${left} more ${left === 1 ? 'hit' : 'hits'}.` });
    }
    // Idle: nothing thrown for a while after the intro.
    if (this.t - this.lastAttackAt > 9 && this.t > 9 && ctrl.attempts === 0) {
      this.offer({ id: 'idle', tone: 'fix', text: `Step toward your partner (${how('move', this.scheme)}) and throw a ${technique('round', this.scheme)}.` });
    }
    // Practice: steer toward the basics, then lead leg, head height and guard.
    if (a.kind === 'practice' && this.t - this.lastShown > 12 && this.t > 10) this.practiceNudge(ctrl);
    this.flush(me.actionable);
  }

  private intro(): CoachTip {
    const a = this.activity;
    const s = this.scheme;
    const id = 'intro';
    switch (a.id) {
      case 'practice':
        return { id, tone: 'info', text: `Free practice. Land each basic on the target: ${technique('front', s)}, ${technique('round', s)}, ${technique('side', s)} and ${technique('punch', s)}.` };
      case 'body10':
        return { id, tone: 'info', text: `${a.goal} valid kicks on the trunk protector in ${a.seconds} s. The ${technique('round', s)} is the quickest.` };
      case 'head5':
        return { id, tone: 'info', text: `${a.goal} head kicks in ${a.seconds} s. To kick high, ${how('head', s)}; a roundhouse reaches the head most easily.` };
      case 'alternate':
        return { id, tone: 'info', text: `The gold ring moves between head and body after every hit. Head: ${how('head', s)}. Body: ${how('body', s)}.` };
      case 'moving':
        return { id, tone: 'info', text: `Your partner keeps moving. Follow with ${how('move', s)} and kick the moment they stop within a leg's length.` };
      case 'block-counter':
        return { id, tone: 'info', text: `Your partner attacks with front kicks. ${cap(how('guard', s))} to block, then counter with any kick within ${a.window} s.` };
      default: {
        const steps = a.steps ?? [];
        const seq = steps.map((st) => `${st.label} (${how(stepAction(st.accept), s)})`).join(', then ');
        return { id, tone: 'info', text: `${seq} — within ${a.window} s. ${a.goal} clean repetitions.` };
      }
    }
  }

  private observe(f: TrainingFeedback, ctrl: TrainingController) {
    const a = this.activity;
    const s = this.scheme;
    switch (f.code) {
      case 'whiff':
        if (++this.whiffs >= 2)
          this.offer({
            id: 'range',
            tone: 'fix',
            text: a.partner === 'moving' ? `Out of range. Close the distance as they stop (${how('move', s)}), then kick straight away.` : `Out of range. Step in (${how('move', s)}) until your partner is about a leg's length away.`,
          });
        break;
      case 'too-close':
        this.offer({ id: 'too-close', tone: 'fix', text: 'Too close — the kick can’t extend, so it doesn’t score. Take a small step back first.' });
        break;
      case 'invalid':
        this.offer({ id: 'invalid', tone: 'fix', text: `That contact didn’t count (${(f.sub ?? 'not a clean technique').toLowerCase()}). Keep it clean and fully extended.` });
        break;
      case 'blocked':
        this.offer({ id: 'blocked', tone: 'fix', text: 'Your partner was guarding. Wait for the guard to drop, then strike.' });
        break;
      case 'wrong-target':
        this.offer(
          ctrl.target === 'head'
            ? { id: 'target-head', tone: 'fix', text: `That landed on the body. The target is the head: ${how('head', s)}.` }
            : { id: 'target-body', tone: 'fix', text: `That went high. The target is the trunk protector: ${how('body', s)}.` },
        );
        break;
      case 'hit':
        this.whiffs = 0;
        if (a.kind === 'challenge' && ctrl.hits === Math.ceil(a.goal / 2) && ctrl.hits < a.goal)
          this.offer({ id: 'half', tone: 'good', text: `Halfway — ${ctrl.hits} of ${a.goal}.` });
        if (a.target === 'alternate' && ctrl.hits <= 2 && ctrl.target)
          this.offer({ id: `alt-${ctrl.target}-${ctrl.hits}`, tone: 'info', text: ctrl.target === 'head' ? `Now the head: ${how('head', s)}.` : `Now the body: ${how('body', s)}.` });
        this.accuracyCheck(ctrl);
        break;
      case 'step': {
        this.whiffs = 0;
        const next = a.steps?.[ctrlStep(ctrl)];
        if (next && ctrl.reps === 0) this.offer({ id: `next-${next.label}`, tone: 'good', text: `Good. Now the ${next.label.toLowerCase()}: ${how(stepAction(next.accept), s)}.` });
        break;
      }
      case 'rep':
        this.whiffs = 0;
        this.broken = 0;
        if (ctrl.reps === 1 && a.goal > 1) this.offer({ id: 'first-rep', tone: 'good', text: `Clean repetition. ${a.goal - 1} more.` });
        break;
      case 'broken': {
        const first = a.steps?.[0];
        if (!first) break;
        this.broken++;
        if (this.broken >= 3)
          this.offer({ id: 'combo-struggle', tone: 'fix', text: `Slow down: throw the ${first.label.toLowerCase()}, let your foot land, then go straight into the next technique.` });
        else this.offer({ id: 'combo-reset', tone: 'fix', text: `Wrong order resets the combination. Start again with the ${first.label.toLowerCase()} (${how(stepAction(first.accept), s)}).` });
        break;
      }
      case 'slow':
        this.offer({ id: 'combo-slow', tone: 'fix', text: `Too slow — you have ${a.window} s between techniques. Throw the next one as soon as your foot lands.` });
        break;
    }
  }

  private accuracyCheck(ctrl: TrainingController) {
    if (ctrl.attempts >= 4 && ctrl.accuracy < 0.5) this.lowAccuracySeen = true;
    if (this.lowAccuracySeen && ctrl.attempts >= 6 && ctrl.accuracy >= 0.7) {
      this.offer({ id: 'accuracy-up', tone: 'good', text: `Much cleaner — ${Math.round(ctrl.accuracy * 100)}% accuracy.` });
      this.lowAccuracySeen = false;
    }
  }

  private practiceNudge(ctrl: TrainingController) {
    const s = this.scheme;
    const missing = BASICS.find((k) => !(ctrl.landed[k] ?? 0));
    if (missing && ctrl.attempts > 0) {
      this.offer({ id: `basic-${missing}`, tone: 'info', text: `Not landed yet: ${technique(missing, s)}.` });
      return;
    }
    const steps: CoachTip[] = [
      { id: 'p-lead', tone: 'info', text: `Lead-leg kicks are faster and shorter: try the ${technique('leadRound', s)}.` },
      { id: 'p-head', tone: 'info', text: `Head kicks score more in Competitive: ${how('head', s)}.` },
      { id: 'p-guard', tone: 'info', text: `Defend between techniques: ${how('guard', s)}. Switch stance with ${how('switch', s)}.` },
    ];
    if (missing) return;
    const tip = steps[this.nudge];
    if (tip) {
      this.offer(tip);
      if (this.current?.id === tip.id) this.nudge++;
    }
  }

  /** Propose a tip; the best candidate is shown when the rules allow. */
  private offer(tip: CoachTip) {
    if (!this.enabled) return;
    const n = this.shownN.get(tip.id) ?? 0;
    const last = this.shownAt.get(tip.id) ?? -99;
    // One-off tips never repeat; others are capped and cooled down.
    const once = tip.id === 'intro' || tip.id === 'time' || tip.id === 'half' || tip.id === 'idle' || tip.id.startsWith('p-') || tip.id.startsWith('alt-') || tip.id.startsWith('next-') || tip.id === 'first-rep';
    if ((once && n > 0) || n >= MAX_REPEATS || this.t - last < SAME_TIP) return;
    if (!this.pending || PRIORITY[tip.tone] > PRIORITY[this.pending.tone]) {
      this.pending = tip;
      this.pendingAt = this.t;
    }
  }

  private flush(actionable: boolean) {
    if (this.current && this.t >= this.until) this.set(null);
    const p = this.pending;
    if (!p) return;
    // Stale encouragement is dropped; corrections wait a little longer.
    if (this.t - this.pendingAt > (p.tone === 'good' ? 1 : 3)) {
      this.pending = null;
      return;
    }
    // Never mid-technique (warnings excepted), never on top of a stronger tip.
    if (!actionable && p.tone !== 'warn') return;
    const outranks = this.current && PRIORITY[p.tone] > PRIORITY[this.current.tone];
    if (this.current && !outranks) return;
    if (!outranks && this.t - this.lastShown < (p.tone === 'good' ? 1.5 : GAP)) return;
    this.pending = null;
    this.show(p);
  }

  private show(tip: CoachTip) {
    this.shownN.set(tip.id, (this.shownN.get(tip.id) ?? 0) + 1);
    this.shownAt.set(tip.id, this.t);
    this.lastShown = this.t;
    this.until = this.t + SHOW[tip.tone];
    this.set(tip);
  }

  private set(tip: CoachTip | null) {
    if (this.current === tip) return;
    this.current = tip;
    this.changed = true;
  }

  /** Player asked for help: the most useful instruction right now (works with tips off). */
  hint(ctrl: TrainingController): CoachTip {
    const a = this.activity;
    const s = this.scheme;
    let text: string;
    if (a.kind === 'drill' && a.steps) {
      const st = a.steps[ctrlStep(ctrl)];
      text = `Next: ${st.label} — ${how(stepAction(st.accept), s)}. ${a.goal - ctrl.reps} ${a.goal - ctrl.reps === 1 ? 'repetition' : 'repetitions'} to go; ${a.window} s between techniques.`;
    } else if (a.kind === 'challenge') {
      const target = ctrl.target === 'head' ? `Target: head (${how('head', s)}).` : `Target: body (${how('body', s)}).`;
      text = `${a.goal - ctrl.hits} more valid ${a.goal - ctrl.hits === 1 ? 'hit' : 'hits'}. ${target} Stay about a leg's length away.`;
    } else {
      const missing = BASICS.filter((k) => !(ctrl.landed[k] ?? 0));
      text = missing.length ? `Still to land: ${missing.map((k) => technique(k, s)).join(', ')}.` : this.intro().text;
    }
    const tip: CoachTip = { id: 'hint', tone: 'info', text, manual: true };
    this.until = this.t + SHOW.info;
    this.lastShown = this.t;
    this.set(tip);
    return tip;
  }

  dismiss() {
    this.pending = null;
    this.lastShown = this.t;
    this.set(null);
  }

  stop() {
    this.stopped = true;
    this.pending = null;
    this.set(null);
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Current drill step index (read through the public HUD snapshot). */
function ctrlStep(ctrl: TrainingController) {
  const steps = ctrl.activity.steps ?? [];
  const label = ctrl.hud().nextStep;
  return Math.max(0, steps.findIndex((s) => s.label === label));
}
