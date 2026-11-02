# DOJANG Design System

The approved **DOJANG UI System** (a Claude Design package) is implemented here. Its tokens are the source of truth and are copied verbatim into `src/tokens.css`. This page is the developer reference: what exists, where it lives, and the rules that keep new screens consistent.

**Direction:** designed simplicity over a live 3D hall. The dojang and fighters are the hero. Hierarchy comes from type, spacing and one scrim; there are no boxes, badges or decorative gold.

## Rules

1. **Brass is for three things only:** the current-item tick, the focus ring, and the one primary button on a screen. Section labels, the Hangul 도장, tab underlines and selected rows use fg or muted.
2. **No tracked uppercase except the wordmark.** Everything else is sentence case. Labels are 13/600, muted.
3. **Menus never sit in a box.** The scrim gives contrast. In-match overlays (pause, results, training summary) use a solid ink 0.88 column at the same left edge.
4. **One edge, one column.** `--edge` (96 / 64 / 24–32 px) and `--ui-col` (460 / 420 px) are shared by every screen, so screens swap without anything jumping.
5. **One primary per screen**, with its input hint on the right ("Enter"). Everything else is a quiet text action.
6. **Fast, short motion:** 120–240 ms fades and 8 px slides. Under `prefers-reduced-motion` it is fades only, plus a static camera.

## Tokens (`src/tokens.css`)

| Group | Tokens |
|---|---|
| Colour | `--ink #15120F` (background), `--fg #EFE6D8`, `--muted #A99F90`, `--faint #7A7166`, `--surface` (fg 7%), `--surface-hover` (fg 4%), `--line` (fg 12%), `--brass #C9A062` / `--brass-hover`, `--on-brass`, `--chung #3C6BC4`, `--hong #C0443A`, `--warn` |
| Type | `--font-display`: Hahmlet → Noto Serif KR → Nanum Myeongjo → Georgia. `--font-ui`: IBM Plex Sans → IBM Plex Sans KR → Apple SD Gothic Neo → Malgun Gothic → system-ui |
| Space | `--s1`–`--s9` (4–96), `--edge`, `--ui-col` |
| Shape and motion | `--radius 2px`, `--t-fast 120ms`, `--t-base 180ms`, `--t-screen 240ms`, `--ease` |
| Scrim | `--scrim`: left-to-right, 0.86 → 0.62 → 0 at 58%. Portrait phones use a bottom-up variant. |

Legacy gameplay CSS keeps `--gold` only for the touch controls' press feedback; the controls stay as built.

## Type roles (`src/ui/menu.css`)

| Role | Font, weight | Desktop · phone | Notes |
|---|---|---|---|
| wordmark | Hahmlet 300 | 104 · 56 (40 in landscape) | +0.08em, UPPER: the only uppercase setting. 도장 at 0.29× on the baseline, muted |
| title | Hahmlet 400 | 44/52 · 32/40 | Screen titles |
| menu-1 | Plex 500 | 26/34 · 22/30 | Play modes and pause actions |
| menu-2 | Plex 500 | 17/24 · 16/24 | Secondary menu, option names, settings rows, segmented controls |
| body | Plex 400 | 16/24 · 15/22 | Max 52ch |
| label | Plex 600 | 13/18 | Group labels, muted |
| caption | Plex 400 | 14/20 | Descriptions, hints, credits |
| button | Plex 600 | 16/20 | Primary actions |
| numeral | Plex 600, `tabular-nums` | 32 / 44 | Scores, timers, results |

Hangul always follows its role's family with no letter-spacing and is wrapped in `lang="ko"`.

**Fonts** are self-hosted: `src/fonts.css` and `src/assets/fonts`, built by `scripts/build-fonts.py`.
- Latin Hahmlet 300/400 and Plex 400/500/600 run 18–24 KB each.
- The Korean faces are subset to the Hangul the UI renders, about 3 KB each, with exact `unicode-range`. Other Hangul falls back to the system Korean font.
- Plex 400 and 600 are preloaded; everything uses `font-display: swap`.
- Vite is told never to inline `.woff2`, so the lazy faces stay lazy.

## Components (`src/ui/kit.tsx`)

