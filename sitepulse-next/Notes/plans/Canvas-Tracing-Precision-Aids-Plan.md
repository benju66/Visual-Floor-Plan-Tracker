# Canvas Tracing Precision Aids — magnifier, smart snapping, crosshair styles & mini-map (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: none (standalone canvas-UX workstream). Related: `Notes/plans/AI-Tracing-Assist-Plan.md` (shares the one file these touch — see §Coordination).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) first.
2. Re-read the files named below **fresh** — do not trust line numbers; they drift.
3. Build the phases in order. Verify after each (see each phase's Exit criteria).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2
   sentence plain-English summary; explain jargon in passing; keep it short.
5. **Do not commit or push until the owner says "Approved."** Branch off `main`.

## Goal
The interactive floor-plan canvas gains four precision aids for placing and
reading points accurately — and because there is **one shared canvas component**
(`FloorplanCanvas`), every aid lands in **both** the Drawing-Library workbench
tracer **and** the project-level map at once:
- **Smarter magnetic snapping** that hugs the *inside face* of thick walls and
  stops jumping to the wrong corner at wall junctions.
- A **magnifier loupe** — a cursor-following lens that renders a genuinely
  high-resolution crop of the plan for precise node placement past the zoom
  ceiling (toggle with `M` or a toolbar button), and which **shows your in-progress
  dashed trace line and placed nodes** inside the lens.
- **Selectable crosshair styles** (lines, lines + dot, ring, ring + dot, gap
  cross) chosen from the Settings menu.
- A **toggleable mini-map** (bottom-right) so when you're zoomed in you can still
  see where you are on the sheet, and click/drag it to jump there.

## Provenance — most of this is already written, just stranded
Two of the four aids were already built and committed on an **unmerged** branch
`claude/code-repo-review-2vre2c` (never reached `main`/production). Port that code
by hand (see each phase); do not blind cherry-pick — the relevant commit is
bundled with unrelated work. Pull exact source with:
```
git show 4cc9101 -- sitepulse-next/src/utils/geometry.ts sitepulse-next/src/utils/geometry.test.ts sitepulse-next/src/components/FloorplanCanvas.tsx   # inside-face snap (Phase 1)
git show claude/code-repo-review-2vre2c:sitepulse-next/src/components/canvas/LoupeOverlay.tsx     # Phase 3
git show claude/code-repo-review-2vre2c:sitepulse-next/src/hooks/useLoupeRenderer.ts              # Phase 3
git show claude/code-repo-review-2vre2c:sitepulse-next/src/utils/loupeMath.ts                     # Phase 3
git show claude/code-repo-review-2vre2c:sitepulse-next/src/utils/loupeMath.test.ts                # Phase 3
git show 014fe85 -- sitepulse-next/src/store/useSettingsStore.ts sitepulse-next/src/workers/pdfRenderProtocol.ts sitepulse-next/src/workers/pdfRender.worker.ts sitepulse-next/src/components/FloorplanCanvas.tsx sitepulse-next/src/components/canvas/DraftPolygon.tsx   # Phase 3 wiring
```
The crosshair styles (Phase 2) and mini-map (Phase 5) are **new** (the branch only
had a crosshair on/off toggle, not styles, and never had a mini-map).

## Coordination — the one file overlap (read before starting)
The only file this workstream and the in-flight **AI Tracing** workstream both edit
is `src/components/FloorplanCanvas.tsx`. Their changes are independent (AI tracing
adds a `CaptureBoxOverlay`; this adds loupe/minimap overlays + snap tweaks) — they
sit near each other but never fight the same logic. Because this plan builds on a
fresh branch off `main`, expect **one small, mechanical reconciliation** in
`FloorplanCanvas.tsx` when the AI tracing branch later merges `main`. Nothing to do
here except keep edits localized and well-commented.

## Out of scope / deferred
- **No DB / backend / migration of any kind.** Every setting added here is
  client-side (`mapSettings`, persisted to `localStorage` via the Zustand persist
  middleware — NOT the TanStack/IDB cache).
- **Mini-map markers** (colored location dots/polygons on the thumbnail) — v1 is
  thumbnail + viewport rectangle + click/drag-to-recenter only. Markers are a
  later pass.
- **Crosshair color/thickness/size controls** — v1 ships 5 fixed style presets, no
  per-property customization.
- **Touch / pinch / mobile** — desktop-first, consistent with the project's
  desktop-only canvas-nav convention. Mouse + keyboard only.
- The unrelated email-invites / set-password / fill-from-walls code that happens
  to live on the source branch — do NOT port it.

## Locked product decisions (from the owner, 2026-06-26)
- **Mini-map placement:** bottom-right corner (clear of top-center toolbar,
  bottom-center bulk-action dock, and the legend which defaults top-left).
- **Mini-map v1 richness:** viewport box only (thumbnail + current-view rectangle +
  click/drag to recenter). No location markers in v1.
- **Crosshair default style:** `lines` (today's behavior) — users opt into other
  styles in Settings. Crosshair stays default-OFF (`showCrosshair: false`), unchanged.
- **Scope:** all four aids, both canvases. The magnifier "show trace overlays"
  enhancement (Phase 4) depends on the magnifier port (Phase 3).
- **Precondition:** do not START building until the current AI Tracing phase
  (branch `claude/ai-location-tracing-pipeline-ip709o`, work currently all
  uncommitted) has been committed by the owner. This is a plan-of-record for after.

## Data model
None. No tables, columns, or RPCs are read or written. All new state is in the
`MapSettings` interface in `src/store/useSettingsStore.ts`:
- `crosshairStyle?: 'lines' | 'lines-dot' | 'ring' | 'ring-dot' | 'gap-cross'` (default `'lines'`)
- `showMiniMap?: boolean` (default `false`)
- `showMagnifier?: boolean` (default `false`, **session-only** — forced OFF on every rehydrate via the persist `merge`, because a persisted-on loupe silently suspends snapping)
- `magnifierZoom?: number` (default `3`, persisted normally)

## Build-on inventory (read these fresh before using — do not fork)
- `src/utils/geometry.ts` — `getSnappedCoordinate()`. EXTEND in place (Phase 1). It
  is the single snapping source for both canvases (AGENTS.md §5). Already unit-tested.
- `src/components/canvas/CrosshairOverlay.tsx` — DOM crosshair, subscribes to the
  pointer store, mutates refs directly (no re-render on mouse move). EXTEND with a
  `style` prop (Phase 2).
- `src/components/canvas/DraftPolygon.tsx` — the in-progress trace line + nodes +
  snap ring live HERE, inside the 3rd Konva layer. Phase 4 composites that *layer*,
  not this component.
- `src/utils/pointerStore.ts` — the zero-re-render pointer position store used by
  crosshair, loupe, and mini-map cursor.
- `src/components/canvas/PdfBaseLayer.tsx` + `src/hooks/usePdfRenderer.ts` +
  `src/workers/pdfRender.worker.ts` + `src/workers/pdfRenderProtocol.ts` — the
  off-main-thread pdf.js pipeline. The loupe spins up a SECOND dedicated worker
  (`useLoupeRenderer`) — by design, do not share the main worker (AGENTS.md §5).
- `src/components/FloorplanCanvas.tsx` — the shared canvas. Re-read fresh; key
  internals to reuse: the `layout` memo (`offsetX/offsetY/drawW/drawH/stageW/stageH`),
  the already-computed `visibleBoundingBox` (visible region in % coords — REUSE for
  the mini-map viewport rect), `stagePosition`/`setStagePosition`, `animateViewport`,
  `stageRef`, `dimensions`, and the THREE Konva `<Layer>`s in render order:
  (1) PDF base, (2) unit polygons, (3) interactive overlays incl. `DraftPolygon`.
- `src/store/useSettingsStore.ts` — `MapSettings` + persist config. Add the fields
  above; carry over the `merge` that forces `showMagnifier: false` on rehydrate.
  Access persisted values via `useHydratedStore` (AGENTS.md §2).
- `src/components/MapHorizontalToolbar.tsx` — project-map toolbar. Already has the
  magnet (snap) + crosshair toggles. Add magnifier + mini-map buttons here.
- `src/components/workbench/WorkbenchTracerToolbar.tsx` — workbench toolbar. Add
  magnifier + mini-map (+ crosshair if not present) toggles for parity.
- `src/components/SettingsMenu.tsx` — has the "Show crosshair" toggle and uses
  `<select>` dropdowns elsewhere. Add the crosshair-style dropdown + mini-map toggle.

## Pure logic to extract + unit-test
Load-bearing correctness goes in framework-free `src/utils/*.ts` (+ `.test.ts`),
deterministic, no `Date.now()`/`Math.random()` inside:
- `geometry.ts` inside-face snap (Phase 1) — port the branch's added tests
  (softened corner gravity + inside-face bias on a thick wall).
- `loupeMath.ts` (Phase 3) — port the branch file AND its `loupeMath.test.ts`.
- `minimapMath.ts` (Phase 5) — NEW: `viewportRectToMiniBox(visibleBBox, miniW, miniH)`
  and `miniClickToStagePosition(clickPx, miniW, miniH, layout, stageScale, dims)`.
  Pure functions → unit-test the projection both directions (a click at the
  mini-map center recenters the view there; the viewport box matches the visible %).
- (Optional) a tiny `crosshairStyles.ts` spec map if it keeps `CrosshairOverlay`
  declarative; only if it earns a test.

## Sub-phasing (ship + verify each)

### Phase 1 — Inside-face-aware magnetic snapping  (port commit 4cc9101)
- **Plain English:** the snap stops grabbing the outer face of thick walls and
  the wrong corner at junctions — it now hugs the inside line you're tracing.
- **Scope:** Port the `geometry.ts` change (add `CORNER_ZONE_FRACTION = 0.6`; add
  optional `interiorPoint` param that biases selection toward the room-interior
  wall face; keep it **backward-compatible** — param defaults to null). Port the
  added `geometry.test.ts` cases. Wire `FloorplanCanvas` to feed the interior hint:
  the centroid of `draftPoints` once ≥3 are placed (freehand trace), and the
  detected-room centroid in the fill-from-walls path **only if** that path exists on
  `main` (it may not — if absent, skip that call site, don't port fill-from-walls).
- **Files:** `src/utils/geometry.ts`, `src/utils/geometry.test.ts`,
  `src/components/FloorplanCanvas.tsx` (~11 lines, the two snap call sites in
  draw-mode `onMouseMove`).
- **Approval gates:** none beyond the standing "don't commit/push until Approved."
- **Exit criteria:** typecheck + test + build green · new geometry tests pass ·
  live `dev:3010` click-through: trace a room over a thick-walled sheet in BOTH the
  workbench and the project map — confirm points land on the inside face and don't
  hijack to a crossing wall's corner · close with the verify-feature skill.

### Phase 2 — Crosshair styles + Settings picker  (new)
- **Plain English:** when the crosshair is on, the user can choose its look —
  including a ring/“circle in the middle” and a CAD-style gap cross — from Settings.
- **Scope:** Give `CrosshairOverlay` a `style` prop and render 5 variants: `lines`
  (current/default), `lines-dot`, `ring`, `ring-dot`, `gap-cross`. Keep the
  zero-re-render ref-mutation pattern and the dark-mode-safe `mix-blend-difference`.
  Add `crosshairStyle` to `MapSettings` (default `'lines'`). Pass
  `mapSettings.crosshairStyle` from `FloorplanCanvas` into `CrosshairOverlay`. Add a
  `<select>` in `SettingsMenu` directly under the existing "Show crosshair" toggle,
  disabled when the crosshair is off.
- **Files:** `src/components/canvas/CrosshairOverlay.tsx`,
  `src/store/useSettingsStore.ts` (1 field + default), `src/components/SettingsMenu.tsx`,
  `src/components/FloorplanCanvas.tsx` (pass the prop). Optional `src/utils/crosshairStyles.ts`(+test).
- **Approval gates:** none beyond standing.
- **Exit criteria:** typecheck + test + build green · live `dev:3010`: toggle each
  style, confirm correct rendering + cursor-follow in BOTH canvases, persistence
  across reload, and visibility on light + dark sheets · verify-feature.

### Phase 3 — Magnifier loupe  (port commit 014fe85, magnifier parts only)
- **Plain English:** a magnifier lens that follows the cursor and shows a crisp,
  zoomed view for precise placement; toggle with `M` or a toolbar button.
- **Scope:** Port new files `components/canvas/LoupeOverlay.tsx`,
  `hooks/useLoupeRenderer.ts`, `utils/loupeMath.ts` (+ `loupeMath.test.ts`) verbatim
  from the branch. Port the `pdfRenderProtocol.ts` `skipLods?` flag + the
  `pdfRender.worker.ts` early-return on `skipLods`. Add `showMagnifier`
  (session-only) + `magnifierZoom` to `MapSettings` AND carry the persist `merge`
  that forces `showMagnifier:false` on rehydrate. Wire `FloorplanCanvas`: the `M`
  key + `[`/`]` zoom handlers, `effectiveSnapping = enableSnapping && !magnifierActive`
  (snapping suspends while the loupe is up), the `useLoupeRenderer` call, and the
  `<LoupeOverlay/>` render. Port the small `DraftPolygon` snap-ring polish.
  **Add the magnifier toggle button** to BOTH `MapHorizontalToolbar` and
  `WorkbenchTracerToolbar`. **Do NOT** port email-invites / set-password / migration
  / fill-from-walls from that commit.
- **Files:** the 3 new loupe files + test; `src/workers/pdfRenderProtocol.ts`,
  `src/workers/pdfRender.worker.ts`; `src/store/useSettingsStore.ts`;
  `src/components/FloorplanCanvas.tsx`; `src/components/canvas/DraftPolygon.tsx`;
  `src/components/MapHorizontalToolbar.tsx`; `src/components/workbench/WorkbenchTracerToolbar.tsx`.
- **Approval gates:** none beyond standing. (Note the perf cost: a SECOND pdf.js
  worker runs while the loupe is active — mention to owner; this is by design.)
- **Exit criteria:** typecheck + test + build green · `loupeMath` tests pass · live
  `dev:3010` in BOTH canvases: `M` and the toolbar button toggle the lens; `[`/`]`
  change zoom; snapping visibly suspends while up and resumes when off; the lens is
  OFF after a page reload (session-only); a raster-only sheet falls back to the soft
  upscale without error · verify-feature.

### Phase 4 — Magnifier shows the trace line + placed nodes  (new; depends on Phase 3)
- **Plain English:** while tracing with the magnifier up, you can see your dashed
  guide line and the points you've already placed *inside* the lens, not just the
  bare drawing.
- **Scope:** Root cause — the loupe's sharp path draws only the pdf.js PDF crop, so
  Konva vector overlays vanish under it. Fix: add a `ref` to the **3rd Konva
  `<Layer>`** (the interactive-overlays layer containing `DraftPolygon`) in
  `FloorplanCanvas`; pass it to `LoupeOverlay`; in the loupe draw routine, after
  drawing the sharp PDF patch, composite `overlayLayer.toCanvas({ x, y, width,
  height, pixelRatio })` for the same screen region on top. Transparent everywhere
  except the trace → PDF detail + crisp line/nodes/snap-ring together. Guard for
  when the layer ref/region is unavailable.
- **Files:** `src/components/FloorplanCanvas.tsx` (1-line layer ref + pass prop),
  `src/components/canvas/LoupeOverlay.tsx` (compositing step).
- **Approval gates:** none beyond standing.
- **Exit criteria:** typecheck + test + build green · live `dev:3010`: with the
  magnifier up in draw mode, the dashed line + placed nodes + snap ring appear in
  the lens over the sharp crop, in BOTH canvases; no flicker on still cursor ·
  verify-feature.

### Phase 5 — Toggleable mini-map  (new)
- **Plain English:** a small bottom-right map of the whole sheet with a box showing
  where you're zoomed in; click or drag it to jump there. Toggle on/off.
- **Scope:** New `src/components/canvas/MiniMapOverlay.tsx` (plain HTML/CSS, NOT
  Konva): an `<img src={baseImageUrl}>` thumbnail + an absolutely-positioned
  rectangle from `visibleBoundingBox`; click/drag computes a new `stagePosition`
  (reuse `animateViewport` for click, direct set for drag). New pure
  `src/utils/minimapMath.ts` (+ test) for the two projections. Add `showMiniMap` to
  `MapSettings`; render `<MiniMapOverlay/>` in `FloorplanCanvas` (bottom-right,
  z-above canvas, below modals) when on. Add the toggle to BOTH toolbars and a
  checkbox in `SettingsMenu`. Apply the native-wheel-isolation pattern (AGENTS.md
  §3) so scrolling/zooming over the mini-map doesn't pan the main canvas.
- **Files:** new `MiniMapOverlay.tsx` + `minimapMath.ts`(+test);
  `src/store/useSettingsStore.ts`; `src/components/FloorplanCanvas.tsx`;
  `src/components/MapHorizontalToolbar.tsx`; `src/components/workbench/WorkbenchTracerToolbar.tsx`;
  `src/components/SettingsMenu.tsx`.
- **Approval gates:** none beyond standing.
- **Exit criteria:** typecheck + test + build green · `minimapMath` tests pass ·
  live `dev:3010`: toggle works in BOTH canvases; the viewport box tracks pan + zoom
  live; click and drag recenter correctly; bottom-right placement doesn't collide
  with toolbar/legend/dock; wheel over the mini-map doesn't move the main canvas ·
  verify-feature.

## Hard guardrails (AGENTS.md — do not violate)
- **Persisted state via `useHydratedStore`** for every new `mapSettings` field —
  prevents hydration mismatch (§2). Keep the `showMagnifier` force-OFF-on-rehydrate
  `merge` (§2 persist) — without it the loupe silently disables snapping each session.
- **Do NOT put class instances in the TanStack/IDB Query cache** (§6) — the loupe's
  `Worker`/`ImageBitmap`/`RBush` live in component state/refs, never in Query cache.
  `mapSettings` persists to `localStorage` (Zustand persist), which is fine.
- **Zustand typing** (§6): extend the `MapSettings` interface explicitly; no `any`,
  prefer `unknown` + narrowing. New files are `.ts/.tsx`.
- **Don't bloat `FloorplanCanvas`** (§3): keep each overlay its own component
  (`CrosshairOverlay`, `LoupeOverlay`, `MiniMapOverlay`); the canvas only wires them.
- **Snapping stays in `getSnappedCoordinate`** (§5) — extend, never fork the math.
- **Native event isolation** for the mini-map HTML overlay (§3): attach a `useRef`
  native `wheel` listener with `stopPropagation` + `overscroll-contain` so it can't
  zoom/pan the Konva stage.
- Frontend-only: no `status_logs`, no `progressAnalytics`, no `mapDisplayStatuses`
  recolor, no offline-queue, no RLS/auth — none are touched here.

## Open decisions
- None load-bearing remain. Minor, deferrable to build time: exact mini-map default
  size (suggest ~160×120 px scaled to sheet aspect) and whether the magnifier/
  mini-map toolbar buttons should be pinnable via `mapSettings.pinnedTools` or fixed
  — default to fixed buttons next to the existing snap/crosshair controls.
```
