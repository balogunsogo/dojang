# Phase 10: Expanded Fighter Roster

The branch is `claude/phase-10-roster`, built on `main`. It implements the approved Phase 10 design handoff (`DOJANG_PHASE_10_DESIGN_HANDOFF.md`). It adds no gameplay, unlocks or new modes.

## 1. What changed

| Area | Change | Files |
|---|---|---|
| Roster | Six fighters, in this order: Kim Jae-won, Park Ha-na, Tunde Adeyemi, Sofia Reyes, Seo Min-jun, Amara Okafor. `ROSTER`, `isCharacterId` and `nextFighter` are the single source of order and validity. `CharacterDef` gains `origin`, `build`, `hair`, `hairStyle` and `hairBack`. | `characterFactory.ts` |
| Faces | Face v2 for all six: a 45 × 67 sculpted mask, the per-fighter fidelity parameters, and ears. Head form (crown rounding and jaw width) for all six. | `face.ts`, `characterFactory.ts` |
| Hair | Six hair caps (crop, part, coily, sleek, fringe, cornrows), shown only with headgear off. Back pieces (ponytail, bun, braid) are always shown and pass under the headgear. | `hair.ts` (new), `gear.ts` |
| Headgear option | `createCharacter(..., { headgear })`. Matches always use headgear. The fighter preview is bare-headed. | `characterFactory.ts`, `gear.ts` |
| Stats | The approved table (section 3). The Jae-won and Ha-na trims are **provisional for UAT**. | `characterFactory.ts` |
| Selection screen | Sections 4–6 of the handoff: desktop, phone landscape (844 × 390 and 740 × 360) and phone portrait. | `Menu.tsx`, `kit.tsx`, `menu.css` |
| Stage | Changes to the fighter shot:<br>• new framing;<br>• bare-head preview;<br>• face light;<br>• the opponent is the next fighter in roster order;<br>• built fighters are kept in a bounded cache, prebuilt at idle;<br>• swaps happen behind a 300 ms dim, or instantly with reduced motion. | `MenuStage.ts`, `MenuBackdrop.tsx`, `FighterAnimator.ts` |
| Modes | No mode assumes "the other of Jae and Ha-na". Arcade, Competitive and Training take the opponent from roster order; couch P2 defaults to the next fighter. | `GameSession.ts`, `Friend.tsx` |
| Couch and online | `FighterPick` is a 2 × 3 grid of name rows. | `Friend.tsx` |
| Online safety | Unknown fighter ids are rejected in the lobby and the player is asked to refresh (section 5). | `NetClient.ts`, `Friend.tsx` |
| Saves | Unchanged format. An unknown or corrupt saved fighter falls back to Jae-won and keeps belt, records and history. | `progress.ts` |
| Fonts | The Korean subsets add 서민준. | `build-fonts.py`, `src/fonts.css`, `src/assets/fonts` |
| Leak fix | Disposing a fighter now frees its skeleton's bone texture. This leak predated Phase 10 and also affected matches. | `characterFactory.ts` |

## 2. Deviations from the handoff

1. **Unknown online fighter ids.** The handoff says to fall back to `jae` and show "Your friend needs to refresh".
   - **What I did instead:** the project owner's brief overrides this, so nothing is substituted. The lobby blocks Ready and the match start on both sides.
     - The player who can't load the other's fighter sees: "Your friend's fighter isn't in this version of DOJANG. Refresh the page to update, then rejoin the room."
     - The other player sees: "Your friend needs to refresh to load your fighter."
     - The guest also refuses a start message, and the match starter refuses ids it can't load.
   - **Unchanged:** BUILD_ID, rollback, the deterministic simulation and the server.
2. **Gear vertex count.** The handoff estimated about 6.4k gear vertices.
   - Main's base gear is already 5.1k, so the measured counts are higher: about 7.3k with headgear on and up to 9.6k with it off.
   - In a match that adds about 16.5k triangles a frame, counting shadow passes (section 6). The budget is 150k.
3. **Opponent while choosing.** In the fighter shot the opponent is out of frame. It changes to the next fighter when the camera next shows it, behind the same dim.
   - **Why:** this keeps the cache at six previews plus one or two opponents. Otherwise a second pass through the roster would overflow it and rebuild geometry.
