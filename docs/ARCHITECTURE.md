# Architecture

## Stack (pinned in package.json)

TypeScript 5.9 · React 19.3 · Vite 8.3 · Three.js 0.187 · @react-three/fiber 9.8 · Zustand 5 · Vitest 5 · Playwright 1.63 (e2e). Assets go through glTF-Transform 4.5 and meshoptimizer.

Rapier is **not** used yet; see DECISIONS.md D-003.

## Layering

```
src/
  game/                 ← pure game code, no React
    config.ts           tick rate, arena, hurt volumes
    math.ts             vectors, segment distance, seeded RNG
    input/              action abstraction + device merging
      actions.ts        ActionState (device level) and FighterIntent (sim level)
      InputManager.ts   keyboard, mouse, gamepad, touch → ActionState; edge latching
    combat/             simulation (no Three.js)
      moves.ts          frame data and strike geometry (single source of truth)
      Fighter.ts        per-fighter state machine, footwork, stamina
      hit.ts            swept-sphere vs capsule/sphere tests, guard arc
      CombatWorld.ts    two fighters, tick, strike resolution, rounds, events
    rules/rules.ts      Ruleset interface (+ optional RuleHooks); ArcadeRules
    rules/competitive/  WT-inspired ruleset: config, validation, scoring, rounds, CompetitiveRules
    ai/AIController.ts  layered AI (perception delay, opponent model, reactive/punish/tactical) → FighterIntent
    anim/               character animation (Three.js, reads sim state)
      rig.ts            bone map, world-space helpers, analytic two-bone IK
      poses.ts          procedural Taekwondo key poses, keyframe sampling, mirroring
      FighterAnimator.ts  state → source (pose or clip), crossfades, IK solve
    render/             Three.js scene content
      characterFactory.ts  GLB load, fighter clone, vertex-color dobok/hogu/headgear
      Dojang.ts         environment builder
      Effects.ts        pooled impact flashes, blob shadows
      quality.ts        tiers, device heuristics, dynamic resolution
    camera/CameraRig.ts free orbit + lock-on framing assist
    audio/AudioEngine.ts  synthesized Web Audio SFX
    perf/PerfMonitor.ts frame-time stats + renderer counters
    GameSession.ts      orchestrator for one match
  store/useGameStore.ts Zustand: screens, HUD snapshot, toasts, settings
  ui/                   React DOM UI (menu, HUD, touch controls + wheel.ts, overlays, PWA hint)
  lab/poseLab.ts        key-pose contact sheet (?lab=poses)
  lab/motionLab.ts      deterministic filmstrips of scripted exchanges (?lab=motion)
```

## Data flow per rendered frame

```
InputManager.poll()  ──►  GameSession.frame(dt)
                            │ accumulate dt
                            ├─ while acc ≥ 1/60 (max 5 steps):
                            │     player intent (camera-relative → world)
                            │     AI intent (delayed perception)
                            │     CombatWorld.step([intentA, intentB])
                            │     events → audio / FX / toasts
                            ├─ interpolate positions (alpha = acc / dt)
                            ├─ FighterAnimator.update (pose or clip, IK, crossfade)
                            ├─ CameraRig.update
                            ├─ HUD snapshot → Zustand (12 Hz)
                            └─ PerfMonitor + DynamicResolution (2 Hz)
R3F useFrame drives frame(); R3F renders the scene.
```

React never sits inside the combat loop. Components subscribe to a throttled HUD snapshot, and touch controls write straight into `InputManager.touch` without using React state.

## Competitive rules integration (Phase 2)

`CombatWorld` calls optional `Ruleset.hooks`:
- `onAttackStart`: detects attacks after Kal-yeo
- `judgeContact`: validity and points for every clean contact
- `afterContact`: knockdowns
- `onIllegalContact`: kicks below the waist
- `afterTick`: boundary, falls, point gap
- `decideRound`, `matchResult`, `roundLength`

The world also has a `break` phase (Kal-yeo: the clock stops, techniques started during it are detected) and a public `endRound()`. Arcade provides no hooks.

## Key interfaces

