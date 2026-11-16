# Phase 12A: Replay Studio (capture and viewer)

The branch is `claude/phase-12a-replay`, built on `main` at `599e9b0` (Phase 11 plus the bracket fit).
- **In scope:** capture and viewing only.
- **Not in scope:** video export (Phase 12B).
- **Unchanged:** combat, AI, scoring, animation timing, camera behaviour in matches, multiplayer synchronization, progression and save formats.

## 1. Technical assessment

**Why not record poses.** The procedural animator (`FighterAnimator`) keeps render-time state: the foot-plant planner, bounce phase, blend history and noted impacts. Online, the scene is drawn from *predicted* frames. So sampling rendered poses during the match would capture predictions, and would cost bone writes every frame.

**Chosen strategy: authoritative tick rows, baked when you watch.**

| Stage | When | What |
|---|---|---|
| Capture | Every authoritative simulation tick (60 Hz) | One row of 60 floats (240 B): world hit stop and phase, plus, per fighter, exactly the fields the animator reads (position, yaw, velocity, stamina, stance, state, time in state, stun, attack serial / move / height / startup / total / hit / blocked / impact / tired, hit reaction, down cause). No poses, no deep copies of `CombatWorld`, no scene objects. |
| Events | Same tick | Compact copies of attack, whiff, hit, block, KO and down events (move, zone, points, impact point, the side a roundhouse came from). |
| Bake | When a clip is opened | The clip's rows go through the **real** `FighterAnimator` at 60 Hz. It gets a 24-tick warm-up on the first row, the match's hit-stop rule and yaw smoothing, and impacts noted exactly as the live session does. Every bone's position and quaternion is stored per tick. |
| Playback | Viewer | Poses are sampled from the baked arrays (lerp / slerp between ticks). Seeking is a lookup: there is no re-simulation and no accumulated error, and pause holds the exact pose. |

**Why 60 Hz rather than about 30 Hz.** I evaluated 30 visual samples per second. Because rows are simulation state rather than poses, recording every tick costs about 11 µs per tick. It reproduces attack phases, hit stop and foot plants at the simulation's own precision. A 30 Hz rate would halve memory but force interpolation of discrete state (states, serials, stun timers), which the animator cannot take. Event timing is tick-exact either way.

**Bounded buffers.**
- **Ring:** a 12 s ring (173 KB) of recent rows.
- **Candidate clips:** a highlight-worthy event opens a clip with 6 s before (from the ring) and 4 s after (appended live), 601 rows (144 KB). At most 8 candidates are alive; the weakest is dropped, never the newest.
- **At completion:** the best three are kept and the rest are freed. Their windows finish while the result screen shows, or are sealed early.
- **Worst case while capturing:** about 1.6 MB.

**Online (rollback).**
- **Hook:** `Rollback.onSim` is a read-only observer called after every simulated tick, including re-simulations. The recorder *stages* that row and its events per frame, and a re-simulation overwrites them.
- **Commit:** the session commits frames only up to `min(remoteHead, frame − 1)`, and only while no correction is pending. At that point every input is known, so the state is final.
- **Result:** predicted or rolled-back actions never enter the record. Events from a re-simulated frame replace the staged ones, so they are never doubled.
- **Unchanged:** completion happens exactly where the confirmed result is already reported. No messages, no server, and no change to input handling or result confirmation.

**Edge rules.**
- **Round resets:** a clip stops where a round ends and the fighters are reset to their marks, so nothing teleports.
- **Final whistle:** a clip cut short there (the Champion screen follows the final at once) continues each fighter's final state for display only. Time in state runs on, with no motion and no new events. This keeps a KO fall visible without delaying any transition or inventing an outcome. These rows are marked `synthFrom`.
- **Fewer moments:** fewer than three highlights gives fewer clips; none gives no Watch replay.

**Rendering.**
- **After a match result:** the viewer borrows the match's own scene and context. `GameSession.setHeld()` hides the live fighters and effects, and stops its camera and animation updates while the finished match stands still. Two replay fighters are built once from the same character definitions.
- **From the Champion screen**, the match renderer is already gone. A standalone viewer mounts its own canvas only while the menu's renderer is released (one WebGL context at a time).

