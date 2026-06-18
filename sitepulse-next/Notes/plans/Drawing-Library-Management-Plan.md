# Drawing Library Management & Corpus Health — library cockpit, delete (soft + hard), grouping (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent plan: `sitepulse-next/Notes/plans/Location-Labeling-Workbench-Plan.md` (the Location Labeling Workbench, **Phases 1–7 shipped to `main`**). This workstream is its follow-on — call it **Workbench Phase 8** (sub-phases 8a–8d). Do not duplicate the workbench plan; build on its hooks/guards.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) — especially **§2** (data via TanStack hooks; floating UI in Zustand with an explicit interface; online-first writes; never touch the offline `pendingChanges` queue or `status_logs`; RLS posture — never widen RLS, never grant `anon`), **§3** (`progressAnalytics` is the single source of truth — **do not fork it**, and the workbench must never enter it), **§4** (taxonomy: `top_level_role` is the single source of truth for role; canonical vs. display), **§6** (TS guardrails: derive types from `database.types.ts`, narrow JSONB at the boundary, no `any`, new files `.ts`/`.tsx`, explicit Zustand interfaces).
2. Re-read the files named in **Build-on inventory** fresh — **do not trust line numbers; they drift.**
3. Build the sub-phases in order (8a → 8b → 8c → 8d). Verify after each slice (§ Verification commands). Close each phase with the **verify-feature** skill (Definition of Done → stop; do not commit/push until the owner says "Approved").
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short; frame technical choices as decisions with trade-offs.

## Goal
When this is done, the **Drawing Library (`/workbench`) is a real management cockpit**, not just a flat list. Each drawing card shows its **review state** (Draft / Ready for review / Reviewed) at a glance. A **corpus-health strip** at the top shows how the labeling effort is going — the review funnel, how many labels have been banked, how many drawings pass the Definition-of-Done, taxonomy coverage, and data-quality signals. Drawings can be **archived (soft-deleted, recoverable)** to tidy the library, and **permanently purged (hard-deleted)** by a privileged user with a strong confirm. The flat list can be **grouped/filtered** (by project type, level, review state, vector quality) so it stays navigable as the corpus grows. All of this stays **completely separate from the live Projects Dashboard** — no workbench data ever enters live rollups.

## Out of scope / deferred (named, so nothing is silently dropped)
- **True collections / folders** (grouping drawings from the same real building/project into persistent, named folders — a `collection_id`/`group_label` column on `workbench_sheets` or a `workbench_collections` table). Phase 8d does only **client-side, in-memory grouping/filtering** of the flat list (no schema change). Persistent collections are deferred until the corpus volume genuinely demands them — they're a schema + UI workstream of their own.
- **Clean corpus export** (model-ready, versioned dataset) → brief **A5**, a later plan. The Phase-8a health metrics are a precursor/companion to it, not the export itself.
- **Any AI / assisted tracing** → brief Phases 6/7, separate.
- **Bulk operations** (multi-select archive/delete/retype across many drawings) → not in v1; single-drawing actions only. Revisit if volume demands.
- **Wiring workbench access into Global Settings user-management** → still the deferred item from the workbench plan; access stays "privileged member of the workbench container."

## Locked product decisions (from the owner — 2026-06-18)
1. **Both soft AND hard delete.** Soft-delete = **archive / recoverable** (the default, low-risk action — a traced drawing is expensive hand-made training data, so the easy action must be reversible). Hard-delete = **permanent purge** (privileged + strong confirm, especially for a `reviewed` drawing).
2. **Review-state badge on the library cards**, reusing the centralized helpers shipped in Phase 7 (`REVIEW_STATE_BADGE` / `REVIEW_STATE_LABELS` / `narrowReviewState` in `src/utils/workbench.ts`). The data already loads — no new fetch.
3. **Corpus-health strip on `/workbench`** — the corpus-building cockpit. **It must never appear on the live Projects Dashboard and must never enter `progressAnalytics`** (the load-bearing contamination guard).
4. **Grouping is two-tier:** cheap client-side grouping/filtering now (Phase 8d); persistent collections deferred (above).
5. **Build order:** 8a (badge + health) → 8b (soft-delete) → 8c (hard-delete) → 8d (grouping).

## Data model

