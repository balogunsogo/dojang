import type { Fighter } from '../combat/Fighter';
import type { HitZone } from '../combat/hit';
import { HEAD_DAMAGE_MULT, type MoveDef } from '../combat/moves';

export interface HitContext {
  attacker: Fighter;
  defender: Fighter;
  move: MoveDef;
  zone: HitZone;
  counter: boolean;
  tired: boolean;
}

export interface HitOutcome {
  damage: number;
  points: number;
}

/**
 * A ruleset decides what a landed technique is worth and how a round is
 * decided. Both rulesets share the same combat engine.
 */
export interface Ruleset {
  readonly id: 'arcade' | 'competitive';
  readonly label: string;
  readonly roundSeconds: number;
  readonly roundsToWin: number;
  readonly usesHealth: boolean;
  scoreHit(ctx: HitContext): HitOutcome;
  /** Decide a round that ended on time. Returns winner id or null for a draw. */
  decideTimeout(f: [Fighter, Fighter], points: [number, number]): 0 | 1 | null;
}

/** Arcade: health-based, knockout or timeout (more health remaining wins). */
export const ArcadeRules: Ruleset = {
  id: 'arcade',
  label: 'Arcade',
  roundSeconds: 60,
  roundsToWin: 2,
  usesHealth: true,
  scoreHit({ attacker, move, zone, counter, tired }) {
    let dmg = move.damage * attacker.stats.power;
    if (zone === 'head') dmg *= HEAD_DAMAGE_MULT;
    if (counter) dmg *= 1.25;
    if (tired) dmg *= 0.7;
    return { damage: Math.round(dmg), points: 0 };
  },
  decideTimeout(f) {
    const a = f[0].health / f[0].stats.maxHealth;
    const b = f[1].health / f[1].stats.maxHealth;
    if (Math.abs(a - b) < 0.005) return null;
    return a > b ? 0 : 1;
  },
};

// Competitive (WT-inspired point scoring) is scheduled for Phase 2; see
// docs/GAME_DESIGN.md "Competitive ruleset" for the planned scoring table.