4. **Face light.** The handoff says to add it on entering the fighter shot and remove it on leaving. Instead it stays in the scene at intensity 0 elsewhere.
   - **Why:** changing the number of lights recompiles every shader, which would cause a hitch on phones.
5. **Detail cross-fade.** The new text holds for 120 ms, then fades in over 180 ms, in step with the stage dim. The old text is not faded out separately. With reduced motion it is a 120 ms fade only.
6. **1024 × 768.** The column is 420 px as specified. The roster body scrolls by 80 px inside `ScreenShell`, and the footer stays pinned. The design board shows no height below 900 for this width.

## 3. Stats (displayed ×100)

| Fighter | Power | Speed | Recovery | Note |
|---|---|---|---|---|
| Kim Jae-won | 108 | **102** (was 100) | **103** (was 100) | Provisional, for UAT |
| Park Ha-na | 94 | **109** (was 110) | **110** (was 112) | Provisional, for UAT |
| Tunde Adeyemi | 106 | 98 | 105 | New |
| Sofia Reyes | 103 | 104 | 104 | New |
| Seo Min-jun | 96 | 112 | 107 | New |
| Amara Okafor | 99 | 108 | 106 | New |

`maxHealth` is 100 for every fighter.

**Balance re-run:** I ran the handoff's harness (`reference/balance.sim.test.ts`, not committed) on the shipped values. It covered every pairing, both corners, Arcade and Competitive, 80 seeds each, at Hard and Normal: 9,600 matches in total.

| Fighter | Win rate (draws count as half a win) |
|---|---|
| Jae-won | 49.8% |
| Ha-na | 51.3% |
| Tunde | 49.1% |
| Sofia | 48.6% |
| Min-jun | 51.3% |
| Amara | 50.0% |

- All 15 head-to-heads fall between 47.2% and 53.4%.
- This matches the handoff's figures to within 0.2 points.
- AI-vs-AI is a floor, not proof. Tunde and Min-jun need human playtesting.

## 4. Verification

| Check | Result |
|---|---|
| `tsc --noEmit`, `vite build` | Clean |
| `vitest` (includes the new `tests/roster.test.ts`) | 115/115 |
| Roster, faces and builds (`scripts/dev/roster-check.mjs`, dev server):<br>• order and keys;<br>• all 12 builds (six fighters, headgear on and off);<br>• no NaN;<br>• vertex budget | 16/16 |
| Save compatibility (unit tests):<br>• Jae-won and Ha-na saves keep fighter, belt, records and matches;<br>• new fighters are kept;<br>• `zed`, `42`, `null` and `__proto__` fall back to Jae-won with progress kept | Pass |
| Selection input (`scripts/dev/select-check.mjs`, build, live stage). Covers:<br>• roster order;<br>• arrows with wrap-around;<br>• selection saves immediately;<br>• the dim, then clear;<br>• hover never swaps;<br>• rapid input;<br>• Esc, Enter;<br>• home footer and item;<br>• D-pad and B (stubbed Gamepad API);<br>• tap and ←/→ column jump at 844 × 390 and 740 × 360;<br>• no scrolling, and the button stays on screen;<br>• the icon back button is labelled;<br>• reduced motion: no dim | 19/19 |
| Modes with new fighters (`scripts/dev/modes-check.mjs`):<br>• Arcade: Tunde vs Sofia, kicks land;<br>• Competitive: Amara vs Jae-won (roster wraps), the AI acts;<br>• Training: Min-jun, kicks register | 7/7 |
| Couch (`scripts/dev/couch-check.mjs`): P2 picks Sofia from the grid; separate controls | 6/6 |
| Online roster (`scripts/dev/online-roster-check.mjs`, two browsers plus a local relay):<br>• **unknown id:** both players see the refresh messages, Ready is disabled and the match never starts;<br>• **Tunde vs Amara:** both peers build them and simulate with no desyncs; stamina agrees | 10/10 |
| Online regression (`scripts/dev/online-check.mjs`):<br>• rematch;<br>• shared pause;<br>• corners;<br>• names;<br>• no desyncs | 25/25 |
| `scripts/menu-smoke.mjs` | 22/23. The one failure ("3 play modes") is a stale assertion that **fails on `main` too**: it predates "Play a friend". |

