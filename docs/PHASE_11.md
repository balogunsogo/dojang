# Phase 11: The Dojang Open (Tournament Mode)

The branch is `claude/phase-11-tournament`, built on `main` at `7865e7f` (Phase 10 merged). It implements the approved Phase 11 design handoff (`DOJANG_PHASE_11_DESIGN_HANDOFF.md`).

What stays the same:
- No changes to combat, AI behaviour, rules, animation, characters, multiplayer or belt requirements.
- No new renderer, WebGL context, assets or design tokens.

## 1. What was built

| Area | Implementation | Files |
|---|---|---|
| Model | The handoff's draw (section 3.2, Fisher–Yates, seeded and reproducible):<br>• five fixtures with winner propagation;<br>• next bout and opponent;<br>• which fixtures are due;<br>• results that apply once;<br>• abandon by walkover;<br>• records that keep the final bracket;<br>• history capped at 20, with uncapped totals;<br>• validation of `dojang.tournament.v1`. | `src/game/tournament/tournament.ts` |
| AI fixtures | Real headless Competitive matches: `CombatWorld` + `CompetitiveRules` at the Open's round length, and two `AIController`s at the Open's difficulty. Each fixture is seeded, so it is reproducible.<br>• **Where it runs:** a Web Worker, with main-thread slices as the fallback.<br>• **Budget:** a 2 s batch budget, then a seeded weighted coin from the measured Phase 10 head-to-heads, with consistent scores. Fallback fixtures are marked `fallback`. | `headless.ts`, `rng.ts`, `simulate.ts`, `sim.worker.ts` |
| Store | `useTournament`:<br>• saves on entry, after each player bout and after each AI fixture;<br>• sets `saveUnavailable` if storage is refused;<br>• puts the result panel on hold until the save is written (no spinner);<br>• finishes fixtures left due after a refresh. | `src/store/useTournament.ts` |
| Match | A tournament bout is an ordinary Competitive match. It passes these explicitly: the player and opponent ids, the existing difficulty preset, the round length, and the Open context (`TournamentBout`). At the end it reports rounds and score to the Open. | `useGameStore.ts`, `MatchScreen.tsx` |
| Stage | `MenuStage.setOpponent`: Pre-match shows the drawn opponent at the Open's AI belt. All Open screens show the Open's own fighter. | `MenuStage.ts`, `MenuBackdrop.tsx` |
| Screens | Home item, Entry, Resume with inline abandon, Bracket (tree / stage pager), Pre-match, result panel (post-win and eliminated), Champion, History. | `Tournament.tsx`, `Overlays.tsx`, `Menu.tsx`, `tournament.css` |
| Input | Keyboard, touch and gamepad (the existing `useGamepadNav`, plus Y to abandon and LB/RB for the pager). Reduced motion turns off every animation. | `kit.tsx` |

**Exactly-once recording:**
- **Record once:** a player bout is applied to the bracket only if that bout is still undecided, and only then does it call the existing `recordMatch`. A duplicate callback, a revisit or a refresh can't count it twice.
- **Statistics:** the bout updates the ordinary match statistics and belt checks exactly as any Competitive match does.
- **Background bouts:** simulated AI-only fixtures never touch progress.
- **Abandon:** a walkover records no match.

## 2. Differences from the handoff

1. **Data model corrections.**
   - `Bout` has `score` (rounds won). A round tied on points is still decided by the tie-breaks, so round points alone can't give the bout score.
   - `simulated: boolean` became `source: 'player' | 'sim' | 'fallback' | 'walkover'`.
   - `OpenRecord` keeps the full bracket (seed, seeds, bouts, start date), so completed brackets stay reviewable after the active Open is cleared.
   - `totals` also keeps `best`, so the best result survives the 20-entry history cap.
2. **Background simulation runs in a worker.** I measured cooperative chunking first. At 4× CPU throttle it competed with rendering, and every fixture ran out of budget and fell back.
   - The worker is 12 KB gzip, has no three.js, and loads when a bout starts.
   - Main-thread slices remain only where Workers are unavailable.
3. **Abandon** gives the pending player bout to the opponent as a walkover (`w/o`, no rounds, no match recorded). The remaining fixtures are then simulated, so history always has a champion.
4. **Final won → Champion directly.** There is no result panel between, as in the clickable prototype (`winBout → champ`).
5. **Resume "Continue: ‹stage›"** opens Pre-match, and "Bracket" is reachable from there.
6. **Bracket breakpoints.**
   - **Tree** at ≥ 900 px wide and ≥ 600 px tall.
   - **Side-column desktop layout** when the column plus tree fit, which is ≥ 1400 × 760.
   - **Tablet layout** (stacked header) between, including 1280 × 800.
   - **Stage pager** below 900 px wide or 600 px tall.
   - **Fit to height:** the tree sits in the space between the header and the bottom row and scales down to fit it (never up). Below 80% scale the stage pager takes over. This stops fixtures running under the primary button on shorter laptop windows (UAT report, 1325 × 720).
7. **Phone landscape Abandon** sits at the right of the stage tabs, and its confirm opens beneath. The phone boards don't place it, and the bottom row had no room.
8. **Post-win note** reads "Tunde is Seed 1 and starts the tournament here.", using the fighter's short name and no pronoun.
9. **Bracket reveal** is a 180 ms fade on the newly decided score. The tick slide (optional) is not animated.
10. **Optional items.**
    - **Done:** the full History screen. Its "No. N" links open that Open's final bracket.
    - **Not done:** "Round details" for simulated bouts and sharing the bracket as text.
