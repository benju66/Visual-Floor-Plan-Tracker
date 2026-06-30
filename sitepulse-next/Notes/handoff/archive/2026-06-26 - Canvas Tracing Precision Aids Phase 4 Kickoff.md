# Kickoff — Canvas Tracing Precision Aids, Phase 4: magnifier shows the trace line + placed nodes

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of Canvas Tracing Precision Aids** (the magnifier lens shows your in-progress dashed trace line + placed nodes + snap ring, not just the bare PDF). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-26 - Canvas Tracing Precision Aids Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Canvas-Tracing-Precision-Aids-Plan.md` (Phase 4 + the Phase 1/3 OUTCOME/STATUS notes)
> - `sitepulse-next/AGENTS.md` (§3 canvas, §5 snapping/PDF pipeline)
>
> Phase 3 (the magnifier) is already shipped and committed (`1dce1e0`) — Phase 4 builds directly on it. Branch off `main` (or stack on `feat/canvas-precision-aids-phase1` if it hasn't merged yet — confirm with me). Build **only Phase 4**. Don't commit or push until I say "Approved."

---

## What this phase delivers
Right now, when the magnifier lens is up in trace mode, its **sharp** path renders only
the pdf.js crop of the drawing — so your dashed guide line, the points you've already
placed, and the pink snap ring all **vanish inside the lens**. You're magnified but
flying blind. This phase composites the Konva overlay layer on top of the sharp crop so
you see the PDF detail AND your trace together, crisply. Plain-English: "while tracing
with the magnifier up, you can see the line you're drawing and the dots you've placed
*inside* the lens, on top of the zoomed-in drawing."

## Why it's the right next phase
It's the natural completion of the magnifier you just approved — the lens is only half
useful for tracing until it shows what you're drawing. It depends on Phase 3 (now done)
and nothing else.

## Root cause (already diagnosed)
`LoupeOverlay`'s two image paths behave differently:
- **Soft fallback** (`stage.toCanvas(...)`) captures the WHOLE stage, so it already
  shows the Konva overlays — but it's a soft upscale.
- **Sharp path** (`ctx.drawImage(patch.bitmap, ...)`) draws ONLY the pdf.js PDF crop —
  no Konva vectors. That's the gap.

Fix: after drawing the sharp PDF patch, composite the **interactive-overlays Konva
layer** (the 3rd `<Layer>`, which contains `DraftPolygon` = trace line + nodes + snap
ring) for the same screen region on top. It's transparent everywhere except the trace,
so you get PDF detail + crisp line/nodes/ring together.

## Required reading (re-read fresh — do not trust line numbers)
1. `src/components/canvas/LoupeOverlay.tsx` — the `draw()` routine; the `covered` sharp
   branch (`ctx.drawImage(p.bitmap, ...)`) is where the composite goes. Note it already
   has `stageRef` and computes `coverage` (the lens's page region) + the lens screen box.
2. `src/components/FloorplanCanvas.tsx` — the THREE `<Layer>`s in render order:
   (1) PDF base, (2) unit polygons, (3) interactive overlays incl. `<DraftPolygon>`
   (currently around the `<Layer>` near the `toolMode === 'draw'` / `CaptureBoxOverlay` /
   `MiniMap`-less block ~line 1748). The 3rd layer is the one to ref.
3. `src/components/canvas/DraftPolygon.tsx` — confirms what lives in that layer (trace
   line, placed nodes, the polished snap ring).

## Scope (Phase 4 only)
- `src/components/FloorplanCanvas.tsx`: add a `useRef` to the **3rd (overlay) `<Layer>`**
  (`ref={overlayLayerRef}`) and pass `overlayLayerRef` into `<LoupeOverlay>` as a new
  prop. ~2 lines + the prop.
- `src/components/canvas/LoupeOverlay.tsx`: accept the optional `overlayLayerRef` prop;
  in the **sharp branch only**, after `ctx.drawImage(p.bitmap, ...)`, composite the
  overlay layer for the lens's screen region on top:
  `overlayLayerRef.current?.toCanvas({ x, y, width, height, pixelRatio })` where
  `x/y/width/height` is the **lens source box in screen px** (centered on the cursor,
  `size / magnification` across — the same `srcCss` box the soft path already uses), and
  `pixelRatio = magnification * dpr`. Draw that returned canvas over the full lens
  canvas (`drawImage(cap, 0, 0, canvas.width, canvas.height)`). Guard for when the ref /
  region is unavailable (skip the composite, keep the sharp PDF). Keep it inside the same
  per-frame `draw()` so it tracks the cursor with zero React re-render (AGENTS.md §3).
- Consider doing the same composite on the SOFT path only if it regresses (it already
  shows overlays via full-stage capture — likely leave it).

## Out of scope
- Phase 2 (crosshair styles) and Phase 5 (mini-map). Do not start them.
- No new snapping math, no DB/backend, no settings fields. Pure rendering composite.

## Guardrails
- Zero-re-render overlays: do the composite in the existing ref-driven `draw()` loop;
  do not add React state or re-subscribe per frame (AGENTS.md §3).
- Don't bloat `FloorplanCanvas` — the composite logic lives in `LoupeOverlay`, the
  canvas only hands it the layer ref.
- `toCanvas` on a Konva layer is synchronous and cheap for a small region, but only
  call it on the sharp path (when a patch covers the lens), not every frame on the soft
  path, to avoid doubling work.
- No `any` for the new prop — type it as `React.RefObject<Konva.Layer | null>` (or the
  project's existing Konva layer ref type; match how `stageRef` is typed).

## Exit criteria (Definition of Done → then STOP)
Run with an absolute prefix (a stray `cd` triggers a prompt):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- typecheck + full test run + build all green (lint is NOT a gate).
- Live `dev:3010` in BOTH canvases: with the magnifier up in draw mode, the dashed line
  + placed nodes + pink snap ring appear in the lens over the sharp PDF crop; no flicker
  on a still cursor; raster-only sheet still falls back cleanly.
- Close with the **verify-feature** skill. Do NOT commit or push until the owner says
  "Approved."
