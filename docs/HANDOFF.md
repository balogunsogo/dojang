# Handoff

_Last updated: end of the Phase 0 + Phase 1 session (2026-11-01)._

## Branches and commits

- `main`: a bootstrap commit only (the repository was empty; a base branch was needed for the pull request).
- `claude/amazing-galileo-4k6k1j`: Phase 0 and Phase 1 work in 5 commits on top of `main`. Run `git log --oneline main..` for the list.
- **Push status:** the session that produced this work couldn't push. GitHub returned 403 because the Claude GitHub App had no write access to the repository. Once access is granted, push both branches and open the pull request `claude/amazing-galileo-4k6k1j` → `main`.

## What was implemented

**Phase 0**

- Vite 8, React 19, TypeScript 5.9, Three.js 0.187, R3F 9 and Zustand 5 project, with pinned versions.
- A reproducible asset pipeline that turns the CC0 Quaternius mannequin into a 204 KiB meshopt GLB (`npm run assets:build`).
- Asset research and license verification, documented in ASSET_MANIFEST.md.
- Performance budgets (PERFORMANCE.md), the state machine and action interfaces (GAME_DESIGN.md, ARCHITECTURE.md), and the decision log.
- An animation feasibility tool, `?lab=poses`, with contact sheets in `docs/media/kicks-side.jpg` and `kicks-quarter.jpg`.

**Phase 1**

- **Combat core** (`src/game/combat`): 60 Hz fixed tick; footwork, dash, stance switch and guard; 5 techniques with frame data; head/body targeting; stamina; input buffering; cancel-on-hit combos; counter hits; hit stop; guard break; distance-aware swept hit detection; KO.
- **Rules:** arcade rules with health, 60 s rounds, best of 3, timeout decision, result screen and rematch. The `Ruleset` interface is ready for Competitive rules.
- **AI** with three first-pass presets that share the player's intent and frame-data path.
- **Animation:** procedural IK key poses for stance, guard, footwork, all 5 techniques and stance switch, mirrored for southpaw. CC0 clips for hit reactions, knockdown and the victory idle. Snapshot crossfades between sources.
- **Rendering:** the dojang environment (about 20 draw calls in a match), fighters drawn as one draw call each and painted in WT corner colors, pooled hit FX, blob shadows on the low tier, quality tiers and dynamic resolution.
- **Input:** keyboard, mouse camera, gamepad and multitouch controls (floating joystick, 5 technique buttons, hold-guard, dash, head/body toggle, camera drag, lock-on/stance/pause), all through one `InputManager` and action abstraction.
- **UI:** menu (difficulty, controls help, settings saved to localStorage), HUD (health, stamina, timer, round pips, status tags, referee-call toasts), pause, result, a portrait rotate prompt and the perf overlay.
- **Audio:** synthesized whoosh, impact, block and bell sounds.

## What was tested

- `npm test`: **24/24 Vitest tests pass.** They cover frame data, state machine timing, stamina and buffering, hit and miss by range, head versus body zones, one hit per technique, guard and guard arc, counter-hit interruption, KO into match-over, timeout decision, an AI-vs-AI exchange, hard AI blocking more than easy, IK accuracy and pole bending, kick extension matching impact points, pose mirroring, and input latching and merging.
- `node scripts/e2e.mjs`: **22/22 headless Chromium checks pass against both the dev server and the production preview build.**
  - Desktop: footwork closes distance; each of the 5 techniques triggers and lands; E-modifier head kick; Space guard; Esc pause.
  - Exchange: both sides land hits in a real match against the Normal AI; a KO on match point shows the result screen; rematch resets the match.
  - Mobile (844×390, touch emulation over CDP multitouch): touch UI shown; the joystick moves the fighter; stick plus guard held at the same time; a Round button tap lands while a second finger drags the camera.
  - Portrait (390×844): the rotate prompt appears and can be dismissed.
  - No page errors in any scenario.
- `npm run build` succeeds, and `tsc -b` is clean.
- **Not tested:** real devices of any kind (no physical iPhone or Android; no real GPU), Safari or Firefox engines, and an actual gamepad (the code path exists but is unexercised). Headless frame rates come from software rendering and say nothing about device performance.

## What remains incomplete

- Competitive WT-style ruleset (Phase 2). The point values in GAME_DESIGN.md still need checking against the published rules.
- AI tuning, front-leg techniques and deeper counter play (Phase 2).
- Hybrid gesture controls and control customization (Phase 3).
- Training mode, belt progression, save/load and character select (Phase 4). The menu shows these as "coming soon" and disabled.
- Bow and victory poses, a Taekwondo-specific knockdown, richer sound and onboarding (Phase 5).
- `Punch_Jab` and `Punch_Cross` clips are shipped but unused.

## Current blockers and risks

1. **No real-device performance data.** The budgets are defined and the instrumentation is in place, but nothing is verified on hardware. This is the top priority for Phase 3, and a person with a device needs to run the PERFORMANCE.md protocol.
2. **Kick animations are hand-authored IK.** They read correctly (see the contact sheets) but aren't motion capture. Licensed Taekwondo mocap wasn't reachable (Mixamo needs a login and blocks redistribution; other sites are blocked by the sandbox network). This isn't blocking.
3. **CC0 status of the character was checked through the GitHub mirror only.** quaternius.com was unreachable. A maintainer should confirm it once (see ASSET_MANIFEST.md).
4. **No project license.** `package.json` says `UNLICENSED`; the repository owner should choose one.

## Exact next steps (Phase 2)

1. Create `src/game/rules/CompetitiveRules.ts` implementing `Ruleset` with `usesHealth: false`:
   - In `scoreHit`, return points by technique and zone: `move.turning` for turning kicks, `move.limb` for punch versus kick.
   - Add a menu toggle and pass the ruleset into `new CombatWorld(...)` in `GameSession`.
   - In the HUD, show `world.points` instead of health bars when `usesHealth` is false.
2. Add gam-jeom: track time spent outside `ARENA_HALF - 0.3` and stalling. Add the penalties to the opponent's points in `CombatWorld.step`.
3. Add lead-leg techniques: extend `MoveDef.limb` with `'leadFoot'`, add `attackKeys` entries using `lLeg`, and add a key or button.
4. Tune AI profiles with a headless AI-vs-AI harness, modeled on the test in `tests/combat.test.ts`. Log hit, block and whiff rates per difficulty in IMPLEMENTATION_PLAN.md.
5. Extend `tests/combat.test.ts` with competitive scoring and penalty tests. Run `npm test`, `npm run build`, then `node scripts/e2e.mjs` against `npm run preview`.

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
node scripts/e2e.mjs http://localhost:4173/ --shots docs/media
```

The e2e script uses Playwright 1.63.0 and its Chromium. In a fresh environment, run `npx playwright install chromium` once.