11. **Fallback weights.** The measured Phase 10 head-to-head table combines Hard and Normal. White belt uses the same table, because it was not measured separately.

## 3. Verification

| Check | Result |
|---|---|
| `tsc --noEmit`, `vite build` | Clean |
| `vitest` (adds `tests/tournament.test.ts`, 17 tests) | **132/132** |
| `tournament.test.ts`:<br>• draw validity and uniformity (6 fighters × 400 seeds);<br>• the three stages;<br>• elimination at QF / SF / final;<br>• champion;<br>• duplicate refusal;<br>• abandon;<br>• the history cap and totals;<br>• storage round trip and refusal;<br>• corrupt and unknown saves;<br>• deterministic simulation and the seeded fallback | Pass |
| `scripts/dev/open-check.mjs` (production build, live stage). Covers:<br>• the home item and its order;<br>• Entry level presets (White / Red / Black → easy / normal / hard), initial focus, and the round length not written back to settings;<br>• the draw;<br>• real Competitive bouts with the right fighters and length;<br>• QF2 / SF2 decided and saved before the panel;<br>• exactly-once counting (3 bouts → +3 played, +3 won);<br>• no double count after revisiting;<br>• Champion and its record;<br>• completed bracket review;<br>• History;<br>• elimination at QF / SF / final;<br>• refresh mid-bout (nothing recorded, the bout restarts from round one);<br>• the pause copy;<br>• leaving the bout;<br>• abandon (focus on Keep playing, Esc cancels, recorded as abandoned, record untouched);<br>• corrupt and unknown saves | **47/47** |
| `scripts/dev/open-layout.mjs`: resume, pre-match, bracket and champion / runner-up at 1440×900, 1024×768, 844×390, 740×360 and 390×844. Checks:<br>• no overflow;<br>• the primary is on screen;<br>• touch targets ≥ 44 px;<br>• pager ← →, tap, gamepad RB;<br>• gamepad Y abandon | **44/44** |
| Regressions:<br>• `modes-check` (Arcade, Competitive, Training) 7/7;<br>• `couch-check` 6/6;<br>• `select-check` 19/19;<br>• `online-check` (two browsers, local relay) 25/25 | Pass |

## 4. Background simulation (measured)

**How this was measured:** headless Chromium with SwiftShader (software WebGL) at 1280 × 800, low quality, rendering the match while the fixtures run.
- 2:00 rounds, three runs per row.
- "4×" is Chrome DevTools CPU throttling, a rough stand-in for a mid-range phone.
- **Physical devices were not measured.**

| Scenario | Fixture time | Panel after match end | Longest frame (median before) | Fallbacks |
|---|---|---|---|---|
| Plain Competitive (baseline, no Open) | — | 230–590 ms | — | — |
| QF won (QF2), 1× | 110–122 ms | 352–525 ms | 133–150 ms (83) | 0 |
| QF lost (4 fixtures), 1× | 386–495 ms total | 581–987 ms | 133–150 ms (83–100) | 0 |
| QF won (QF2), 4× | 176–207 ms | 1.05–1.26 s | 283–333 ms (117–133) | 0 |
| QF lost (4 fixtures), 4× | 561–633 ms total | 1.34–1.46 s | 200–217 ms (100–117) | 0 |

**Before the worker:** cooperative main-thread slices took 1.0–1.5 s for the four fixtures at 1×. At 4× every fixture fell back on the 2 s budget, and the panel waited about 3.2 s.

**Other costs:**

| Cost | Phase 11 |
|---|---|
| JS + CSS (gzip) | 439.0 KB → 467.8 KB: +16.8 KB app, plus the 12.0 KB worker on demand |
| WebGL contexts | Unchanged. The bracket is DOM only; Pre-match and Champion reuse the menu stage. |
| Menu stage | Pre-match opponents reuse the bounded fighter cache: one or two extra instances at the AI belt. |
| Combat simulation | Unchanged. Orchestration runs only between bouts. |
| Storage | One key, about 2–8 KB with 20 records. |

## 5. Known limitations and notes for UAT

- **Real-phone checks:** physical-device performance is not measured. Please check the bracket and a full Open on a mid-range phone.
- **Controller:** the gamepad was tested with a stubbed Gamepad API, not a physical controller.
- **Rare undercount:** the tournament save is written first and the progress save immediately after. A crash in the gap between them could undercount one match, but never double it.
- **Bout length:** the journey checks resolve rounds through the world's own `endRound` (the real round and match flow). The opening seconds of each bout in the videos are real play.
- **Stale menu-smoke test:** `scripts/menu-smoke.mjs` still has a stale "3 play modes" assertion that predates "Play a friend" (it fails on `main` too). Its other checks pass.

## 6. Evidence (`docs/media/phase-11/`)

- **Desktop journey:**
  - `desktop-home`, `entry`, `bracket-qf`, `prematch`, `postwin-qf`, `bracket-sf`, `postwin-sf`, `champion`, `bracket-final`, `history`;
  - elimination: `eliminated-sf`, `bracket-out`;
  - resume and abandon: `resume`, `pause`, `abandon`.
- **Sizes:** `{1024x768, 844x390, 740x360, 390x844}-{home, resume, prematch, bracket, champion | runnerup}`.
- **Videos:** `phase11-win.mp4` (a full winning Open) and `phase11-out.mp4` (out in the semifinal, then the bracket and history). Both were recorded headless with software rendering, so the frame rate is low.
