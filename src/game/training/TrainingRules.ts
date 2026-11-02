import type { CombatWorld } from '../combat/CombatWorld';
import { WT_2026 } from '../rules/competitive/config';
import { SCORE_LABEL, scoreKind } from '../rules/competitive/scoring';
import { validateContact } from '../rules/competitive/validation';
import type { ContactInfo, ContactVerdict, HitOutcome, RoundDecision, RuleHooks, Ruleset } from '../rules/rules';

/**
 * Training uses the shared combat engine with an open-ended round. Contacts
 * are judged with the same validation as Competitive (clean contact, legal
 * target, enough extension), so "valid" in training means the same thing
 * as in a match. No health, no penalties, no round end.
 */
export class TrainingRules implements Ruleset, RuleHooks {
  readonly id = 'training' as const;
  readonly label = 'Training';
  readonly roundSeconds = 99 * 60;
  readonly roundsToWin = 1;
  readonly usesHealth = false;
  readonly hooks: RuleHooks = this;

  scoreHit(): HitOutcome {
    return { damage: 0, points: 0 };
  }
  decideTimeout() {
    return null;
  }
  onMatchStart() {}
  onRoundStart() {}
  onAttackStart() {}
  judgeContact(world: CombatWorld, c: ContactInfo): ContactVerdict {
    const check = validateContact(c.attacker, c.attack, c.zone, world.phase === 'break', WT_2026);
    const kind = scoreKind(c.attack.move, c.zone, check.turning);
    return { points: 0, valid: check.valid, reason: check.reason, label: SCORE_LABEL[kind], turning: check.turning };
  }
  onIllegalContact() {}
  afterContact() {}
  afterTick(world: CombatWorld) {
    // Keep the clock topped up: training never times out at the engine level.
    if (world.roundTicksLeft < 60 * 60) world.roundTicksLeft = this.roundSeconds * 60;
  }
  decideRound(): RoundDecision {
    return { winner: null, reason: 'time' };
  }
  matchResult() {
    return { over: false, winner: null };
  }
  roundLength() {
    return this.roundSeconds;
  }
}
