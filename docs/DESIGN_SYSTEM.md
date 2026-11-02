# DOJANG Design System (Phase 7)

The menus are a cinematic layer over the game's own dojang. The direction is restrained: a lit room, strong type, a single accent colour and very little chrome. This page is the reference for anyone adding a screen.

## Principles

1. **The dojang is the backdrop.** Menus sit over the live 3D room, not over decorative panels. Text gets contrast from a gradient grade, not from boxes.
2. **One accent.** Muted amber marks the current selection, primary actions and section labels. Dancheong red and the chung/hong corner colours are used only where they carry meaning (corners, belts, scores).
3. **Hierarchy through type, not borders.** Use a serif display face for names and titles, and small letter-spaced capitals for labels. Body text uses the system face. There are no card grids and no heavy outlines.
4. **Fast, skippable motion.** Every transition is under 0.35 s, except the 3D camera ease. Nothing blocks input. Everything collapses to instant changes under `prefers-reduced-motion`.
5. **Touch first.** Every target is at least 44 px. Safe-area insets are respected. Panels become bottom sheets on portrait phones.

## Tokens (`src/styles.css`, `:root`)

| Token | Value | Use |
|---|---|---|
| `--char` | `#0f0b08` | Page background, deepest shadow |
| `--wood` | `#2a1c12` | Warm surface tint |
| `--surface` / `--panel` | translucent charcoal | Sheets, dialogs |
| `--ink` | `#f2ebdf` | Primary text (warm off-white) |
| `--ink-2` | ink at 72% | Secondary text, unselected menu items |
| `--muted` | `#a99c88` | Captions, metadata |
| `--gold` / `--gold-hi` | `#d6a548` / `#f0c66b` | Accent, selection, primary actions |
| `--gold-soft` | amber at 16% | Selected-row wash |
| `--ember` | `#a8392a` | Dancheong red (sparingly) |
| `--line` | warm white at 14% | Hairline dividers |
| `--chung` / `--hong` | `#1f4fb8` / `#c42b2b` | Corner colours only |
| `--serif` | Iowan Old Style → Palatino → Noto Serif KR → Georgia | Display: title, sheet titles, fighter names, results, numerals |
| `--ease` | `cubic-bezier(0.22, 0.8, 0.24, 1)` | All UI motion |

No web fonts are downloaded. The serif stack uses fonts already installed on Apple, Windows and Android devices.

## Type scale

- **Title:** `DOJANG`, serif, 52–92 px, tracking 0.16em. The Hangul 도장 ("dojang", training hall) sits beside it in amber.
- **Eyebrow:** 11 px, 600 weight, tracking 0.32em, uppercase, amber. Example: "태권도 · Taekwondo" (태권도 = Taekwondo).
- **Menu item:** 15 px, 600 weight, tracking 0.2em, uppercase. Its one-line description appears only on the active item.
- **Sheet title:** serif, 28–40 px. **Section label (h3):** 11 px, tracking 0.28em, amber.
- **Body:** system face, 14 px, line height 1.55.

Korean text is limited to verified words: 태권도 (Taekwondo), 도장 (dojang), and the fighters' names 김재원 / 박하나. Korean referee calls are only used in-match, as before. Do not add decorative Hangul.

## Components

| Component | Class | Notes |
|---|---|---|
| Primary navigation | `.main-nav .nav-item` | Text-only list. Active item: amber label, 18 px amber rule, slides 14 px right, shows its description. Mouse hover, focus and ↑/↓ all set the active item. |
| Side sheet | `.sheet` | Left-anchored panel up to 580 px wide: eyebrow, serif title, "← Back". On portrait phones it becomes a bottom sheet (78 vh) over the scene. |
| Tabs / segmented | `.seg2` | Underline tabs (rules, round length, settings/controls). |
| Selectable row | `.opp`, `.ftab`, `.act-row` | No box at rest. Selected: amber wash plus an amber left or bottom edge. |
| Primary action | `.cta` | Full-width amber button, uppercase, 54 px. One per sheet. |
| Secondary action | `.ghost-cta` | Hairline outline. |
| Belt | `.belt-chip`, `.belt-track .knot` | Belt colour band with a knot. The current belt glows amber; locked belts are dimmed. |
| Difficulty | `.pips3` | Three amber diamonds. |
| Dialog | `.overlay .panel` | Charcoal gradient, 2 px amber top edge, serif uppercase heading. Used by Pause, Result, Training summary and Promotion. |
| Scoreline | `.scoreline` | Result screen: names with chung/hong edges and a serif score. |

