# Phase 1.5: Combat Animation and Mobile UX Refinement

Desktop and physical-iPhone UAT of the Phase 1 build found two problems: fighters felt robotic, and the mobile HUD and controls hid too much of the fight. This phase fixes both without adding Phase 2 features. Frame data, hit detection and the simulation are unchanged; see "What did not change".

## A. Animation

| Problem seen in UAT / Phase 1 | Change |
|---|---|
| Feet slid along the floor; footwork was a sine wiggle | **Foot planting** (`src/game/anim/FootPlanner.ts`): feet stay exactly where they land and take discrete arcing steps, one foot at a time, leading with the foot on the side of travel. Stride grows with speed, the target is predicted ahead of the body, and turning in place produces pivot steps. The hips shift over the support foot during each step. |
| Identical, looping idle | **Stance life**: breathing (faster and deeper when stamina is low), slow weight shifts between the feet, guard hands drifting independently, small head movement, and a TKD bounce whose rhythm and depth wander. The heels lift at the top of each bounce. Everything is seeded per fighter, so two fighters never move in sync. |
| Direction changes snapped | Smoothed local velocity **and acceleration** drive forward/side lean, so starts, stops and reversals read clearly. |
| Kicks were stance → chamber → extend → back, with no weight transfer | Kicks now go through **anticipation** (weight loads onto the lead leg, rear heel rises), chamber, snap extension, **support-foot pivot on the ball of the foot** (rises during extension), retraction, then a **landing settle** before returning to stance. |
| Same recovery whether the kick landed or not | **Outcome-aware recovery**. Landed: brief stick at contact, then a crisp rechamber. Blocked: the leg rebounds and the hips are knocked back. Missed: follow-through (a roundhouse over-rotates across the body, a front kick drops forward, a side kick over-commits). Only the shape changes; recovery length is the same frame data. |
| Every kick looked identical | **Seeded variation** per technique: chamber height, body yaw, lean and guard arm vary slightly. The extension pose (the hit point) is never varied. |
| Hit reactions used generic CC0 clips that dropped the guard and brought the feet together | **Procedural reactions on top of the fighting stance**, scaled by an impulse envelope (fast rise, eased decay over the stun). Body shots fold the trunk and drive the hips back. Head shots snap the head and torso away from the side the kick came from; roundhouses carry a side. Heavy hits are 1.45× bigger. Planted feet take stagger steps naturally when the sim's pushback moves the body. |
| Blocked attacks barely registered on the defender | **Block reaction**: forearms driven back into the guard, torso absorbs, small twist away. |
| Cross-fades counted render frames (faster at 120 Hz, slower at 30 FPS) and the match started with a T-pose flash | Cross-fades are now **time-based with an ease-out curve**: attacks 60 ms, hits and blocks 50 ms, return to footwork 140 ms. There is no fade on the first frame. Guard on/off is a smoothed weight rather than a cross-fade. |
| Stance switch was a cross-fade | A **jump switch**: the two mirrored stances blend with a hop. |

**Rig.** The CC0 mannequin rig is kept. Nothing reachable from this environment offered a licensed, Taekwondo-specific replacement, and the problems were in how the rig was driven, not the rig itself (see DECISIONS.md D-010).

**Evidence.** These are deterministic filmstrips from the motion lab (`?lab=motion`). The real simulation and animator run tick by tick on scripted exchanges: footwork, roundhouse landing, side kick blocked, front kick missing, back kick landing, and a head kick taken.

- Before: `docs/media/phase1.5/motion-before.jpg`
- After: `docs/media/phase1.5/motion-after.jpg`

Foot planting and idle life only show in motion. They are covered by unit tests (no foot movement while planted, never two feet in the air, cadence 2.5–7 steps per second at 2 m/s, pivot on turning, freeze during hit stop) and need checking on a real device.

## B. Mobile controls

Two schemes, chosen in Settings or from the pause menu:

**Compact (new default)**
- Floating left joystick.
- **Kick**: tap to throw the selected kick. Slide from the button, or hold for 260 ms, to open the **technique wheel** (Front ↑, Round ↖, Side ←, Back ↙). Releasing on a technique switches to it and throws it. **The selection persists**, so later taps repeat it without reopening the wheel. The button shows the selected technique, and the choice is saved.
- **Head/body:** slide past the outer dashed ring for a head kick (gesture), or set the default height with the **Body/Head chip** (secondary control).
- **Guard** (hold), **Dash**, **Punch**, and **⇄** stance switch.
- **Camera:** drag anywhere not covered by a control.
- While the wheel is open the other buttons dim to 12% so the wheel reads clearly.

**Classic**: one button per technique, kept with smaller, more transparent buttons, more spacing, and stance switch added to the cluster.

**Multitouch and gesture conflicts.** Every control captures its own pointer; the camera layer sits under everything. The joystick, Guard, Kick, wheel and camera can all be in use at once without stealing touches, and the wheel only reads drags that began on the Kick button.

## C. Mobile HUD and framing

