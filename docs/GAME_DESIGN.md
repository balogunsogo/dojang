# Game Design

## Pillars

1. **Believable Taekwondo.** Techniques read as Taekwondo: chamber, extension, rechamber; a bladed sparring stance; constant bouncing footwork; kicks dominate, punches are short and to the body.
2. **Responsive, readable combat.** Every technique has frame data. You win with timing, distance and stamina, not button mashing.
3. **Mobile-first.** Touch is a first-class input and phones are a first-class target.

## Confirmed product decisions

These are fixed: semi-realistic 3D; a modern Korean dojang with traditional details; a free third-person camera with optional lock-on and framing assist; arcade/simulation hybrid combat; competitive point rules and arcade health rules; Training and AI Sparring modes; two selectable fighters; basic belt milestones; virtual buttons and touch gestures; desktop, Android Chrome and iOS Safari; single-player, no backend.

## Fighters

| | Kim Jae-won (김재원) | Park Ha-na (박하나) |
|---|---|---|
| Build | 1.83 m, scale 1.00 | 1.74 m, scale 0.95 |
| Power | ×1.08 | ×0.94 |
| Footwork speed | ×1.00 | ×1.10 |
| Stamina recovery | ×1.00 | ×1.12 |

In Phase 1 the player is Jae-won (chung / blue corner) and the AI is Ha-na (hong / red corner). Character selection arrives in Phase 4. Both share one rig and one combat engine.

## Combat model

The simulation runs at a **fixed 60 Hz**. All timings below are in ticks (1 tick ≈ 16.7 ms).

### States

`idle` (stance and footwork) · `guard` · `dash` · `attack` (startup → active → recovery) · `hitstun` · `blockstun` · `switch` (stance change) · `ko` · `victory`

- Attacks can be started from idle or guard, and from a dash after 7 ticks (a dash-in kick).
- Inputs are **buffered for 10 ticks**, so a technique pressed late in recovery comes out on the first free frame.
- If a technique lands cleanly, recovery can be **cancelled into the next technique** after `cancelAfter` ticks. This enables combinations; the back kick cannot be cancelled.
- A hit during the defender's startup is a **counter hit**: ×1.25 damage and 6 extra stun ticks.
- **Hit stop** freezes the fight for 5 ticks on a hit and 3 on a block, which sells the impact.

### Techniques (orthodox)

| Technique | Startup | Active | Recovery | Stamina | Damage | Heights | Reach (body impact) |
|---|---|---|---|---|---|---|---|
| Straight punch (jireugi) | 6 | 3 | 12 | 5 | 5 | body | 0.80 m |
| Front kick (ap chagi) | 10 | 4 | 16 | 10 | 9 | body/head | 1.00 m |
| Roundhouse (dollyeo chagi) | 11 | 4 | 17 | 12 | 11 | body/head | 1.02 m |
| Side kick (yeop chagi) | 14 | 5 | 21 | 15 | 14 | body/head | 1.20 m |
| Back kick (dwi chagi) | 17 | 5 | 24 | 18 | 17 | body | 1.12 m |

Lead-leg techniques (Phase 2), thrown with the front leg:

| Technique | Startup | Active | Recovery | Stamina | Damage | Reach (body) |
|---|---|---|---|---|---|---|
| Lead front kick (apbal ap chagi) | 8 | 3 | 14 | 7 | 6 | 1.06 m |
| Lead roundhouse (apbal dollyeo chagi) | 7 | 3 | 14 | 8 | 7 | 1.08 m |
| Lead side / cut kick (apbal yeop chagi) | 9 | 4 | 16 | 9 | 8 | 1.24 m |

Head variants add 2 startup ticks, 2 stamina and ×1.35 damage. Back kick is a turning technique and has the most pushback.

### Hit detection

- The defender has two hurt volumes: a trunk-protector capsule (0.98–1.38 m, r 0.20) and a headgear sphere (1.62 m, r 0.15).
- During active frames the striking surface sweeps from the chamber point to the impact point. Each tick's swept segment is tested against both volumes, so a hit can't tunnel through between ticks.
- **Distance-aware extension:** on the first active tick, the impact point is clamped to the opponent's surface when they are inside full reach. The kick lands on the target instead of passing through it. Beyond full reach it extends fully and misses.
- Each technique can hit at most once.

### Guard and stamina

- Guard blocks attacks that come from within 75° of the defender's facing. A block drains `0.8 × move stamina` from the defender. If that empties their stamina, it's a **guard break**: stun plus half damage. Arcade rules apply 12% chip damage through a guard.
- Stamina (max 100) recovers at 17/s standing, 11/s moving, 6/s guarding, 4/s while dashing or switching, and 0 while attacking or stunned. Recovery runs at 25% for 20 ticks after spending.
- Low stamina has costs. Below a technique's cost it becomes "tired": 4 ticks slower and ×0.7 damage. Below 4 stamina you can't attack, and below 15 footwork is 20% slower. Dash costs 9.

