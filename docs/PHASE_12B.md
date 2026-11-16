# Phase 12B: Replay video export (16:9 and 9:16)

The branch is `claude/phase-12b-export`, built on `main` at `4adcf83` (Phase 12A merged). The replay viewer can now export the selected highlight as a video file.
- **Only on request:** export runs in the viewer, never during a match.
- **Unchanged:** combat, playback, capture and saves.

## 1. How it works

| Part | Implementation |
|---|---|
| Where | **Export video** in the replay viewer (top right). It exports the highlight on screen, using its current camera preset. |
| Formats | **Landscape 16:9, 1280 × 720.** **Portrait 9:16, 720 × 1280.** On constrained devices (low quality tier, ≤ 4 CPU cores or ≤ 3 GB memory) these become 960 × 540 / 540 × 960. 30 fps capture. |
| Portrait | Not a crop. The replay camera reframes for the 9:16 aspect, as it does for portrait phones: it backs off, or widens the lens where the hall stops it, so both fighters stay in frame. |
| Rendering | The viewer's own renderer is resized to the export size, with a camera at that aspect, and restored afterwards. **No second WebGL context and no pixel readback.** During recording the canvas is shown centred at the export's aspect as a live preview. |
| Video | `canvas.captureStream(30)` → `MediaRecorder`. |
| Audio | The replay's sound bus also feeds a `MediaStreamAudioDestinationNode`. It carries the replay's own mix, independent of the player's volume and mute settings. |
| Container | Detected at run time, never assumed:<br>1. MP4 (H.264 + AAC) where the browser can record it (Safari, Chrome builds with AAC);<br>2. otherwise WebM (VP9 or VP8 + Opus);<br>3. plain MP4 only as a last resort.<br>MP4 with Opus is deliberately skipped, because QuickTime and iOS do not accept it. A WebM from MediaRecorder has no duration, so one is written into its header after recording (EBML `Info › Duration`). |
| Speed | Normal by default. If the viewer is in slow motion, the export can use that speed (0.5× or 0.25×). Recordings keep their pitch, and every sound is scheduled at its slowed moment. |
| Timing | Export follows the wall clock, so the file is exactly the clip's length at the chosen speed, plus a 0.35 s hold on the last frame. Replay sounds are scheduled slightly ahead with exact Web Audio delays, so a slow frame never makes them late. |
| Memory | One recording at a time. Chunks are capped by bitrate (5 Mbps at 720p, 3 Mbps at 540p, 128 kbps audio): a 10 s 720p export is at most about 6 MB, and typically 0.3–0.6 MB here. Everything is released on finish, failure or cancel. The finished file is kept until **Done**. |
| Result | **Save video** (a download with a descriptive name, for example `dojang-knockout-roundhouse-kick-portrait.webm`), **Share** where the browser can share files, and the size, container, sound, duration, measured frame rate and file size. |
| Limits shown honestly | Without MediaRecorder or canvas capture: "This browser cannot record video…", with no Export button and no broken file. Without audio capture, the setup says "(no sound in this browser)". If the device rendered slowly while recording (below 20 fps), a note says the video may look choppy. |
| Watermark | None. |

## 2. Verification (`scripts/dev/export-check.mjs`, real files checked with ffprobe and ffmpeg)

The clip is a real captured Arcade knockout (a real head roundhouse, then the finishing kick).

| Check | 16:9 | 9:16 | 16:9 at 0.5× |
|---|---|---|---|
| Container matches the extension and the browser's actual format (WebM here: this Chromium cannot record AAC) | ✓ | ✓ | ✓ |
| Dimensions and aspect: 720p (with `--full`) or 540p (constrained) | 1280×720 ✓ | 720×1280 ✓ | 1280×720 ✓ |
| Duration = clip ÷ speed + hold (`Duration` present in the WebM) | 8.13 s ✓ | 8.28 s ✓ | 15.09 s ✓ |
| Includes the replay's sound (Opus) | ✓ | ✓ | ✓ |
| Decodes end to end with no errors (`ffmpeg -f null`) | ✓ | ✓ | ✓ |
| **Audio sync:** the impact is the loudest sound at the hit, and peaks at the hit's time in the file | 4.17 / 4.17 s ✓ | 4.18 / 4.17 s ✓ | — (see below) |
| **Audio scheduling:** the impact is scheduled on the audio clock at the hit tick's moment | 1 ms ✓ | −3 ms ✓ | 7 ms ✓ |
| Slow motion: the 1× sound pattern reappears at twice its times, with a fixed offset under 0.1 s | | | ✓ |
| The preview showed the export's aspect while recording | ✓ | ✓ | ✓ |
| Renderer and canvas restored afterwards | ✓ | ✓ | ✓ |

