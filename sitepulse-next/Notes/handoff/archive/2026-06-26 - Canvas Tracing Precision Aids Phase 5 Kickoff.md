# Kickoff — Canvas Tracing Precision Aids, Phase 5: toggleable mini-map

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 5 of Canvas Tracing Precision Aids** (a toggleable bottom-right mini-map: a thumbnail of the whole sheet with a box showing where you're zoomed in; click or drag it to jump there). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-26 - Canvas Tracing Precision Aids Phase 5 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Canvas-Tracing-Precision-Aids-Plan.md` (Phase 5 + the locked product decisions)
> - `sitepulse-next/AGENTS.md` (§2 persisted state / `useHydratedStore`, §3 zero-re-render canvas overlays + **native wheel isolation**, §6 no class instances in the Query cache)
>
> Phases 1–4 are shipped + committed on `feat/canvas-precision-aids-phase1` (latest `66c121a`); Phase 2 is shipped + committed on `feat/canvas-precision-aids-phase2` (`99b79d4`, stacked on phase1). Phase 5 is independent of the crosshair/magnifier/snap work — branch off **`feat/canvas-precision-aids-phase2`** (so the whole P1–P5 set stays stacked) or off `main` (confirm with me). Build **only Phase 5**. Don't commit or push until I say "Approved."

---

## What this phase delivers
A small **bottom-right** overlay showing the whole sheet thumbnail with a rectangle
marking the currently-visible region. It updates live as you pan/zoom, and:
- **click** it → recenter the main view there (eased, via `animateViewport`),
- **drag** the box → pan the main view continuously.

Plain-English: "a little map of the whole drawing in the corner so you don't get
lost when zoomed in — click or drag it to jump around."

## Why it's a good final phase
Independent of the crosshair/magnifier/snap work, frontend-only, and lands in
**both** canvases at once (the shared `FloorplanCanvas`). It closes out the
Precision Aids workstream.

## Locked product decisions (owner, 2026-06-26 — do not re-litigate)
- **Placement:** bottom-right corner (clear of the top-center toolbar, the
  bottom-center bulk-action dock, and the legend which defaults top-left).
- **v1 richness:** **viewport box only** — thumbnail + current-view rectangle +
  click/drag-to-recenter. **No** location markers/dots on the thumbnail (later pass).
- **Default:** OFF (`showMiniMap: false`). Desktop-only (mouse), consistent with
  the project's canvas-nav convention.
- Default size ~**160×120 px**, scaled to the sheet's aspect ratio (deferrable to
  build time).

## Required reading — current state (re-read fresh; line numbers DRIFT)
1. `src/components/FloorplanCanvas.tsx` — the shared canvas. Reuse, don't refork:
   - the **`layout`** memo (`offsetX/offsetY/drawW/drawH/stageW/stageH`),
   - the already-computed **`visibleBoundingBox`** (visible region in **% coords** —
     this is your viewport rectangle source; grep for it),
   - `stagePosition` / `setStagePosition`, **`animateViewport`**, `stageRef`,
     `dimensions`, `stageScale`.
   - The base thumbnail image URL — grep for the preview PNG / `base_image_url` /
     `pdfSource` (`src/utils/pdfSource.ts`); the server-rendered `converted/<sheetId>.png`
     is the instant placeholder LOD (AGENTS.md §5). Use a **versioned** URL so it caches.
   - Render `<MiniMapOverlay/>` near the other DOM overlays (search `CrosshairOverlay`
     / `LoupeOverlay`) — bottom-right, z-above the canvas, below modals — gated on
     `mapSettings?.showMiniMap`. **Keep all rendering in the overlay component; don't
     bloat the canvas (§3).**
2. `src/components/canvas/CrosshairOverlay.tsx` + `LoupeOverlay.tsx` — pattern
   reference for a DOM overlay that reads canvas state without re-rendering per frame.
3. `src/store/useSettingsStore.ts` — `MapSettings` interface + the initial
   `mapSettings` object. Add `showMiniMap` like a normal persisted field (it's a
   plain bool — NOT the `showMagnifier` force-OFF-on-rehydrate treatment).