### Reuse, don't rebuild (ground truth — verified against `src/types/database.types.ts`, 2026-06-18)
- **`workbench_sheets`** (the per-drawing sidecar, 1:1 with a workbench `sheets` row): `sheet_id (PK→sheets ON DELETE CASCADE)`, `sheet_project_type`, `level_label`, `source_sheet_number`, `vector_quality`, `is_partial`, `review_state`, `reviewed_by`, `reviewed_at`, `created_at`. **No soft-delete column exists yet** — Phase 8b adds one.
- **`units`** (a label): `id, sheet_id (FK), unit_number, unit_type, top_level_role, subtype_id, computed_area, polygon_coordinates, spans_levels, level_note, has_void, …`. Workbench labels hang off workbench sheets.
- **`sheets`**: deleting a row **cascades** its `workbench_sheets` sidecar AND its `units` via FK `ON DELETE CASCADE` — but **storage objects and `sheet_vectors` are NOT cascaded** and must be cleaned explicitly (see `handleDeleteSheet`).
- Read scoping is via `useWorkbenchSheets(containerId)` (always filtered to the hidden `kind='workbench'` container) — the contamination guard. Never read workbench rows through a live/all-project query.

### New schema this plan adds (Phase 8b only — one additive, idempotent, guarded migration)
- **`workbench_sheets.deleted_at TIMESTAMPTZ`** (nullable; null = active, non-null = archived) — the soft-delete marker. Optionally **`deleted_by UUID`** (who archived it). Additive + nullable; no backfill (defaults handle it); idempotent (`ADD COLUMN IF NOT EXISTS`). No `CHECK` needed for a nullable timestamp. Built to the **`create-migration`** skill; regenerate `database.types.ts` and derive in `domain.ts` (`WorkbenchSheet` picks the column up automatically).
- Hard-delete (8c) needs **no migration** — it reuses the cascade + the explicit storage/`sheet_vectors` cleanup.

## Build-on inventory (read these fresh before using)
- **`src/app/workbench/page.tsx`** — the library page + `DrawingGrid` + `DrawingCard`. ⚠️ **`DrawingCard` is currently a full-card `<Link>`** to `/workbench/[id]` — adding action buttons (archive/delete/menu) requires restructuring so the click-to-open area and the action controls don't nest a button inside the link (use `preventDefault`/`stopPropagation` or split the clickable region). Badge, health strip, grouping controls, and per-card actions all land here.
- **`src/utils/workbench.ts`** — `REVIEW_STATE_BADGE`, `REVIEW_STATE_LABELS`, `narrowReviewState` (badge — Phase 8a), plus `assertWorkbenchContainer` lives in `useWorkbenchActions.ts` (the write-site `kind='workbench'` guard to carry onto every new write).
- **`src/utils/workbenchNaming.ts`** — `definitionOfDoneChecks` (reuse for the per-drawing DoD pass-rate in the health strip; do NOT re-implement).
- **`src/hooks/useWorkbench.ts`** — `useWorkbenchSheets(containerId)` (Phase 8b adds the `deleted_at` filter + a "show archived" path). The container-scoped read hooks are the ONLY sanctioned way to read workbench data.
- **`src/hooks/useWorkbenchActions.ts`** — `assertWorkbenchContainer` (reuse), `useCreateWorkbenchDrawing` (its **cleanup-on-failure** block is the storage/orphan-removal template), `useUpdateWorkbenchReviewState` (pattern for a `workbench_sheets` write that invalidates `workbenchSheets`). Add `useArchive…` / `useRestore…` / `useHardDelete…` here.
- **`src/hooks/useProjectActions.ts` → `handleDeleteSheet`** — the **hard-delete template**: `supabase.storage.from('floorplans').remove(['converted/<id>.png','originals/<id>.pdf'])` → `invalidatePdfBytes(id)` → `supabase.from('sheet_vectors').delete().eq('sheet_id', id)` → `supabase.from('sheets').delete().eq('id', id)` (cascade does the sidecar + units). (Skip the vestigial OpenSeadragon `tiles/` cleanup — AGENTS.md §5 notes that path was removed.)
- **`src/hooks/useProjectQueries.ts`** — `useUnits(sheetId)` and the query-key shapes; the health strip needs labels aggregated across the container's sheets (a new container-scoped units-aggregate read, kept in `useWorkbench.ts` so it stays filter-applying — never an all-project units query).
- **`src/types/queryKeys.ts`** — `workbenchSheets(containerId)`; add a `workbenchCorpusStats(containerId)` key if the stats get their own query.
- **Do NOT fork / touch:** `progressAnalytics`, `bottleneck`, `mapDisplayStatuses`, the live Projects Dashboard (`src/app/dashboard/page.jsx`), `main.py`, RLS, or the offline queue.

