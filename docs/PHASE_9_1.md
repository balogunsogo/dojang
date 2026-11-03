# Phase 9.1: Natural Combat Audio Refinement

The branch is `claude/phase-9-1-natural-audio`, built on `claude/phase-9-audio`.

**Note on the PR stack:** PR #13 (Phase 9) was merged into the Phase 8.1 branch *after* PR #11 had already merged into `main`, so Phase 9 never reached `main`. This PR targets `main` and therefore brings **Phase 9 and 9.1** in together.

This phase changes audio only. Animations, timing, hit detection, AI, scoring, training, belts, geometry, camera, controls and the UI are unchanged.

## 1. Audit of Phase 9

**Listening:** I could not listen to audio in this environment. The audit below comes from the code and from objective measurements of rendered audio: spectra, envelopes, peaks and RMS.

| Finding | Where | Why it sounds synthetic |
|---|---|---|
| Sine pitch-drop "thump" (98→46 Hz) under every body impact | `body` | A pure tone sliding down reads as an electronic "808" drop, not a padded impact |
| A separate 62→36 Hz sine "heavy" layer | `heavy` (turning kicks, counters, head kicks) | A sub boom: inaudible on phones, exaggerated on headphones. **90% of the old head-kick energy sat below 80 Hz** |
| Same pattern in footsteps, falls, knockout and the `boom` | `step`, `fall`, `boom` | Footwork was 51% sub-bass; the combined exchange was 73% |
| Saturation (tanh, drive 1.5) on sines, then normalised | body/heavy | Adds odd harmonics typical of synthesizers |
| High-passed noise "click" as the dobok snap | `snap` | A crisp but electronic click; real cloth has rustle and flutter |
| Identical takes from a single seed per variant | all | Distinct variants existed, but repetition was still audible |
| Mono, no room | all | Everything sat in the centre of the head, dry |
| Stacking | exchanges | A combined exchange peaked at **+3.5 dBFS** (clipping) |
| Fine as synthesis | whoosh air, scoring/timer/menu cues, breath | Air and UI cues are naturally "synthetic" sounds; kept |

**Priorities:**
1. Replace the impact cores with recorded material contact.
2. Remove the sub-bass booms.
3. Use real cloth for the dobok.
4. Use real mat footfalls.
5. Add subtle stereo and room.
6. Fix stacking peaks.
7. Keep everything that already worked: timing, UI cues and the training/menu sets.

## 2. Sourcing

External sound sites are blocked by this session's network policy, but GitHub raw and LFS content is reachable.
- **Source:** Kenney's **CC0** "Impact Sounds 1.0" and "RPG Audio 1.0", taken from the `series-ai/jam-ready-assets` mirror. It vendors the full packs with Kenney's own `License.txt`, which I checked.
- **Integrity:** each file was verified against the SHA-256 in that repo's Git LFS pointer.
- **Selection:** by measurement rather than listening. 20 short takes, mono MP3, **72 KB total**.
- **Records:** files and hashes are listed in `docs/ASSET_MANIFEST.md`; the licence text is in `public/audio/LICENSE-kenney.txt`.

**No voice recordings:**
- **Not available:** the reachable CC0 packs have no suitable kihap, grunt or exhale recordings.
- **Unchanged:** per the brief, vocalizations stay as they were. Only the quiet synthesized breath exhale remains, and nothing is described as recorded that isn't.

## 3. What changed

**Hybrid engine (`src/game/audio/AudioEngine.ts`):**
- **Recordings:** fetched and decoded once after the first gesture, then cleaned:
  - high-passed per group at 24 dB/oct (hogu 85 Hz, headgear 130, glove 150, guard 90, mat 60, cloth 160–300) so they read on phone speakers without boom;
  - leading silence trimmed;
  - peak-normalised.
- **Fallback:** if a file cannot load, that layer falls back to its Phase 9 synth, so the game is never silent.

| Event | Phase 9 | Phase 9.1 |
|---|---|---|
| Body kick | sine thump + noise pop + click (+ sine sub for heavy) | **Recorded padded impact** (5 takes) + short foam/vinyl contact slap; heavy adds a lower-pitched second take (weight, not sub) |
| Head kick | sine + noise; turning added the sub boom | **Recorded medium impact** (3 takes, slightly raised) + brighter slap; heavy adds a soft lower take |
| Punch | sine + noise | **Recorded glove contact** (2 takes, lighter) + small slap |
| Blocked | noise knock + square tone | **Recorded soft contact, pitched up** (dull) + synth knock body; no protector "pop". Guard break adds a soft weight layer |
| Miss | whoosh + whiff tail | Unchanged: air + follow-through only, no contact |
| Kick motion | whoosh + noise click | Softer synth **air** peaking at extension + **recorded cloth swish** into the kick + **recorded cloth flick** at full extension (rear-leg kicks) |
| Footsteps | noise + sine | **Recorded carpet/mat footfall** (3 unique takes) on actual foot plants; never on idle bounces |
| Landing | noise + sine | Mat footfall (lower, heavier) + **recorded cloth settle** |
| Dash | noise slide | Slide + a mat plant at the end |
| Fall / KO | sine + noise; KO sine boom | Recorded impact pitched down + mat + cloth settle; KO adds a delayed second settle (no boom) |
| Pivot, exhale, UI, scoring, training, menu, ambience | — | Unchanged (pivot scuff and exhale levels kept low) |

**Variation:**
- A different take every time (never the same one twice in a row).
- Pitch varies by ±3% and level by ±6%. This is narrower than Phase 9's ±4.5% and ±10%, so identical attacks still give consistent feedback.

