# Handoff

_Last updated: end of the Phase 1.5 session (2026-11-01)._

## Branches and pull requests

- `main`: Phases 0–1, merged through PR balogunsogo/dojang#1. Deployed at https://dojang-sigma.vercel.app.
- `claude/amazing-galileo-4k6k1j`: **Phase 1.5**, restarted from `main` after #1 merged, with a pull request open against `main`. Run `git log --oneline origin/main..` for the commits.

## What was implemented

**Phases 0–1** (unchanged here): the combat simulation, procedural Taekwondo techniques on the CC0 rig, dojang, camera, input abstraction, AI, arcade rules, HUD, touch controls, docs. See IMPLEMENTATION_PLAN.md.

**Phase 1.5** (details and measurements in PHASE_1_5.md):

- **Animation** (`src/game/anim/`):
  - `FootPlanner` foot planting and stepping.
  - Stance life: breathing, weight shift, seeded bounce, guard drift, acceleration lean.
  - Anticipation, support-foot pivot and landing settle for kicks.
  - Outcome-aware recovery (hit, blocked, whiff) with seeded variation.
  - Procedural hit and block reactions.
  - Time-based ease-out cross-fades; jump stance switch; no T-pose flash.
- **Sim:** presentation-only fields on `HitReaction` (technique, side). Frame data and hit detection are unchanged.
- **Controls** (`src/ui/TouchControls.tsx`, `src/ui/wheel.ts`): Compact scheme (default) with Kick, the persistent technique wheel, a head ring and a Body/Head chip, plus Guard, Dash, Punch and switch. Classic refined. Scheme selectable in Settings and the pause menu, and saved.
- **HUD:** slim one-row scoreboard, short names on phones, consolidated status, translucent controls, safe-area margins, aspect breakpoints.
- **Camera:** UI-aware framing (`CameraRig.safe`, field-of-view fit, `setViewOffset`).
- **PWA:** manifest, icons, Apple standalone tags, iOS tip, Android install button. Optional, with no service worker.
- **Tools:** the motion lab `?lab=motion`; `scripts/ux-capture.mjs` (UI coverage, HUD height, perf per phone profile); `scripts/make-icons.mjs`.

## What was tested

- `npm test`: **36/36 pass.** The 24 existing tests plus 12 new ones:
  - foot planting: still while planted, never two feet airborne, cadence, pivot, freeze
  - keyframes: extension identical across outcomes and seeds, every recovery ends in stance, outcomes differ, variation differs, reaction envelope
  - wheel geometry: direction mapping, dead zones, head ring
- `node scripts/e2e.mjs` against the production preview: **38/38 pass.**
  - Desktop and AI-exchange checks, unchanged.
  - Compact scheme in iPhone-sized landscape emulation (852×393):
    - it's the default; scoreboard ≤ 30 px
    - joystick works; stick + guard multitouch; Kick tap plus a simultaneous camera drag
    - wheel opens; release on Side selects and throws; the selection persists; the Kick label updates
    - outer ring gives a head kick; the Head chip works; Punch and switch work
  - Classic: all four kick buttons land.
  - PWA manifest and icons served; portrait prompt.
- `scripts/ux-capture.mjs` before and after on 4 phone profiles: UI coverage 25–32% → 14–18%, scoreboard 41–46 → 28 px.
- `npm run build` and `tsc -b` clean.
- **Not tested:** any physical device, Safari/WebKit or Firefox engines, a real gamepad, real notch insets (they were simulated with CSS variables), and the iOS Add to Home Screen flow.

## What remains incomplete

- Real-device UAT of Phase 1.5; see the list at the end of PHASE_1_5.md.
- All Phase 2+ scope is untouched: Competitive rules, lead-leg techniques, AI tuning, gestures beyond the Kick wheel, training, progression.
- `Hit_Chest`, `Hit_Head`, `Punch_Jab` and `Punch_Cross` clips are shipped but unused (about 40 KB). Remove them in the asset build if they stay unused.

## Current blockers and risks

1. Animation feel and touch ergonomics can only be confirmed on devices. Emulation verifies behavior, not comfort.
2. The character's CC0 status was confirmed only through the GitHub mirror (see ASSET_MANIFEST.md).
3. No project license chosen (`UNLICENSED`).

## Exact next steps

1. Run UAT on the Vercel preview for this PR on an iPhone and an Android phone. Check:
   - foot planting and reactions
   - Compact wheel reach (`HOLD_MS` and the radii in `src/ui/wheel.ts`)
   - safe areas in both landscape orientations
   - Add to Home Screen
   Tune constants rather than structure where possible.
2. Merge, then start Phase 2 as described in IMPLEMENTATION_PLAN.md: Competitive ruleset (check WT values first), penalties, lead-leg techniques, AI tuning harness.

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
node scripts/ux-capture.mjs http://localhost:4173/ /tmp/ux after
```

The browser scripts use Playwright 1.63.0; in a fresh environment, run `npx playwright install chromium` once.
