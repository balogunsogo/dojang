# Release Candidate Review: Phases 3–6

_Branch `claude/amazing-galileo-4k6k1j`, based on `main` at 470ba0b (PR #4 merged). Draft PR: balogunsogo/dojang#5. Prepared 2026-11-02._

This is a **release candidate for human review**. The implementation is complete and automated verification passed. Human UAT on real devices is still pending, and a **production release is not authorized**: nothing here has been merged or deployed to production.

## 1. What is in this release candidate

### Phase 3: Mobile experience (commit 6b13725)
- **Control preferences:**
  - opacity (40–100%), size (80–130%), left-handed mirror, and a forced-touch toggle;
  - the Compact/Classic scheme choice is kept.
- **Left-handed layout:** the whole cluster is mirrored with a CSS transform, and labels are counter-flipped so they stay readable. The wheel's swipe direction is mirrored to match.
- **Comfort and camera:** camera assist (lock-on drift) on/off, reduce screen shake, and reduce flashes. First run follows `prefers-reduced-motion`.
- **Shared settings panel**, in both the main menu and the pause menu. It covers controls, camera, comfort, audio (master, effects, ambience, mute), quality, the perf overlay and a reset.
- **Interruptions:**
  - Hiding the tab, switching apps or `pagehide` pauses the match and suspends audio.
  - Audio resumes on return; the match stays paused until the player resumes.
- **Failure handling:**
  - No WebGL → a clear fallback screen.
  - A runtime error in the match → an error boundary with Retry / Back to menu.
  - A failed asset load → Retry / Back.
  - Audio that cannot unlock fails silently.
- **Wheel hold delay** went from 260 to 200 ms.

### Phase 4: Training and progression (commit d1fb357)
- **Training mode** reuses the real combat simulation (`CombatWorld`) with `TrainingRules`. A "valid" hit uses the same contact validation as Competitive.
- **Training partner** holds a lit target ring (head or trunk) and can stand still, move, or attack.
- **Activity types (three kinds, nine activities):**
  - **Practice:** free technique practice with a Finish button.
  - **Challenges:**
    - Body kicks: 10 in 40 s.
    - Head kicks: 5 in 40 s.
    - Alternating targets: 8 in 45 s.
    - Moving target: 6 in 45 s.
  - **Drills:** three reps each, with order and timing enforced:
    - Front → Roundhouse.
    - Lead → Rear roundhouse.
    - Side → Back kick.
    - Block → Counter (the partner attacks).
- **Feedback:** live toasts and sounds ("Miss: step in", "Wrong target", "Too close: no impact", "Combination broken", "Too slow"), plus a HUD showing progress, clock, accuracy, combo and the next step.
- **Summary screen:** stats, a coaching tip, best records, and next-belt requirements. Options: Retry / Next / Training menu / Main menu.
- **Fighter selection:** Kim Jae-won or Park Ha-na. The chosen fighter is used in sparring and training.
- **Belt progression White → Yellow → Green:**
  - Each belt has four milestones, shown as a checklist.
  - A promotion screen appears once.
  - The belt color renders on the dobok.
  - The game labels it as a gameplay milestone, not an official grading.
- **Persistence:**
  - Progress uses the versioned localStorage key `dojang.progress.v1` with `migrate()`. Corrupt or partial saves fall back safely.
  - A refused write (private mode, quota) shows a warning instead of crashing.
  - Settings persist separately in `dojang.settings.v1`.

### Phase 5: Visual, audio and feel polish (commit 5479f7b)
- **Audio:**
  - Mixer buses for effects and ambience, each with its own volume.
  - Footsteps, UI clicks, training success/fail cues, a promotion fanfare, a low-stamina warning, and a knockdown thud.
  - A quiet dojang room tone during matches and training.
- **Calls and toasts:** referee calls replace each other, so only one shows at a time; at most three toasts are on screen.
- **Character shading:** dobok fabric folds, heavier hems and a lapel edge, all baked into vertex colors (no textures, no extra draw calls).
- **Camera:** a subtle zoom punch on heavy impacts, scaled down by "reduce shake".
- **Dojang:**
  - kicking paddles on a wall rack, stacked trunk protectors, folded mats and a standing kick shield;
  - all merged into the existing static mesh, so there are 0 extra draw calls.
- **Screens:** entrance animations on the result and promotion overlays, gold accents, and the promotion belt-band reveal, all disabled under reduced motion.
- **Menu redesign** (landed with Phase 4): a home screen with a fighter card, belt chip and mode buttons, plus Spar setup, Training, Fighter, Progression, Settings and Controls panels.

### Phase 6: Release validation (this document)
- Performance audit (§3), one full verification pass (§2), accessibility review (§4), failure handling (Phase 3 above), and documentation updates.

### Unchanged on purpose
- The Phase 2 / PR #4 competitive rules are unchanged:
  - points 1/2/3/4/6;
  - 5 gam-jeom per round, 10 per match;
  - Art. 15.5 tie-breaks with the labelled "Game decision";
  - no golden round;
  - 60/90/120 s rounds.
- The unresolved "passive late ×2" detail stays configurable in `WT_2026` and documented in DECISIONS.md D-017.

## 2. Verification (one complete pass, 2026-11-02)

| Check | Result |
|---|---|
| `npx tsc -b` | clean |
| `npm test` (Vitest) | **105 / 105** (6 files; 9 of them are new training/progression tests) |
| `npm run build` | OK |
| `node scripts/e2e.mjs` against `vite preview` (production build, headless Chromium, SwiftShader) | **71 / 71** checks |

The e2e sections are: desktop, exchange, compact, classic, pwa, mobile-gate, training, competitive, competitive-mobile and portrait. The new Phase 3/4 checks cover:
- the left-handed wheel;
- pause/resume on visibility change;
- finishing a match and a rematch by touch;
- fighter selection;
- completing the Body challenge;
- the promotion flow;
- a combination drill;
- progress persisting across a reload.

**Not verified:**
- **Browsers:** Safari, Firefox, iOS Safari and Android Chrome were not run. Only headless Chromium was.
- **Real phones and tablets:** none were used. Mobile coverage comes from Chromium device emulation (touch, viewport and DPR).
- **Offline:** offline play is **not claimed**. The PWA manifest allows "Add to Home Screen", but there is no service worker.

## 3. Performance

Measured with `scripts/ux-capture.mjs` in headless Chromium with **SwiftShader (software WebGL)**. Frame rates in this environment are **not representative** and are not reported. Draw calls, triangles, CPU timings and bundle sizes are meaningful.

| Metric | Phase 2 (main) | This RC | Budget |
|---|---|---|---|
| Draw calls in a match | 19–23 | 20–22 | ≤ 40 |
| Triangles | not recorded | 29.8–29.9k | — |
| Simulation CPU / frame | 0.07–0.13 ms | 0.09–0.17 ms | ≤ 1 ms |
| Animation + IK CPU / frame (2 fighters) | 0.37–0.48 ms | 0.55–0.69 ms (busy container) | ≤ 2 ms |
| App chunk (gzip) | 78.3 KB | 88.4 KB | — |
| CSS (gzip) | 3.7 KB | 6.2 KB | — |
| Total JS + CSS (gzip) + fighter.glb | ~382 KB + 85 KB | ~393 KB + 85 KB | ≤ 1.5 MB |
| UI coverage on phones (landscape) | 13.6–17.6% | 13.6–17.6% | — |

There are no new textures, shaders, materials, physics or asset files. The training target ring is one small mesh, created only in training.

## 4. Accessibility

- **Keyboard and focus:**
  - All menus and overlays are keyboard reachable, with `:focus-visible` rings.
  - Dialogs use `role="dialog"`/`aria-modal`, and their primary action has `autoFocus`.
- **Reduced motion:**
  - `prefers-reduced-motion` sets "reduce shake" and "reduce flashes" on first run.
  - CSS animations are disabled under reduced motion.
- **Hearing:** every audio cue has a visual counterpart (toasts or the HUD), and audio can be muted or mixed per bus.
- **Text alternatives:** Korean terms are shown with English glosses ("Joon-bi! (Ready)", "Shi-jak! / Begin").
- **Not done:** no screen-reader pass with VoiceOver or TalkBack, and no contrast audit with tooling.

## 5. Assets and licensing

**No new asset files were added in Phases 3–6:**
- All new sounds are synthesized with Web Audio.
- All new visuals are Three.js primitives or vertex colors.
- The single binary asset is still the CC0 Quaternius mannequin (`public/assets/fighter.glb`). See ASSET_MANIFEST.md.

**No new Korean text was introduced.** The existing calls and banner were verified in earlier phases.

## 6. Known issues and limitations

1. **No real-device or cross-browser testing yet.** This needs human UAT (§7).
2. **Hybrid touch gestures** (tap/swipe recognizer) from the original Phase 3 plan were not built. Compact and Classic were completed instead. The gestures are deferred.
3. **Passive late ×2 gam-jeom** is still an unverified rule detail. It is configurable, as before.
4. **Training equipment is out of shot.** It sits on the back wall, behind the default camera, and is visible only with the free camera.
5. **Belts stop at Green.** Higher belts are out of scope.
6. **No onboarding tutorial.** The Controls panel and the Practice activity serve that role.
7. **No offline play** (see §2).
8. **Audio starts only after the first tap or key press.** This is browser policy; ambience starts then.

## 7. UAT checklist (human)

**Desktop sparring**
- [ ] Arcade vs Easy/Normal/Hard: movement, all kicks including lead-leg kicks (F + K/L/U), guard, dash, KO, rematch.
- [ ] Pause with Esc; settings in the pause menu apply live; switching tabs auto-pauses.

**Mobile sparring** (one iPhone and one Android phone, landscape)
- [ ] The Compact wheel opens by slide and by hold, and head height works past the outer ring.
- [ ] Classic scheme, plus the Rear/Lead chip.
- [ ] Opacity and size sliders; the left-handed layout mirrors and remains usable.
- [ ] App switch or lock screen → the match is paused and audio stops; resume works.
- [ ] The portrait prompt appears, and Add to Home Screen launches fullscreen.

**Training**
- [ ] Each of the nine activities can be started, completed and failed (time out).
- [ ] The target ring and the HUD hint match the required zone; the feedback messages make sense.
- [ ] Summary: Retry / Next / Training menu / Main menu.

**Character selection**
- [ ] Choosing Jae-won or Ha-na changes the fighter in sparring and training, and persists across a reload.

**Belt progression**
- [ ] White → Yellow after the four milestones; the promotion screen shows once; the belt renders on the dobok.
- [ ] Yellow → Green; Progress → Reset clears it.
- [ ] Progress survives a reload. In private mode, a save warning appears instead of a crash.

**Competitive scoring** (regression against PR #4)
- [ ] Points 1/2/3/4/6, gam-jeom 5/round and 10/match, tie-break labels, no golden round, 60/90/120 s.

**Performance and animation**
- [ ] Note FPS (perf overlay with `?perf=1`) on a mid-range Android and an older iPhone; 30 FPS sustained is the minimum.
- [ ] Kicks, footwork and hit reactions look grounded, and the heavy-hit camera punch is subtle (off with reduce shake).

## 8. Release readiness

| Item | Status |
|---|---|
| Implementation of Phases 3–6 | ✅ Complete (with the deferrals in §6) |
| Automated verification | ✅ Passed (tsc, 105/105 unit, build, 71/71 e2e) |
| Preview deployment | Vercel preview for PR #5 (see the PR) |
| Human UAT | ⏳ Pending (§7) |
| Production release | ⛔ Not authorized: merge and deploy only after UAT sign-off |
