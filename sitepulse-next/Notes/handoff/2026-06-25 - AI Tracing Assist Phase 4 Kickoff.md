# Kickoff — AI Tracing Assist, Phase 4: door/window openings (jamb-to-jamb capture)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of AI Tracing Assist** (**door/window openings**: a fast jamb-to-jamb line tool that captures each opening on a sheet — `door` / `window` / `cased_opening` — as verified training data and the geometry that will later auto-close rooms). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-25 - AI Tracing Assist Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (§ Phase 4 + annotation tool #4 + the "Open decisions" on opening cadence)
> - `sitepulse-next/AGENTS.md`
>
> Work on branch `claude/ai-location-tracing-pipeline-ip709o` (Phases 1–3c + the gridline-editing follow-up are merged to `main`; branch == `main`). **This slice REINTRODUCES an approval-gated migration** (`sheet_openings`) — present the SQL via the `create-migration` skill and **STOP for owner approval before applying**. Verify with the live `dev:3010` click-through, then close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**

---

## What this slice delivers (plain English)
On a sheet, the tracer can mark each **door / window / cased opening** by dragging a short line **jamb to jamb** (across the gap, NOT the swing arc, NOT a box) and tagging its type. Like the gridline tool, the app *proposes* nothing here — the human draws the line and picks the type — but each confirmed opening is banked as clean, multi-task training data. Openings are the geometry that later lets the model **auto-close rooms** (walls + doors → seal the gaps) and they sharpen the dataset. This is a **subset-of-sheets** layer (the manual trace already closes rooms today), so the UI should make it easy to mark a sheet "done for openings" without forcing it on every sheet.

## Why this is the same shape as 3b (reuse, don't reinvent)
Phase 3b's gridline annotator already built almost the entire pattern: a **session flag** in `useWorkbenchStore`, a **line-drag** capture (`capture_line` ToolMode + `onCaptureLine` on `FloorplanCanvas`, endpoints snapped via `getSnappedCoordinate`), a **pending list → "accept all"** bulk-confirm, a **1:1 JSONB array** table (`sheet_gridlines`) with M1 provenance + frozen suggested, a **side panel** controller, and a **canvas overlay**. Phase 4 is the SAME machine with a different payload (`{p1,p2,type,swing?}`) and a type tag instead of a label. Copy the gridline files as the template; do not fork a new capture mechanism.

## How it should work (build sketch — confirm against the real files)
- **Data model:** `sheet_openings` — 1:1 by `sheet_id`, `openings JSONB NOT NULL DEFAULT '[]'` = `[{ p1, p2, type:'door'|'window'|'cased_opening', swing? }]` in the SAME percent space as `sheet_gridlines`. Mirror `20260625_sheet_gridlines.sql` exactly: PK=FK `sheets` CASCADE, M1 provenance cols (`source`/`model_version`/`review_status`/`spec_version`, + frozen `suggested_openings` if a proposal layer is ever added — for now human-drawn, so `source` will usually be `human`), RLS mirrors `sheet_gridlines` (read = member, write = owner/admin/pm; CLIENT-written so the privileged-write RLS is load-bearing — the workbench user is admin ✓).
- **Capture:** reuse the `capture_line` line-drag (jamb-to-jamb), routed by a new `isOpeningOpen` session flag the way `isGridlineOpen` routes `capture_box`/`capture_line`. **Snapping:** jamb endpoints should snap to wall-vector ends (reuse `snapPoint` / `getSnappedCoordinate`) so the opening line locks to the real jambs. (Grid-aware snapping from 3c is irrelevant here — openings sit ON walls, so plain vector snapping is right; do NOT pass `gridAware`.)
- **Type tag:** each captured opening carries `door | window | cased_opening`. Settle WHERE the tag is set (see decisions). A sensible default: the toolbar/panel holds the *active* opening type (a 3-way segmented control), the line-drag stamps that type, and each pending row can re-tag before "accept all".
- **Pure logic (`src/utils/openingParse.ts` + vitest):** the pending→row "accept all" mapping (APPEND onto saved, like `mapPendingGridlinesToRow`), the type-tag normalization, and any swing-direction derivation. Keep it pure/deterministic; mirror `gridlineParse.ts`.
- **Hooks/UI:** `useSheetOpenings` (read + upsert, narrow the JSONB at the query boundary via a new `isOpeningArray` guard in `domain.ts`), an `OpeningsPanel` (session controller: active type, pending list with per-row re-tag + remove, "accept all", saved-management like the gridline editing follow-up), an `OpeningOverlay` (saved = solid, pending = dashed; color/icon per type), opening state in `useWorkbenchStore`. A toolbar button (mutually exclusive with the title-block + gridline sessions, like they are with each other).
- **Provenance:** accept banks provenance on the `sheet_openings` row itself (like the title block + gridlines — `trace_events` stays room/polygon-shaped, so opening rejects are NOT logged). Confirmed openings → `review_status:'confirmed'`.