**Space:**
- Each voice is panned by its fighter's on-screen position (up to ±0.6) and gently attenuated by camera distance (×0.62–1.08).
- One shared short room reflection: early taps at 7–29 ms plus a ~70 ms diffuse tail, low-passed at 3.2 kHz, stereo-decorrelated. Small sends (impacts 0.12–0.16, feet 0.10, air and cloth 0.05–0.08, UI 0).
- **Cost:** a single `ConvolverNode`.

**Mix:**
- Hierarchy: impacts › blocks › attack air and cloth › feet › UI › room.
- The sfx bus is high-passed at 40 Hz to free headroom. The master limiter is kept.

## 4. Measurements

All renders are offline, at matched loudness, via `?lab=sounds`.

| Example | Version | < 80 Hz | 80–300 Hz | 1–6 kHz | Centroid | Crest | L/R correlation |
|---|---|---|---|---|---|---|---|
| Body kick | 9 | 41% | 51% | 4% | 321 Hz | 13.6 dB | 1.00 |
| Body kick | 9.1 | **9%** | 60% | 10% | 931 Hz | 16.9 dB | 0.96 |
| Head kick | 9 | 90% | 7% | 2% | 155 Hz | 14.6 dB | 1.00 |
| Head kick | 9.1 | **0.3%** | 39% | 12% | 991 Hz | 17.2 dB | 0.95 |
| Blocked kick | 9 | 0.2% | 55% | 18% | 1035 Hz | 19.6 dB | 1.00 |
| Blocked kick | 9.1 | 0.1% | 45% | 24% | 2035 Hz | 20.2 dB | 0.95 |
| Punch | 9 | 1% | 80% | 14% | 599 Hz | 15.8 dB | 1.00 |
| Punch | 9.1 | 0% | 63% | 6% | 449 Hz | 17.0 dB | 0.97 |
| Footwork | 9 | 51% | 22% | 16% | 539 Hz | 16.7 dB | 1.00 |
| Footwork | 9.1 | **4%** | 51% | 13% | 568 Hz | 19.9 dB | 0.97 |
| Exchange | 9 | 73% | 17% | 6% | 336 Hz | 18.3 dB | 1.00 |
| Exchange | 9.1 | **3%** | 42% | 12% | 657 Hz | 19.4 dB | 0.94 |

**Peaks and loudness** (raw, before matching):
- **Phase 9.1:** no example peaks above **−2.3 dBFS**, and the exchange runs at −22 dB RMS.
- **Phase 9:** the exchange peaked at **+3.5 dBFS** and ran at −15.6 dB RMS.
- 9.1 is cleaner and quieter, not louder.

**Reading the numbers:**
- **Energy:** it moves out of the sub-bass into the body (80–300 Hz) and presence (1–6 kHz) ranges that phone speakers reproduce.
- **Transients:** higher crest means clearer, more defined contact.
- **Stereo:** the correlation shows subtle width rather than a wide spread.
- **Block:** the blocked kick is brighter overall than the clean body kick, mostly because the kick's cloth flick is not masked by a protector thump. It is clearly different from a scoring hit, but whether it reads as "dull" enough needs a listen.

## 5. Listening and comparison

- **`?lab=sounds`** on the preview:
  - Phase 9 vs Phase 9.1 buttons for body kick, head kick, blocked kick, miss, punch, footwork and a combined exchange, rendered offline and **matched to the same RMS**;
  - every individual 9.1 sound, with ×4 to hear the variation.
- **Exported examples:** `docs/media/phase9_1/*.mp3`. For each example there is a `-v9`, a `-v91`, and an `-A9-then-B91` file (Phase 9, a short gap, then 9.1).
  - **Regenerate:** `node scripts/dev/export-sounds.mjs`.

## 6. Size and performance

- **Download:** +72 KB of MP3s (20 files, fetched after the first gesture, not at page load). The licence text is about 1 KB. The App chunk is about 98 KB gzipped, slightly *smaller* than Phase 9, because the impact recipes moved to sample playback.
- **Memory:** the recordings (about 8.3 s in total) decode to about 1.5 MB at a 44.1 kHz context rate (about 1.6 MB at 48 kHz). The synth layers are rendered lazily at 32 kHz, as before.
- **CPU:** per sound, one buffer source, gain and panner, plus a send gain for the room. The convolver is shared, with a 0.32 s impulse response. Voices are capped at 24.

## 7. Verification (automated)

- `tsc -b` is clean and `npm run build` succeeds.
- `node scripts/dev/audio-check.mjs`: **14/14**:
  - audio is locked before a gesture and unlocks on click;
  - **hit** = air + cloth + recorded hogu + slap, with no guard or whiff;
  - **miss** = air + whiff only;
  - **block** = guard recording + knock, with no protector impact;
  - **punch** = fast air + glove;
  - the recordings actually decoded (not the fallback);
  - the fighters are placed apart in stereo;
  - the master volume slider works;
  - mute silences, stops the room tone and persists, and unmute restores both;
  - on an emulated mobile device, the first tap unlocks audio and menu cues play;
  - no page errors.
- Peak and clipping sanity from the offline renders, above.

**Subjective listening is pending (UAT):** naturalness, balance, stereo on headphones, and phone speakers on real iOS and Android devices.

## 8. Known limitations

- **Voices:** no human vocal recordings. Kihap, grunts and natural exhales still need a licensed source.
- **Recorded material:** these are generic game-foley impacts and cloth, not recordings of real hogu or headgear. They're closer to real contact than synthesis, but a custom recording session would be better still.
- **Blocks:** see Measurements.
- **Mirror dependency:** the recordings come from a third-party mirror of the CC0 packs. They were hash-verified against the mirror's LFS records, but not against Kenney's own download, which was unreachable from here.
