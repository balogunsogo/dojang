# Implementation Plan

Status key: ✅ done · 🟡 partial · ⬜ not started

## Phase 0: Technical foundation and asset feasibility ✅

- ✅ Inspect the repository (it was empty)
- ✅ Pin the stack and dependency versions (ARCHITECTURE.md)
- ✅ Research characters and animations, verify licenses (ASSET_MANIFEST.md)
- ✅ Reproducible asset pipeline (`scripts/build-assets.mjs`): pinned source, checksums, meshopt
- ✅ Mobile performance budgets (PERFORMANCE.md)
- ✅ Gameplay state machine and action interfaces (GAME_DESIGN.md, `input/actions.ts`, `combat/Fighter.ts`)
- ✅ Documentation set
- ✅ Minimal runnable project that builds
- ✅ Animation feasibility: front, roundhouse and side kicks on the shared rig (`?lab=poses`, `docs/media/kicks-*.jpg`)

**Gate passed:** the asset strategy works (CC0 rig plus procedural kicks), the architecture is documented, and the project builds.

## Phase 1: First playable vertical slice ✅

- ✅ Recognizable 3D dojang
- ✅ Two compatible characters
- ✅ Movement, fighting stance, dash, stance switch
- ✅ Free camera plus lock-on framing
- ✅ Front, roundhouse and side kicks (plus back kick and punch)
- ✅ Guard
- ✅ Valid attack collision and hit reactions
- ✅ Reactive AI opponent
- ✅ Keyboard controls (plus gamepad)
- ✅ Mobile joystick and attack buttons, multitouch
- ✅ Performance measurement overlay
- ✅ Arcade round, timer, KO, result and rematch

**Gate passed:** a full sparring exchange is playable on desktop (keyboard) and touch (emulated mobile viewport with multitouch). It hasn't been tried on a physical device yet; see HANDOFF.md.

## Phase 2: Combat and match systems ⬜

1. Competitive ruleset (`rules/CompetitiveRules.ts`): check the WT point values first; implement the scoring table, gam-jeom for leaving the mat and stalling, and a round decision. Add a ruleset picker in the menu.
2. Stamina tuning pass, and a recovery-state animation for exhaustion.
3. Counterattack depth: punish windows, a parry or "cut" kick (front-leg cut kick) option.
4. Front-leg techniques (fast lead-leg roundhouse/cut kick) using the existing pose system with `limb: 'leadFoot'`.
5. AI: tune the three profiles with data. Run AI-vs-AI simulations headless (as in `tests/combat.test.ts`) and record hit and block rates per profile in this document.
6. Round-transition presentation (fighters return to their marks, a bow).
7. Tests: competitive scoring, penalties, round decisions.

## Phase 3: Complete mobile interaction ⬜

1. Hybrid gesture mode on the right pad: tap = punch, swipe up = front kick, swipe toward the opponent = roundhouse, swipe away = side kick, circular swipe = back kick, two-finger tap = guard. The recognizer must ignore pointers owned by the joystick or camera. Gestures call `InputManager.press(kind, height)`, and the API already supports height.
2. Control settings: layout scale, left-handed mirror, button opacity, mode switch (classic / hybrid).
3. Camera assistance tuning on small screens and an auto-zoom option.
4. Orientation: handle resize and orientation changes mid-match (pause on portrait).
5. **Real-device profiling** on at least one iOS and one Android device, following the protocol in PERFORMANCE.md.

## Phase 4: Training and progression ⬜

1. Training mode scene reuse: dummy fighter (`ai=off` behavior), kicking targets (pads at body and head height), moving targets.
2. Drills: accuracy, timed kicking, combinations (for example roundhouse → back kick), with performance summaries.
3. Belt milestones: white → yellow → green, with challenge requirements. Save to localStorage (versioned key) or IndexedDB, and restore on reload.
4. Character select (Jae-won / Ha-na) and settings and menu polish.
5. Tests: progression rules, save/load migration.

## Phase 5: Visual and audio polish ⬜

Refine the dojang materials and lighting; better character shading (fabric, protector gloss); bow and victory poses; better knockdown; hit FX; impact SFX variety; onboarding tutorial.

## Phase 6: Release validation ⬜

Regression pass, browser matrix (Chrome, Safari, Firefox desktop; iOS Safari; Android Chrome), real-device performance checks, production build checks, deployment (static hosting; for example GitHub Pages with `base: './'`, which already works).