## Decisions to settle early (flag, don't silently solve)
- **Opening cadence UI** (the plan's open decision) — how the sheet signals it's in the openings subset. Options: a per-sheet "openings captured" flag/boolean (new `workbench_sheets`/`sheets` column → another migration), vs. infer "done" from `sheet_openings` existing, vs. a library badge. **Recommend** the lightest thing first (presence of a saved `sheet_openings` row = "has openings"), and only add a real flag if the owner wants an explicit "this sheet is in the subset / N to go" signal. Settle before building the cadence UI.
- **Type-tag interaction** — set the type BEFORE the drag (active-type segmented control) vs. AFTER (a popover per opening). Recommend active-type-before (faster for runs of same-type openings) + per-row re-tag in the panel. Confirm.
- **Swing direction** — capture it now (optional tag: which side/way the door swings) or defer? The plan calls swing "decorative for our purposes (optional swing-direction tag only)." **Recommend defer** swing to keep the tool fast; leave `swing?` optional in the schema so it can be added without a migration. Flag it.
- **Interior + exterior** — the plan wants both captured; confirm the tool doesn't distinguish them geometrically (same line-drag), only by where the human draws.
- **capture_line reuse vs. a new ToolMode** — reuse `capture_line` routed by `isOpeningOpen` (no new ToolMode) the way 3b reused `capture_box`. Confirm there's no conflict when both a gridline and an openings session could be open (they should be mutually exclusive, like title-block vs. gridlines today).

## Deferred (explicitly NOT in Phase 4)
- **Auto-close rooms** (walls + door openings → seal gaps). Openings are the *input* to that; wiring the closer is later (and gated on whether layered/opening coverage is worth it — see Phase 3.5/7).
- **A proposal layer for openings** (machine-suggested openings). Phase 4 is human-drawn; `suggested_openings` can stay null/empty until a detector exists.
- **Phase 3.5 CAD-layer extraction** (the "Aldi jackpot" — `A-Door*`/`A-Glaz` layers auto-populate openings). Orthogonal backend path, layered sheets only; gated on need. If the owner would rather do that next, it supersedes hand-capture for layered sheets.

## Hard guardrails (AGENTS.md) — same as 3a/3b
- §2: all session/tool/overlay/pending state in `useWorkbenchStore` (Zustand), never `useState`/`useEffect` for data; never touch the `pendingChanges` offline queue; accepted writes go through the Query mutation hook, not raw inserts. Opening capture is **online-only** (like the other proposals).
- §4/§6: reflect the new table in `database.types.ts` (hand-maintained — it drifts; see the schema-types-drift note) + derive domain types in `domain.ts`; narrow the JSONB at the query boundary (`isOpeningArray`), no `Json` in props.
- §3: overlay uses native-event isolation if it mounts HTML; never recolor `mapDisplayStatuses`.
- §5: the new cache follows the `sheet_vectors`/`sheet_gridlines` write-through pattern; no class instances in the Query cache.
- §7: no backend in this slice (frontend-pure over the canvas line-drag, like 3a/3b) — unless the type/swing needs an extract endpoint, which it does not.
- ⛔ **Migration gate:** `sheet_openings` SQL via the `create-migration` skill → STOP for owner approval → apply to prod only on go-ahead. Mirror `sheet_gridlines` RLS exactly.

## Exit criteria (then stop)
- `npm run typecheck` green · `npm run test` green (new vitest: opening accept-all mapping + type normalization + any swing/geometry helper — boundary cases) · `npm run build` green.
- **Live `dev:3010` click-through:** open the openings tool, mark a few **interior + exterior** openings on a real sheet (each snapped jamb-to-jamb, typed), "accept all" writes the `sheet_openings` row with correct provenance under RLS, reload redraws them; the saved-management (re-tag / move / delete, mirroring the gridline-editing follow-up) works; then **delete the test row** so prod is left clean. **Do NOT touch sheet 93064259's real grids** or any real captured data.
- Migration applied only after owner approval. Close with `verify-feature`, then STOP. **Do not commit or push until the owner says "Approved."** On approval, fast-forward `main`, then draft the **Phase 5** (detail callouts) kickoff — or **Phase 3.5** (CAD-layer extraction) if the owner reprioritizes — and paste its launch prompt.
