# Handoff

> **Phase 7 (cinematic menu and UI refinement)** is on `claude/amazing-galileo-4k6k1j`, branched from `main` aeff806 after PR #5 merged.
> - **New:** `src/game/menu/MenuStage.ts` (the live dojang behind the menu) and `src/ui/MenuBackdrop.tsx`. `src/ui/Menu.tsx` is rewritten.
> - **Restyled:** the results, summary, promotion and loading screens, plus light HUD styling in `src/styles.css`.
> - **Design reference:** [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). Screenshots are in `docs/media/phase7/` (before and after).
> - **Verification:** tsc clean, build OK, `scripts/menu-smoke.mjs` 18/18 (desktop navigation, transitions, phone layout). By request, the full unit and e2e suites were not rerun: gameplay logic was not modified.
> - **e2e helper:** the Competitive section of `scripts/e2e.mjs` was updated for the new flow (`round-120` → `opp-normal` → `start-match`).


> **Phases 3–6 are complete as a release candidate** on `claude/amazing-galileo-4k6k1j` (draft PR balogunsogo/dojang#5, base `main` 470ba0b). Read **[RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md)** first: it lists what shipped per phase, verification (tsc clean, 105/105 unit, build OK, 71/71 e2e on 2026-11-02), performance, known issues and the human UAT checklist.
> - Commits: Phase 3 6b13725, Phase 4 d1fb357, Phase 5 5479f7b, Phase 6 (docs and release review).
> - Next steps: human UAT on real devices and browsers (RELEASE_CANDIDATE.md §7); then, if approved, mark PR #5 ready and merge. Production deploy is **not authorized** yet.
> - Deferred: hybrid gesture controls, onboarding tutorial, bow/victory poses, offline (service worker).
> - Run one e2e section: `E2E_ONLY=training node scripts/e2e.mjs http://localhost:4173/` after `npm run build && npx vite preview --port 4173`.

The rest of this file describes the Phase 2 rules corrections (PR #4, merged).

_Last updated: Phase 2 rules corrections after the review of PR #3 (2026-11-01)._

## Branches and pull requests

- `main`: Phases 0, 1, 1.5 and 2. PRs balogunsogo/dojang#1, balogunsogo/dojang#2 and balogunsogo/dojang#3 are merged. Production: https://dojang-sigma.vercel.app.
- `claude/amazing-galileo-4k6k1j`: the **Phase 2 rules corrections** requested in the review of #3. PR #3 had already been merged before the corrections, so the branch was restarted from `main` and the corrections are in a new pull request against `main`. Run `git log --oneline origin/main..` for the commits.

## What changed in the rules corrections

- **Round length:** selectable 60 / 90 / 120 s in the menu when Competitive is chosen. 90 s is the default; 120 s is labelled the WT senior standard. The setting is saved.
- **Gam-jeom (Art. 14):**
  - 5 in one round lose that round.
  - 10 cumulative in the match lose the match.
  - The HUD shows the round count (`GJn`), plus `/m` with the match total once it differs.
  - Results list the match total with reasons.
- **Tie-breaks (Art. 15.5)** for tied rounds:
  - a. turning-kick points
  - b. head, then trunk, then punch, then gam-jeom points
  - c. registered valid hits
  - d. a deterministic **game decision** (delivered techniques, thrown techniques, fewer gam-jeom, first attack, Hong as the fixed last resort), labelled "Game decision", never "referee"

  Rounds are never drawn.
- **No golden round (Art. 7.1.2):** best of three ends when a fighter wins two rounds.
- **Unchanged:** Arcade, AI, lead-leg techniques, animation and mobile UX.

## What was tested

- `npm test`: **96/96 pass**.
  - Competitive tests rose from 38 to 47. New coverage:
    - 60/90/120 s rounds: clock, exact timeout and next round
    - default 90 s and senior 120 s
    - 5 gam-jeom round loss
    - 10 cumulative match loss, reached across three rounds
    - passive late ×2 against active ×1
    - each 15.5 step a–c in priority order
    - the labelled game fallback (never a draw)
    - best of three with no golden round
    - a three-round match decided only by tie-breaks
    - 2-0 in two rounds
    - rematch reset
  - All existing scoring, penalty, Arcade, AI and animation tests pass.
- `E2E_ONLY=competitive,competitive-mobile,exchange node scripts/e2e.mjs` against the production preview: **18/18 pass**.
  - The 120 s choice from the menu drives the clock.
  - Body +2, head +3, turning head +6, lead roundhouse +2, boundary gam-jeom.
  - A 2-0 win in exactly two rounds; results; rematch; back to menu.
  - Phone HUD at 28 px.
  - An Arcade full match and rematch.
- **Not run in this pass:** the full 54-check e2e suite. Desktop controls, Compact and Classic touch, PWA and portrait were unaffected; the full suite passed on the merged Phase 2 code. Nothing ran on real devices.

## Open rules interpretation issues

The build environment still cannot open the rulebook PDF (taekwondo.dk is blocked by the network policy), so these items could not be checked against the text:
1. **Last-10-seconds passivity (Art. 14):** currently a passive gam-jeom (crossing the boundary, falling) in the last 10 s of a round gives the opponent 2 points instead of 1; active infractions always give 1. Please confirm which acts count as passive, the window length, and the point award. All are configurable in `WT_2026`.
2. **"Registered valid hits" (15.5 c):** interpreted as every clean contact on the trunk protector or headgear, including contacts below the scoring force threshold, but excluding blocked strikes and contacts during Kal-yeo. If the rule means only scoring hits, it is a one-line change in `CompetitiveRules.judgeContact`.
3. **Overlap between 15.5 a and b:** turning head kicks count in a. (turning points) and again in b. (head points). The same for turning body kicks in trunk points. Confirm whether b. should exclude turning kicks.
4. **Game fallback order (15.5 d):** the order of the deterministic proxies, and Hong as the fixed last resort, are the game's own choices. Review if a different neutral rule is preferred.

## Exact next steps

1. UAT on the PR's Vercel preview (steps are in the PR description). Answer the four items above.
2. After merge, Phase 3 (complete mobile interaction), as in IMPLEMENTATION_PLAN.md. Not started.

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

Prefix the e2e command with `E2E_ONLY=competitive,exchange` (or other section names) to run a subset. The browser scripts use Playwright 1.63.0; in a fresh environment, run `npx playwright install chromium` once.
