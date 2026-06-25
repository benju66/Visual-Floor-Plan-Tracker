# Kickoff — AI Tracing Assist, Phase 3b: gridlines (two-part annotator) + "accept all"

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3b of AI Tracing Assist** (the **gridline** annotator: a two-part "app proposes → human confirms" tool — (a) box a grid **bubble** to read its label ("A"/"1") from the sheet text, (b) drag the **axis line** across the grid line and snap it to the long straight vector — plus an **"accept all"** bulk-confirm; persisted to a new `sheet_gridlines` table). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-25 - AI Tracing Assist Phase 3b Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (Phase 3 + Annotation tool #3 gridlines + Data model + Build-on inventory)
> - `sitepulse-next/AGENTS.md`
>
> Work on branch `claude/ai-location-tracing-pipeline-ip709o` (Phase 3a is merged to `main`; branch == `main`). ⛔ **This slice has an approval-gated DB migration** (`sheet_gridlines`) — present the SQL via the `create-migration` skill and **STOP for owner approval before applying**. Don't commit or push until I say "Approved." Verify with the live `dev:3010` click-through, then close with the `verify-feature` skill.

---

## Context for the session

### Where we are (don't rebuild this — 3a shipped)
Phase 3a shipped the **proposal→overlay→accept/edit framework on the shared canvas** and the **title-block reader**. Reuse its patterns verbatim — 3b is the same shape with a line tool added:
- **`'capture_box'` ToolMode** on the shared `useMapStore` + the optional **`onCaptureBox(rect)`** prop on `FloorplanCanvas` + **`CaptureBoxOverlay`** (violet rubber-band). The grid **bubble** read REUSES `capture_box` — box the bubble, read the label from `sheet_text` inside the rect. Don't fork a second box tool.
- **`useSheetText(sheetId)`** — cache-first `sheet_text` read (narrowed via `isTextWordArray`). The bubble-label parse reads it, exactly like the title-block parse did.
- **`sheet_metadata`** is the template annotation table: 1:1 by `sheet_id`, RLS mirrors `sheet_text` (read=member; write=owner/admin/pm), M1 provenance columns (`source`/`model_version`/frozen suggestion/`review_status`/`spec_version`), JSONB narrowed at the query boundary with a `domain.ts` guard. `sheet_gridlines` follows it.
- **Floating tool state in `useWorkbenchStore`** (mirror the `titleBlock*` cluster: visibility + the pending list + the active proposal). Pure parse/mapping in `src/utils/*` + vitest (mirror `titleBlockParse.ts`).
- **Capture invariant:** confirmed marks bank provenance on their annotation row (gridlines aren't `units`, so — like the title block — they're **not** logged to the room-shaped `trace_events`; flagged + accepted in 3a).

### What this slice delivers (plain English)
A fast way to record a sheet's structural grid so a clean sheet is a couple of clicks:
1. **Bubble label** — the user boxes a grid bubble; the app reads "A"/"B"/"1"/"2" from the sheet text inside the box (a single short token).
2. **Axis line** — the user drags a line across the grid line; the app **snaps each endpoint to the nearest long straight vector** (`getSnappedCoordinate`, already used for tracing). One grid = `{ label, p1, p2, axis: 'h'|'v' }` in percent space (axis inferred from the line direction).
3. **"Accept all"** — a bulk-confirm so a sheet's worth of proposed grids is one click, not twenty. Each confirmed grid is human-verified ground truth.

Confirming grids also feeds the Phase-3c calibration (grid lineweight/color → subtractable snapping noise) — but **3b only captures grids**; calibration is 3c.

### Required reading (in order)
1. `AGENTS.md` — §2 (tool/overlay/proposal state in `useWorkbenchStore`; accepts via mutation hooks, never `pendingChanges`), §3 (canvas native-event isolation; the line tool renders in the overlay Layer; never recolor `mapDisplayStatuses`), §4/§6 (new table + column in `database.types.ts` + derived in `domain.ts`; **narrow the new JSONB at the query boundary**), §5 (write-through cache pattern; no class instances in Query cache).
2. `AI-Tracing-Assist-Plan.md` — **Annotation tool #3 (gridlines)**, the **Data model** (`sheet_gridlines`), and **Build-on inventory** (`getSnappedCoordinate`, `useSnappingVectors`).

### Re-read these real files before editing (line numbers drift)
- `src/components/FloorplanCanvas.tsx` — copy the `capture_box` plumbing (`onPointerDown`/`onPointerUp` `boxOrigin` branch + the overlay mount) for the new **`capture_line`** tool. The canvas already builds `vectorTree` (RBush) + calls `getSnappedCoordinate` for tracing — reuse it to snap the axis endpoints.
- `src/components/canvas/CaptureBoxOverlay.tsx` — the model for a new `CaptureLineOverlay` (snapped-endpoint preview).
- `src/utils/titleBlockParse.ts` + `.test.ts` — the pure-parse + vitest shape to copy for the bubble-label parse + axis inference + accept-all mapping.
- `src/hooks/useSheetMetadata.ts` — the read+upsert hook shape to copy for `useSheetGridlines`.
- `src/components/workbench/TitleBlockPopover.tsx` + `WorkbenchTracer.tsx` + `WorkbenchTracerToolbar.tsx` — where the tool button, overlay state, and confirm UI mount.
- `src/store/useWorkbenchStore.ts` — add the gridline tool/proposal/pending-list state (mirror the `titleBlock*` cluster).

## Decisions to settle early (flag, don't silently solve)
- **`sheet_gridlines` shape — 1:1 JSONB array vs row-per-grid.** Recommendation: **1:1 by `sheet_id` with `gridlines JSONB` = `[{label,p1,p2,axis}]`** (matches `sheet_vectors`/`sheet_text`; "accept all" is one upsert; per-sheet provenance columns). Surface the SQL before applying.
- **`capture_line` ToolMode vs reuse.** A grid axis is a 2-point line, not a box — recommend a new `'capture_line'` ToolMode + `onCaptureLine(p1,p2)` prop (mirror `capture_box`), endpoints snapped via `getSnappedCoordinate`. Flag if you find a lighter reuse.
- **Axis inference + label↔line pairing.** Axis from `|dx|` vs `|dy|`; pair the most-recent bubble-label read with the next axis drag (or let the popover bind them). Keep the pairing logic pure + unit-tested.
- **Bubble-label parse:** a grid bubble holds ONE short token (letter or number). Pick the single most-central short token in the box; ignore multi-word/long text. Unit-test it.

## Hard guardrails (AGENTS.md) — same as 3a
- §2 state in `useWorkbenchStore`; accepts via Query mutation hooks; never `pendingChanges`.
- §3 overlays in the Konva overlay Layer with native-event isolation; never recolor `mapDisplayStatuses`.
- §4/§6 `sheet_gridlines` in `database.types.ts` (hand-add — [[schema-types-drift]]) + derived in `domain.ts`; narrow the `gridlines` JSONB at the query boundary with a new guard.
- §5 write-through/cache pattern; raw JSON in the Query cache only.
- Frontend-pure (Phase 3 has no backend); the bubble parse reads cached `sheet_text`, the axis snaps off the already-loaded `sheet_vectors`.

## Exit criteria (then stop)
- `npm run typecheck` green · `npm run test` green (new vitest: bubble-label parse + axis inference + **accept-all bulk-confirm mapping**) · `npm run build` green.
- ⛔ **Migration:** `sheet_gridlines` SQL via `create-migration`, STOP for owner approval, apply, then reflect in `database.types.ts` + `domain.ts`.
- **Live `dev:3010` click-through** (the real gate): box a bubble → label reads; drag an axis → snaps to the grid line; confirm a few grids; "accept all"; reload → persists. (Local backend on :8001 needed only for uploads/extraction: `cd sitepulse-backend && ./venv/Scripts/python.exe -m uvicorn main:app --reload --port 8001`.)
- Close with `verify-feature`, then STOP. **Do not commit or push until the owner says "Approved."** On approval, fast-forward `main`, then draft the **Phase 3c** (calibration seed) kickoff and paste its launch prompt.
