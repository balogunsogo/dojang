# Performance

## Budgets (defined in Phase 0)

| Metric | Budget | Notes |
|---|---|---|
| Frame time, capable devices | ≤ 16.7 ms (60 FPS) | Desktop, recent iPhone and flagship Android |
| Frame time, lower-powered supported devices | ≤ 33.3 ms (stable 30 FPS) | The adaptive DPR defends this on the `low` tier |
| Draw calls in a match | ≤ 40 (target ≤ 25) | Shadow pass counted separately |
| Triangles per frame | ≤ 150k | |
| Simulation CPU per frame | ≤ 1 ms | 1–2 fixed ticks per frame |
| Animation and IK CPU per frame (2 fighters) | ≤ 2 ms | |
| Initial download (gzipped JS + assets) | ≤ 1.5 MB | |
| Textures in GPU memory | ≤ 32 MB | Canvas textures; no KTX2 needed yet |
| JS heap during a match | ≤ 120 MB | |
| Postprocessing on mobile | none | |

## Quality tiers

| Tier | DPR cap / floor | Shadows | MSAA | Chosen when |
|---|---|---|---|---|
| low | 1.0 / 0.6 | off (blob shadows) | off | touch device with ≤ 4 cores or ≤ 3 GB memory |
| medium | 1.5 / 0.75 | 1024² | off | other touch devices |
| high | 2.0 / 1.0 | 2048² | on | desktop |

`DynamicResolution` lowers the DPR by 0.15 after 1.5 s over budget (×1.15) and raises it by 0.1 after 4 s under budget (×0.7). Players can force a tier in Settings.

## Instrumentation

Open the perf overlay with `` ` ``, Settings › Performance overlay, or `?perf=1`. It shows FPS, average and p95 frame time, simulation and animation CPU time, draw calls, triangles, geometries, textures, current DPR, tier and JS heap (Chromium). Automation can read the same data from `window.__dojang.session.perf.snapshot`.

## Measurements to date

**Environment:** headless Chromium 1243 with **SwiftShader (software WebGL on the CPU)** in a cloud container. Frame rates here **don't predict real GPU performance**; they only show the game runs. Draw calls, triangles, asset sizes and CPU timings for sim and animation are meaningful.

| Measured | Value | Budget |
|---|---|---|
| Draw calls in a match (high tier, shadows on) | 19 | ≤ 40 ✅ |
| Draw calls (low tier, blob shadows) | 20–21 | ≤ 40 ✅ |
| Triangles (high tier, with shadow pass) | 57k | ≤ 150k ✅ |
| Triangles (low tier) | 29.6k | ≤ 150k ✅ |
| Geometries / textures resident | 17–18 / 7–9 | ✅ |
| Simulation CPU per frame | 0.11–0.19 ms | ≤ 1 ms ✅ |
| Animation and IK CPU per frame (2 fighters) | 0.44–1.16 ms | ≤ 2 ms ✅ (on a busy software-rendering container) |
| JS heap in a match | 33–48 MB | ≤ 120 MB ✅ |
| Gzipped JS (three 206 KB, react 69 KB, app 72 KB, other 11 KB) | ≈ 358 KB | |
| `fighter.glb` | 204 KiB raw / ~85 KB gzipped | |
| Total initial download | ≈ 0.45–0.56 MB | ≤ 1.5 MB ✅ |
| FPS under SwiftShader | 6–21 FPS | **not representative** |

## Phase 1.5 before/after

See PHASE_1_5.md § D. In the same environment: draw calls 20–23 → 19–21, animation CPU 0.32–0.43 → 0.37–0.48 ms per frame for both fighters, no new textures, shaders or materials. Phone UI coverage went from 25–32% to 14–18% of the screen.

## Phase 2 vs Phase 1.5

See PHASE_2.md §G. Arcade UI coverage is unchanged (13.6–17.6%). Competitive matches it (13.6–17.6%) with a 28 px scoreboard. Draw calls are 19–23 (+1 boundary line in Competitive). Simulation CPU, now including the new AI, is 0.07–0.13 ms per frame, against a 1 ms budget. No new textures, shaders or physics.

## Not yet verified

- **No real-device testing has been done.** Nothing has run on a physical iPhone, an Android phone or a desktop GPU. The 60/30 FPS targets are unverified.
- Thermal throttling over a long session, iOS Safari memory limits, and context-loss recovery are unverified.

**Real-device protocol for Phase 3 and Phase 6:**

1. Run `npm run build && npm run preview -- --host` and open the LAN URL with `?perf=1`.
2. Play three full matches.
3. Record the median and p95 frame time, the DPR the scaler settles on, and the draw calls.
4. Note the device model, OS and browser. Add a row to this file.

## Known costs and next optimizations

- Three.js is 206 KB gzipped. Named imports already tree-shake; a further cut would mean dropping unused loaders.
- The skinned mesh has 8.5k vertices per fighter; fine on mobile, but skinning cost rises with both fighters close to the camera.
- Shadows are the largest GPU cost on medium. The shadow frustum is tight (10 × 10 m) and only the fighters and bags cast.
- Static environment geometry is merged; the canvas textures (max 1040×480) cost about 4 MB of GPU memory.