## Pure logic to extract + unit-test (framework-free, deterministic; pass data IN, never `Date.now()` / no I/O inside)
Put in `src/utils/` with co-located `*.test.ts` (Vitest globals OFF — import `{ describe, it, expect }` from `'vitest'`):
- **`workbenchStats.ts`** (Phase 8a): `summarizeCorpus(drawings, unitsBySheet)` → `{ reviewFunnel: {draft, ready_for_review, reviewed}, totalDrawings, totalLabels, avgLabelsPerDrawing, dodReadyCount (drawings whose definitionOfDoneChecks().passed), byRole, bySubtype, untypedOrPendingCount (top_level_role set + subtype_id null → the review-queue/dictionary-growth signal), vectorQuality: {clean, scanned, unknown}, byProjectType }`. Reuse `definitionOfDoneChecks` + `narrowReviewState`. Tests: empty corpus, a mix of states/roles, the untyped/pending count, archived excluded (once 8b lands).
- **`workbenchGrouping.ts`** (Phase 8d): `groupDrawings(drawings, key)` (`'project_type' | 'level' | 'review_state' | 'vector_quality'`) → ordered groups with a stable "Unspecified" bucket; `filterDrawings(drawings, filters)`. Pure; tests cover each key + the empty/unspecified bucket.

## Sub-phasing (ship + verify each — smallest safe slice first)

