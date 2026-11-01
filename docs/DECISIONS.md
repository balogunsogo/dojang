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