### Footwork

Fighters always face each other, as in real sparring. Speeds: forward 2.1 m/s, back 1.75, lateral 1.85, guard ×0.45. A dash is a 12-tick burst at 5.4 m/s; with no direction it's a back-step. Fighters push apart at 0.68 m, and the mat is 8 × 8 m.

## Rulesets

Both rulesets plug into the same `CombatWorld` through the `Ruleset` interface (`src/game/rules/rules.ts`).

### Arcade (implemented)

Health 100. Rounds are 60 s, best of 3. A round ends on a KO, or on time, where the higher health percentage wins (equal is a draw). The match ends when a fighter reaches 2 round wins, or after 3 rounds.

### Competitive: WT-inspired points (implemented in Phase 2)

Based on the World Taekwondo Competition Rules & Interpretation in force from June 1, 2026. Full details, sources, verification status and simplifications are in [PHASE_2.md](PHASE_2.md).

| Valid technique | Points |
|---|---|
| Punch to trunk | 1 |
| Kick to trunk | 2 |
| Kick to head | 3 |
| Turning kick to trunk | 4 |
| Turning kick to head | 6 |
| Opponent's gam-jeom | +1 (+2 for a passive gam-jeom in the last 10 s) |

- **Rounds:** 60, 90 (default) or 120 s (WT senior standard), best of three with no golden round (Art. 7.1.2). A round ends on time, at a 15-point gap, or on 5 gam-jeom in the round. 10 gam-jeom in the match lose the match (Art. 14).
- **Tie-breaks (Art. 15.5):** turning-kick points; head, trunk, punch, then gam-jeom points; registered hits; then a labelled deterministic game decision. Rounds are never drawn.
- **Gam-jeom:** boundary, self-inflicted fall, kick below the waist, attack after Kal-yeo, attacking a fallen opponent, punch to the head.
- **Valid contact** needs a clean, unblocked strike on the scoring zone with enough extension. Only true turning techniques (the back kick) get the turning bonus.

## Modes

- **AI Sparring: Arcade or Competitive rules (implemented).** The AI was rebuilt in Phase 2 as a layered decision system; see PHASE_2.md §E. Below is the original Phase 1 description of the presets. Three AI presets:
  - **Easy:** 24-tick reaction, rarely guards.
  - **Normal:** 14-tick reaction, guards and counters, picks techniques by range.
  - **Hard:** 8-tick reaction, frequent guard, punishes whiffs, dashes.

  The AI uses the same intents and frame data as the player. The presets are a first pass and get tuned in Phase 2.
- **Training (implemented in Phase 4).** Runs on the same combat simulation; a training partner holds a lit target ring. Practice (free), Challenges (Body 10 in 40 s, Head 5 in 40 s, Alternating 8 in 45 s, Moving 6 in 45 s) and Drills (Front → Roundhouse, Lead → Rear roundhouse, Side → Back kick, Block → Counter; 3 reps, order and timing enforced). Live feedback and an end summary with tips.

## Progression (Phase 4)

Local belt milestones: white → yellow → green (implemented). Saved in localStorage (`dojang.progress.v1`, versioned with migration). This is a game progression model, not an official grading. The belt color renders on the fighter's dobok.

- **Yellow:** land a front kick, roundhouse, side kick and punch in Practice; complete the Body challenge; 60% accuracy in a challenge; win any match.
- **Green:** complete the three combination drills; 75% accuracy in Alternating targets; complete Block → Counter; win against a Red belt (Normal) or Black belt (Hard) AI.

Fighter selection (Kim Jae-won / Park Ha-na) is saved with progress.

## Touch controls

- **Compact (default):** joystick, a Kick button that repeats the selected kick, and a technique wheel opened by sliding from Kick (or holding it). The inner ring holds the lead-leg kicks and the outer ring the rear-leg kicks. Slide past the outer ring for head height. Plus Guard, Dash, Punch, switch stance and a Body/Head chip.
- **Classic:** one button per technique, plus a Rear/Lead chip.
- **Keyboard:** hold F with K/L/U for lead-leg kicks. **Gamepad:** D-pad.

See PHASE_1_5.md.

## Presentation

Match calls use Korean referee commands: *Joon-bi* (ready), *Shi-jak* (begin), *Keu-man* (stop). Competition corners are chung (blue) and hong (red), shown on the trunk protector and headgear. The dojang has the taegeukgi, a 跆拳道 calligraphy banner with the five tenets (예의 · 염치 · 인내 · 극기 · 백절불굴), a dancheong frieze, changsal lattice windows, a belt rack, a mirror wall and heavy bags.