### Phase 8a — Library at-a-glance: review-state badge + corpus-health strip (no DB)
- **Scope:** (1) Add a **review-state badge** to `DrawingCard` (reuse `REVIEW_STATE_BADGE`/`REVIEW_STATE_LABELS`/`narrowReviewState`; data already on `drawing.workbench.review_state`). (2) Add a **corpus-health strip** at the top of `/workbench`: extract `summarizeCorpus` (pure, tested) and feed it the drawings + a **container-scoped units aggregate** (new filter-applying read in `useWorkbench.ts`, e.g. `useWorkbenchCorpusUnits(containerId)` — units joined to the container's sheets only, never an all-project query). Render the review funnel + corpus size + DoD-ready count + taxonomy coverage + vector-quality/project-type signals. **Nothing on the live dashboard; nothing through `progressAnalytics`.**
- **Approval gates:** ⛔ none (no DB). Guard: the units aggregate MUST be scoped to the container — never reuse an all-project/rollup key.
- **Exit criteria:** typecheck + test + build green (`workbenchStats.test.ts`) · live `dev:3010`: cards show the correct state badge; the health strip reflects the real counts for the test drawings; the live dashboard is unchanged · close with verify-feature.

### Phase 8b — Soft-delete (archive + restore)  ⛔ APPROVAL GATE (migration)
- **Scope:** `supabase/migrations/<today>_workbench_soft_delete.sql` — additive `workbench_sheets.deleted_at TIMESTAMPTZ` (+ optional `deleted_by UUID`), idempotent + nullable. Regenerate `database.types.ts`; derive in `domain.ts`. `useWorkbenchSheets` **excludes `deleted_at IS NOT NULL` by default**, with a **"Show archived"** path; add `useArchiveWorkbenchDrawing` / `useRestoreWorkbenchDrawing` (set/clear `deleted_at`, carry the `kind='workbench'` guard, invalidate `workbenchSheets`). `DrawingCard` gets an **Archive** action (and **Restore** when viewing archived). The health strip (8a) now **excludes archived** drawings.
- **Approval gates:** ⛔ **DDL** — present the full SQL via the `create-migration` skill and **STOP**; apply dev/branch-first only after explicit owner approval. Additive + nullable only; no backfill; never widen RLS.
- **Exit criteria:** typecheck + test + build green · migration applied/verified on dev/branch · live: archiving a drawing hides it from the default list + the health counts; "Show archived" reveals it; Restore brings it back; the live app is unaffected · close with verify-feature.

### Phase 8c — Hard-delete (permanent purge)  ⛔ destructive
- **Scope:** `useHardDeleteWorkbenchDrawing(containerId)` mirroring `handleDeleteSheet`: kind-guard (`assertWorkbenchContainer`) → remove storage (`converted/<id>.png`, `originals/<id>.pdf`) → `invalidatePdfBytes` → delete `sheet_vectors` row → delete the `sheets` row (cascade removes the sidecar + units) → invalidate `workbenchSheets`. **Privileged + strong confirm:** a confirm modal that names the drawing and the number of labels that will be lost, **type-to-confirm** (require typing the drawing name), with an extra warning when the drawing is `reviewed`. Gate visibility behind the same privileged signal that gates `/workbench` entry (verify the current gate fresh; do not widen it).
- **Approval gates:** ⛔ no DB, but it is irreversible — the confirm UX is part of the spec, not optional. Never hard-delete without the typed confirm.
- **Exit criteria:** typecheck + test + build green · live: hard-deleting a throwaway test drawing removes it from the library AND drops its storage objects + `sheet_vectors` + labels (spot-check the DB/storage); a `reviewed` drawing shows the stronger warning; the live app is unaffected · close with verify-feature.

### Phase 8d — Client-side grouping & filtering (no DB)
- **Scope:** extract `workbenchGrouping.ts` (pure, tested); add grouping/filter controls to `/workbench` (group/filter by project type, level, review state, vector quality) over the already-loaded drawings — no schema change. Floating UI state (selected grouping/filter) in `useWorkbenchStore` with the explicit interface. Persistent collections stay **deferred** (Out of scope).
- **Approval gates:** ⛔ none.
- **Exit criteria:** typecheck + test + build green (`workbenchGrouping.test.ts`) · live: grouping/filtering reorganizes the library correctly, including an "Unspecified" bucket; clearing returns the flat list · close with verify-feature.

## Hard guardrails (AGENTS.md / workbench plan — do not violate)
- **No backend / auth changes** — no `main.py`, no RLS widening, no `anon` grants, no service-role from the client (the Phase-4 container bootstrap is the only server-role path and it stays as-is).
- **Contamination guard is load-bearing** — every workbench read/write goes through the dedicated, container-scoped hooks; `kind='workbench'` rows never appear on the live dashboard or in any all-project/units rollup, and the health metrics never touch `progressAnalytics`. Carry the `assertWorkbenchContainer` write-site guard onto every new write (archive/restore/hard-delete).
- **Additive migrations only** (8b) — nullable + idempotent (`ADD COLUMN IF NOT EXISTS`); data-touching steps are gated + dev/branch-first; regenerate types after.
- **Canonical vs display** — taxonomy coverage counts the canonical `top_level_role`; display labels are presentation-only (§4).
- **Types** — new column → `database.types.ts` → derive in `domain.ts`; no `any`; new files `.ts`/`.tsx`; explicit Zustand interfaces; floating UI in Zustand (`useHydratedStore` for any persisted prefs like a remembered grouping).
- **Don't fork** `progressAnalytics` / `bottleneck` / `mapDisplayStatuses` / the established Query hooks; reuse the online create/update/delete paths.
- **Verify with typecheck + test + build** — whole-repo lint is NOT a gate (~1850 pre-existing problems).

## Verification commands (the exit-criteria gate)
Run npm with an absolute `--prefix` (Bash cwd persists; a stray `cd` triggers a prompt):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (target one file: ... run test -- src/utils/workbenchStats.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components / new routes)
```
Live UI verification: `npm run dev:3010` from `sitepulse-next/` (port 3010, not 3000) — the backend on :8001 is only needed for NEW PDF ingest, not for badge/health/delete/grouping. Vitest globals are OFF — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `foo.test.ts` next to `foo.ts`.

## Open decisions (resolve in the noted phase)
- **Soft-delete column name + `deleted_by`** (Phase 8b) — `deleted_at TIMESTAMPTZ` (+ optional `deleted_by UUID`). **Recommended:** `deleted_at` + `deleted_by` (cheap provenance; mirrors `reviewed_by`/`reviewed_at`). Confirm at the migration gate.
- **Do archived drawings count in the health metrics?** (Phase 8a/8b) — **Recommended: NO** (archived = removed from the active corpus, so exclude from both the list and the metrics). 8a counts all (no archived concept exists yet); 8b updates the list filter AND the stats query to exclude archived.
- **Hard-delete gating + confirm strength** (Phase 8c) — **Recommended:** reuse the existing privileged gate that controls `/workbench` entry (don't invent a new role), plus an always-on **type-the-drawing-name** confirm, with an extra warning for a `reviewed` drawing. Confirm whether hard-delete should be allowed at all on a `reviewed` drawing or require un-reviewing first.
- **Badge + health in one phase vs. split** (Phase 8a) — bundled here because both are read-only display on the same page; the badge is a ~10-line warm-up. Split only if 8a overruns its session.
