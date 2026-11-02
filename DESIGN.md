---
# gstack: design-md-format=spec
name: URCI Field
description: Certified field form — official navy ink on white paper, ruled like a stamped inspection sheet, legible in direct sun.
colors:
  ink: "#14171A"
  paper: "#FFFFFF"
  rule: "#C9CED6"
  text-muted: "#4A5260"
  primary: "#1D3B6E"
  on-primary: "#FFFFFF"
  primary-pressed: "#152C54"
  primary-tint: "#EEF2F8"
  focus-ring: "#9DB6E0"
  error: "#B42318"
  warning: "#8A5300"
  success: "#14532D"
  band-sangat-baik: "#14532D"
  band-baik: "#3F6212"
  band-sedang: "#854D0E"
  band-buruk: "#C2410C"
  band-sangat-buruk: "#9F1239"
  on-band: "#FFFFFF"
typography:
  display:
    fontFamily: Barlow
    fontWeight: 600
    fontSize: 56sp
    fontFeature: tnum
  title:
    fontFamily: Barlow
    fontWeight: 600
    fontSize: 24sp
    lineHeight: 1.2
  section:
    fontFamily: Barlow
    fontWeight: 600
    fontSize: 20sp
  body:
    fontFamily: Barlow
    fontWeight: 400
    fontSize: 16sp
    lineHeight: 1.5
  label:
    fontFamily: Barlow
    fontWeight: 500
    fontSize: 14sp
    letterSpacing: 0.02em
  grid-label:
    fontFamily: Barlow Semi Condensed
    fontWeight: 500
    fontSize: 16sp
  mono:
    fontFamily: IBM Plex Mono
    fontWeight: 400
    fontSize: 14sp
    fontFeature: tnum
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  phone: 24px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  target-min: 48px
  grid-row: 56px
  grid-cell: 72px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    minHeight: "{spacing.target-min}"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.primary}"
    borderColor: "{colors.primary}"
    rounded: "{rounded.md}"
  input:
    borderColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    minHeight: "{spacing.target-min}"
  grid-cell:
    width: "{spacing.grid-cell}"
    height: "{spacing.target-min}"
    borderColor: "{colors.rule}"
    rounded: "{rounded.sm}"
  grid-cell-filled:
    borderColor: "{colors.primary}"
    backgroundColor: "{colors.primary-tint}"
  band-chip:
    textColor: "{colors.on-band}"
    rounded: "{rounded.sm}"
  result-stamp:
    borderColor: "{colors.ink}"
    rounded: "{rounded.md}"
---

# URCI Field

## Overview

**Creative North Star:** "Certified field form": the app reads like an official, stamped inspection sheet brought to life, because the product's promise is that the URCI number is defensible evidence.
**Product context:** offline Android app (Capacitor) for mine haul-road inspectors and the mine engineer who acts on trends. Indonesian by default, ID/EN. Used outdoors in bright sun, dust and gloves.
**Mode per surface:** every screen is Operate (task UI). The in-app manual (Panduan) is Read.
**Reference sites:** none. Built from design knowledge plus the TM 5-626 DA Form 7348-R layout.
**Key characteristics:**
- Navy ink on white paper; ruled lines instead of cards.
- The URCI shown in a bordered "stamp" with a solid rating-band strip.
- Section labels carry the DA 7348-R block numbers (8 · Kuantitas & tingkat, 9 · Perhitungan URCI).
- Road-sign typeface (Barlow), large tabular numbers, monospace stamps.

## Colors

**Strategy:** Restrained. One ink color (navy `primary`) for interaction, neutrals for everything else, and color spent only where it carries meaning: the five rating bands and the status colors.
**Light or dark:** light. Inspectors read the screen outdoors in direct tropical sun; dark text on white gives the highest legibility. There is no dark theme in v1.
- `primary` marks everything tappable or in focus: buttons, links, the active tab, filled grid cells, focus rings.
- Rating bands are always shown as **text label + color** (white text on the band fill, every pair ≥ 4.5:1). Never by color alone.
- `error` (stamp red) is for blocking errors and tamper/corruption chips. `warning` (amber) is for backup age, pending photos and off-chart flags.
- Body text is `ink` on `paper` (17:1). Secondary text is `text-muted` (8:1). Light gray text is never used for content.

## Typography

- **Barlow** comes from California highway-sign lettering, so it's built to be read at a glance outdoors. It's the UI and number face. **Barlow Semi Condensed** is used only for grid row labels, so Indonesian distress names fit 360 dp phones. **IBM Plex Mono** is for GPS coordinates, photo stamps and file names.
- All three are SIL Open Font License, bundled inside the APK (latin subset, about 300 KB), and never loaded from the network.
- Scale (sp): 56 URCI number / 24 screen title / 20 section / 16 body and grid labels / 14 captions and labels only. Body text is never below 16 sp. Numbers always use tabular figures.
- Grid labels wrap to 2 lines at the largest system font size and are never truncated. Full distress names live in the (i) popup.

## Layout

- Phone-first, grid-disciplined: 16 dp screen edges, 8 dp spacing grid, 56 dp grid rows, 72 dp quantity cells.
- Every tap target is at least 48 × 48 dp.
- The Inspect result stamp is a sticky bar above the keyboard. The header collapses to one summary line after the first fill.
- Wide or landscape screens show full distress names. The structure never changes, only the label width.

