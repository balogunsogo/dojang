# Decision Log

## D-001 — CC0 Quaternius mannequin as the shared character rig (Phase 0)

**Context.** Two compatible, semi-realistic fighters were needed with a consistent skeleton. Mixamo needs a login and doesn't allow redistributing raw files. Sketchfab, Kenney and OpenGameArt were unreachable.
**Decision.** Use the CC0 *Universal Animation Library* mannequin (realistic proportions, 53 deform bones) for both fighters. They are differentiated by scale, stats, skin tone and corner colors.
**Consequences.** One skeleton and one animation system. The look is mannequin-like; the dobok, trunk protector and headgear are painted in vertex colors. A more detailed model on the same skeleton can replace it later.

## D-002 — Procedural IK kicks instead of sourced kick clips (Phase 0)

**Context.** No properly licensed Taekwondo kick animations were obtainable; see ASSET_MANIFEST.md.
**Decision.** Author the front, roundhouse, side and back kicks and the punch as key poses solved with analytic two-bone IK, with timing driven by frame data.
**Consequences.** The motion lines up with the hit windows and adapts to distance (the kick lands on the target's surface). It is hand-authored rather than motion capture, and is labeled that way. Sourced clips are still used for hit reactions and knockdown.

## D-003 — Rapier deferred; analytic collision instead (Phase 0)

**Context.** The proposed stack included Rapier. A 1v1 fighting game on a flat mat needs capsule push-apart, mat bounds and swept-sphere strikes. All of that is a few lines of analytic math, deterministic, and testable without WASM.
**Decision.** Don't ship Rapier in Phases 0–1. Keep collision in `combat/` (pure TypeScript).
**Consequences.** Saves about 600 KB+ of WASM on mobile and avoids async init. Revisit in Phase 4 if training targets need rigid-body physics such as swinging bags or knock-over pads. If added, keep it out of the combat simulation and load it lazily.

## D-004 — Fixed 60 Hz simulation, decoupled from React and rendering

**Decision.** `CombatWorld.step()` advances exactly one tick, with an accumulator and at most 5 steps per frame. Rendering interpolates positions, and animation samples state time. React only receives a throttled HUD snapshot.
**Consequences.** Identical frame data on 30 Hz phones and 144 Hz monitors, deterministic unit tests, and no React re-render in the hot path.

## D-005 — Fighters always face each other; the camera is free

**Context.** The brief asks for a free third-person camera with optional lock-on, plus believable sparring footwork.
**Decision.** Sim facing always tracks the opponent, as in real sparring. Lock-on is a camera behavior: it frames both fighters side-on with the player on the left. Free mode orbits the player. Movement is camera-relative in both modes.
**Consequences.** In the default view, right or `D` steps toward the opponent and up or `W` sidesteps. This was verified in e2e. A "forward = toward opponent" control option could be added in Phase 3 if players find camera-relative movement confusing.

## D-006 — Synthesized audio, procedural textures

**Decision.** Generate sound effects with Web Audio and textures with Canvas 2D.
**Consequences.** Zero licensing risk and nothing to download. The sound is functional rather than rich; sourced CC0 audio can be considered in Phase 5.

## D-007 — Arcade rules first; WT-style points in Phase 2

**Decision.** Phase 1 ships arcade (health) rules only. The `Ruleset` interface already carries points and timeout decisions, so Competitive rules plug in without engine changes. The WT values must be checked against the current published rules before implementation.

## D-008 — Three AI presets exposed early as a first pass

**Decision.** The phase plan puts AI difficulty in Phase 2. The profile structure (reaction delay, guard chance, aggression, footwork, counters) was needed to build even one AI, so three presets are exposed now. A unit test asserts "hard blocks more than easy". Real tuning stays in Phase 2.

## D-009 — TypeScript 5.9 rather than 7.x

TypeScript 7 (the native compiler) was the newest release, but 5.9 was chosen for proven compatibility with the Vite and Vitest type-checking toolchain. Revisit later.

## D-010 — Keep the CC0 rig in Phase 1.5; fix how it is driven

**Context.** UAT found the fighters robotic. Options: replace the rig and model, or improve the animation driving it.
**Decision.** Keep the rig. The stiffness came from sliding feet, a fixed loop, missing weight transfer, identical recoveries and generic hit clips. All of those are animation-layer problems. No licensed Taekwondo-specific replacement was reachable, and a new rig would mean re-authoring every technique.
**Consequences.** Foot planting, stance life, outcome-aware recovery, variation and procedural reactions were added (PHASE_1_5.md). A higher-fidelity model on the same skeleton is still possible later.

## D-011 — Procedural hit reactions replace the CC0 hit clips

The `Hit_Chest` and `Hit_Head` clips dropped the guard and reset the feet. Reactions are now procedural layers on the fighting stance, directional and scaled by technique. The clips stay in `fighter.glb` (about 20 KB) but are unused. The knockdown (`Death01`) and victory idle (`Idle_Loop`) clips are still used.

## D-012 — Compact touch scheme as the default

One persistent-selection Kick button with a technique wheel replaces five technique buttons on screen. This frees the screen (UI coverage 25–32% → 14–18%) while keeping every technique one gesture away. Classic remains selectable. Head height comes from a gesture (slide past the outer ring) or the Body/Head chip.

## D-013 — Optional PWA, no service worker

A web manifest and Apple standalone tags let players launch fullscreen from the home screen. Installing is optional. No service worker: offline play isn't a requirement, and caching would complicate deployments.

## D-014 — UI-aware camera framing

The camera fits both fighters into the screen region not covered by the HUD and controls (field-of-view math) and shifts the projection with `setViewOffset`, instead of using a fixed distance formula.

## D-015: Competitive rules as optional engine hooks

`Ruleset.hooks` (judge contact, attack start, after tick, round decision, match result, round length), a stoppage phase in `CombatWorld`, and a public `endRound()`. Arcade implements no hooks, so its path is unchanged. Competitive is a stateful class created per session. Validation, scoring, penalties and round logic live in separate modules.

## D-016: Competitive round length (approved)

Selectable 60, 90 or 120 s; 90 s is the gameplay default, and 120 s is identified as the WT senior standard (`ROUND_DURATIONS`, `SENIOR_ROUND_SECONDS`). Chosen in the menu, saved in settings, and passed to `CompetitiveRules`.

## D-017: Rule details are configurable and their sources are recorded

The build environment cannot read the 2026 PDF. Article-level decisions (7.1.2, 14, 15.5) follow the product owner's review; other values come from search excerpts and federation summaries and are marked as such in PHASE_2.md.

## D-018: Article 15.5 tie-breaks with a labelled game fallback (approved)

Tied best-of-three rounds are decided by: a. turning-kick points; b. head, then trunk, then punch, then gam-jeom points; c. registered valid hits. Where WT relies on the referee, a deterministic fallback decides (delivered techniques, thrown techniques, fewer gam-jeom, first attack, Hong as the fixed last resort). It is labelled "Game decision", never presented as a WT referee decision. Rounds are never drawn.

## D-023: No golden round in best of three (approved, Art. 7.1.2)

Phase 2 originally added a golden round when the match was level after three rounds. Article 7.1.2 excludes a fourth round from best of three, so it was removed. The match ends when a fighter wins two rounds. An aggregate-score format with a golden round could later be added as a separate configuration.

## D-024: Gam-jeom limits (approved, Art. 14)

5 gam-jeom in one round lose that round; 10 cumulative across the match lose the match outright (`gamjeomRoundLimit`, `gamjeomMatchLimit`).

## D-019: Force threshold from extension, not a fake sensor

Validity uses how far the strike had extended at contact, which the simulation measures via the latched impact point, plus a stamina-starved force factor. There is no random "electronic protector" simulation.

## D-020: Hurt-volume and head-strike corrections (shared engine)

The trunk-protector capsule's cap reached the chin, so head kicks registered as body hits, and head-height strikes swept diagonally through the trunk. Both are fixed for both modes; every Arcade test still passes.

## D-021: AI difficulty from decision quality only

Perception delay, read accuracy, anticipation from the observed rhythm, punish and stop-kick tendencies, softmax noise, boundary and score awareness, habit detection. No damage multipliers and no input reading. Tests enforce a minimum reaction time and that difficulty rises from white to black belt.

## D-022: Lead-leg kicks on the wheel's inner ring

Fast techniques use the shortest thumb travel. There are no new permanent buttons. Classic gets one Rear/Lead chip. Desktop uses an F modifier; gamepad uses the D-pad.
