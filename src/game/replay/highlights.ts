/**
 * Highlight scoring: simple, explainable, presentation only. It reads the
 * match's own combat events and never affects scoring.
 *
 *   Knockout                      100 (plus the finishing strike)
 *   Knockdown (Competitive)        55 (plus the strike)
 *   Match-winning strike          +35 (the winner's last hit, ≤ 4 s before the end)
 *   Hit: base 8; head +22; turning kick +15; counter +12; Competitive points +4 each
 *   Combination                   +10 (same attacker hit again within 1.2 s)
 *   Guard break                    14
 *   Training combination          +22 (a completed drill repetition)
 *
 * A moment needs 12 points to be a highlight (an ordinary arcade body kick
 * is 8). Selection: highest first, at least 5 s apart, a repeated kind of
 * moment counts 25% less each time, at most three, shown in match order.
 */
import { MOVES } from '../combat/moves';
import type { AttackKind } from '../input/actions';

export const MIN_SCORE = 12;
export const MIN_SEPARATION_TICKS = 300;
export const MAX_HIGHLIGHTS = 3;

export interface Candidate {
  /** Tick of the moment (absolute, recorder ticks). */
  tick: number;
  score: number;
  /** Kind used for variety ("ko", "head", "turning", "points", "combo", ...). */
  kind: string;
  label: string;
  /** Fighter who made the moment, or null (training drills). */
  by: 0 | 1 | null;
  move?: AttackKind;
}

export const moveName = (k: AttackKind) => MOVES[k].name.replace(/ \(.*\)$/, '');

export interface HitInfo {
  attacker: 0 | 1;
  move: AttackKind;
  zone: 'head' | 'body';
  counter: boolean;
  turning: boolean;
  /** Competitive: scored, and how many points. */
  valid?: boolean;
  points: number;
  /** A follow-up within 1.2 s of the same attacker's previous hit. */
  combo?: AttackKind;
}

/** Score and label one clean hit. Invalid Competitive contacts score nothing. */
export function scoreHit(h: HitInfo): Omit<Candidate, 'tick'> {
  const name = moveName(h.move);
  if (h.valid === false) return { score: 0, kind: 'none', label: name, by: h.attacker, move: h.move };
  let score = 8;
  let kind = 'body';
  let label = name;
  if (h.zone === 'head') {
    score += 22;
    kind = 'head';
    label = `${name} · Head kick`;
  }
  if (h.turning) {
    score += 15;
    kind = 'turning';
  }
  if (h.valid && h.points > 0) {
    score += 4 * h.points;
    label = `${name} · ${h.points} point${h.points === 1 ? '' : 's'}`;
    if (kind === 'body') kind = 'points';
  }
  if (h.counter) {
    score += 12;
    kind = 'counter';
    label = `Counterattack · ${name}`;
  }
  if (h.combo) {
    score += 10;
    if (kind === 'body' || kind === 'points') kind = 'combo';
    label = `Combination · ${moveName(h.combo)} → ${name}`;
  }
  return { score, kind, label, by: h.attacker, move: h.move };
}

/** Pick up to three: best first, separated in time, varied in kind; returned in match order. */
export function selectHighlights(cands: Candidate[], max = MAX_HIGHLIGHTS, sep = MIN_SEPARATION_TICKS): Candidate[] {
  const pool = cands.filter((c) => c.score >= MIN_SCORE);
  const picked: Candidate[] = [];
  while (picked.length < max) {
    let best: Candidate | null = null;
    let bestScore = -1;
    for (const c of pool) {
      if (picked.includes(c) || picked.some((p) => Math.abs(p.tick - c.tick) < sep)) continue;
      const same = picked.filter((p) => p.kind === c.kind).length;
      const s = c.score * 0.75 ** same;
      // Ties: the later moment (closer to the finish).
      if (s > bestScore || (s === bestScore && best && c.tick > best.tick)) {
        best = c;
        bestScore = s;
      }
    }
    if (!best) break;
    picked.push(best);
  }
  return picked.sort((a, b) => a.tick - b.tick);
}