- **`ActionState`**: what a device produced this frame. Stick axes are in screen space. Pressed actions are edge-latched until the first sim tick consumes them, so a tap is never dropped at high refresh rates.
- **`FighterIntent`**: what a fighter wants this tick, with movement as a world-space vector. The player controller and the AI both produce it, so every input source and both rulesets share one combat path.
- **`Ruleset`**: `scoreHit()` returns damage and points; `decideTimeout()` settles a round on time. Arcade uses health, Competitive will use points.
- **`CombatEvent`**: attack, hit, block, whiff, KO, round and match events. Consumers are audio, FX, HUD, and later training stats.

## Animation system

The rig is the CC0 Quaternius mannequin: 53 Blender-style deform bones, where local +Y runs along each bone and X is the hinge axis.

1. **Procedural Taekwondo poses** (`poses.ts`). Each key pose holds the hips position, body yaw, lean and twist, ankle targets with knee poles and foot point/flat blending, and wrist targets with elbow poles. Keys are placed relative to the move's actual startup, active and recovery ticks, so the visual extension always lines up with the hit window. Poses are authored orthodox and mirrored for southpaw.
2. **Analytic two-bone IK** (`rig.ts`) builds each limb's orientation from a hinge-consistent basis. The knee and elbow hinge sign is measured from the bind pose, so joints can't bend backwards.
3. **Sourced clips** (Hit_Chest, Hit_Head, Death01, Idle_Loop) are sampled at a time derived from sim state, never wall-clock time, so they stay deterministic during hit stop and pause.
4. **Crossfades:** when the source changes, all bone rotations are snapshotted and the new source is blended in over 3–9 frames.
5. Fists are a fixed finger curl, and the head counter-rotates to keep looking at the opponent.

**Phase 1.5 layers** (all presentation only): stance life (breathing, weight shift, seeded bounce, guard drift, acceleration lean); `FootPlanner` (planted feet, discrete steps, pivots); outcome-aware technique keys with seeded variation; procedural `hitPose` and `blockPose` driven by `reactionEnvelope`; and time-based ease-out cross-fades.

Both the strike-point sweep in the simulation and the IK ankle targets in animation come from the same `MoveDef.chamber` and `MoveDef.impact` data.

## Rendering

- Each fighter is one skinned mesh with one vertex-colored material, so one draw call. The dobok, trunk protector, headgear and belt are painted per vertex from the dominant bone and the bind-pose position. Mesh positions are quantized, so bind-pose positions are reconstructed through the skeleton.
- The environment is static geometry merged by material, plus instanced mats, beams, light panels and bags, and canvas textures under 1 MB in total.
- Lighting is a hemisphere light plus one shadowed directional light and one unshadowed fill. There's no postprocessing. ACES tone mapping, sRGB output.
- Quality tiers control the DPR cap, shadows, shadow map size and MSAA. A dynamic-resolution controller adjusts DPR from measured frame time.
- GPU cleanup: `GameSession.dispose()` releases character geometry and materials, environment geometry, materials and textures, instanced meshes and FX. It runs on unmount, so leaving a match frees GPU resources.

## Training and progression (Phase 4)

- `src/game/training/`: `activities.ts` (data), `TrainingRules` (an open-ended `Ruleset` whose `judgeContact` reuses the competitive `validateContact`), and `TrainingController` (reads the same combat events as a match, tracks attempts/hits/combos/drill steps, and drives the partner, fighter 1, through `partnerIntent`). `GameSession` runs it after each fixed step and forwards feedback to toasts and audio.
- `src/game/progress/progress.ts`: pure, versioned progress model (`migrate`, `recordTraining`, `recordMatch`, `checkPromotion`, `BELT_REQUIREMENTS`). Storage is injected, so tests cover corrupt and refused saves.
- The store's `commitProgress` checks promotion, saves, and surfaces `saveFailed` and `promotion` to the UI.
- Settings (`dojang.settings.v1`) feed `GameSession.setPrefs` (camera assist, shake, flashes) and `audio.setMix` (master/sfx/ambient buses, mute).

## Testing strategy

- **Vitest** for pure logic: frame data, the state machine, hit geometry, guard, counter hits, round and match flow, AI behavior differences, IK accuracy, pose and impact agreement, input latching.
- **Playwright e2e** (`scripts/e2e.mjs`) against dev or preview builds: keyboard techniques landing, guard, pause, an exchange against the AI, result and rematch, mobile multitouch (stick plus guard, camera drag plus button), and the portrait prompt. Checks wait on sim ticks, not wall time, because software WebGL is slow.
- **Visual review:** `?lab=poses` renders a contact sheet of every technique's key frames.
