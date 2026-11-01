# Phase 2: Competitive Sparring, Lead-Leg Techniques and AI

Phase 2 adds a WT-inspired Competitive mode, three lead-leg kicks, and a new AI decision system. All of it runs on the existing fixed-step combat engine and procedural animation. Arcade mode keeps its scoring and victory logic; two bug fixes to shared hit detection are listed in "Arcade compatibility" below.

## A. Rules sources and chosen edition

**Edition:** World Taekwondo *Competition Rules & Interpretation*, in force as of **June 1, 2026**.

**Reference copy:** [Competition Rules and Interpretation from 01.06.2026](https://www.taekwondo.dk/files/Dokumenter/Statisk/Dommer/Regler/Competition%20Rules%20and%20Interpretation%20from%2001.06.2026.pdf) (Danish Taekwondo Federation mirror). The product owner reviewed it and approved the rule decisions in the Phase 2 review of PR #3: Articles 7.1.2, 14 and 15.5.

**How the values were verified.** This build environment still cannot open the PDF: its network policy blocks taekwondo.dk, worldtaekwondo.org and the federation sites. So the article-level decisions below come from the product owner's review. The remaining values come from search excerpts of the official document and federation bulletins summarising the 2026 changes (USA Taekwondo April 2026 update; Taekwondo Canada, January 2026).

Every value lives in `src/game/rules/competitive/config.ts` (`WT_2026`) and can be corrected without touching game logic.

| Rule | Value used | Confidence |
|---|---|---|
| Punch to trunk | 1 | Confirmed (official excerpt and summaries) |
| Kick to trunk | 2 | Confirmed |
| Kick to head | 3 | Confirmed |
| Turning kick to trunk | 4 (double the base) | Confirmed: "turning kicks score double their base value" |
| Turning kick to head | 6 | Confirmed: raised from 5 to 6 in 2026 |
| Gam-jeom | +1 to the opponent | Confirmed |
| Passive gam-jeom in the last 10 s of a round | +2 to the opponent (boundary and fall only) | **Open:** asked to verify against Art. 14; reported by federation summaries, not yet checked against the text here. Configurable (`passiveLateGamjeomPoints`, `passiveLateWindowSeconds`). |
| Point gap ending a round | 15 | Reported: raised from 12 to 15 (General Assembly, April 2026, effective June 2026) |
| Boundary | Gam-jeom when **any part of the foot** crosses the line, unless caused by the opponent's prohibited act | Reported 2026 wording |
| Best of three rounds | Each round starts 0–0; the first to win 2 rounds wins; **no fourth (golden) round** | Art. 7.1.2 (approved review) |
| Round tie-break (best of three) | a. turning-kick points; b. head, then trunk, then punch, then gam-jeom points; c. registered valid hits; d. game-specific deterministic fallback where a referee would decide | Art. 15.5 (approved review); fallback is the game's own |
| Gam-jeom limits | **5 in one round lose that round; 10 cumulative in the match lose the match** | Art. 14 (approved review) |
| Round length | **60 / 90 / 120 s**, selectable; **90 s default**; **120 s is the WT senior standard** | Approved review |

## B. Competitive implementation

Code: `src/game/rules/competitive/`. The responsibilities are separated:

| Concern | File | What it decides |
|---|---|---|
| Attack validation | `validation.ts` | Is the contact a valid technique on a valid zone with enough delivered force? |
| Point calculation | `scoring.ts` | Technique, zone and turning → points (from config) |
| Penalties, stoppages, flow | `CompetitiveRules.ts` | Gam-jeom detection and accumulation (per round and per match), Kal-yeo/Kye-sok, point gap, round history |
| Round outcome and match result | `rounds.ts` | Art. 15.5 tie-break chain; best of three (Art. 7.1.2) |

The engine calls the ruleset through optional hooks on the `Ruleset` interface (`rules.ts`: `RuleHooks`). Arcade implements none of them, so its code path is unchanged.

### When a contact scores

A point needs **all** of the following. Points never come from an animation; they come from the simulation's contact geometry.
1. A **clean contact**: the swept strike sphere (foot or fist) intersects the trunk-protector capsule or the headgear sphere during the technique's active frames. **Blocked strikes never score**: they land on the arms.
2. **Not during a stoppage**: contact after Kal-yeo is void.
3. **The attacker is inside the boundary.**
4. **A legal target for the technique:** punches only to the trunk. A punch to the head is a gam-jeom.
5. **Delivered force,** measured as how far the technique had extended at contact (`extensionAtContact`). The impact point is latched to the target's surface, so a jammed kick shows a short extension. Thresholds:
   - trunk: at least 45% of full extension
   - head: at least 20%, because head scoring is contact-based
   - stamina-starved ("tired") techniques deliver 70% force

   This is a deterministic geometric measurement, not a simulated electronic sensor.
6. **Turning bonus:** given only to techniques delivered with the back turned (`MoveDef.turnDegrees ≥ 180`: the back kick). Roundhouses never qualify, however much the hips turn over. Covered by tests.

### Penalties (gam-jeom)

Only objectively detectable infractions are implemented:

| Infraction | Detection | Consequence |
|---|---|---|
| Crossing the boundary line | Body centre + foot extent (0.14 m) past the 4 m line (8 × 8 m area) | +1 (+2 in the last 10 s); Kal-yeo; both fighters return to their marks |
| Falling down | A self-inflicted fall: a stamina-starved turning or head kick that misses throws the kicker off balance | +1 (+2 late); Kal-yeo |
| Kick below the waist | Swept strike touches the leg volume below the trunk protector and nothing above it | +1; Kal-yeo; no points |
| Attack after Kal-yeo | A technique *started* during a stoppage, after a 12-tick grace for attacks already on their way | +1 |
| Attacking a fallen opponent | Same, while the opponent is down | +1 |
| Punch to the head | Punch contact on the head | +1; no points |

- **Not penalized:** retreating, circling and guarding are never penalized.
- **Limit:** five gam-jeom in a round lose that round (configurable; unverified).
- **Left out deliberately** because they can't be detected reliably or the game has no mechanic for them: avoiding or delaying the match ("passivity"), grabbing, pushing, holding, lifting the knee to block, attacking with the knee or head, misconduct, coach violations, and injury feigning. These are left out rather than guessed at.

### Knockdowns and stoppages
- A **valid head or turning kick on an exhausted opponent** (stamina below 18) knocks them down. The referee stops the bout to count, and the fighter rises using the CC0 fall clip played forward then back.
- There is **no penalty** for being knocked down by a valid technique.
- The **clock stops** during Kal-yeo. Kye-sok resumes the bout.
- The competition area is drawn as a light boundary line, which flashes red on an out-of-bounds call. It adds one draw call, in Competitive only.

### Round and match outcomes

**Rounds:**
- A round lasts 60, 90 (default) or 120 s, chosen in the menu when Competitive is selected.
- A round ends on time, on the 15-point gap, on **5 gam-jeom in the round** (that fighter loses the round), or on the **10th gam-jeom of the match** (that fighter loses the match).
- A round that runs the full time goes to the fighter with more points. If points are tied, **Article 15.5** decides:
  - a. more points from turning (spinning) kicks
  - b. higher-value scores, compared in order: head points (including turning head kicks), trunk points (including turning body kicks), punch points, then points received from the opponent's gam-jeom
  - c. more **registered valid hits**: clean contacts on the trunk protector or headgear (see open issues)
  - d. **game decision** (deterministic fallback; *not* an official WT referee decision), used only where WT relies on the referee's superiority judgement:
    1. more techniques delivered to the opponent, including blocked ones
    2. more techniques thrown
    3. fewer gam-jeom
    4. threw the first technique
    5. if neither fighter threw anything, the round goes to Hong, an arbitrary fixed last resort

    The results screen labels these steps "Game decision: …".
- **A round is never drawn.**

**Match (Art. 7.1.2):** best of three. The first fighter to win two rounds wins, so a match lasts two or three rounds. **There is no golden round.** A traditional aggregate-score format (with a golden round) can be added later as a separate ruleset configuration; it is not implemented now.

**Display:**
- The HUD shows `GJn` for the current round's gam-jeom, plus `/m` with the match total once it differs.
- The results screen lists gam-jeom per fighter for the whole match, with reasons.

**Results screen:**
- winner and rounds won
- points per round, with the deciding reason
- valid techniques by category, and gam-jeom with their reasons
- Rematch and Main menu buttons

## C. Lead-leg techniques

| | Lead front | Lead roundhouse | Lead side (cut kick) | Rear roundhouse (reference) |
|---|---|---|---|---|
| Startup / active / recovery (ticks) | 8 / 3 / 14 | **7** / 3 / 14 | 9 / 4 / 16 | 11 / 4 / 17 |
| Stamina | 7 | 8 | 9 | 12 |
| Body reach (impact) | 1.06 m | 1.08 m | **1.24 m** | 1.02 m |
| Arcade damage | 6 | 7 | 8 | 11 |
| Pushback | 1.7 | 1.4 | **3.0** (stopping kick) | 2.0 |
| Cancel window after a hit | 6 | 6 | 8 | 8 |

**Tactical trade-offs:**
- Lead kicks are quicker and cheaper, which suits probing, stop-kicks and starting combinations.
- They have shorter hip drive, so they do less damage and pushback in Arcade (the cut kick is the exception: it is a stopping kick).
- Points are the same in Competitive (2 or 3).
- A blocked lead kick recovers quickly but has a short cancel window, so it can't be chained as freely.

**Animation is not a sped-up rear kick:**
- **Weight transfer:** weight loads back onto the rear (support) leg, the lead heel rises, and the rear foot pivots.
- **Body rotation:** the body turns the opposite way to the rear-leg versions (clockwise from above for orthodox), so the lead hip drives the kick.
- **Recovery:** the lead foot re-plants forward.
- **Shared Phase 1.5 machinery:** lead kicks use the same anticipation → chamber → snap → outcome-aware recovery → landing settle, plus seeded variation, foot planting and reactions that keep the guard.

The hit sweep uses the same `MoveDef` geometry as the IK targets, and the kicks mirror correctly in southpaw. Evidence: `docs/media/phase2/lead-kicks-side.jpg` and `lead-kicks-quarter.jpg`.

**Back kick to the head** is now available: a 6-point turning head kick in Competitive.

## D. Controls

| Input | Lead-leg access |
|---|---|
| Keyboard | Hold **F** + **K** / **L** / **U**: lead front / roundhouse / side. F is unused elsewhere and sits next to the WASD hand. The existing keys are unchanged. |
| Gamepad | D-pad ↑ / → / ←: lead front / roundhouse / side |
| Touch, Compact | The technique wheel gained an **inner ring** with the three lead kicks (short thumb travel for fast techniques). The outer ring keeps the rear kicks; sliding past the dashed ring gives head height. The selection persists, as before. **No new permanent buttons.** |
| Touch, Classic | One **Rear/Lead** chip switches the Front/Round/Side buttons to the lead leg |

## E. AI

`src/game/ai/AIController.ts` is a layered decision system:

1. **Perception:** the AI sees the opponent only through a ring buffer, delayed by its reaction time. It never reads inputs.
2. **Opponent model:** decaying counts of the player's techniques (spotting habits) and the player's attack rhythm.
3. **Reactive layer**, once per perceived attack:
   - correct read (probability `read`) → guard, back-step out of range, or stop-kick with a faster lead kick if one becomes active before the attack does
   - misread → nothing
4. **Punish layer:** attacks into the opponent's recovery when a technique becomes active before they recover.
5. **Tactical layer:** utility scores for every technique and height, plus approach, retreat, circle, hold and anticipatory guard, then a softmax pick. Inputs:
   - hit likelihood from range bands and the opponent's state
   - point value (Competitive) or damage (Arcade)
   - exposure (startup plus recovery)
   - lead-leg probing bonus, habit answers, a repetition penalty
   - stamina reserve
   - boundary room (circles toward the centre and escapes the line)
   - score and clock pressure: protects a late lead, presses when trailing

| Profile | Reaction | Read | Anticipate | Stop-kick | Punish | Noise | Character |
|---|---|---|---|---|---|---|---|
| White belt | 22 ticks (367 ms) | 0.45 | 0.05 | 0 | 0.15 | 1.1 | Predictable favourite technique, simple combos, drifts near the line, occasional out-of-range kicks |
| Red belt | 14 ticks (233 ms) | 0.70 | 0.5 | 0.15 | 0.45 | 0.5 | Better spacing and blocking, stamina reserve, some counters and lead-leg probes |
| Black belt | 9 ticks (150 ms) | 0.88 | 0.7 | 0.4 | 0.75 | 0.2 | Reads habits, stop-kicks, punishes whiffs, combos, full score and clock awareness |

**Fairness:**
- All profiles use the player's actions, frame data, stamina and hit detection. There are no damage multipliers.
- A test asserts that no reaction happens sooner than the profile's perception delay.
- Fast kicks (11-tick startup) can't be blocked on reaction at human reaction times. Stronger profiles block more by **anticipation**: they read the opponent's observed rhythm, as real fighters do.

**Performance:** tactical decisions run every 7–18 ticks; the per-tick work is constant. Perception uses a preallocated ring buffer, and the intent object is reused.

## F. Tests

`npm test`: **96 tests across 5 files** (36 before Phase 2; 87 at first review, then 96 after the rules corrections). The new Phase 2 tests:

| File | Tests | Covers |
|---|---|---|
| `tests/competitive.test.ts` | 47 | Every scoring technique's points, including lead kicks, the turning head kick 6 and turning trunk 4. Roundhouse never turning. Jammed kicks, blocked, whiffed and out-of-range attacks score nothing. No damage in Competitive. Boundary gam-jeom with Kal-yeo and position reset; the late ×2; retreating never penalized. Attack after Kal-yeo, with grace; contact during a stoppage void; attacking a fallen opponent; below-waist geometry and penalty; the gam-jeom limit; self-fall penalty; knockdown not penalized. Point gap; the clock stops during Kal-yeo; Art. 15.5 priorities a–c in order and the labelled game fallback (never a draw); best of three with no golden round; a full three-round match decided by tie-breaks; a 2-0 match in two rounds; rematch reset. Round durations 60/90/120 (clock, timeout, next round; default 90; senior 120). 5 gam-jeom lose the round; 10 cumulative lose the match; passive late ×2. Arcade unaffected: no points, the mat clamp, no penalties or stoppages. Lead kicks faster, cheaper, shorter, lead-side and mirrored, landing earlier, and counter-hitting slower kicks. |
| `tests/ai.test.ts` | 12 | Black belt beats white belt (Arcade and Competitive) and red beats white in seeded matches. Block rate rises with difficulty. No reaction faster than the perception delay. Punishes whiffs more at higher difficulty. Black belt spots a repeated technique and white belt doesn't. Distance kept in kicking range. No voluntary boundary exits (red and black). Escapes the line when trapped. Attacks more when trailing late than when leading. Black belt uses lead kicks for over 20% of attacks. No attacks during Kal-yeo. |
| `tests/anim-controls.test.ts` | updated | Lead kicks included in the "extension identical across outcomes and seeds" and "recovery ends in stance" checks; wheel inner and outer rings |

Browser e2e (`node scripts/e2e.mjs`, production preview) covers a full Competitive match **started from the menu**, plus the rest:

| Area | Checks |
|---|---|
| Competitive scoring | Body kick +2, head kick +3, turning head kick +6, F+L lead roundhouse +2 on the scoreboard |
| Penalty | Boundary gam-jeom (GJ marker, +1 to the opponent) |
| Match flow | Two rounds won on time, then a result screen with rounds, techniques and penalties; Rematch resets; return to menu |
| Competitive on a phone | HUD stays ≤ 30 px with both scores |
| Compact wheel | Inner-ring lead roundhouse lands and persists |
| Classic | Lead chip |
| Earlier checks | All the Phase 1.5 desktop, Arcade, mobile and PWA checks |

## G. Performance

The same headless SwiftShader capture as Phase 1.5 (`scripts/ux-capture.mjs`). Frame rates in this environment are not representative of devices.

| Metric (4 phone profiles) | Phase 1.5 | Phase 2 Arcade | Phase 2 Competitive |
|---|---|---|---|
| UI coverage | 13.6–17.6% | 13.6–17.6% (identical) | 13.6–17.6% (scores sit inside the scoreboard row) |
| Scoreboard height | 28 px | 28 px | 28 px |
| Fighter reference points visible (not under UI) | 100% | 100% | 100% |
| Draw calls | 19–21 | 19–22 | 20–23 (+1 boundary line) |
| Triangles | ~29.5k | ~29.5k | ~29.5k |
| Simulation CPU per frame (includes AI) | 0.08–0.15 ms | 0.08–0.13 ms | 0.07–0.13 ms |
| Animation CPU per frame | 0.37–0.48 ms | 0.32–0.51 ms | 0.35–0.39 ms |

No new textures, shaders, materials or physics were added. AI decisions are rate-limited, so the simulation stays well under its 1 ms budget.

**Still needs real-device validation:** frame times, thermal behaviour, touch feel of the two-ring wheel (inner-ring radius 58 px, head ring 160 px), and how readable the score toasts are.

## H. Arcade compatibility

Arcade scoring, health, rounds and victory logic are untouched. Three shared corrections affect both modes; all were found by the new Phase 2 tests and are bug fixes:
1. **Trunk-protector hurt volume:** its rounded top reached the chin (about 1.58 m), so head kicks registered as body hits. It now tops out at about 1.42 m (shoulders). Body strikes (1.10–1.20 m) are unaffected.
2. **Head-height strikes** now chamber high and extend to the head instead of sweeping diagonally through the trunk zone.

3. **Head-height modifier latched at press time.** Holding E (or the Head chip) is now captured when the kick is pressed, not when the simulation consumes the input. A quick E+L tap could previously come out at body height. The e2e Competitive test caught this.

Arcade also gains the lead-leg kicks and the back kick to the head, as additions to the shared move set. Every original Arcade test passes unchanged.

## I. Known limitations

- **Rules verification:** article-level decisions follow the product owner's review of the June 2026 edition. This environment still can't open the PDF. The open interpretation items are listed in HANDOFF.md.
- **Superiority decision:** where Art. 15.5 leaves the decision to the referee, the game uses a labelled deterministic fallback, not a simulated referee.
- **Simplified knockdown:** no 8-count and no referee-stops-contest; the fighter always rises.
- **Penalty coverage:** Kal-yeo resets positions only for boundary calls. Several prohibited acts are intentionally not simulated (§B).
- **AI:** tuned in simulation, not yet by playtesting. Its anticipatory guarding can read as "psychic" if the player keeps a very regular rhythm (that is by design).
- **Down animation:** the get-up reuses the CC0 fall clip played backwards. The unused `Hit_*` and `Punch_*` clips are still shipped.

## J. Recommendations for the next phase (Phase 3 is not started)

1. Resolve the open interpretation items in HANDOFF.md: the last-10-seconds passivity rule, what counts as a "registered valid hit", and whether a turning head kick counts under both a. and b. of 15.5.
2. Run real-device UAT of the wheel's two rings and the Competitive HUD. Tune `WHEEL_LEAD_EDGE`, `WHEEL_HEAD_RADIUS` and `HOLD_MS` from feedback.
3. Phase 3 scope: hybrid gestures, control customization (left-handed mirror, button scale), real-device profiling.
