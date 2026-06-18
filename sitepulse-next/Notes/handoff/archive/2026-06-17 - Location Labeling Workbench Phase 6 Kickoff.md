# Kickoff — Location Labeling Workbench, Phase 6: Workbench tracing (reuse the canvas to bank labels)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 6 of the Location Labeling Workbench** (open a Drawing-Library drawing into a tracing view that reuses the existing `FloorplanCanvas` to bank location labels). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-17 - Location Labeling Workbench Phase 6 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` (Phase 6)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Reuse the existing canvas / PDF / snapping / taxonomy pipeline **unchanged** (no `main.py` changes; do NOT fork `FloorplanCanvas` or `progressAnalytics`). Build **only Phase 6** — tracing + label create. **No** standard-enforcing naming rules, label metadata toggles (`spans_levels`/`has_void`), or Definition-of-Done/review UX — those are Phase 7. Don't commit or push until I say "Approved."

---

> Context for the session (everything below is the detail the launch prompt points at). Self-contained: read this, then the files it names, then build.
> **✅ PHASES 1–5 ARE DONE.** Phase 5 (the "New drawing" PDF-ingest action + per-sheet `workbench_sheets` metadata capture) shipped on branch `claude/workbench-phase5-pdf-ingest` (commit `dc6f44c`, 2026-06-17) and was verified live end-to-end. The schema (Phase 3: `projects.kind`, `workbench_sheets` + RLS, `units.spans_levels`/`level_note`/`has_void`) is on prod. The hidden `kind='workbench'` container exists in prod (`1a0b0343-29ab-400f-a498-12c62d11df42`, "Drawing Library") with **one real drawing already in it** — `8ae5a09f-6459-49cd-bebe-fbce4776fc10` ("Verification Drawing — L2") — so you have a real drawing to open and trace immediately.
> **Branch off `main`.** Small reviewable commits; `typecheck` + `test` before each. Do NOT commit/push until the owner says "Approved."

## What you're building
**Phase 6 of the Location Labeling Workbench plan** — make a Drawing-Library card **openable into a tracing view**. The view mounts the **reused, unchanged `FloorplanCanvas`** on the workbench sheet, and wires its `onPolygonComplete` to the **existing** naming popover + taxonomy picker so the team can trace polygons and bank labels (`units` rows) under the hidden container — using the **same online create path the live app uses** (`useCreateUnit(sheetId)`), setting `unit_type` = chosen sub-type name + `top_level_role` + `subtype_id` + `computed_area`. The picker is fed the **sheet's** `sheet_project_type` (per-drawing, from Phase 5's sidecar), **not** a project-level type. **No status/schedule/sync UI, no bulk dock** — the workbench never mounts those. **No naming-standard enforcement / label-metadata toggles / Definition-of-Done review** — that's Phase 7.

## Required reading (in order, fresh — do not trust line numbers; they drift)
1. `sitepulse-next/AGENTS.md` — especially **§2** (data via TanStack hooks; floating UI/modals in Zustand; online-first writes; do NOT touch the offline `pendingChanges` queue or `status_logs`/`status_audit_log`; RLS posture), **§3** (the React-Konva canvas: native-event isolation; **never recolor `mapDisplayStatuses`**; **`progressAnalytics` is the single source of truth — do not fork**), **§4** (Location Taxonomy: `unit_type` is KEPT and applicability keys on it; `top_level_role` is the single source of truth for role; sub-type write rules), **§5** (the PDF/vector/snapping pipeline you reuse — off-main-thread render, versioned public URLs; you are NOT changing it), **§6** (TS guardrails: new files `.ts`/`.tsx`, derive types from `database.types.ts`, no `any`), **§7** (backend auth — do NOT touch `main.py`).
2. `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` — read **§ Locked product decisions**, **§ Data model → "The load-bearing coupling — DO NOT break it"**, **§ Build-on inventory**, **Phase 6** in full, and **§ Open decisions** (note the **"Container query robustness"** follow-up surfaced in Phase 5 — see Guardrails below). (Phase 7 is NOT in scope.)
3. **The code you're extending/reusing, fresh:**
   - `src/components/FloorplanCanvas.tsx` — **reuse as-is.** It reads `activeSheetId` from `useMapStore` and `useUnits(activeSheetId)` internally; it takes `activeStatuses`/`rawStatuses`/`applicabilityIndex` as **props — pass empty** (`[]`/`[]`/undefined) for the workbench. `onPolygonComplete` is the trace entry point. Do NOT fork it.
   - `src/hooks/useMapActions.ts` — `handlePolygonComplete`, `saveNewUnitFromPopover`, `resolveTaxonomy`: the create-label flow. **Prefer a slim workbench-scoped wrapper over forking the whole hook** (it is bound to `useMapStore`/`useUIStore` + status writes you must NOT trigger). Reuse only the polygon→popover→`useCreateUnit` path.
   - `src/components/UnitNamingPopover.jsx` + `src/components/TaxonomyPicker.tsx` + `src/utils/subtypes.ts` (`taxonomyResultToUnitFields`, `orderedSubtypesByRole`) + `src/hooks/useSubtypes.ts` — the label naming + role/sub-type picker. Feed it the **sheet's** `sheet_project_type` so the pick-list scopes correctly (Phase 5 stored it on `workbench_sheets`; read it via `useWorkbenchSheets`).
   - `src/hooks/useProjectQueries.ts` — `useUnits(sheetId)`, `useCreateUnit(sheetId)` (mirror the live create exactly: `unit_type` = sub-type name, `top_level_role`, `subtype_id`, `computed_area`, `polygon_coordinates`), `useSnappingVectors`.
   - **Phase 4/5 workbench layer** — `src/hooks/useWorkbench.ts` (`useWorkbenchContainer`, `useWorkbenchSheets`), `src/hooks/useWorkbenchActions.ts` (`useCreateWorkbenchDrawing` + the **write-site `kind='workbench'` guard** — mirror that guard for any new workbench write), `src/store/useWorkbenchStore.ts` (floating UI → Zustand; add the tracing-view open/active-drawing state here), `src/app/workbench/page.tsx` (the library + `DrawingCard` — add the "open into tracing" affordance).