4. `src/components/MapHorizontalToolbar.tsx` + `src/components/workbench/WorkbenchTracerToolbar.tsx`
   — add a mini-map toggle button to BOTH (Phase 2 just added the crosshair
   toggle+picker to the workbench toolbar — mirror that exact pattern; a `Map`/
   `MapPinned` lucide icon fits). `SettingsMenu.tsx` — add a checkbox toggle too,
   matching the existing toggle rows.

## Scope (Phase 5 only)
- **New `src/utils/minimapMath.ts` (+ `minimapMath.test.ts`):** the load-bearing
  projection math, pure + deterministic (no `Date.now()`/`Math.random()`), unit-tested
  BOTH directions:
  - `viewportRectToMiniBox(visibleBBox, miniW, miniH)` → `{left, top, width, height}` px
    rectangle inside the mini-map (the visible % region mapped onto the thumbnail).
  - `miniClickToStagePosition(clickPx, miniW, miniH, layout, stageScale, dimensions)` →
    the `stagePosition` that recenters the main view on the clicked thumbnail point.
  - Test the round-trip: a click at the mini-map center recenters there; the box
    matches the visible %. (These are the two invariants — see plan § "Pure logic".)
- **New `src/components/canvas/MiniMapOverlay.tsx`** (plain HTML/CSS, NOT Konva):
  `<img src={thumbnailUrl}>` + an absolutely-positioned `<div>` rectangle positioned
  from `viewportRectToMiniBox`. Click → `animateViewport` to the eased target; drag
  the box → direct `setStagePosition` per move (read live canvas state via props/refs,
  not per-frame React state where avoidable — follow the Crosshair/Loupe pattern).
- **`useSettingsStore.ts`:** add `showMiniMap?: boolean` to `MapSettings` (+ `false`
  in the initial object). Explicit type, no `any` (§6).
- **`FloorplanCanvas.tsx`:** render `<MiniMapOverlay/>` when `showMiniMap`, wired to
  the reused internals above. Keep edits localized + well-commented (the AI-tracing
  branch also edits this file — see plan § Coordination; one mechanical reconcile later).
- **Both toolbars + `SettingsMenu`:** the on/off toggle.

## Guardrails (AGENTS.md — do not violate)
- **Native wheel isolation (§3):** the mini-map is an HTML overlay over the Konva
  stage. Attach a `useRef` native `wheel` listener with `stopPropagation` +
  `overscroll-contain` so scrolling/zooming over the mini-map can't pan/zoom the main
  stage. (Same pattern the legend/other HTML overlays use.)
- **Zero-re-render where it matters (§3):** the viewport box tracks pan/zoom; update
  it via the same low-cost path the other overlays use — don't trigger a full canvas
  re-render on every frame.
- **No class instances in the Query cache (§6):** nothing here goes near TanStack/IDB;
  `showMiniMap` persists to `localStorage` via Zustand persist (fine). Access persisted
  values via `useHydratedStore` (§2).
- **No `any` (§6);** new files `.ts/.tsx`. **No DB/backend/migration** — client-only.
- **Don't collide** with the draggable `MapLegend`, the bottom-center `BulkActionDock`,
  or the zoom controls — bottom-right is chosen to dodge them; verify live.

## Out of scope
- Mini-map **location markers** (colored dots/polygons on the thumbnail) — explicitly a
  later pass.
- Touch/pinch/mobile.
- The open **P4 snap-ring-under-the-loupe** tension (keep snapping on while the loupe is
  up) — separate decision, not this phase.
- Any crosshair/magnifier changes.

## Exit criteria (Definition of Done → then STOP)
Run with an absolute prefix (a stray `cd` triggers a permission prompt):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- typecheck + full test run (incl. new `minimapMath` cases) + build all green (lint is
  NOT a gate).
- Live `dev:3010` in BOTH canvases (workbench tracer + project map): toggle the mini-map
  on from each toolbar (and the Settings checkbox); the viewport box tracks pan + zoom
  live; click recenters (eased) and drag pans correctly; bottom-right placement doesn't
  collide with toolbar/legend/dock; **wheel/zoom over the mini-map does NOT move the main
  canvas**; the toggle persists across a reload.
- Close with the **verify-feature** skill. Do NOT commit or push until the owner says
  "Approved."