## Screens

- **Home:**
  - Title, tagline, then six actions: Training (or **Continue Training** once you have history, showing the recommended next activity), Arcade Sparring, Competitive Sparring, Choose Fighter, Belt Progression, Settings & Controls.
  - The fighter and belt are shown at the foot.
- **Sparring:** an Arcade/Competitive tab, three rule lines, the opponent (White/Red/Black belt AI), the round length (Competitive), and **Start match**.
- **Training:**
  - A "Recommended next" card: the activity that moves you toward your next belt.
  - The activities, grouped as Free practice, Target challenges and Combination drills. Each shows its objective, difficulty pips, completion tick and best record.
- **Fighter:** name tabs (the 3D camera moves to a close-up of your fighter, and switching swaps the model), a blurb, stat bars, and the belt. Actions: Spar / Train.
- **Belt progression:** the White → Yellow → Green track, the next-belt meter, the requirement checklist, the record, and reset.
- **Settings & Controls:** tabs. Every existing preference is kept, plus a new **Animated menu background** toggle.
- **Results, summary, promotion:** cinematic dialogs. Promotion reveals the belt band, then the knot, then the title.

## Motion

| Transition | Treatment |
|---|---|
| Home ↔ panel | Sheet slides in from the left by 14 px with a fade, in 0.32 s. The 3D camera eases to the panel's shot in about 1 s. |
| Panel shots | home: profile two-shot · spar: low angle · training: toward the equipment wall · fighter: close-up · progress: the belt rack · settings: high wide shot |
| Setup → gameplay | Menu fades to black (0.28 s). The loading card ("Entering the dojang") appears, then the match canvas fades in (0.6 s). |
| Gameplay → results | Dialog fades in and rises (0.3 s). |
| Results → menu | Home fades in (0.6 s). |
| Promotion | Belt band unrolls (0.7 s), knot fades in, title rises. |

Under reduced motion, all of the above become instant: there is no camera drift, no shadow-sparring, and the dust is static.

## Live menu scene (`src/game/menu/MenuStage.ts`)

**What it reuses:** `buildDojang`, `createCharacter` and `FighterAnimator` are reused unchanged. A `CombatWorld` with `TrainingRules` drives two idle fighters that occasionally throw a technique out of range.

**What it doesn't run:** no AI, input, HUD or audio.

**Cost and fallbacks:**
- **One WebGL context.** It is disposed with `forceContextLoss()` before the match canvas mounts, so the menu and the match never hold two contexts.
- **30 FPS cap**, through its own rAF loop.
- **Pixel ratio** capped at 1.5 (high tier), 1.25 (medium) and 1 (low).
- **Shadows** on the high tier only.
- **Fog and a warm point light**; the hemisphere fill is lowered for contrast.
- **Dust:** 160 points (70 on low), one draw call.
- **Loading:** the fighter model is the same cached `fighter.glb` the match uses, so loading the menu scene also preloads the match.
- **Fallbacks:**
  - When WebGL is missing, context creation fails or the setting is off, a painted CSS backdrop is used instead; it is also shown while the scene loads.
  - `?nomenu3d` forces the still backdrop.

## Gameplay HUD (light touch)

Sizes and layout are unchanged, so mobile coverage is unchanged. The changes:
- the health bars use an amber gradient with a hairline frame;
- the stamina bar gets a blue gradient;
- the clock and points use serif numerals;
- the clock gets a framed, darker plate;
- round pips are diamonds;
- referee call toasts use letter-spaced serif capitals with an amber sub-line.

Controls, the touch layout, hitboxes, timing, scoring and AI are untouched.
