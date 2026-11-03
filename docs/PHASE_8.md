# Phase 8: Fighter Visuals, Equipment and Animation Polish

Branch `claude/amazing-galileo-4k6k1j`, from `main` 148d73a. This is presentation only: the simulation, frame data, hit detection, scoring, AI, UI and controls are unchanged.

## Visual references

The brief mentions reference screenshots from another Taekwondo game, but none were attached to this session. The work therefore follows the written direction: recognisable doboks, proper head and trunk protection, athletic stances, fluid footwork and kicks.

## Assets

**No new asset files and no third-party models.** I considered replacing the mannequin, but rejected it: the brief says not to swap the rig just for looks, every technique is solved procedurally onto this skeleton, and no licensed sparring-gear model would fit it without retargeting. Instead, the outfit and gear are generated in code.

`src/game/render/gear.ts` builds the outfit at load time from the CC0 Quaternius mannequin's own bind-pose vertices:
- **How it fits:** for each slab of a limb or the torso, it measures the body's radius and adds a fabric margin.
- **How it moves:** it is skinned to the existing skeleton. Limbs blend across elbows and knees; rigid gear follows a single bone.
- **Quantization:** the mannequin's vertices are quantized (the dequantization lives in the inverse bind matrices), so the gear is expressed in that same raw space. Skinning then maps it to metres exactly like the body.

| Piece | Construction |
|---|---|
| Trousers | Loose tubes from hip to ankle. Ripple folds, an outer seam and a hem band. Blended thigh to shin at the knee; the top ring is half on the hips. |
| Jacket | Wrap top: V-neck (skin inside the V), darker lapel, a diagonal wrap edge, and a skirt below the belt. Follows the spine bones by height, with the shoulders on the shoulder bones. |
| Sleeves | Tubes from shoulder to wrist with folds, an underarm seam and a cuff. Blended upper arm to forearm at the elbow. |
| Belt | Band, knot and two splayed tails in the rank colour. |
| Hogu | Padded shell over the jacket: front bulge, vertical quilting, dark binding at the edges, a neck dip and shoulder straps. Corner colour. |
| Headgear | Ellipsoid shell from the crown to below the jaw, with an open face, crown seams, darker ear pads and a rim. Corner colour. |
| Gloves, foot protectors | Padded shells on the hand bones (corner colour), and dark socks over the instep and heel with an open sole, kept clear of the floor. |

**Cost:** one extra skinned draw call per fighter (two with shadows), about 2.6k vertices, no textures, and a single shared material per fighter.

## Footwork (`FighterAnimator`, `FootPlanner`)

- **Bounce:** smooth, with no cusp at the bottom. The knees load as the hips drop, and the heels rise at the top, more on the unweighted foot. It flattens while travelling, so the steps carry the rhythm.
- **Weight shift:** the weight rocks between the front and rear foot every other bounce, with a small hip yaw and counter-rotating shoulders. The guard hands ride the bounce a beat late.
- **Settle:** a spring dips the hips when a stepping foot lands and when the fighter stops.
- **Pivots:** turning in place pivots on the ball of the foot (no lift). Repositioning steps glide lower.
- **Unchanged:** the planted-foot planner still never slides a planted foot, and only one foot is airborne at a time. Its existing tests pass.

## Kicks and reactions (`poses.ts`)

- **Roundhouse (dollyeo chagi):** a new knee-lift key. The knee rises square in front, then turns over on the pivoting support foot before the snap.
- **Front kick (ap chagi):** a tighter, higher knee chamber.
- **Side kick (yeop chagi):** the knee is pulled across the chest, heel leading.
- **Back kick (dwi chagi):** the shoulders and head lead the hips through the turn.
- **Lead-leg kicks:** more compact chambers than their rear-leg versions; they keep their own load-back and pivot direction.
- **Reactions:** the hit and block envelopes rock slightly past neutral late in the recovery before settling.
- **Unchanged:** the extension keys, ankle targets and all key times relative to startup, active and recovery. Contact still matches the hit detection.

## Verification (focused)

- `tsc -b` is clean and `npm run build` succeeds.
- Animation and pose tests (`tests/anim-controls.test.ts`, `tests/rig-input.test.ts`): **20/20**. They cover:
  - extension identical across outcomes and seeds;
  - every outcome returns to stance;
  - the kick extension reaches the impact point;
  - the foot planner does not slide, keeps one foot airborne at a time, and pivots.
- `E2E_ONLY=desktop scripts/e2e.mjs`: **10/10**. Footwork closes distance; round, front, side, punch and back kicks land; head height, guard and pause work.
- Visual inspection: both fighters in a match, and the `?lab=poses` key-frame contact sheets for front, roundhouse, side, back and lead-leg kicks. See `docs/media/phase8/`.
- Mobile viewport and performance (`scripts/ux-capture.mjs`, headless Chromium with SwiftShader):

| Metric | Before (UI system) | After |
|---|---|---|
| Draw calls in a match | 20–22 | 21–24 (budget ≤ 40) |
| Triangles | ~29.8k | ~38.9k |
| Animation and IK CPU per frame (2 fighters) | 0.55–0.69 ms | 0.55–0.87 ms (budget ≤ 2 ms; noisy software rendering) |
| Phone UI coverage | 13.6–17.6% | unchanged |

FPS from software rendering is not reported. **No real-device test was done.**

## Known limitations

- **Linear-blend skinning:** loose trousers bulge slightly at a deeply folded knee (the back-kick chamber). The jacket skirt can briefly clip a thigh raised very high.
- **Faces:** the mannequin's face is still featureless under the open-face headgear.
- **Proportions:** body proportions are the mannequin's. Only the silhouette changed, through the outfit.
- **Knockdown:** still uses the CC0 fall clip.
- **Animation evidence:** key-frame contact sheets only; no video was recorded.
