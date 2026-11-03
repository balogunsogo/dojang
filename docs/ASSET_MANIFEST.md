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

### UI fonts — `src/assets/fonts/*.woff2` (8 files, ~117 KB total; each loads only when used)

| Family | Weights | Files | Source | License |
|---|---|---|---|---|
| Hahmlet (display: wordmark, titles) | 300, 400 Latin; 400 Korean subset | `hahmlet-latin-300/400`, `hahmlet-ko-400` (2.9 KB) | Fontsource `@fontsource/hahmlet` 5.x (Google Fonts, designed by Hypertype / C. Kim) | SIL Open Font License 1.1 |
| IBM Plex Sans (interface) | 400, 500, 600 Latin | `plex-sans-latin-400/500/600` | Fontsource `@fontsource/ibm-plex-sans` 5.x (IBM) | SIL Open Font License 1.1 |
| IBM Plex Sans KR (Hangul in UI text) | 400, 600 Korean subset | `plex-sans-kr-400/600` (~3.6 KB each) | Fontsource `@fontsource/ibm-plex-sans-kr` 5.x (IBM) | SIL Open Font License 1.1 |

Built by `scripts/build-fonts.py` (fontTools): the Latin files are copied unchanged; the Korean faces are subset to the Hangul the DOM renders (도장 김재원 박하나 청 홍 태권), with matching `unicode-range` in `src/fonts.css`, so any other Hangul falls back to the system Korean font. The OFL permits redistribution and modification with the software (the fonts are not sold on their own). **Review note:** the OFL treats subsetting as a modification, and IBM Plex declares "Plex" as a Reserved Font Name. The Korean subset files here are referenced under the original family names, the same practice Fontsource and Google Fonts use for their own subset files. If strict Reserved-Font-Name handling is required, rename the two `plex-sans-kr` faces' family (e.g. `DojangSansKR`) in `src/fonts.css` and the font-name tables; nothing else depends on the name.

### Audio recordings — `public/audio/*.mp3` (20 files, 72 KB total; Phase 9.1)

All from **Kenney** (www.kenney.nl), licence **CC0 1.0** (public domain dedication; commercial use and redistribution allowed; credit optional and given). The packs' own licence texts are in `public/audio/LICENSE-kenney.txt`.

Retrieved from the `series-ai/jam-ready-assets` mirror, which vendors the complete packs together with Kenney's `License.txt`. Each original was verified against the SHA-256 recorded in that repository's Git LFS pointer (first 12 hex characters below).

**Processing (ffmpeg):** downmix to mono, 32 kHz, trailing silence trimmed, 10 ms end fade, MP3 VBR q4. At load time the game additionally high-passes each group (24 dB/oct at 60–300 Hz), trims leading silence and normalises the peak. The original sounds are otherwise unaltered.

| Game file(s) | Pack | Original file(s) (SHA-256 prefix) | Used for |
|---|---|---|---|
| `hogu-1…5` | Impact Sounds 1.0 | `impactPunch_heavy_000…004.ogg` (ff099bdcaffc, dd3cb705f462, e4644c152f34, 688d327fe487, 2f6add56716d) | Body kick on the trunk protector; weight layer; fall; knockout |
| `headgear-1…3` | Impact Sounds 1.0 | `impactPunch_medium_000/001/003.ogg` (c85dd74a7752, d47307d8bf17, 7504b65f5a26) | Head kick on the headgear |
| `glove-1…2` | Impact Sounds 1.0 | `impactPunch_medium_002/004.ogg` (d01459504998, fea5246cd91f) | Punch (glove on protector) |
| `guard-1…3` | Impact Sounds 1.0 | `impactSoft_medium_000/002/004.ogg` (976b7a3ff7f6, 3c1fce0d7b26, 3b2d3d29f728) | Kick or punch into the guard |
| `mat-1…3` | Impact Sounds 1.0 | `footstep_carpet_000/001/003.ogg` (0147b7bd6ceb, a79861f48e7f, 14465fb482a2); 002 and 004 are byte-identical duplicates and were skipped | Foot plants, landings, dash, fall |
| `cloth-swish-1…2` | RPG Audio 1.0 | `cloth2.ogg`, `cloth4.ogg` (0ddc67e4cdf0, 319705aab579) | Dobok moving into a kick or punch |
| `cloth-settle-1` | RPG Audio 1.0 | `cloth3.ogg` (05c08d809354) | Dobok settling after a landing or fall |
| `cloth-flick-1` | RPG Audio 1.0 | `clothBelt2.ogg` (0478e09c1e86) | Dobok flick at full kick extension |

**No voice recordings are used.** The breath exhale is synthesized noise, unchanged from Phase 9.

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
| Dobok (jacket, trousers, sleeves), belt, hogu, headgear, gloves, foot protectors (Phase 8) | Procedural skinned geometry in `src/game/render/gear.ts`, fitted to the CC0 mannequin's own bind-pose vertices and skinned to its skeleton | Original work (derived only from the CC0 mannequin's dimensions) |
| Stylized faces (sculpted mask, eyes, lids, brows, mouth), ponytail; WT-style headgear (Phase 8.1) | Procedural geometry in `src/game/render/face.ts` and `gear.ts`, rigid on the head bone | Original work |
| Synthesized sound layers (Phase 9/9.1): kick and punch air, contact slap, guard knock, whiffs, pivot scuff, dash slide, breath exhale, bell, timer tone, scoring blips, gam-jeom buzz, deciding-round drum, victory/defeat, training cues, gong, menu cues, room tone and room reflection; plus synth fallbacks for every recorded layer | Rendered in code (`src/game/audio/AudioEngine.ts`, `dsp.ts`, `legacy9.ts`) into in-memory buffers | Original work |
| Training equipment (paddles, trunk protectors, mats, kick shield), target ring, dobok fabric shading | Three.js primitives and vertex colors | Original work |
| Hit flashes, blob shadows | Three.js primitives | Original work |

The banner uses system fonts (Noto Serif KR, Nanum Myeongjo, Apple SD Gothic Neo or Malgun Gothic, with a serif fallback). No font files are shipped.

## Evaluated and rejected

| Candidate | Reason |
|---|---|
| three.js example `Xbot.glb` / `Soldier.glb` | Mixamo-derived; redistribution terms unclear for this use, and no kicks |
| Khronos glTF sample characters (CesiumMan, RiggedFigure) | CC-BY; no combat animations; low fidelity |
| Mixamo kicks | Login required; raw files can't be redistributed in a public repo |
