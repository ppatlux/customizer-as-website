# HP Robots — App & Tool UI Design Guide
*Companion to the HP Robots Otto Design Guide (print/deck/document system). This guide covers a different medium — software product UI (the block-coding app, project manager, editors) — sampled directly from real app screenshots. Paste alongside the main guide; use this one whenever the deliverable is an app screen, tool mockup, or in-product UI element rather than a document or deck.*

---

## 0. Relationship to the Brand Guide

The product UI is **its own visual system**, not a re-skin of the marketing deck. It shares the family resemblance (rounded, friendly, blue-forward, Ink for text) but uses a **different, UI-specific palette** tuned for screens — softer neutrals, a dedicated interface blue, and a wide rainbow of functional category colors inside the code editor that the marketing system does not have.

**Important distinction to preserve, not merge:** the marketing "Signal Blue" (`#549EF7`) and the product's "Interface Blue" (`#3D7FFD`) are close but *not* the same value. Keep them separate — use Interface Blue for anything inside the actual app/tool, and Signal Blue only in Mode A/B documents. Don't average them or swap one for the other.

---

## 1. UI Color System (sampled from the live app)

### 1.1 Neutrals & chrome

| Role | Hex | Usage |
|---|---|---|
| **App canvas background** | `#ECF4F9` | Default background for every screen (project list, forms, editor canvas, code panel) |
| **Surface white** | `#FFFFFF` | Cards, input fields, icon buttons, the selected segment in a tab group |
| **Segmented-control track** | `#D4E2EA` | Background of the pill-shaped tab/segment group before selection |
| **Border / placeholder / dashed outline** | `#B9CCD8` | Empty-state dashed "add" cards, subtle dividers |
| **Icon / secondary text (slate)** | `#515E80` | Default icon color, unselected tab labels, back-arrow, plus-icon |
| **Primary text** | `#000000` (near-black) | Page titles, primary labels |
| **Input placeholder text** | `#8595AD` | Placeholder copy inside text fields |

### 1.2 Action & state colors

| Role | Hex | Usage |
|---|---|---|
| **Interface Blue (primary action)** | `#3D7FFD` | Primary buttons ("New project", "Change", "Save"), selected tab border + label |
| **Run / success green** | `#3CD278` | Play/run button |
| **Stop / destructive red** | `#F6231E` | Stop button, destructive actions |

### 1.3 Code-editor category colors (rainbow-coded, functional — not brand colors)

The block-editor sidebar uses a distinct, highly saturated color per functional category. These exist to help users visually scan and distinguish block types at a glance — treat this palette as **fixed and separate** from both the marketing triad and the neutral UI chrome.

| Category | Hex |
|---|---|
| Events | `#F1D119` |
| Motion | `#5C63EC` |
| Sound | `#F860B8` |
| Color lights | `#B350F3` |
| Ultrasonic | `#B350F3` |
| Sensing | `#629DF6` |
| In / Out | `#222147` |
| Control | `#F9BD3E` |
| Math | `#3BD177` |
| Functions | `#48C7FE` |
| Variables | `#F78B15` |
| IoT | `#3296D5` |

**Rule**: each category keeps one fixed color everywhere it appears — sidebar icon, sidebar label (when active), and every block belonging to that category on the canvas. Never reuse a category color for a different category, and never recolor a block outside its category's assigned hue.

### 1.4 Code (text) syntax colors

Sampled from the generated-Python side panel — a light background (`#ECF4F9`, same as app canvas) with colored monospace text:

| Token | Approx. color |
|---|---|
| Keywords (`import`, `from`) | Magenta/pink `#D2278F`–`#D853A8` range |
| Comments | Muted gray-green, lighter weight |
| Default code text | Dark slate gray `#616267` |
| Background | `#ECF4F9` (matches app canvas — the code panel is not a separate dark theme) |

Keep the code panel on the **light** theme consistent with the rest of the app — do not introduce a dark-mode IDE background; that would break from the product's established look.

---

## 2. Typography

- Same family as the brand guide: **Forma DJR Micro** (or nearest clean geometric sans) throughout the UI — page titles, buttons, labels, block text.
- Page titles: bold, near-black, medium-large size (e.g. "Your projects", "New project").
- Form labels ("Project name", "Project type", "Project icon"): small, regular weight, slate/gray, sit directly above their control.
- Buttons: bold/medium weight, white text on filled Interface Blue, generous horizontal padding, fully rounded (pill) shape.
- Block text (inside the editor canvas): bold white text on the category color fill — must stay legible at small size, so keep block labels short.
- Code panel: monospace font for the generated code view, standard code-editor conventions (line numbers left-aligned, muted).

---

## 3. Layout & Component Patterns

### 3.1 Global chrome
- **Top bar**: back-arrow icon button (white circle, slate icon) + page title top-left; primary actions and a segmented control top-right. This left/right split is consistent across every screen.
- **Circular icon buttons**: consistently white-filled circles (~40–44px) with a slate icon centered inside — used for back navigation, and for the editor's toolbar (home, save, export, help, more, avatar).
- **Corner radius**: generous and consistent — large radius (~12–16px) on cards/panels/inputs, fully rounded (pill) on buttons, tabs, and tag-style controls. Nothing in the UI is sharp-cornered.
- **Spacing**: airy, uncluttered — wide margins, big touch targets, one primary action per screen clearly emphasized in Interface Blue while everything else stays neutral.

