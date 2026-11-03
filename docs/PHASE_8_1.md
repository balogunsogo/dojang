# Phase 8.1: Character Identity and Natural Footwork

This is a stacked follow-up to Phase 8 (PR #10, not yet merged). The branch is `claude/phase-8-1-identity-footwork`, built on `claude/amazing-galileo-4k6k1j`.

The work covers faces, headgear and the idle fighting rhythm. Kicks, combat, AI, the UI and everything else accepted in Phase 8 are untouched.

## Faces (`src/game/render/face.ts`)

The CC0 mannequin's head is a featureless egg. A small sculpted **face mask** now sits over its front:
- **Mask:** a 26 × 40 grid, rigid on the head bone, inside the existing gear mesh, so there are no extra draw calls and no textures.
- **Shape:** brow ridge, almond eye sockets, nose bridge and tip, alae, philtrum, cheekbones, lips, chin and jaw are smooth offsets, with soft vertex-colour modelling.
- **Eyes:** small eyeballs with iris and pupil, set in the sockets, with upper and lower lids and a lash line, so they read as almonds rather than balls.
- **Brows and mouth:** thin strips just above the mask, so they stay crisp at any distance.
- **Fit:** the front of the egg is recessed about 1.6 cm in each fighter's cloned body geometry, so the mask always sits in front. The mask follows the head's measured front profile.

**Distinct identities** (`FACES` in face.ts):

| | Kim Jae-won | Park Ha-na |
|---|---|---|
| Brows | straight, heavier | arched, finer |
| Nose | broader, more prominent | narrower |
| Jaw | squarer | tapered |
| Lips | neutral | slightly fuller, warmer tint |
| Eyes | 1.0× | 1.07× |
| Hair | short (nape) | short low ponytail below the headgear |

Skin tones are the existing character colours.

## Headgear (`src/game/render/gear.ts`)

WT-style sparring headgear replaces the Phase 8 cap:
- **Shell:** runs from the crown to the jaw line, with an **open face from brow to chin**, so the face stays fully recognisable.
- **Padding:** a raised forehead pad, segmented crown pads with pressed seams, and a thick rolled rim around the opening that shows the padding depth.
- **Ear pads:** domed, with a hearing hole.
- **Straps:** a chin strap under the chin, and a rear hook-and-loop fastening band.
- **Movement:** rigid on the head bone, with the nape blended to the neck, so it moves with the head and cannot clip the face.
- **Corners:** Chung blue and Hong red are unchanged.

## Fighting rhythm (`src/game/anim/FighterAnimator.ts`)

**Goal:** light, grounded and economical, not jumping in place.
- **Amplitude:** hip bounce roughly halved. The movement is knee and ankle flexion with brief unloading.
- **Feet never lift in sync:** the loaded foot stays down, the unloaded heel rises a little, and the rear heel leads the front.
- **Weight:** drifts irregularly between the feet, with much smaller hip and shoulder motion.
- **Guard:** the hands follow with their own lag per arm, never in lockstep with the hips.
- **Rhythm:** owned by the animator, with a per-fighter tempo (the two fighters bounce independently). A slow activity envelope adds moments of near-stillness. It stays deterministic for a given frame sequence.
- **Transitions:** the bounce gives way to stepping, pivoting, travelling and dashing. After a technique, hit, block, knockdown or stance switch it fades back in over about 0.9 s, so the fighter settles first.
- **Unchanged:** the planted-foot planner, the Phase 8 settle spring and pivots, and all AI decisions.

### Measured (deterministic 75 Hz trace, 8 s idle, both fighters)

| Metric | Phase 8 | Phase 8.1 |
|---|---|---|
| Hip bounce (p5–p95) | 19.6 / 21.3 mm | 9.2 / 8.9 mm |
| Front-heel lift proxy | 14.4 / 13.3 mm | 1.1 / 1.8 mm (front foot grounded) |
| Rear-heel lift proxy | 37.1 / 34.6 mm | 20.1 / 19.1 mm (rear foot on the ball) |
| Front/rear heel correlation | +0.51 / +0.49 (in sync) | −0.34 / −0.10 (independent) |
| Rhythm variation (0.5 s windows) | 16.7–20.2 mm (constant) | 3.4–9.7 mm (rests and builds) |
| Hip range per 0.5 s after a roundhouse | 78, 35, 13, 15, 15, 17 mm (bounce resumes at once) | 78, 30, 2, 4, 4, 5 mm (settles, then resumes) |

## Evidence

All captures are in `docs/media/phase8_1/`:
- `faces-before.jpg` and `faces-after.jpg`: front and three-quarter close-ups of both fighters, with the same camera.
- `jae-front.jpg` and `hana-three-quarter.jpg`.
- `footwork-compare.mp4` and `footwork-compare.gif`: Phase 8 and Phase 8.1 side by side with identical scripted input. The sequence is 8 s idle, advance, idle, retreat, idle, roundhouse, then recovery.
  - **Captured deterministically:** the game is stepped at a fixed dt and rendered per frame, giving a true 25 fps clip. Headless software rendering runs at only about 6 fps, which would have hidden the bounce.
  - **Scripts:** `scripts/dev/capture-footwork.mjs` and `scripts/dev/capture-faces.mjs`, dev tools that run against `vite preview`.

## Verification (focused)

- `tsc -b` is clean and `npm run build` succeeds.
- `tests/anim-controls.test.ts` and `tests/rig-input.test.ts`: **20/20**. Kick extension timing and contact are unchanged across outcomes; feet don't slide; one foot is airborne at a time; pivots work; IK reaches the impact point.
- `E2E_ONLY=desktop scripts/e2e.mjs`: **10/10**. Round, front, side, punch and back land with the same damage as Phase 8 (100→88→78→63→58→40).
- Mobile sanity (`ux-capture`, 4 phone viewports, SwiftShader):

| Metric | Phase 8 | Phase 8.1 |
|---|---|---|
| Draw calls | 21–24 | 21–22 |
| Triangles | ~38.9k | ~47.1k (face mask and the finer headgear) |
| Animation CPU per frame (2 fighters) | 0.55–0.87 ms | 0.63–0.74 ms (budget ≤ 2 ms) |
| UI coverage | unchanged | unchanged |

**Not tested on a physical device.**

## Intentionally preserved

- **Untouched:**
  - all kick keyframes, timing, strike windows, contact points and stamina;
  - combat, scoring, AI and training;
  - the coach, belts, menus, design system, controls, camera, audio and HUD.
- **Dobok and hogu:** unchanged. The body mesh change is limited to recessing the front of the head.

## Known limitations

- **Faces:** they're static (no expressions or blinking) and fit the semi-realistic, stylized direction rather than realism. The head remains the mannequin's egg shape behind the mask, which shows only in extreme profile views.
- **Triangles:** about 8k more per match. The headgear grid could be lowered if a real device shows a need.
- **Rhythm intent:** the bounce is deliberately subtle. If UAT finds it too still, the amplitude is one constant in `stanceLife`.