| Component | Use | Behaviour |
|---|---|---|
| `Wordmark` | Home only (`h1`, `aria-label="Dojang"`) | Hahmlet light, tracked; 도장 muted |
| `Menu` (menu list) | Home, pause | One shared current index for pointer, ↑/↓ keys and gamepad. Two sizes (`tier` 1 or 2). The description shows under the current item only (`aria-describedby`). The current item gets the brass tick. Hit area ≥ 44 px. |
| `PrimaryButton` | One per screen | Brass fill, label left, input hint right; disabled = surface and faint |
| `QuietButton`, `BackButton` | Back, Change, Cancel, secondary results actions | Text only; Back is "← Menu" |
| `Segmented` | Arcade/Competitive, round length, touch layout, quality | `role="radiogroup"`, ←/→ move. Selected = fg plus a 2 px fg underline (the `small` variant adds a surface fill). |
| `OptionRow` / `OptionGroup` | Opponent, fighter, training activity | Native radio underneath. Leading marker (belt or none), name, one-line description, radio. Selected = surface row and filled radio. No borders. |
| `BeltMarker`, `CornerTag` | Belts, corners | A belt is a flat 24 × 6 bar (48 × 8 on the ladder), always next to its name. A corner is a 4 px bar plus the name. |
| `SettingToggle`, `SettingSlider`, `SettingChoice`, `SettingLink` | Settings | 52 px rows, label left, control right. Toggles are fg switches (not brass). Sliders always print their value. |
| `Hints` | Home, setup, pause | Key glyph plus action; hidden on touch devices |
| `GroupLabel` | Section labels | 13/600 muted (an `h2`) |
| `ScreenShell` | Every sub-screen | Back, optional context, title; a scrolling body; a pinned footer. Esc goes back; Enter triggers the primary unless focus is on another control. |
| `useGamepadNav` | Menu, pause, results, summary | D-pad/stick moves focus (reusing the menu list's own arrow handling), A activates, B goes back. Polls only after `gamepadconnected`. |

**Do not add:** cards or tiles, eyebrow labels, divider ornaments, badges, chips, pills, tooltips, extra modals, or a generic input library. The touch controls stay as built.

## Screens

| Screen | File | Contents (real game data) |
|---|---|---|
| Home | `Menu.tsx › Home` | Wordmark, tagline. Menu-1: Training (**Continue training** once you have history, showing the recommended next activity), Arcade sparring, Competitive sparring. Menu-2: Choose fighter, Belt progression, Settings & controls. Footer: fighter name, Hangul and belt, plus keyboard hints. |
| Sparring | `Menu.tsx › SparSetup` | Arcade/Competitive tabs; the real rules copy (Competitive points 1/2/3/4/6, gam-jeom, tie-breaks); opponent White/Red/Black belt; round length 1:00/1:30/2:00 (60/90/120 s, 1:30 default); Start match |
| Training | `Menu.tsx › TrainingSelect` | All 9 activities grouped as practice, challenges and drills, each with its objective (from `activities.ts`) and done state. The objective panel shows the brief, goal, best record and status. "Begin practice / challenge / drill". |
| Fighter | `Menu.tsx › FighterSelect` | Kim Jae-won 김재원 / Park Ha-na 박하나 with blurbs, power/speed/recovery and the current belt. "Fight as …" goes to sparring setup. The 3D close-up swaps the model. |
| Belt progression | `Menu.tsx › BeltProgression` | White → Yellow → Green ladder with earned, current, next and locked states. The next milestone shows the real requirement labels, status and progress bars. Also the record line and reset. |
| Settings & controls | `SettingsPanel.tsx` | Every existing preference in two columns (controls, camera & comfort / audio, graphics, about) plus the control reference sub-screen. The credit line moved to About. |
| Pause | `Overlays.tsx › PauseMenu` | Context ("Competitive · Red belt"), score with corner tags, round and time left. Resume / Restart / (End activity) / Settings & controls / Quit to menu. |
| Results | `Overlays.tsx › ResultOverlay` | "You win / You lose / Draw", round score, the per-round table (Competitive, with the technique breakdown folded away), and an inline promotion note. Rematch (Enter) / Back to menu (Esc). |
| Training summary | `Training.tsx › TrainingSummary` | Stats, one tip, the inline promotion note, and next-belt requirements. Retry / Next / Training menu / Main menu. |

## Responsive behaviour

- **≥ 1280 px:** 96 px edge, 460 px column.
- **1024–1279 px:** 64 px edge, 420 px column.
- **Training on wide screens** (≥ 1180 × 600): the objective sits beside the list, and the scrim extends with it.
- **Phone portrait (< 600 px):**
  - The scrim runs bottom-up; the home menu stacks at the bottom with a 56 px wordmark.
  - Sub-screens start at 18vh, so the hall stays visible above them.
  - Settings use one column.
- **Phone landscape (height ≤ 500 px):**
  - 40 px wordmark, with the player shown top-right.
  - The play modes sit in a column, and the secondary items in one row beneath them.
  - Sub-screens use the left column.
- **Everywhere:** safe-area insets are padded and text sizes are in rem, so OS text scaling works.

## 3D backdrop integration

- The live `MenuStage` (a single WebGL context, disposed before a match) sits at z 0. The scrim is one div in the menu shell; screens swap inside the shell.
- The menu camera drift was reduced to a barely perceptible ±8 cm, and is static under reduced motion. No new lights, post-processing or assets were added.

## Gameplay HUD (restrained)

**Positions, sizes, touch controls and camera framing are unchanged.**

The changes are:
- Plex numerals with tabular figures;
- a top gradient instead of the clock and score plates;
- 4 px corner bars beside the names, and score underlines in corner colour;
- an off-white health bar;
- toasts in Plex, inside a polite live region so score changes are announced.

## Training coach (tips)

`src/game/training/Coach.ts` is a small, deterministic, rules-based coach; no AI or network is involved. It only **observes**: the training controller's feedback codes, its counters, and the tick's combat events. Combat, scoring, completion and progression are unchanged.

**Triggers:**
- the activity's real objective at the start;
- repeated misses from out of range, and attacks that are too close to score;
- an invalid contact, or a hit on a guarding partner;
- the wrong target height;
- a broken combination (wrong order) and, after three, guidance for struggling;
- too slow between drill steps;
- the next drill step after a correct one (first repetition only);
- the first clean repetition, and the halfway point of a challenge;
- accuracy improving from below 50% to 70% or more;
- 10 seconds left in a timed challenge;
- being hit while learning Block → Counter;
- no attack for 9 s;
- in practice: the basics not yet landed, then lead leg, head height and guard.

**Fatigue rules:**
- Only one tip is on screen; there is never a stack.
- At least 4 s between automatic tips.
- The same tip waits 22 s before repeating, and repeats at most 3 times. Objectives and milestones show once.
- Corrections outrank information, which outranks encouragement. A higher-priority tip replaces a lower one.
- Nothing new appears while the player is mid-technique, except the time warning.
- Stale encouragement is dropped.
- Tips stop when the activity ends; Retry or Next starts a fresh coach.

**Input-aware wording** (`how(action, scheme)`):
- The scheme is gamepad if a pad was used, keyboard once a key was pressed, and otherwise the touch layout (Compact or Classic) when touch controls are shown.
- Wording uses only real bindings: keyboard keys, gamepad buttons, or on-screen controls ("slide from Kick to Round on the outer ring", "set the Body/Head chip to Head").
- The training HUD's "Next:" and "Target:" line uses the same wording.

**UI (`.coach-tip`):**
- One compact note (14 px Plex) at the top-left under the training bar, clear of the fighters, centre toasts, pause button and touch controls, inside the safe areas. On phones in landscape it is narrower, with its actions stacked below.
- The left edge is coloured by tone: fg for corrections, muted for information, brass for brief positives, warn for time.
- Actions: ✕ dismisses, and **Turn off tips** disables tips and confirms how to get help.
- **Hint** in the training bar, or **H** on a keyboard, shows the most useful instruction now, even with tips off.

**Preference:** Settings › Training › **Show training tips**. It is on by default, saved in `dojang.settings.v1` as `trainingTips`, and also available in the pause menu's settings. Objectives, counters and completion feedback are never affected.

## Accessibility

- **Focus:** a visible brass ring on every interactive element.
- **Semantics:** real buttons and native radios. ↑/↓ move within menus, ←/→ within segmented controls, and Tab moves between groups.
- **Colour:** corner colour is always paired with a name. Text is ≥ 4.5:1 over the scrim; sub-screens hold the scrim darker under the column.
- **Reduced motion:** fades only.