## Files this phase will likely touch (verify against the live tree first)
- **NEW** a workbench **tracing view** (e.g. `src/components/workbench/WorkbenchTracer.tsx` and/or a sub-route like `src/app/workbench/[sheetId]/page.tsx`) that mounts `FloorplanCanvas` for the chosen workbench sheet and hosts the naming popover. Decide route-vs-overlay; a dedicated sub-route is cleaner for a full zoom/pan canvas (a modal can't host it — same reason the workbench is a page, not a modal).
- **NEW** a slim workbench create-label path — extend `src/hooks/useWorkbenchActions.ts` (e.g. `useCreateWorkbenchLabel(sheetId)`) that calls `useCreateUnit(sheetId)`'s mutation with the taxonomy-derived fields, invalidating `queryKeys.units(sheetId)` **only** (never any live/all-project rollup key; a workbench label must never reach `progressAnalytics`).
- **EDIT** `src/store/useWorkbenchStore.ts` — add the tracing-view state (active sheet id / open flag) with an explicit interface (per §2/§6).
- **EDIT** `src/app/workbench/page.tsx` — make `DrawingCard` open the tracer for that sheet.
- **REUSE UNCHANGED:** `FloorplanCanvas`, the PDF render worker, the snapping engine, the taxonomy pickers, `useCreateUnit`. **No `main.py` changes.**

## How it should behave
- In the Drawing Library, opening a drawing mounts a tracing canvas showing that sheet's converted PDF (the Phase-5 `base_image_url` preview as the instant placeholder; pdf.js sharpening as usual) with snapping working when `vector_quality='clean'`.
- Tracing a polygon opens the **existing** naming popover; the role/sub-type picker is scoped by the **sheet's** `sheet_project_type`. Saving banks a `units` row under the hidden container (`unit_type` = sub-type name + `top_level_role` + `subtype_id` + `computed_area`), exactly like the live create flow.
- Labels persist and reload. The live app is **completely unaffected**; no `status_logs`/`status_audit_log` rows are written; the workbench sheet/labels never appear on the Projects Dashboard or in any progress rollup.

## Guardrails (must not violate)
- **Reuse the canvas/snapping/taxonomy pipeline unchanged** — do NOT fork `FloorplanCanvas`, `useMapActions` wholesale, `progressAnalytics`, `bottleneck`, or `mapDisplayStatuses`. No `main.py` changes; do not touch the JWKS-ES256 auth path (§7).
- **Online-first create via `useCreateUnit`** — NOT the offline `pendingChanges` queue; **never** write `status_logs`/`status_audit_log`; never mount the field/status/schedule/bulk/sync UI.
- **Stay scoped to the container** — labels are `units` under workbench sheets; invalidate only the workbench/`units(sheetId)` keys, never an all-project/rollup key. A workbench label must never enter a live surface or `progressAnalytics`.
- **Carry over Phase 5's write-site contamination guard** — any new workbench write should verify it is operating on a `kind='workbench'` sheet/container (the container read hook is `staleTime:Infinity` + IDB-persisted and CAN serve a stale/wrong container — Phase 5 found it pointing at a live project). **Recommended:** also do the small Phase-5 "Open decision" hardening here — make `useWorkbenchContainer` re-resolve via the route when the cached project is missing or not `kind='workbench'`, so reads self-correct too.
- **`unit_type` stays** (applicability keys on it) — set it to the chosen sub-type name, like the live flow. Store only the canonical `top_level_role`; display labels are presentation-only (§4).
- **Floating UI in Zustand** (explicit interface); **types** derive from `database.types.ts`; narrow `polygon_coordinates` JSONB at the boundary with `isPercentPointArray` (§6); no `any`; new files `.ts`/`.tsx`.

## Verify before closing (exit criteria)
Run with the absolute `--prefix` (cwd persists in Bash; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Then a **live `npm run dev:3010`** (from `sitepulse-next/`, port 3010) click-through:
- Open the existing test drawing (`8ae5a09f…`, "Verification Drawing — L2") from the library → a tracing canvas mounts on that sheet.
- Trace 2–3 locations; for each, name it + pick a role + sub-type (tag one `Other (pending)`); labels persist and survive a reload.
- The live app is unaffected; the workbench sheet/labels do **not** appear on the Projects Dashboard, and **no** `status_logs` are written (spot-check the DB).
- No status/schedule/sync/bulk controls anywhere in the tracing view.

> ⚠️ The live verification writes **real** `units` rows under the hidden container (the intended, additive, hidden behavior). Tell the owner what you created; the labels cascade-delete with their sheet (mirrors `handleDeleteSheet`). Note: a real workbench container + a test drawing already exist from Phase 5 — reuse them; do not create duplicates.

Close the phase with the **verify-feature** skill (Definition of Done → stop). **Do not commit or push until the owner says "Approved."**

## Scope discipline
This session builds **only Phase 6** — the tracing view + label create via the reused canvas/taxonomy. Do **NOT** build the standard-enforcing naming rules (trim/uniqueness/auto-increment), the `spans_levels`/`level_note`/`has_void` label-metadata toggles, interior-face guidance, or the Definition-of-Done/second-person review lifecycle (`review_state` on `workbench_sheets`) — those are **Phase 7** (`workbenchNaming.ts` pure logic + popover wiring). If a slice grows past one session, split it and write a fresh kickoff.