### 3.2 Segmented control / tabs
- Track: rounded pill container in `#D4E2EA`.
- Selected segment: white pill, Interface Blue icon + label (or bold black label, per context).
- Unselected segments: no background, slate (`#515E80`) icon + label, sitting directly on the track color.

### 3.3 Empty-state "add" card
- Dashed border (`#B9CCD8`) square/rectangle on the canvas background, centered slate `+` icon — the standard pattern for "create your first X" states. Reuse this exact pattern (dashed border + centered plus) anywhere a collection is empty and the user's next action is "add one."

### 3.4 Forms (e.g. "New project")
- Field label (small, gray) directly above a white, rounded, full-width input with a light placeholder.
- Multi-choice settings (e.g. "Project type") render as a **row of pill/card buttons**, not a dropdown — selected state = white bg + Interface Blue border + Interface Blue label; unselected = white bg + slate label, no border emphasis.
- Secondary choices with a visual preview (e.g. "Project icon") pair a small blue pill button ("Change") with a white rounded preview swatch showing the current selection beside it.
- Primary save/submit action lives top-right as a filled Interface Blue pill button, consistent with the top bar pattern.

### 3.5 Block-coding canvas (editor)
- **Left rail**: vertical icon+label navigation, one row per category, each tinted its fixed category color (§1.3). This is the UI equivalent of the marketing deck's left color rail — same *position and role* (a color-coded vertical strip anchoring the left edge) but serving a functional/navigational purpose instead of a decorative brand one.
- **Blocks**: classic interlocking "puzzle piece" shapes (Blockly-style notches), solid-filled in the category color, bold white label text, nested dropdown fields shown as a slightly darker/lighter same-hue rounded pill inside the block.
- **Canvas background**: flat, light neutral, uncluttered, no grid lines needed at default zoom.
- **Floating controls**: bottom-left cluster of circular icon buttons for zoom in/out, recenter, undo/redo; bottom-right circular Run (green `#3CD278`) and Stop (red `#F6231E`) buttons, plus a small copy-code icon.
- **Code side panel**: toggled open on the right, same light app background, monospace syntax-highlighted code, with an "Open in Python editor" link/button at its top-right corner and a close (×) icon.

---

## 4. Iconography (UI-specific — different from the marketing icon style)

The marketing guide's icons are large, centered, single-flat-color pictograms meant to be looked at. The UI icons are a **different, smaller-scale system** meant to be scanned and clicked:

- Simple, thin, functional line icons (arrows, floppy-disk/save, ellipsis/more, graduation cap, gear) — not the bold solid-fill pictograms from the deck.
- Default/inactive state: slate (`#515E80`) on white.
- Active/category state (sidebar only): the assigned category color, full saturation.
- Always sit inside a consistent circular or square touch-target container, never floating bare at inconsistent sizes.
- **Do not** apply the marketing deck's icon style (large flat-color pictograms) to in-app UI controls — it will look oversized and off-brand for a functional interface. Keep the two icon systems intentionally distinct.

---

## 5. Interaction & State Conventions

- **Selected/active** = filled white background + Interface Blue accent (border, text, or icon).
- **Unselected/inactive** = no fill, slate-colored icon/text sitting on the neutral background.
- **Primary action** = solid Interface Blue pill, white text/icon, top-right of its context.
- **Secondary action** = smaller solid Interface Blue pill (e.g. "Change") or a plain circular icon button.
- **Destructive/stop** = red, reserved only for stop/delete-type actions, never used decoratively.
- **Success/run** = green, reserved only for play/run/confirm-type actions.

---

## 6. Quick-Reference Checklist for New App/Tool Screens

- [ ] Background is `#ECF4F9`, not the marketing deck's pure white.
- [ ] Primary action uses Interface Blue `#3D7FFD` (not marketing Signal Blue `#549EF7`).
- [ ] All corners generously rounded; buttons/tabs fully pill-shaped.
- [ ] Icons are the small functional line-icon style, slate by default, colored only when active/categorized — not the deck's bold flat pictograms.
- [ ] Any code-category or functional grouping gets one fixed, distinct rainbow color from §1.3 (or a new distinct hue if it's a genuinely new category) — never reuses another category's color.
- [ ] Empty states use the dashed-border-plus-icon pattern.
- [ ] Forms: label-above-field, pill-button multi-choice groups, primary action top-right.
- [ ] Typography stays Forma DJR Micro (or fallback) throughout — same type family as the marketing guide, different scale/usage.
- [ ] Code panel, if present, stays on the light theme — no dark IDE background.

---

*Use this guide for anything that lives inside the actual product (app screens, editor UI, tool mockups, feature-request wireframes). Use the main HP Robots Otto Design Guide for anything that lives outside the product (decks, documents, marketing pages, printed material).*