- **One slim scoreboard row:** corner dot, short name on phones ("Jae", "Ha-na"), round pips, a 5 px health bar over a 2 px stamina bar, and a compact clock. Measured height: **41–46 px → 28 px**.
- **Status consolidated** into one line under the clock (`BODY·ORTH·LOCK`). The large status pills are gone.
- **Inactive controls are translucent** (about 30% fill, 24% border). Touch targets stay at least 44 px, and pressed controls light up fully.
- **Safe areas:** controls sit at least `max(safe-area-inset, 14 px)` from the left and right edges and `max(inset, 10 px)` from the bottom, which keeps them clear of the notch and home indicator. Pause and lock-on are small buttons tucked under the scoreboard.
- **Responsive layouts:** a breakpoint for short phones (≤ 390 px tall, for example iPhone SE: cluster at 88%), one for tablet/foldable heights (cluster at 112%), and portrait.
- **Camera framing:** the camera measures how much of the screen the HUD and controls cover. It picks a distance from real field-of-view math so both fighters plus kick reach fit 60% of the width (touch) or 72% (desktop), and shifts the projection (`setViewOffset`) so the fighters sit in the middle of the clear region instead of behind the buttons.

### Measured before/after

Run with `scripts/ux-capture.mjs` against the production build, in headless Chromium with mobile emulation. Notch insets are simulated for the iPhone profiles.

| Device profile | UI coverage before | UI coverage after | Scoreboard height before → after |
|---|---|---|---|
| iPhone SE landscape (667×375) | 32.4% | 17.6% | 41 → 28 px |
| iPhone 15 landscape (852×393) | 25.5% | 15.7% | 41 → 28 px |
| iPhone 15 Pro Max landscape (932×430) | 25.3% | 13.6% | 46 → 28 px |
| Pixel 8 landscape (915×412) | 25.6% | 15.3% | 41 → 28 px |

UI coverage is the share of the screen under any visible HUD element or control. Raw data: `docs/media/phase1.5/ux-before.json` and `ux-after.json`. Screenshots: `hud-before-*.jpg`, `hud-after-*.jpg`, `mobile-compact.jpg`, `mobile-wheel.jpg`, `mobile-classic.jpg`.

### PWA evaluation

- **Added:** `manifest.webmanifest` (`display: fullscreen`, landscape, icons including maskable), Apple standalone meta tags (`black-translucent` status bar), and an apple-touch-icon.
- **iOS:** Safari has no install prompt API, so the menu shows a dismissible tip: Share → Add to Home Screen. Launched from the home screen, the game runs without Safari's toolbars. iOS ignores the manifest's orientation, so the rotate prompt still applies.
- **Android/Chromium:** offers an **Install** button when the browser fires `beforeinstallprompt`.
- **Optional:** installation is never required, and the browser version behaves identically.
- **No service worker** was added. The game doesn't need offline play, and a cache layer would complicate Vercel deployments for little gain. This can be revisited later.

## D. Performance

The same headless SwiftShader environment and the same capture as Phase 1 (frame rates in this environment are not meaningful):

| Metric | Before | After |
|---|---|---|
| Draw calls in a match (low tier) | 20–23 | 19–21 |
| Triangles | 29.5–29.7k | 29.5–29.6k |
| Animation CPU per frame (2 fighters) | 0.32–0.43 ms | 0.37–0.48 ms |
| Simulation CPU per frame | 0.10–0.13 ms | 0.08–0.15 ms |
| New assets | — | 4 icons (51 KB) + manifest; no textures or shaders |

Foot planting and stance life add about 0.05 ms per frame for both fighters, well inside the 2 ms animation budget. No new materials, draw calls, shaders or physics were added. Input latency is unchanged:

- Touch handlers write straight into the input object.
- Kick taps fire on pointer-up (one tap's duration).
- Wheel picks fire on release.
- Attack cross-fades are 60 ms, with an ease-out curve so most of the motion happens in the first frames.

## What did not change

- `MoveDef` frame data, hit volumes, swept hit detection, stamina, AI and rules.
- The only simulation edits are presentation fields: `HitReaction` now records the technique and side, and blocks carry a reaction too. Neither is read by game logic.
- The original 24 combat, IK and input tests still pass unchanged.
- New tests check that the extension pose (the hit point) is identical across every outcome and variation seed, and that every recovery ends in the fighting stance.

## Needs real-device validation

- Feel of foot planting, bounce and reactions at device frame rates (30, 60 and 120 Hz).
- Thumb reach and comfort of the Compact layout on iPhone SE, 15 and Pro Max, and on Android. Hold-to-open timing (260 ms) and wheel radius (100 px) may need tuning.
- Safe areas with a real notch or Dynamic Island in both landscape orientations, and the iOS home-indicator gesture zone.
- Add to Home Screen flow and fullscreen standalone launch on iOS; the Install prompt on Android Chrome.
- Haptics (`navigator.vibrate`) don't exist on iOS Safari, where taps have no haptic feedback.
- Real frame times and the dynamic-resolution steady state on device.
