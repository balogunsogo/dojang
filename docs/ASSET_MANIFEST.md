# Asset Manifest

Every asset shipped in the repository or generated at runtime is listed here with its source, license and transformations. Nothing with a license that forbids repository redistribution is committed.

## Committed binary assets

### `public/assets/fighter.glb` (204 KiB; ~85 KB gzipped)

| Field | Value |
|---|---|
| Content | "Mannequin" skinned character (8,547 vertices, 13,743 triangles, 53-bone Rigify-style deform skeleton) and 6 animation clips: `Idle_Loop`, `Hit_Chest`, `Hit_Head`, `Death01`, `Punch_Jab`, `Punch_Cross` |
| Author | Quaternius — *Universal Animation Library* (standard / free edition) |
| License | **CC0 1.0 Universal** (public domain dedication). Redistribution and modification are permitted, and attribution is not required but is given here. |
| Source used | GitHub mirror `J-Ponzo/gltf-universal-animation-library`, commit `e24c23cf2a1323488a3faa226ea7ea21f644b73e`. Its README says it is the itch.io distribution of 2025-06-10, gltf-only, CC0. |
| License evidence | The mirror's `LICENSE` file is the full CC0 1.0 legal code (sha256 `a2010f34…0499`), and the README credits Quaternius. The original pages (quaternius.com, quaternius.itch.io) were **not reachable** from the build environment's network policy, so the CC0 status was confirmed through the mirror only. **Action for a maintainer:** confirm on https://quaternius.itch.io/universal-animation-library that the free edition is still CC0. |
| Source checksums | `.gltf` `0ff075c7…7765`, `.bin` `6e65377d…543c` (checked by the build script) |
| Transformations | `scripts/build-assets.mjs`: keeps the 6 clips listed above; drops scale tracks and every translation track except the hips; removes UV sets; merges the 2 primitives into 1 with one material; resamples keys (tolerance 0.0005); removes orphaned accessors; meshopt compression with quantization (`EXT_meshopt_compression`, `KHR_mesh_quantization`). |
| Runtime changes | The material is replaced with a vertex-colored `MeshStandardMaterial`. The dobok, trunk protector, headgear, belt and skin are painted per vertex. Fingers are curled into fists procedurally. |
| Reproduce | `npm run assets:build` (downloads to `.asset-cache/`, verifies SHA-256, writes the GLB). |

`Punch_Jab` and `Punch_Cross` are shipped but **not used yet**; the punch is procedural for stance consistency. They are kept for evaluation in Phase 5 (about 20 KB).

## Animation provenance

| Motion | Source | Status |
|---|---|---|
| Fighting stance, guard, footwork, dash, stance switch | **Original procedural** (IK key poses, `src/game/anim/poses.ts`) | Functional |
| Front, roundhouse, side and back kicks; straight punch | **Original procedural** key poses solved with analytic IK on the CC0 rig | Functional. Reviewed visually in `docs/media/kicks-*.jpg`. Hand-authored, not motion capture. |
| Hit reactions (body, head) | **Original procedural** reaction layers (`hitPose`, `blockPose` in `poses.ts`) since Phase 1.5. The Quaternius `Hit_Chest` and `Hit_Head` clips are still shipped but unused (D-011). | Functional |
| Knockdown | Quaternius `Death01` (CC0) | Functional; a generic fall, not Taekwondo-specific |
| Victory idle | Quaternius `Idle_Loop` (CC0) | Placeholder for a proper bow / victory pose (Phase 5) |

**Why the kicks are procedural.** No properly licensed Taekwondo kick animations were reachable:

- **Mixamo** needs an Adobe login and its terms don't allow redistributing raw animation files in a public repository.
- **Sketchfab, Kenney, OpenGameArt, Poly Pizza and quaternius.com** were blocked by the sandbox network policy.
- The CC0 Quaternius free library has no kicks.

The procedural kicks are an intentional, documented choice: the motion is Taekwondo-specific (chamber, pivot, extension, rechamber) and lines up exactly with the hit frames. Motion-captured kicks would be smoother. To swap them in later, add clips on the same skeleton, select them in `FighterAnimator.pickSource()`, and keep the timing aligned with `MoveDef` frame data.

## App icons (Phase 1.5)

`public/icons/*.png` are original artwork (a red/blue taegeuk on a dark field), rendered by `scripts/make-icons.mjs`. `public/manifest.webmanifest` references them.

## Generated at runtime (no files)

| Asset | Generator | License |
|---|---|---|
| Wood floor, dancheong frieze, changsal lattice, taegeukgi, calligraphy banner | Canvas 2D in `src/game/render/Dojang.ts` | Original work for this project. The taegeukgi is drawn from its public geometric specification. |
| Dojang geometry, mats, beams, bags, belt rack | Three.js primitives | Original work |
| Sound effects (whoosh, body/head impact, block, bell) | Web Audio synthesis in `src/game/audio/AudioEngine.ts` | Original work |
| Hit flashes, blob shadows | Three.js primitives | Original work |

The banner uses system fonts (Noto Serif KR, Nanum Myeongjo, Apple SD Gothic Neo or Malgun Gothic, with a serif fallback). No font files are shipped.

## Evaluated and rejected

| Candidate | Reason |
|---|---|
| three.js example `Xbot.glb` / `Soldier.glb` | Mixamo-derived; redistribution terms unclear for this use, and no kicks |
| Khronos glTF sample characters (CesiumMan, RiggedFigure) | CC-BY; no combat animations; low fidelity |
| Mixamo kicks | Login required; raw files can't be redistributed in a public repo |