**Why slow motion is checked differently.** At half speed a technique's whoosh is anchored to its slowed extension, so it separates from the impact and is louder. The loudest sound is then not the impact. The container's audio/video alignment is proven by the 1× files, and the impact's scheduling is measured directly on the audio clock.

**Other checks:**
- **Cancel (Esc) mid-export:** back to the setup, nothing kept, renderer restored.
- **After exporting:** back to the result screen, with the match renderer at full size.
- **Phones:** at 844×390 and 390×844 the panel fits, every touch target is at least 40 px, and a portrait export completes with progress and the result.
- **Unsupported browser** (MediaRecorder removed): a clear message and no Export button.
- **Unit tests:** `tests/export.test.ts` covers writing the WebM duration (unknown and known Segment size, an existing duration left alone, malformed input untouched) and the file names.
- **Results:** `vitest` 146/146; `export-check` 35/35 (540p run), plus 31/31 for the 720p checks with `--full`. The Phase 12A `replay-check` Arcade run is unchanged at 15/15.

## 3. Performance and smoothness

- **During matches:** nothing runs. Export exists only in the viewer.
- **Export cost:** the viewer renders at the export size for the length of the clip (real time), and the browser's own encoder records it.
- **Measured here (software rendering):** headless Chromium with SwiftShader draws this scene at about 250 ms per frame, so the files recorded here hold only **about 2.5–9 frames per second**. The UI reported this and showed the "may look choppy" note. Durations, audio and sync are still correct.
- **Real devices:** with a hardware GPU the same renderer runs matches at 30–60 fps, so exports should approach 30 fps. **This has not been verified on a physical device.** UAT should export on a real phone and a desktop.
- **If real phones record choppily**, the next step is frame-exact export with WebCodecs (`VideoEncoder` and `AudioEncoder` with explicit timestamps) plus a small muxer. That renders every frame regardless of device speed. It is not included now because it needs a muxing dependency, and the need has not yet been demonstrated on real hardware.

## 4. Known limitations

- **MP4 here:** this test browser (open-source Chromium) records MP4 only with Opus audio, so it exports WebM. MP4 + AAC is chosen automatically where supported (Safari, Chrome with AAC), but was **not verified here**.
- **iOS and WebM:** iOS Safari records MP4. A WebM saved from a desktop browser may not open in iOS apps.
- **Real-time recording:** a 10 s clip takes about 10 s to export (20 s at 0.5×), and the tab must stay open. Switching tabs can throttle rendering and make the video choppier.
- **Audio level:** exported audio is the replay's own mix, so it is not affected by the in-game mute or volume. Room tone and UI sounds are not included.
- **Window resizing** during an export is not supported; the renderer is restored afterwards.

## 5. Evidence (`docs/media/phase-12b/`)

- **Exported files (720p, real recordings):**
  - `dojang-knockout-roundhouse-kick-landscape.webm`
  - `dojang-knockout-roundhouse-kick-portrait.webm`
  - `dojang-knockout-roundhouse-kick-landscape-half-speed.webm`
- **Still frames extracted from those files at the moment of the hit:** `frame-from-landscape-file.jpg`, `frame-from-portrait-file.jpg`.
- **Desktop export flow:** `export-recording-landscape`, `export-recording-portrait` (the live preview at the export's aspect), `export-done-*`.
- **Phones:** `phone-844x390-{setup,recording,done}` and `phone-390x844-{setup,recording,done}`.