## 5. Visual comparison

The renders come from the same procedural code the game ships, captured in a local lab page that is not committed. Each comparison shows the handoff reference on top and the implementation below.

- **Sheets:** `docs/media/phase-10/cmp-sheet-{id}.jpg`, six of them. Each shows front, three-quarter, profile, back, headgear on and the red corner, plus head close-ups with headgear off and on.
- **Roster line-up:** `cmp-roster.jpg`. The top row has headgear off and the bottom row has it on.
- **Recognition heads:** `cmp-heads.jpg`, headgear on and off.
- **Selection screen:** `select-desktop-{id}.jpg` (1440 × 900), `select-landscape-844-amara.jpg`, `select-landscape-740-amara.jpg`, `select-portrait-390-sofia.jpg` and `select-1024-minjun.jpg`.
- **Multiplayer pickers:** `couch-pick.jpg` and `online-pick.jpg`. **Home** with headgear back on: `home-sofia.jpg`.
- **Video:** `phase10-demo.mp4` (60 s). It cycles through all six fighters, confirms Tunde, then fights an Arcade round against Sofia.

## 6. Performance (vs `main`)

**How this was measured:** headless Chromium with SwiftShader (software WebGL) at 1280 × 800, medium quality, on the same machine.
- Absolute frame times reflect software rendering, so compare branch against main. Real phones were **not** measured.
- "Max frame gap" is the longest frame in the 1.5 s after a selection change. The baseline frame here is about 135–170 ms.

| Metric | `main` | Phase 10 | Note |
|---|---|---|---|
| JS + CSS (gzip) | 432.5 KB | 439.2 KB | +6.7 KB |
| Font files | 118.9 KB | 120.1 KB | +1.1 KB (서민준) |
| Menu interactive / stage live | 1.28 / 1.90 s | 1.31–1.50 / 2.0–2.2 s | Within run-to-run noise. The six previews build at idle, after the stage is live. |
| Fighter creation (median, per build) | Jae 23 ms, Ha-na 17 ms | 21–31 ms for each of the six | About 25% more: face v2 and hair. Paid once per stage lifetime. |
| Preview switch, max frame gap | 283–333 ms (rebuilds both fighters) | 133–183 ms (cached; about one frame) | **No hitch on selection** |
| Menu GPU buffers / textures, after cycling the roster twice | 81 / 18 | 153 / 16 | The cache holds up to 10 fighters |
| After leaving and re-entering twice | 81 / **26** (textures leak) | 153 / **16** (flat) | Bone-texture leak fixed |
| Menu JS heap | 23 MB | 18–22 MB | Noise |
| Match draw calls | 23 | 23 | Unchanged |
| Match triangles (Jae vs Ha-na) | 91.8k | 108.3k | +16.5k including shadow passes. Tunde vs Sofia: 108.5k |
| Match frame / p95 (software renderer) | 134.8 / 166 ms | 136.9 / 173 ms | GPU-bound in SwiftShader; within noise |
| Sim / animation CPU per frame | 0.20 / 0.45 ms | 0.16 / 0.45 ms | Unchanged |

**Mobile:**
- The draw-call count is unchanged.
- The extra triangles are 11% of the 150k budget.
- Selection no longer builds geometry, and the menu skips the animator's floor probe (about 70 ms per build).
- **UAT should confirm** the fighter-select screen and a match on a real mid-range phone.

## 7. Known issues and notes for UAT

- The Jae-won and Ha-na stat trims are provisional and need UAT sign-off.
- The gamepad was tested against a stubbed Gamepad API, not a physical controller.
- Online compatibility was tested by rewriting a peer's outgoing fighter id. A real mixed-build pair is normally stopped earlier by the BUILD_ID check.
- The demo video was recorded headless with software rendering, so it runs at a low frame rate. It shows the flow, not the smoothness. In an earlier take with 2 s between presses, the recording load made the stage trail the selection by one step. Without recording, every step showed the right fighter at the same pace, and the committed take uses 4 s between presses.
- The stale `menu-smoke` assertion is left as it is; it fails on `main` too.
