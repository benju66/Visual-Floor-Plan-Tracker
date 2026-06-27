# Kickoff — Canvas Tracing Precision Aids, Phase 2: selectable crosshair styles + Settings picker

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Canvas Tracing Precision Aids** (the crosshair gains 5 selectable looks — lines, lines+dot, ring, ring+dot, gap-cross — chosen from the Settings menu). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-26 - Canvas Tracing Precision Aids Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Canvas-Tracing-Precision-Aids-Plan.md` (Phase 2 + the locked product decisions)
> - `sitepulse-next/AGENTS.md` (§2 persisted state / `useHydratedStore`, §3 zero-re-render canvas overlays)
>
> Phases 1, 3, 4 are already shipped + committed on `feat/canvas-precision-aids-phase1` (latest `66c121a`). Phase 2 is independent of all of them — branch off **that branch** (so it stacks) or off `main` (confirm with me). Build **only Phase 2**. Don't commit or push until I say "Approved."

---

## What this phase delivers
Today the crosshair (toggled by `mapSettings.showCrosshair`, default OFF) is exactly
two full-bleed dashed lines that follow the cursor. This phase lets the user pick its
**look** from Settings — 5 fixed presets:
- `lines` — today's behavior (full vertical + horizontal dashed lines). **Default.**
- `lines-dot` — the lines plus a small dot at the exact cursor point.
- `ring` — just a circle centered on the cursor, no lines (the owner's "circle in the
  middle" ask).
- `ring-dot` — ring plus center dot.
- `gap-cross` — CAD-style: the cross with a gap in the middle so the exact point under
  the cursor isn't covered.

Plain-English: "when the crosshair is on, choose how it looks in Settings — including a
ring/circle and a CAD-style gap cross — instead of only the two lines."

## Why it's a good next phase
It's independent (no dependency on the magnifier or snapping work), frontend-only, and
lands in **both** canvases at once because `CrosshairOverlay` is shared. Small, contained.

## Required reading — current state (re-read fresh; line numbers drift)
1. `src/components/canvas/CrosshairOverlay.tsx` (~44 lines) — the whole component. It's a
   DOM overlay (NOT Konva): a wrapper `<div>` with `mix-blend-difference opacity-40`
   holding two absolutely-positioned line `<div>`s (`vLineRef` left, `hLineRef` top). It
   subscribes to the pointer store and in a single `update()` mutates `v.style.left` /
   `h.style.top` directly — **the component never re-renders on mouse move.** Today it
   takes only `{ pointerStore }`. The pointer sample exposes `screenX` / `screenY` (cursor
   in container px) — you'll need both to center a ring/dot/gap on the cursor.
2. `src/store/useSettingsStore.ts` — `MapSettings` interface is at ~line 18; the initial
   `mapSettings:` object (with defaults) is at ~line 79. `showCrosshair: false` already
   lives in both. `crosshairStyle` is a **normal persisted field** — do NOT give it the
   `showMagnifier` force-OFF-on-rehydrate treatment in the persist `merge`.
3. `src/components/SettingsMenu.tsx` — the "Canvas Crosshair" on/off toggle is the block
   at ~lines 778–792 (label + `<input type="checkbox" checked={mapSettings?.showCrosshair}
   onChange={... onUpdateMapSettings({ ...(mapSettings as MapSettings), showCrosshair })}`).
   The next block down is "Smooth Wheel Zoom". Insert the style picker between them. Match
   the existing styling; grep `<select` in this file for the dropdown idiom already used.
4. `src/components/FloorplanCanvas.tsx` — renders `{mapSettings?.showCrosshair && (
   <CrosshairOverlay pointerStore={pointerStore} /> )}` (search for `CrosshairOverlay`).
   `mapSettings` here is already the hydrated value (via `useHydratedStore`). Pass the new
   prop here.

## Scope (Phase 2 only)
- **`useSettingsStore.ts`:** add `crosshairStyle?: 'lines' | 'lines-dot' | 'ring' |
  'ring-dot' | 'gap-cross'` to the `MapSettings` interface, and `crosshairStyle: 'lines'`
  to the initial `mapSettings` object. Explicit union type, no `any` (§6).
- **`CrosshairOverlay.tsx`:** add a `style?: MapSettings['crosshairStyle']` prop
  (default `'lines'`). Render the 5 variants while **keeping the zero-re-render
  ref-mutation pattern** and the dark-mode-safe `mix-blend-difference`:
  - Lines stay full-bleed `<div>`s positioned by `left`/`top` as today (shown for
    `lines`, `lines-dot`, `gap-cross`).
  - Add a cursor-centered element for the ring and/or dot, positioned at
    `(screenX, screenY)` via `transform: translate(...)` (or left/top + `-translate`),
    mutated in the same `update()` loop. Show per `style`.
  - `gap-cross`: render each axis as two segments with a gap around the cursor, OR keep
    the single lines but apply a radial-gradient/mask that punches a hole at the cursor —
    your call; simplest correct approach wins. The gap must track the cursor (ref-mutated).
  - Because `style` changes which elements are active, depend the `useEffect` on
    `[pointerStore, style]` so `update()` re-binds when the style changes. **Per-frame
    mouse moves must still never call `setState`** — only `style`/`pointerStore` changes
    re-subscribe.
- **`FloorplanCanvas.tsx`:** pass `style={mapSettings?.crosshairStyle}` into
  `<CrosshairOverlay>`.
- **`SettingsMenu.tsx`:** add a `<select>` (the 5 options) directly under the "Canvas
  Crosshair" toggle, **disabled when `!mapSettings?.showCrosshair`**, writing via
  `onUpdateMapSettings({ ...(mapSettings as MapSettings), crosshairStyle: e.target.value
  as MapSettings['crosshairStyle'] })`. Label it e.g. "Crosshair style".
- **(Optional) `src/utils/crosshairStyles.ts` (+ `.test.ts`):** only extract a small
  declarative spec map (which elements each style shows) if it genuinely tidies the
  component AND earns a unit test. Don't add a test that just restates a literal.

## Out of scope
- Phase 5 (mini-map) — do not start it.
- The open "snap ring under the loupe" decision — separate, not this phase.
- **No** crosshair color/thickness/size controls (v1 is 5 fixed presets — locked decision).
- No new toolbar button — the existing crosshair on/off toggle + a `crosshair` pinnable
  tool already exist; Phase 2 only adds the **style** picker in Settings.
- No DB/backend/migration. `crosshairStyle` is client-only (`mapSettings` → localStorage).

## Guardrails
- **Zero-re-render on mouse move** (§3): keep the ref-mutation `update()` loop; the only
  allowed re-render is when `style` (a settings change) flips. Don't subscribe per frame.
- **Persisted state via `useHydratedStore`** (§2) — `FloorplanCanvas` already reads the
  hydrated `mapSettings`; just thread the field. The default `'lines'` keeps today's look
  for everyone who never opens the picker.
- **No `any`** (§6) — type the union explicitly; cast the `<select>` value to the union.
- Don't bloat `FloorplanCanvas` (§3) — all rendering lives in `CrosshairOverlay`.
- Dark-mode safety: the wrapper's `mix-blend-difference` is what keeps the crosshair
  visible on both light and dark sheets — preserve it on every variant.

## Exit criteria (Definition of Done → then STOP)
Run with an absolute prefix (a stray `cd` triggers a permission prompt):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- typecheck + full test run + build all green (lint is NOT a gate).
- Live `dev:3010` in BOTH canvases (workbench tracer + project map): turn the crosshair on,
  switch through all 5 styles — each renders correctly and follows the cursor with no
  flicker; the picker is disabled when the crosshair is off; the choice persists across a
  page reload; all styles stay visible on both a light and a dark sheet.
- Close with the **verify-feature** skill. Do NOT commit or push until the owner says
  "Approved."
