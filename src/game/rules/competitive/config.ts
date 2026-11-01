/**
 * Competitive (WT-inspired) rule values. Everything is configurable so the
 * values can be corrected without touching game logic.
 *
 * Reference edition: World Taekwondo "Competition Rules & Interpretation",
 * in force as of June 1, 2026. The official PDF could not be opened from the
 * build environment (network policy), so the values below were taken from
 * search excerpts of that document and national-federation bulletins
 * summarising the 2026 changes. Each value notes its confidence; see
 * docs/PHASE_2.md "Rules sources". Items marked UNVERIFIED need checking
 * against the official text before any claim of fidelity.
 */
export interface CompetitiveConfig {
  edition: string;
  /** Round length (s). WT seniors: 2:00. Shortened for game pacing (see DECISIONS D-016). */
  roundSeconds: number;
  /** Golden round length (s) if the match is level after three rounds. */
  goldenRoundSeconds: number;
  roundsToWin: number;
  points: {
    punchTrunk: number;
    kickTrunk: number;
    kickHead: number;
    turningTrunk: number;
    turningHead: number;
  };
  /** Minimum body rotation (deg) for a turning-kick bonus. */
  turningMinDegrees: number;
  gamjeomPoints: number;
  /** Passive gam-jeom (boundary, fall) in the last seconds of a round. */
  passiveLateGamjeomPoints: number;
  passiveLateWindowSeconds: number;
  /** Round ends when the score difference reaches this (0 disables). */
  pointGap: number;
  /** Round is lost on reaching this many gam-jeom in one round (0 disables). UNVERIFIED. */
  gamjeomRoundLimit: number;
  /** Boundary line: half-size of the competition area (m). */
  boundary: number;
  /** How far the foot extends past the body centre (m): "any part of the foot crosses". */
  footExtent: number;
  /** Fraction of full extension the strike must reach to register on the trunk protector. */
  minTrunkExtension: number;
  /** Head contact needs only light contact (head scoring is contact-based). */
  minHeadExtension: number;
  /** A tired (stamina-starved) strike delivers this fraction of normal force. */
  tiredForce: number;
  /** Defender stamina below which a valid head or turning kick causes a knockdown. */
  knockdownStamina: number;
  /** Stoppage (Kal-yeo) lengths in ticks. */
  stoppageTicks: { boundary: number; penalty: number; knockdown: number; fall: number };
  /** Attacks already started when Kal-yeo is called are not penalized within this grace (ticks). */
  kalyeoGraceTicks: number;
}

export const WT_2026: CompetitiveConfig = {
  edition: 'World Taekwondo Competition Rules & Interpretation (in force June 1, 2026) — game adaptation',
  roundSeconds: 90,
  goldenRoundSeconds: 60,
  roundsToWin: 2,
  // Verified in search excerpts of the June 2026 edition: turning kicks score
  // double their base value (trunk 4, head 6).
  points: { punchTrunk: 1, kickTrunk: 2, kickHead: 3, turningTrunk: 4, turningHead: 6 },
  turningMinDegrees: 180,
  gamjeomPoints: 1,
  // June 2026 change reported by federation summaries: passive gam-jeom in the
  // last 10 s gives the opponent 2 points.
  passiveLateGamjeomPoints: 2,
  passiveLateWindowSeconds: 10,
  // April 2026 General Assembly (effective June 2026): point gap raised 12 → 15.
  pointGap: 15,
  // UNVERIFIED: sources disagree (5 per round vs. 10 per match). 5 per round chosen.
  gamjeomRoundLimit: 5,
  boundary: 4.0,
  footExtent: 0.14,
  minTrunkExtension: 0.45,
  minHeadExtension: 0.2,
  tiredForce: 0.7,
  knockdownStamina: 18,
  stoppageTicks: { boundary: 84, penalty: 66, knockdown: 150, fall: 96 },
  kalyeoGraceTicks: 12,
};
