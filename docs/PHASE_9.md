# Phase 9: Taekwondo Sound Design

The branch is `claude/phase-9-audio`. It is stacked on Phase 8.1 (`claude/phase-8-1-identity-footwork`, PR #11). PR #11 was still open when this phase started, so its faces, headgear and footwork are preserved here.

This phase changes audio only. Kick poses and timing, hit detection, stamina, scoring, AI, training objectives, progression, camera, controls, UI layout and the characters are untouched.

## Starting point (what was there)

- One Web Audio engine with sfx and ambience buses under a master, plus mute, suspend/resume and gesture unlock. All sounds were synthesized live from oscillators and noise.
- **Kicks:** the whoosh played when an attack *started*, not at extension. A missed technique made no sound of its own.
- **Contact:** each impact was one tone plus one noise burst, identical every time. A block was a tone plus noise.
- **Footsteps:** one tiny burst per foot step, fired when the step started.
- **Missing:** clothing, pivots, landing, dash, punch-specific impacts, guard break, deciding round, victory/defeat, and menu back/confirm.

**Kept:** the architecture (one engine, the same buses, settings, unlock and suspend/resume), the room tone (refined) and the low-stamina cue.

## Sourcing and licensing

**No third-party audio.** Every sound is original, rendered in code from seeded noise, filters and envelopes. There is no licence to track and no attribution requirement, and the game download gains no audio files.

**Why:** this session's network policy blocks external sound libraries (Kenney and OpenGameArt return 403 at the proxy). So I could not download or verify CC0 recordings, and I did not take unverifiable files from package registries.

**Vocalizations:** no kihap or grunt recordings are included. Without verified-quality human recordings, the brief says to omit them rather than ship weak ones. The only "human" sound is a very quiet sharp breath exhale ("tss") on some committed kicks: filtered breath noise, not speech. Adding licensed kihap recordings later is a one-line `play()` per event.

## How it works (`src/game/audio/AudioEngine.ts`)

- **Sample library:** each sound is a small recipe of layered DSP:
  - an RBJ biquad (fixed or gliding cutoff);
  - attack/decay envelopes;
  - sine sweeps;
  - soft saturation, and normalisation to a −1 dBFS peak.

  It is rendered **once** at 32 kHz into a mono `AudioBuffer`, with 1–4 seeded variants per sound.
- **Rendering:** samples render lazily and are prewarmed in small idle chunks after the first gesture, so no stall falls on a hit.
- **Playback:** one `AudioBufferSourceNode` plus a gain per sound, with ±4.5% pitch and ±10% gain variation and a random variant, so repeats never sound identical. Nodes disconnect when they end.
- **Control:** per-sound cooldowns (footsteps, scuffs, landings, exhale, menu ticks) and a 24-voice cap that drops quiet sounds first.
- **Master chain:** a gentle `DynamicsCompressor` limiter (−10 dB threshold, 8:1) prevents clipping when impacts stack.
- **Timing:** kick whooshes are *scheduled* from the attack's real startup frames, so the air peaks exactly at extension and the dobok snap lands on full extension. Impacts, blocks and whiffs play on the simulation's contact events, so contact and sound agree.
- **Lifecycle:** suspend/resume follow page visibility as before. The room tone stops entirely when muted or at zero volume, and restarts when audible.

## Sounds

| Event | Sound |
|---|---|
| Rear-leg kick (front, roundhouse) | Air whoosh rising to the extension, dobok snap, sometimes a quiet exhale |
| Side kick, back kick | Heavier, longer, lower whoosh; snap; sometimes an exhale |
| Lead-leg kicks | Fast, brighter, shorter whoosh; lighter snap |
| Punch | Fast whoosh, no snap |
| Body contact (hogu) | Padded low thump + vinyl slap + short fabric tail (3 variants) |
| Head contact (headgear) | Higher, drier foam thwack (3 variants) |
| Punch contact | Smaller glove-on-hogu impact |
| Turning kick, counter, rear-leg head kick | The impact plus a low weight layer |
| Blocked kick or punch | Dull forearm/guard knock (no hogu pop); guard break adds weight |
| Missed technique | The whoosh's follow-through tail ("whiff"), no contact |
| Foot plant | Soft bare foot on the mat, on the actual plant; 4 variants; quieter for the opponent; cooldowns |
| Pivot on the ball of the foot | Very soft skin-on-vinyl scuff |
| Landing after a kick | Weight coming down |
| Dash | Short slide on the mat |
| Round start / end | Arcade: small struck bell (1 or 3). Competitive: electronic timer tone (short or long) |
| Deciding round | Two low drum strokes after the start cue |
| Point (Competitive) | Short electronic blip; a second, higher blip for turning techniques (4 and 6 points) |
| Gam-jeom | Low muted double buzz |
| Knockdown, KO | Body fall on the mat; KO adds a deep boom |
| Victory, defeat | Warm major-chord swell, or a soft falling minor third (after the final bell) |
| Training | Wood-block tock on valid hits; rising tock on combination steps; three-note combo completion; halfway chime in challenges; soft tick on misses; two-chime completion |
| Belt promotion | Low gong and a warm chord |
| Menu | Quiet tick when moving the current item; two-note confirm; falling back cue; soft swell when play starts |
| Ambience | Low room tone with a very slow air movement |

**Deliberately silent:**
- coaching tips (no notification fatigue);
- the idle bounce (no footstep unless a foot actually re-plants);
- the training round start.

### Mix (rendered RMS × level, dB)

The intended hierarchy, as measured: impacts −12 to −21 › landing −22 › whoosh −25 › dobok snap −28 › footstep −30 › whiff −31 › exhale −36 › pivot scuff −40. Menu sounds are quieter still while in the menu.

## Size and performance

- **Download:** **0 bytes of audio assets.** The engine code adds roughly 7 KB gzipped to the App chunk. The `?lab=sounds` page is a separate 1 KB chunk that loads only on that URL.
- **Memory:** about 3 MB decoded if *every* sound has been rendered (23 s of mono 32-bit samples at 32 kHz). A typical match renders the combat subset, roughly 1–1.5 MB.
- **CPU:** rendering happens once, in about 16 ms chunks after the first gesture. During play, each sound is one buffer source plus one gain, with no per-frame allocation, capped at 24 voices.

## Verification

### Automated

Run with `node scripts/dev/audio-check.mjs`; it results in **12/12**:
- Audio stays locked before a gesture, and a click unlocks it.
- **Landed roundhouse:** whoosh, snap and body impact, with no block or whiff.
- **Missed roundhouse:** whoosh and whiff, with no impact or block.
- **Blocked front kick:** whoosh and block, with no impact.
- **Landed punch:** fast whoosh and punch impact, with no snap.
- **Master volume:** the slider sets the output gain.
- **Mute:** silences the output, stops the room tone and is saved. Unmute restores both.
- **Mobile:** on an emulated touch phone, the first tap unlocks audio and the menu back/confirm cues play.
- No page errors.

Also:
- `tsc -b` is clean and `npm run build` succeeds.
- Every rendered sound is non-silent, NaN-free and peaks at 0.9 (no clipping).

### Subjective (pending, for UAT)

I could not listen to audio in the build environment. Judging how convincing the sounds are, the balance, and the mobile speaker behaviour (iOS Safari and Android Chrome) all need human listening.

## Comparing before and after

- **Before:** https://dojang.balogunoluwasogo.com (production, the old synthesized set).
- **After:** the PR's Vercel preview.
- In both, play the same sequence:
  - a roundhouse in range;
  - the same kick out of range;
  - a kick into a guarding opponent (Competitive vs the Red belt AI);
  - footwork back and forth;
  - a Competitive turning-kick point and a gam-jeom;
  - a training combination drill.
- **Isolated sounds:** open `<preview>/?lab=sounds`. It plays every sound in the library, has "×4" buttons to hear the variation, and includes combined cues (landed, blocked and missed kick; turning point; gam-jeom; deciding round; promotion).

## Known limitations

- **Voices:** no kihap or grunt recordings (see Sourcing).
- **Synthesis limits:** the hogu and headgear sounds are layered synthesis, not recorded foam. It's good for clarity and size, but a recorded library could sound more physical.
- **Not tested on real devices:** iOS Safari and Android Chrome. The engine keeps the `webkitAudioContext` fallback and unlocks on the first gesture, as before.
- **Paused timing:** a whoosh scheduled just before pausing can still finish playing.
