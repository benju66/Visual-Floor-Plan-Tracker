# Kickoff — AI Tracing Assist, Phase 3c: grid-aware snapping (confirmed grids clean up the snap)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3c of AI Tracing Assist** (**grid-aware snapping**: use the gridlines a user already confirmed on a sheet to stop the snapping magnet from grabbing grid lines, so tracing prefers real walls — fixing the "heavy lines are grids, not walls" annoyance. **Frontend-pure: no new table, no backend, no migration.**). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-25 - AI Tracing Assist Phase 3c Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (§ "Smart layer — per-set calibration" — note the design pivot in this kickoff)
> - `sitepulse-next/AGENTS.md`
>
> Work on branch `claude/ai-location-tracing-pipeline-ip709o` (Phase 3b is merged to `main`; branch == `main`). **No approval-gated migration this slice** (frontend-pure, like Phase 2) — but still STOP and present before any commit/push. Verify with the live `dev:3010` click-through, then close with the `verify-feature` skill.

---

## ⚠️ Design pivot (read this — the plan's original Phase 3c was reshaped)
The plan's § "Smart layer" framed Phase 3c as a **per-set `drawing_set_profile`** that learns a firm's grid/wall **lineweight+color** signature on sheet 1 and tunes snapping on sheets 2..N. After review (2026-06-25) we **simplified to the design below**, for three reasons:
1. **Gridlines are captured on *every* sheet** (the plan's own cadence), so we already KNOW each sheet's grid lines from `sheet_gridlines` (Phase 3b). We never need to *recognize* grids by their lineweight — the human already pointed them out. The lineweight/color signature is redundant for the snapping fix.
2. **The trained model (M3) is the real adaptive layer** — the plan calls calibration "the bridge." A hand-tuned per-set calibration engine is partly throwaway once the model lands; don't over-invest.
3. **Lineweight/color is re-derivable** — the PDFs are owned and extraction is deterministic, so capturing stroke attributes can be a one-batch enrichment whenever the model needs it. Deferring loses nothing permanent.

**Therefore:** Phase 3c = **grid-aware snapping** (frontend-pure, uses confirmed grid geometry we already store). The `drawing_set_profile` table and the backend **stroke-attribute (lineweight/color) extraction are DEFERRED** and re-homed under model/dataset work — see "Deferred" below. Do NOT build them in this slice.

## What this slice delivers (plain English)
When you've confirmed a sheet's gridlines (Phase 3b), the snapping magnet should stop snapping your cursor to those grid lines and prefer the actual walls. This slice reads the confirmed grids and teaches the existing snapping engine to **de-prioritize grid lines**, so tracing on grid-heavy sets (e.g. Project A) gets noticeably cleaner — with a toggle to turn it off.

## How it should work (build sketch — confirm against the real files)
- Read the active sheet's confirmed grids with **`useSheetGridlines(sheetId)`** (exists, Phase 3b) — `[{label, p1, p2, axis}]` in percent space.
- A **pure classifier** (new `src/utils/gridAwareSnap.ts` + vitest): given the `SnappingVectorLine[]` and the confirmed grid lines, tag each vector that is **collinear with + overlapping** a confirmed grid line (aspect-corrected distance, like `getSnappedCoordinate`). Keep it pure/deterministic.
- Feed that into snapping. **Decision to settle (flag):** *down-weight* grid-collinear vectors vs *remove* them. **Recommend down-weight** — a wall that runs ALONG a grid line must still snap; only prefer a non-grid vector when one is within range, else fall back to the grid vector. This likely means `getSnappedCoordinate` (in `src/utils/geometry.ts`) gains an optional per-item "isGrid" penalty (or a two-pass walls-first search). Removing grid vectors outright is simpler but kills legitimate wall-on-grid snaps — call it out.
- Build the classification where the **RBush `vectorTree` is instantiated** in `FloorplanCanvas` (the deferred `useState` + `useEffect(setTimeout(10))` block, AGENTS.md §5) — keep raw JSON in the Query cache, never the tagged tree.
- **Workbench-only:** confirmed grids only exist for workbench sheets; gate this like `onCaptureBox`/`gridlineOverlays` (the live map passes nothing → inert).
- **Toggle:** a `mapSettings.gridAwareSnapping` flag (mirror `enableSnapping`/`smoothWheelZoom` in `useSettingsStore`), default on, surfaced in `WorkbenchTracerToolbar`. A gentle "snapping tuned to N confirmed grids" affordance is optional.

## Decisions to settle early (flag, don't silently solve)
- **Down-weight vs remove grid-collinear vectors** — recommend down-weight (protect walls-on-grid). Settle the exact penalty / two-pass shape.
- **Collinearity tolerance** — how close (aspect-corrected) a vector must sit to a confirmed grid line to count as grid, and whether span-overlap is required. Pick a sane default; unit-test boundary cases.
- **Toggle home + default** — `mapSettings.gridAwareSnapping` default on; confirm it reads via `useHydratedStore` (hydration-safe) like the other map settings.

## Deferred (explicitly NOT in 3c — re-homed under model/dataset work)
- **`drawing_set_profile` table + per-set (per-firm) calibration.** Only worth building if cross-sheet auto-recognition proves needed despite per-sheet grid capture. Gated on need.
- **Backend stroke-attribute (lineweight/color) extraction** (`get_drawings()` exposes per-path `width`/`color`; current `extract_vectors_from_pdf` discards them). Re-home as a **dataset-enrichment batch** for the model — a model FEATURE, re-runnable over the owned corpus anytime, NOT a snapping prerequisite. Add it when the M3 dataset assembly calls for it, with its own migration/backend gate.

## Hard guardrails (AGENTS.md) — same as 3a/3b
- §2 toggle/UI state in the appropriate store (`useSettingsStore.mapSettings` for the persisted flag); reads via Query hooks; never `pendingChanges`.
- §3 nothing recolors `mapDisplayStatuses`; no canvas-event regressions; the change is to snap candidate weighting, not rendering.
- §5 keep raw JSON (`SnappingVectorLine[]`) in the Query cache — the tagged/penalized structure is derived inside the deferred RBush effect, never cached.
- §6 no new JSONB/types beyond reading the existing `Gridline[]`; keep the classifier pure + typed.
- **No backend, no migration** this slice (frontend-pure, Phase-2 precedent).

## Exit criteria (then stop)
- `npm run typecheck` green · `npm run test` green (new vitest: the grid-collinear classifier + the down-weight/penalty mapping — boundary cases: a wall ON a grid still snaps; a pure grid line is de-prioritized) · `npm run build` green.
- **Live `dev:3010` click-through** (the real gate): on a sheet with confirmed grids, trace near a grid line that's NOT a wall → the cursor snaps to the wall, not the grid; toggle grid-aware snapping OFF → prior behavior returns; a wall coincident with a grid still snaps. No regression on a sheet with no confirmed grids.
- No migration gate, no backend gate this slice. Close with `verify-feature`, then STOP. **Do not commit or push until the owner says "Approved."** On approval, fast-forward `main`, then draft the **Phase 4** (door/window openings) kickoff and paste its launch prompt.