**Audio.**
- **Bus:** an opt-in replay bus under the effects level, so master, effects and mute apply. It is cut on pause, seek, restart and exit.
- **Variation:** seeded per cue, so a replayed moment picks the same takes every time.
- **Live play:** unchanged (`Math.random`, no bus).
- **Timing:** cues fire only when playback crosses them going forward, so seeking never fires them.
- **Slow motion:** at 0.25× and 0.5× a technique's air is scheduled to its slowed extension, and recordings keep their pitch. Time-stretching short impacts sounds worse than playing them as they are.

## 2. Highlight rules (`src/game/replay/highlights.ts`)

| Moment | Score |
|---|---|
| Knockout | +100, added to the finishing strike |
| Knockdown (Competitive) | +55, added to the strike |
| Match-winning strike (the winner's last hit, ≤ 4 s before the end) | +35 |
| Clean hit | 8 base |
| — head | +22 |
| — turning kick | +15 |
| — counter | +12 |
| — Competitive points | +4 per point |
| Combination (same attacker again within 1.2 s) | +10 |
| Guard break | 14 |
| Training combination (a completed drill repetition) | +22 (or 30 alone) |

- **Threshold:** a moment needs 12 to be a highlight; an ordinary arcade body kick is 8. Invalid Competitive contacts score 0.
- **Selection:** best first, at least 5 s apart. A repeated kind counts 25% less each time. At most three, shown in match order.
- **Labels** come from the events, for example "Roundhouse kick · Head kick", "Back kick · 4 points", "Counterattack · Front kick", "Combination · Front kick → Roundhouse kick", "Knockout · Roundhouse kick" and "Training combination". The engine reports a KO from inside the damage step, before that tick's hit, so hits are taken first and the finishing strike is the one named.
- **Isolation:** highlight scores never touch match scoring.

## 3. Modes

| Mode | Where | Notes |
|---|---|---|
| Arcade, Competitive | Result panel → Watch replay | Round table and all result info kept; Esc / Back returns to the same panel |
| Tournament | Post-win and eliminated panels; Champion screen | Champion uses the standalone viewer. The bracket, totals and statistics are untouched. AI-only fixtures are not replayed. |
| Training | Training summary | Only when a usable event exists |
| Couch | Result panel | Moments by either fighter, with the P2 name in the by-line |
| Online | Result panel, after the confirmed result | Each peer watches its locally captured replay. Rematch, lobby and leave are unchanged. |

Memory only. The most recent completed match or activity is kept across result, bracket, Champion and viewer navigation. Starting another match replaces it, and refreshing clears it. Nothing is written to storage or a backend.

## 4. Verification

| Check | Result |
|---|---|
| `tsc --noEmit`, `vite build` | Clean |
| `vitest` (adds `tests/replay.test.ts`, 10 tests) | **142/142** |
| `replay.test.ts`:<br>• labels and scoring;<br>• selection (separation, variety, max 3, nothing fabricated);<br>• memory bound;<br>• **every clip row equals the match state at that tick**;<br>• clips stop at round resets;<br>• KO continuation (display only, no events after the real end);<br>• **online rollback:** a predicted *block* that the real input turned into a *hit*. Only the hit is recorded, every committed tick equals the confirmed truth, there are no duplicate hits or blocks, both peers agree, and nothing is committed before confirmation. | Pass |
| `replay-check.mjs` Arcade (real kicks):<br>• highlights chosen;<br>• Watch replay;<br>• KO labelled with the real roundhouse by Chung on Hong;<br>• **the knocked-out fighter's hips fall from 0.83 to 0.21 m and stay down**;<br>• repeated seeking gives the identical pose;<br>• pause freezes it;<br>• 0.25× runs at about a quarter speed;<br>• cameras stay in the hall;<br>• next / previous;<br>• Back returns to the same panel;<br>• **progress unchanged**;<br>• player released | 15/15 |
| Competitive: "Match-winning · Roundhouse kick · 3 points"; round table kept · Couch: P2 credited · Training: "Training combination" | Pass |
| Tournament:<br>• post-win replay;<br>• Champion replay in the standalone viewer (one canvas);<br>• bracket, totals and statistics unchanged | 5/5 |
| Audio:<br>• recorded cues play (air, cloth, impact, steps);<br>• **paused and seeking across the impact plays nothing**;<br>• **seeded takes repeat exactly**;<br>• mute sets master to 0;<br>• bus released on exit | 6/6 |
| Phones (844×390, 740×360, 390×844):<br>• controls fit;<br>• touch targets ≥ 40 px;<br>• the scene stays visible;<br>• tap switches cameras;<br>• portrait framing fits both fighters (it backs off, or widens the lens where the hall stops the camera) | 7/7 |
| `replay-online-check.mjs` (two browsers, local relay, real kicks to a finish):<br>• Watch replay only after the confirmed result on both;<br>• **both peers' highlights identical** (labels, timing, hits and every recorded row, with about 200 rollbacks on the guest);<br>• rematch works afterwards | 8/8 |

## 5. Performance (software rendering, the same machine, `main` vs this branch)

Measured with headless Chromium and SwiftShader. Frame times reflect software rendering. **No physical-device measurement was made.**

| Metric | `main` | Phase 12A |
|---|---|---|
| Simulation per rendered frame (AI v AI Competitive, low quality, 25 s × 3) | 0.14–0.18 ms | 0.19–0.21 ms |
| Capture cost | — | 10–14 µs per tick; about 0.06% of a 60 Hz frame on a phone at one tick per frame |
| Frame time | 98–105 ms | 95–102 ms (no change) |
| Heap growth over the 25 s match | ~0.5 MB | 0.8–2.0 MB (ring plus up to 8 candidate clips; ≤ 1.6 MB by design) |
| Recorder held at the end of a match | — | 0.45–1.5 MB |
| Viewer ready (click → first frame) | — | 1.4–1.9 s, of which the bake is 0.5–0.6 s for about 10 s of footage. The fighters stay hidden until baked. |
| Baked poses for one clip | — | 1.4 MB (freed on close) |
| Clip data kept for the session | — | about 250 KB for three clips |
| Seek | — | 0.06–0.08 ms |
| Playback frame time | — | Same as the live match (69–83 ms here) |
| Heap with the viewer open / after closing | — | +0.6–1.9 MB / +0.3–1.7 MB (the kept clips plus GC timing) |

No video encoding, no GPU readbacks, and no new contexts during matches. The match scene is reused for viewing.

## 6. Known limitations

- **Physical devices:** not measured. The bake (about 0.5 s here) will take longer on a slow phone. It runs in chunks and the page stays responsive, but the first frame of a clip takes a moment. UAT on a mid-range phone is recommended.
- **Animator warm-up:** the first frame of a clip settles from a 24-tick warm-up instead of the match's full blend history, so the first fraction of a second can differ subtly from what was on screen.
- **Slow motion:** sounds keep their pitch at 0.25× and 0.5×. Air whooshes follow the slowed extension; impacts play as recorded at the slowed moment.
- **Synthetic continuation:** rows after the final whistle continue the last state for display, and show only when the viewer is opened (or the Champion screen appears) before the 4 s window has filled.
- **Online:** each peer watches its own capture. There is no replay sync, which was not required.
- **Test setup:** the browser checks position the fighters and, for knockouts, lower the defender's health before the finishing exchange. The kicks and the KO themselves are real game actions through the real input, and the replay shows exactly what was recorded.

## 7. Evidence (`docs/media/phase-12a/`)

- **Cameras:** `arcade-broadcast`, `arcade-side`, `arcade-close`.
- **KO sequence:** `ko-sequence.jpg`, plus `ko-chamber`, `ko-contact`, `ko-falling` and `ko-floor`.
- **Modes:** `competitive-replay`, `couch-replay`, `training-replay`, `champion-replay`, `online-host`, `online-guest`.
- **Phones:** `mobile-844x390`, `mobile-740x360`, `mobile-390x844`.
- **Videos:**
  - `replay-headkick.mp4`: a real Competitive head kick, then its replay through broadcast, side at 0.5× and close-up.
  - `replay-ko.mp4`: a real knockout, then its replay at 1×, close-up at 0.25×, and side.
