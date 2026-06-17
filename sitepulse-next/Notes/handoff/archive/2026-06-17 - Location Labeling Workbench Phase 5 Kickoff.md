# Kickoff — Location Labeling Workbench, Phase 5: PDF ingest + per-sheet metadata capture

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 5 of the Location Labeling Workbench** (PDF ingest + per-sheet metadata capture). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-17 - Location Labeling Workbench Phase 5 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` (Phase 5)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Reuse the existing PDF-upload pipeline **unchanged** (no `main.py` changes). Build **only Phase 5** — no tracing canvas, no status/schedule/sync UI. Don't commit or push until I say "Approved."

---

> Context for the session (everything below is the detail the launch prompt points at). Self-contained: read this, then the files it names, then build.
> **✅ PHASES 1–4 ARE DONE and merged to `main`.** Phase 4 (the `/workbench` shell + the hidden `kind='workbench'` container bootstrap + the dedicated read hooks `src/hooks/useWorkbench.ts` + the empty Drawing Library list + the dashboard contamination guard) merged at **`e205b6f`** (2026-06-17). The Phase 3 schema (`projects.kind`, `workbench_sheets` + RLS, `units.spans_levels`/`level_note`/`has_void`) is applied to prod. The columns + RLS this phase writes already exist — sanity-check with `grep -n "workbench_sheets" src/types/database.types.ts` and `grep -n "WorkbenchSheetInsert" src/types/domain.ts` if unsure.
> **Branch off `main`.** Small reviewable commits; `typecheck` + `test` before each. Do NOT commit/push until the owner says "Approved."

## What you're building
**Phase 5 of the Location Labeling Workbench plan** — make the (currently empty) Drawing Library *fillable*. Add a **"New drawing" action** to the `/workbench` page that: (1) uploads a historical PDF through the **existing, unchanged** floorplan upload pipeline, and (2) captures **per-drawing metadata** into the `workbench_sheets` sidecar (project type, level label, source sheet #, vector quality, partial flag). After upload the drawing appears in the library (the Phase 4 `DrawingCard` already renders its metadata chips), with a server-converted preview — and **still never** appears in the Projects Dashboard. **No tracing canvas, no status/schedule/sync UI, no naming/review workflow** — those are Phases 6–7.

## Required reading (in order, fresh — do not trust line numbers)
1. `sitepulse-next/AGENTS.md` — Especially **§0** (talk to the owner in plain English), **§2** (data fetching via TanStack Query hooks — never `useState`/`useEffect` for DB data; **floating UI state — modals — in Zustand**; online-first writes, do NOT touch the offline `pendingChanges` queue or `status_logs`; RLS posture), **§4** (Location Taxonomy — `unit_type` is kept; `PROJECT_TYPES` is the source of truth), **§5** (the PDF / vector pipeline you're reusing — versioned public `floorplans` bucket, off-main-thread render; you are NOT changing it), **§6** (TS guardrails: new files `.ts`/`.tsx`, derive types from `database.types.ts`, no `any`), **§7** (backend auth — **do NOT touch `main.py`**; `verify_sheet_access` is sheet-scoped via `project_id`).
2. `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` — the plan-of-record. Read **§ Locked product decisions**, **§ Data model → "The load-bearing coupling — DO NOT break it"** (this is *why* the upload works unchanged), **§ Build-on inventory**, and **Phase 5** in full. (Phases 6–7 are NOT in scope.)
3. **The code you're extending, fresh:**
   - `src/hooks/useWorkbench.ts` — the Phase 4 read hooks (`useWorkbenchContainer`, `useWorkbenchSheets`). Your new **create** mutation goes here (or a sibling `useWorkbenchActions.ts`) and must invalidate `queryKeys.workbenchSheets(containerId)`.
   - `src/hooks/useProjectActions.ts` → **`handleAddLevel`** — the canonical upload sequence to mirror (insert `sheets` row → upload via service → write `base_image_url`). **Mirror its shape; do NOT reuse it** — it is bound to `useMapStore`/`useUIStore` and the live project page. Build a slim workbench-scoped version.
   - `src/services/api.ts` → **`uploadFloorplanService(sheetId, file, pdfPageNumber, token)`** — reuse **verbatim/unchanged**. It POSTs to the backend `/upload-floorplan/{sheetId}?page_number=N` and returns `{ base_image_url }`.
   - `src/app/workbench/page.tsx` — the Phase 4 shell. The empty state deliberately has **no** upload button; you add the "New drawing" entry + the capture form here. `DrawingCard` already renders `sheet_name` + chips for `sheet_project_type` / `level_label` / `is_partial`.
   - `src/app/dashboard/page.jsx` (New Project modal) **and** `src/components/SettingsMenu.tsx` (the `activeTab==='data'` `project_type` `<select>`) — **reuse their styling** for the capture form + the 9-type picker. `PROJECT_TYPES` (`src/utils/locationTaxonomy.ts`) is the 9-value list the `workbench_sheets.sheet_project_type` CHECK mirrors.

## Files this phase touches
- **NEW** a workbench **create mutation** — extend `src/hooks/useWorkbench.ts` (or add `src/hooks/useWorkbenchActions.ts`) with e.g. `useCreateWorkbenchDrawing(containerId)`. It mirrors `handleAddLevel`'s sequence but scoped to the container and adds the sidecar write:
  1. `supabase.from('sheets').insert([{ project_id: containerId, sheet_name }]).select().single()` — **client-side**; the existing `sheets` RLS lets privileged members insert, and the Phase 4 bootstrap made the user **`admin`** of the container, so this works **without** service-role. (Only the Phase 4 container bootstrap needs service-role; this does not. Do NOT widen RLS.)
  2. `uploadFloorplanService(sheetId, file, pdfPageNumber, token)` → `{ base_image_url }`, then `supabase.from('sheets').update({ base_image_url }).eq('id', sheetId)` (exactly like `handleAddLevel`).
  3. `supabase.from('workbench_sheets').insert([{ sheet_id: sheetId, ...metadata }])` — the sidecar (type `WorkbenchSheetInsert`, already derived in `domain.ts`). Leave `review_state` to its `'draft'` default (Phase 7 owns the lifecycle); leave `reviewed_by`/`reviewed_at` null.
  4. Invalidate **`queryKeys.workbenchSheets(containerId)`** (and `queryKeys.snappingVectors(sheetId)`, mirroring `handleAddLevel`). **Never** invalidate/​write the live `queryKeys.sheets(...)` key.
  - **Ordering/atomicity:** like `handleAddLevel`, this creates the `sheets` row before the upload, so a failed upload leaves an orphan empty drawing. Prefer **cleanup-on-failure** (delete the sheet + sidecar in a `catch`) or create the sidecar only after a successful upload — pick one and note it.
- **NEW / EDIT** the **"New drawing" UI** in `src/app/workbench/page.tsx`: a header button (and/or a CTA in the empty state) that opens a capture form/modal collecting:
  - the PDF **file**, a **drawing/level name** → `sheets.sheet_name`;
  - **`sheet_project_type`** — a `<select>` over `PROJECT_TYPES` (9 types; reuse the New Project / SettingsMenu select styling);
  - **`level_label`**, **`source_sheet_number`** (free text); **`vector_quality`** (`'clean'`|`'scanned'` select — "clean" = vector PDF where snapping works, "scanned" = raster); **`is_partial`** (toggle).
  - `pdf_page_number` for the upload: historical PDFs can be multi-page. v1 may default to page 1 with an optional page-number input (the service already takes `?page_number=`). Scale (`scale_preset`/`scale_ratio` on `sheets`) is **out of scope here** — it's set with the existing scale tooling (`useUpdateSheetScale`) during tracing (Phase 6); do not block upload on it.
- **NEW** a small Zustand store `src/store/useWorkbenchStore.ts` (**explicit state interface**, per §2/§6) for the **modal open/close** state (floating UI → Zustand). Transient text-input values inside the form may stay local `useState` (as the New Project modal does); the modal *visibility* is the Zustand bit.
- **REUSE UNCHANGED:** `uploadFloorplanService` + the backend `/upload-floorplan/{sheetId}` endpoint. **No `main.py` changes.** The upload works because `verify_sheet_access` checks `project_members` via the sheet's `project_id`, and the user is a member of the container — this is the load-bearing coupling; do not alter the auth path.

## How it should behave
- In the Drawing Library, **"New drawing"** opens the capture form. Choose a PDF, name it, fill the metadata, submit → a `sheets` row is created **under the hidden container**, the PDF is uploaded/converted by the existing pipeline, the `workbench_sheets` sidecar stores the metadata, and the drawing appears in the library card grid with its metadata chips + the server-converted preview.
- Reloading `/workbench` re-lists the drawing (persisted). The drawing **never** appears in the Projects Dashboard grid (Phase 4 contamination guard stays intact).
- **No** tracing canvas, **no** status/schedule/bulk/sync controls anywhere. Opening a drawing into a canvas is Phase 6.

## Guardrails (must not violate)
- **Reuse the upload pipeline unchanged** — `uploadFloorplanService` + `/upload-floorplan/{sheetId}` as-is. **No backend (`main.py`) changes**; do not touch `verify_sheet_access` / the JWKS-ES256 auth path (§7).
- **Online-first writes via a TanStack mutation** — NOT the offline `pendingChanges` queue; **no `status_logs` / `status_audit_log`** writes; never mount the field/status/schedule/bulk/sync UI.
- **Stay scoped to the container** — sheet + sidecar inserts use `project_id = containerId`; the mutation invalidates only the **workbench** query key (`queryKeys.workbenchSheets`), never the live `sheets` key. A workbench row must never reach a live-project surface or `progressAnalytics`.
- **No service-role / no RLS widening** — the sheet + sidecar inserts go through the **client** under existing RLS (the user is `admin` of the container). Service-role is only for the Phase 4 container bootstrap; don't reach for it here.
- **Floating UI (the modal) in Zustand** with an explicit interface; **Types** derive from `database.types.ts` (`WorkbenchSheetInsert` already in `domain.ts`); no hand-written table shapes; no `any`; new files `.ts`/`.tsx`.

## Verify before closing (exit criteria)
Run with the absolute `--prefix` (cwd persists in Bash; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Then a **live `npm run dev:3010`** (from `sitepulse-next/`, port 3010) click-through:
- Open the Drawing Library → **New drawing** → upload a **real historical PDF**, set the metadata → it appears in the library with its metadata chips and a converted preview.
- **Reload** `/workbench` → the drawing persists.
- The drawing does **NOT** appear in the Projects Dashboard list.
- No status/schedule/sync/tracing controls anywhere in the workbench.

> ⚠️ The live verification writes a **real** drawing (a `sheets` row + a `workbench_sheets` row + a converted PNG / original PDF in the public `floorplans` storage bucket) under the hidden container. That's the intended, additive, hidden behavior — not a throwaway probe. Tell the owner what you created; offer to delete the test drawing afterward (it cascades cleanly: `workbench_sheets` is `ON DELETE CASCADE` on `sheets`, and removing a sheet's storage objects + `units` mirrors `handleDeleteSheet`).

Close the phase with the **verify-feature** skill (Definition of Done → stop). **Do not commit or push until the owner says "Approved."**

## Scope discipline
This session builds **only Phase 5** — the New-drawing upload action + per-sheet metadata capture into `workbench_sheets`. Do **NOT** build the tracing canvas / label creation (Phase 6) or the standard-enforcing naming + Definition-of-Done/review UX (Phase 7) — separate gated sessions.