## Elevation & Depth

Flat, like paper. Separation comes from 1 px `rule` lines and 2 px `ink` lines under the top bar and around the result stamp. No drop shadows inside the app; the only shadow is the device frame in previews.

## Shapes

Small, document-like radii: 4 px for inputs, cells and chips, 6 px for buttons and the stamp, 8 px for panels and sheets. No pills, no uniform large radius.

## Components

- **Buttons:** primary is solid navy; secondary is white with a navy 2 px border; tertiary is underlined navy text. Pressed state is `primary-pressed`. Focus shows a 3 px `focus-ring` outline. Disabled is 40% opacity and is never the only signal; the label explains why.
- **Grid cell:** 72 × 48 dp, centered in a 56 dp row; value centered (Barlow 500, 20 sp). A filled cell gets a navy 2 px border and `primary-tint` fill. **The photo marker (camera icon 14 dp plus count) sits in the cell's top-right corner, never shares a line with the value, and is status only (not a tap target).** Tapping a cell opens its keypad sheet. Once the cell has a value, the sheet shows a full-width 48 dp "Ambil foto" button for exactly that cell.
- **Row label:** the whole 96 dp label area is the tap target for the (i) help popup, marked by a small info glyph. There is no separate (i) icon. Processing shows a spinner icon in the same corner; failure shows a warning icon.
- **Dust (84):** three single-choice chips (R/S/T); selected is solid navy.
- **Result bar (Inspect, sticky):** about 72 dp. Left: the 32 sp URCI number ("—" before the first entry). Middle: band chip plus "TDV · q". Right: the Save button. It sits directly above the keyboard, and the tabs hide while the keyboard is open. While stamps are pending, Save reads "Menyimpan… memproses N foto".
- **Result stamp (calc sheet and PDF only):** 2 px ink border. The left side has block "9 · URCI · TDV · q" and "Ketuk untuk perhitungan". The right side has the 56 sp number behind a 2 px divider. Along the bottom runs a full-width band strip with the label and range.
- **Band chip:** uppercase label on the band fill, 4 px radius.
- **Messages:**
  - field error: red text under the field;
  - success: 3 s toast;
  - blocking: dialog;
  - standing condition: banner;
  - per-item: icon chip on the row.
- **Dialogs:**
  - **Notice:** one primary button.
  - **Confirm:** primary button plus a tertiary "Batal".
  - **Destructive:** the primary button is `error` red with an explicit verb ("Hapus foto", "Buang draf"), never "OK".
  - Default focus is always the safe choice.
- **Banners:**
  - **Info:** `primary-tint` background, navy icon.
  - **Warning:** `paper` background, a 3 dp `warning` top rule and an amber icon. Used for backup age, clock drift, conflicts and closed rounds.
- **Toast:** `ink` background, white 16 sp text, 4 px radius, 3 s. It appears just above the result bar or tabs and never covers Save.
- **Progress:** a dialog with a 4 dp navy bar on a `rule` track, "X dari Y" (or "Bagian n dari m") and "Batal" only when cancellable. A non-cancellable stage says so.
- **Chart (trend):**
  - band zones as tints of the band colors at 12% opacity behind the data;
  - an ink line, 2 px;
  - solid 8 dp points for complete rounds, hollow points for incomplete ones, each labeled "n dari N";
  - outlier units marked with an `error` triangle plus a text label;
  - axis labels in Barlow 14 sp `text-muted`.
- **Chips:**
  - the round chip is read-only;
  - a closed round shows a lock icon, `text-muted` text and "Ditutup";
  - the GPS status uses IBM Plex Mono ("GPS ±4 m" / "Mencari GPS…"), with an amber "GPS mati · Aktifkan" chip when location is off or denied.
- **Icons:** bundled Material Symbols subset, 24 dp, monochrome. Status colors only for warning and error. Every icon has a TalkBack label.

## Do's and Don'ts

- Do show every rating as text plus color.
- Do keep the cell value and the photo marker on separate lines (corner badge).
- Do use DA 7348-R block numbers only for sections that exist on the paper form.
- Do keep body text at 16 sp or larger and targets at 48 dp or larger.
- Do bundle fonts and icons; nothing loads from the network.
- Don't use emoji as UI.
- Don't use cards, shadows or gradients as containers; use ruled lines.
- Don't use a dark theme or light-gray content text.
- Don't put text labels inside grid cells beside the number.
- Don't decorate the result stamp beyond its border and band strip.

## Motion

- **Approach:** minimal-functional.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out).
- **Duration:** micro 100 ms, short 200 ms; nothing longer.
- **The one authored moment:** the URCI number briefly flashes the `primary-tint` background for 150 ms when its value changes, so the inspector sees the live update without looking for it.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-02 | Initial design system created | /design-consultation from the URCI Field design doc. Memorable thing: "official and trustworthy". Resolves DS-1. |
| 2026-11-02 | Design re-review: compact result bar, keypad-sheet photo button, label-as-help, confirm/destructive dialogs, warning banners, toast/progress/chart specs, chips | /plan-design-review D3–D17 |
| 2026-11-02 | Grid photo marker moved to the cell corner | Owner asked that cramped cell text never occur; 72 dp cells and a corner badge keep the value alone on its line. |
