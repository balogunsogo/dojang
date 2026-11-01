# Handoff

_Last updated: end of the Phase 2 session (2026-11-01)._

## Branches and pull requests

- `main`: Phases 0, 1 and 1.5. PR balogunsogo/dojang#1 (Phases 0–1) and balogunsogo/dojang#2 (Phase 1.5) are merged. Deployed at https://dojang-sigma.vercel.app.
- `claude/amazing-galileo-4k6k1j`: **Phase 2**, restarted from `main` after #2 merged, with a pull request open against `main`. Run `git log --oneline origin/main..` for the commits.

## What was implemented

**Phases 0–1.5** are unchanged; see IMPLEMENTATION_PLAN.md, PHASE_1_5.md and earlier history.

**Phase 2** (full report: PHASE_2.md):

- **Competitive Sparring**, based on the WT 2026 rules (`src/game/rules/competitive/`):
  - Scoring: 1 / 2 / 3 / 4 / 6.
  - Validation: clean contact, legal target, extension-based force, turning eligibility.
  - Gam-jeom subset: boundary, fall, below the waist, after Kal-yeo, fallen opponent, head punch. Includes the late ×2 and the limit of 5.
  - Flow: Kal-yeo and Kye-sok with the clock stopped, knockdowns, 15-point gap, tie-break chain, best of three, golden round, per-round history.
  - Engine integration: optional `Ruleset.hooks` and a `break` phase in `CombatWorld`; Arcade has no hooks.
- **Lead-leg kicks** (front, roundhouse, side/cut kick) with their own frame data and distinct IK animation, plus the back kick to the head.
- **AI** rebuilt as a layered decision system with three profiles distinguished by perception and decision quality (`src/game/ai/AIController.ts`).
- **UI:**
  - Menu mode choice (Arcade or Competitive).
  - Competitive HUD: points beside the clock, GJ markers, still 28 px on phones.
  - Score and penalty toasts with sounds.
  - Results screen: per-round points, decisions, techniques scored, penalties.
  - Boundary line that flashes red when a fighter crosses it.
- **Controls:**
  - Keyboard: F + K/L/U.
  - Gamepad: D-pad.
  - Compact: the wheel's inner ring holds the lead kicks.
  - Classic: a Rear/Lead chip.
- **Shared-engine fixes:** trunk-protector hurt volume and the head-kick strike path (head kicks were registering as body hits).

## What was tested

- `npm test`: **87/87 pass** (36 existing plus 51 new). Covers competitive rules (38), AI scenarios (12), and the wheel and lead-leg animation invariants.
- `node scripts/e2e.mjs` against the production preview covers:
  - every Phase 1.5 desktop, Arcade, mobile, PWA and portrait check
  - Compact inner-ring lead kicks and Classic Lead chip
  - a full Competitive match started from the menu
  - Competitive HUD on a phone

  **54/54 pass.**
- `scripts/ux-capture.mjs` on 4 phone profiles: Arcade and Competitive both cover 13.6–17.6% of the screen (identical to Phase 1.5), with a 28 px scoreboard and both fighters fully visible.
- **Not tested:** real devices, WebKit/Safari, a real gamepad, the official WT PDF text.

## What remains incomplete

- Verify the WT values that are still unconfirmed against the official June 2026 text: tie-break order, gam-jeom limit, passive late window. The round length (90 s vs. 2:00) needs a product decision.
- Real-device UAT: wheel rings, Competitive HUD readability, AI feel.
- Knockdown has no 8-count. Prohibited acts with no game mechanic are not simulated (PHASE_2.md §B).
- Unused CC0 clips are still shipped (about 40 KB).

## Current blockers and risks

1. The official WT document is unreachable from this environment: worldtaekwondo.org, taekwondo-canada.com and assets.contentstack.io are blocked by the network policy. They need to be allowed, or someone must check the values by hand.
2. Animation feel, touch ergonomics and performance still need physical devices.
3. No project license chosen (`UNLICENSED`).

## Exact next steps

1. Product owner: approve or adjust the round length (`WT_2026.roundSeconds`) and the gam-jeom limit (`WT_2026.gamjeomRoundLimit`).
2. Check the tie-break order (Article 15) and the penalty articles against the official PDF; edit `config.ts` and `rounds.ts` if needed. The tests document the expected behaviour.
3. Run UAT with the steps in the Phase 2 PR. Tune `HOLD_MS`, `WHEEL_LEAD_EDGE`, `WHEEL_HEAD_RADIUS` and the AI profile numbers from feedback.
4. After merge: Phase 3 (complete mobile interaction), as in IMPLEMENTATION_PLAN.md. Not started.

## How to run the checks

```bash
npm install
```

```bash
npm test
```

```bash
npm run build && npm run preview
```

In a second terminal, with the preview server running:

```bash
node scripts/e2e.mjs http://localhost:4173/ --shots /tmp/shots
```

```bash
node scripts/ux-capture.mjs http://localhost:4173/ /tmp/ux comp "&mode=competitive"
```

The browser scripts use Playwright 1.63.0; in a fresh environment, run `npx playwright install chromium` once.
