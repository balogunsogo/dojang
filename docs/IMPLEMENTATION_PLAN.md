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

## Phase 1.5: Combat animation and mobile UX refinement ✅

Requested after desktop and physical-iPhone UAT. Details and measurements are in PHASE_1_5.md.

- ✅ Foot planting, stance life (breathing, weight shift, varied bounce), acceleration lean
- ✅ Anticipation, support-foot pivot, landing settle; outcome-aware recovery; seeded variation
- ✅ Procedural hit and block reactions; time-based cross-fades; jump stance switch
- ✅ Compact touch scheme (Kick + persistent technique wheel, head ring and chip, Guard/Dash/Punch/switch); Classic refined
- ✅ Slim HUD, consolidated status, translucent controls, safe areas, aspect-ratio breakpoints, UI-aware camera framing
- ✅ Optional PWA (manifest, icons, iOS hint, Android install button)
- ⬜ Real-device validation of feel, reach and safe areas (UAT)

## Phase 2: Competitive sparring, lead-leg techniques and AI ✅

Details are in PHASE_2.md.

- ✅ WT 2026-inspired Competitive ruleset: scoring, validation, turning eligibility, gam-jeom subset, boundary, Kal-yeo and Kye-sok, knockdowns, point gap, Art. 15.5 tie-breaks, gam-jeom round and match limits, best of three (no golden round, Art. 7.1.2), 60/90/120 s rounds
- ✅ Lead-leg front, roundhouse and side (cut) kicks with distinct frame data and animation; back kick to the head
- ✅ Layered AI: perception delay, opponent model, reactive / punish / tactical layers; three profiles distinguished by decision quality
- ✅ Menu mode selection, Competitive HUD (points, gam-jeom), score and penalty feedback, results with per-round points and technique counts
- ✅ Controls: F modifier, D-pad, Compact wheel inner ring, Classic Lead chip
- ✅ Tests: 96 unit and scenario tests; e2e full Competitive match
- ✅ Rules corrections from the Phase 2 review (Art. 7.1.2, 14, 15.5; round lengths)
- ⬜ Open interpretation items (HANDOFF.md)
- ⬜ Real-device UAT

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
