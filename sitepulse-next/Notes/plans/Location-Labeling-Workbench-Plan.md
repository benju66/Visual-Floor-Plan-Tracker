# Location Labeling Workbench — decoupled drawing library + standard-enforcing tracing (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `docs/initiative-brief.md` (Workstream **A3 + A4**) + `docs/location-labeling-standard.md` (the *how to label* source of truth).
> Sibling/predecessor plan: `sitepulse-next/Notes/plans/Location-Taxonomy-Foundation-Plan.md` (A1–A2, **shipped** — pickers, governed dictionary, review queue). Do not duplicate it.
> Backlog dependency it explicitly defers to: `sitepulse-next/Notes/Backlog.md` item **"Polygon holes / donut + cut-out geometry"**.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) — especially §2 (offline queue / `pendingChanges` stays local / `upsert_status_log`-only / RLS posture), §3 (canvas; never recolor `mapDisplayStatuses`; `progressAnalytics` is not forked), §4 (Location Taxonomy invariants), §5 (vector/PDF pipeline), §6 (TS guardrails), §7 (backend auth — do NOT touch).
2. Re-read the files named in each phase **fresh** — do not trust line numbers; they drift.
3. Build the phases in order. Verify after each slice (§ Verification commands). Close every phase with the **verify-feature** skill (Definition of Done → stop; do not commit/push until the owner says "Approved").
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short; frame technical choices as decisions with trade-offs.
5. Work on branch **`claude/polygon-drawing-performance-n976r3`**, small reviewable commits, `typecheck` + `test` before each.

## Goal
When this is done, there is a **separate, full-page "Drawing Library" workspace** (reached from the Projects Dashboard, privileged-gated) where the team ingests historical PDFs and traces them to bank clean, standard-compliant labels — **without** creating live projects, and **without** touching status tracking, schedules, or the offline-sync queue. Each workbench drawing captures per-sheet metadata (project type, level, sheet #, scale, vector quality, partial flag). Tracing reuses the existing canvas/PDF/snapping pipeline and the taxonomy pickers, and **enforces the labeling standard**: interior-face guidance, one polygon per location, trimmed + unique-within-sheet names with auto-increment, a required role + sub-type, two-level metadata, and a Definition-of-Done checklist gated behind a second-person review state. Separately (and shipped first), the **New Project popup** lets you set a project's type at creation, and the **taxonomy seed is corrected** (Kitchen/Prep → Back of House; "Housing and Hotel" split into "Housing" + "Hotel") before any volume tracing begins.

## Out of scope / deferred (named, so nothing is silently dropped)
- **Clean corpus export** (model-ready, versioned) → brief **A5**, a later plan.
- **Tracing accelerators** (fill-room-from-walls, grid stamp) → brief **Workstream B**, separate.
- **Any AI** (assisted tracing, trained model) → brief Phases 6/7.
- **True polygon-with-holes / donut geometry** (cut a void out of a polygon; multi-ring areas) → **Backlog item "Polygon holes / donut + cut-out geometry."** This plan only adds a lightweight **`has_void` label flag** so the dataset is honest; it does NOT change polygon geometry, area math, snapping, or PDF export.
- **Drawing collections / batches** (grouping thousands of drawings into folders) → later; v1 is one flat library under one shared container.
- **Inviting non-owner labelers into the workbench via the UI** → v1 access is "members of the workbench container project." Wiring the workbench container into Global Settings user-management is a small later follow-up; for v1 the owner (and anyone manually added as a member of the container) can label.
- **Retiring `unit_type`.** It stays — milestone applicability (`getAppliesTo` / `applies_to_unit_types`) keys on it (AGENTS.md §4). Workbench labels keep setting `unit_type` = the chosen sub-type name, exactly like the live create flow does today.

## Locked product decisions (from the owner — 2026-06-17)
1. **Decoupling = "hidden workbench container" (hardened), NOT separate tables.** Workbench drawings live as `sheets`/`units` under a single `projects` row flagged `kind = 'workbench'`. This reuses 100% of the proven canvas + PDF-upload + snapping + taxonomy pipeline with **zero backend changes**. The one risk (workbench rows sharing the live `projects`/`sheets`/`units` tables) is contained by: (a) an indexed `kind` flag, (b) the dashboard explicitly excluding `kind='workbench'`, (c) all workbench reads/writes routed through **dedicated, filter-applying hooks**, and (d) the workbench UI never mounting any status/schedule/sync surface. *Why this over separate tables:* the dataset's portability (the actual moat) is produced by the future export step regardless of storage layout, so separate tables buy "physical tidiness" at the cost of a **second copy of the most complex, most actively-improved part of the app (the tracing canvas)** — divergence we refuse to take on.
2. **Placement = new full-page surface** at a dedicated route, opened from a button on the Projects Dashboard, **privileged-gated** (owner/admin/pm). A modal can't host a zoom/pan tracing canvas.
3. **Taxonomy correction, locked NOW (corpus is empty → change is free; §10 of the standard says never change mid-corpus):**
   - **Restaurant `Kitchen` and `Prep` → `support` (Back of House).** Guest-facing `Dining Area`, `Bar/Lounge`, `Private Dining`, `Outdoor/Patio Dining` stay `program` (Primary).
   - **Split `Housing and Hotel` → `Housing` + `Hotel`** (project types **8 → 9**). Rationale: merging two labels later is free; splitting one later means re-examining every drawing. Sub-types re-scope: Dwelling Unit / Live/Work Unit → Housing; Guestroom / Suite / Event/Ballroom / Meeting Room → Hotel (cross-list where genuinely shared — scoping never restricts).
   - **No other seed changes** — let the **review queue** grow the dictionary from real evidence (propose → approve) rather than guessing additions up front.
4. **Two-level spaces (loft / mezzanine / double-height): handled as label metadata now** — a `spans_levels` flag + `level_note` on the label. Faithful to standard §7 (label on the primary turnover floor, note the second level); no geometry change.
5. **Donut rooms: keep the standard's workaround for v1** (trace the outer boundary; a tracked core like a shaft is its own location) **+ a `has_void` label flag** so the data is honest. True hole geometry is deferred to the Backlog.
6. **Taxonomy edits stay online-first** (same as the shipped foundation): the `useUpdateUnitFields` / `useCreateUnit` online path, never the offline `pendingChanges` queue.

## Data model

### Reuse, don't rebuild (ground truth — verified against `src/types/database.types.ts`)
- **`projects`**: `id, name, unit_types (Json), procore_*, project_type (text|null, CHECK ∈ 8 or null), created_at`. The workbench container is a `projects` row.
- **`sheets`**: `id, project_id (FK), sequence_order, sheet_name, base_image_url, scale_ratio, scale_preset, pdf_version, …`. A workbench drawing is a `sheets` row under the container.
- **`units`** (a "location"/label): `id, sheet_id (FK), unit_number, unit_type (text|null — applicability keys on it), top_level_role (text|null, CHECK 4), subtype_id (uuid|null → subtypes, ON DELETE SET NULL), computed_area, polygon_coordinates (Json), …`. A workbench label is a `units` row.
- **`subtypes`** (global governed dictionary): `name UNIQUE, top_level_role, status, aliases (jsonb), default_project_types (jsonb), proposed_note, …`. RLS: read = any authenticated member; write = owner/admin/pm.
- Domain types in `src/types/domain.ts` derive Row/Insert from `database.types.ts`; `ProjectType`/`TopLevelRole` unions live in `src/utils/locationTaxonomy.ts` (the DB stores plain TEXT). **Never hand-write a table shape.**

### The load-bearing coupling — DO NOT break it
- **Backend access is sheet-scoped via `project_id`.** `verify_sheet_access(sheet_id, user_id)` in `sitepulse-backend/main.py` reads the sheet's `project_id` and checks `project_members`. This is **why** workbench sheets must hang off a real container project — and why we make **zero backend changes**. Do NOT alter the auth path (AGENTS.md §7).
- **`unit_type` stays** — applicability via `applies_to_unit_types` / `getAppliesTo` keys on it. Workbench labels set `unit_type` = chosen sub-type name, like the live flow.
- **`status_logs` / `status_audit_log` / offline queue are untouched.** The workbench never writes status; it never mounts the field/status UI; `pendingChanges` stays local `useState` and is not used here.

### New schema this plan adds (two additive, idempotent, guarded migrations — built to the create-migration skill)
**Migration A (Phase 2 — taxonomy correction):**
- `projects.project_type` CHECK: replace the 8-value constraint with the **9-value** list (`…,'Housing','Hotel',…` instead of `'Housing and Hotel'`); remap any existing `'Housing and Hotel'` rows → `'Housing'` (expected: none — existing projects are NULL).
- `subtypes`: `UPDATE … SET top_level_role='support'` for `Kitchen` and `Prep`; `UPDATE` each affected `default_project_types` JSONB to replace `"Housing and Hotel"` with `"Housing"` and/or `"Hotel"` per sub-type.
- Mirror the change in `src/utils/locationTaxonomy.ts` (`PROJECT_TYPES`, `SEED_SUBTYPES` roles + `defaultProjectTypes`, `ROLE_DISPLAY_LABELS` key `Housing and Hotel`→`Housing`, decide a `Hotel` label) and its test. The constant is the source of truth; the SQL mirrors it (AGENTS.md §4).

**Migration B (Phase 3 — workbench infrastructure):**
- `projects.kind TEXT NOT NULL DEFAULT 'live' CHECK (kind IN ('live','workbench'))` — the hidden-container marker. Indexed.
- **`workbench_sheets`** sidecar (1:1 with a workbench drawing; keeps the shared `sheets` table clean):
  `sheet_id UUID PRIMARY KEY REFERENCES sheets(id) ON DELETE CASCADE`,
  `sheet_project_type TEXT` (per-drawing — workbench drawings are heterogeneous, unlike a live project's single type; CHECK ∈ 9 or null),
  `level_label TEXT`, `source_sheet_number TEXT`,
  `vector_quality TEXT CHECK (vector_quality IN ('clean','scanned') OR vector_quality IS NULL)`,
  `is_partial BOOLEAN NOT NULL DEFAULT false`,
  `review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft','ready_for_review','reviewed'))`,
  `reviewed_by UUID`, `reviewed_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ DEFAULT now()`.
  RLS mirrors the units/sheets membership pattern (member of the parent sheet's project). (`scale_ratio`/`scale_preset` stay on `sheets` — reuse the existing scale tooling.)
- **`units`** additive nullable label flags (label metadata belongs with the label, like `computed_area`): `spans_levels BOOLEAN`, `level_note TEXT`, `has_void BOOLEAN`. Unused by live UI (nullable, additive).
- Regenerate `database.types.ts`; derive `WorkbenchSheet` + extend `Unit` flags in `domain.ts`; narrow any new JSONB at the boundary (none expected here).

## Build-on inventory (read these fresh before using)
- **`src/app/dashboard/page.jsx`** — New Project modal (Phase 1 picker) + project list query (Phase 4: must exclude `kind='workbench'`) + entry button (Phase 4).
- **`src/app/api/projects/route.js`** — inserts `{ name, procore_project_id? }`; Phase 1 threads `project_type`. Phase 4 needs a sibling path that creates the container with `kind='workbench'`.
- **`src/components/SettingsMenu.tsx`** (~the `activeTab === 'data'` block) — the existing `project_type` `<select>` over `PROJECT_TYPES`; **reuse its styling** for the New Project picker.
- **`src/utils/locationTaxonomy.ts`** (+ `.test.ts`) — `PROJECT_TYPES`, `SEED_SUBTYPES`, `ROLE_DISPLAY_LABELS`, `subtypesForProjectType`. Source of truth for Migration A constants.
- **`src/components/UnitNamingPopover.jsx`** + **`src/components/TaxonomyPicker.tsx`** + **`src/utils/subtypes.ts`** (`taxonomyResultToUnitFields`, `orderedSubtypesByRole`) + **`src/hooks/useSubtypes.ts`** — the label-naming + role/sub-type pick flow to reuse (and extend in Phase 7 with naming validation + two-level/void).
- **`src/components/FloorplanCanvas.tsx`** — reads `activeSheetId` from `useMapStore` and `useUnits(activeSheetId)` internally; takes `activeStatuses`/`rawStatuses`/`applicabilityIndex` as props (pass empty for the workbench). `onPolygonComplete` is the trace entry point. Reuse as-is in Phase 6.
- **`src/hooks/useMapActions.ts`** (`handlePolygonComplete`, `saveNewUnitFromPopover`, `resolveTaxonomy`) — the create-label flow; Phase 6 reuses the same shape (consider a slim workbench-scoped variant rather than forking the whole hook).
- **`src/hooks/useProjectActions.ts`** (`handleAddLevel`, `handleAttachOriginal`) + **`src/services/api.ts`** (`uploadFloorplanService`, `attachOriginalService`) + **`src/hooks/useProjectQueries.ts`** (`useSheets(projectId)`, `useUnits(sheetId)`, `useCreateUnit(sheetId)`, `useSnappingVectors`) — the sheet/PDF/label data layer to reuse (Phases 4–6).
- **`supabase/migrations/20260616_location_taxonomy.sql`** — the style template (idempotent, guarded `DO $$`, `CHECK … NOT VALID` then `VALIDATE`, units→sheets→project_members RLS). **`.claude/skills`/`.agent/skills` `create-migration`** — the migration checklist + gate.
- **Do NOT fork:** `progressAnalytics`, `bottleneck`, `mapDisplayStatuses`, the `pendingChanges` offline queue (`useFieldData.ts` / `pendingChangesStore.ts`), or the established TanStack hooks. The workbench reuses the online create/update paths and adds new **filter-applying** read hooks following the same pattern.

## Pure logic to extract + unit-test (framework-free, deterministic; pass timestamps IN, never `Date.now()` inside)
Put in `src/utils/` with co-located `*.test.ts` (Vitest globals OFF — import `{ describe, it, expect }` from `'vitest'`):
- **`locationTaxonomy.ts`** (Phase 2): the 9-type list + corrected roles/scoping; tests assert Kitchen/Prep = `support`, the 9 types, and that no seed still references `'Housing and Hotel'`.
- **`workbenchNaming.ts`** (Phase 7): `normalizeLocationName(raw)` (trim, collapse double spaces); `isNameUniqueOnSheet(name, existingNames)`; `suggestNextName(existingNames)` — auto-increment following the established designator pattern (e.g. `301 → 302`, `A-104 → A-105`, `Court 1 → Court 2`); `definitionOfDoneChecks(sheetLabels)` → the §9 checklist results (every label named + typed; names trimmed + unique; role+sub-type present). Tests cover numeric, prefixed, and trailing-number patterns + the "no pattern → no suggestion" fallback.

## Sub-phasing (ship + verify each — smallest safe slice first)

### Phase 1 — Project-type on the New Project popup (no DB; online; smallest safe slice)
- **Scope:** add a `PROJECT_TYPES` `<select>` to the New Project modal in `src/app/dashboard/page.jsx`, directly below the Project Name field (reuse the SettingsMenu `data`-tab `<select>` styling). Hold `newProjectType` state; thread it through `handleCreateProject` → the POST body → `src/app/api/projects/route.js` (`insertData.project_type = project_type ?? null`). Optional/nullable. The picker maps over `PROJECT_TYPES`, so it auto-updates to 9 types after Phase 2 — no rework.
- **Approval gates:** none (no DB; `projects.project_type` + its CHECK already exist).
- **Exit criteria:** typecheck + test + build green · live `dev:3010` click-through (create a project with a type → lands on the project → Settings → Data shows the type; create one *without* a type → still works) · close with verify-feature.

### Phase 2 — Taxonomy correction migration (Kitchen/Prep→Support; split Housing/Hotel)  ⛔ APPROVAL GATE
- **Scope:** update `locationTaxonomy.ts` (+ test) as in **Migration A**; write `supabase/migrations/<today>_taxonomy_correction.sql` (the DDL + data `UPDATE`s above); regenerate `database.types.ts` (project_type is plain TEXT, so the union change is driven by the constant — confirm typecheck). Re-verify the three live pickers (New Project, SettingsMenu, trace popover) read the constant.
- **Approval gates:** ⛔ **DDL + data-touching `UPDATE`** — present the full SQL and **STOP**; apply (Supabase MCP/CLI, dev/branch first) only after explicit owner approval; show affected row counts; never trial-write against real rows (per the no-live-write-probes rule). ⛔ Keep `unit_type` untouched.
- **Exit criteria:** typecheck + test green (constants tests updated) · migration applied on dev/branch + verified by query (Kitchen/Prep = support; 9 project types; no `default_project_types` still containing `'Housing and Hotel'`) · existing app runs, pickers show 9 types with Kitchen under Back of House · close with verify-feature; do not commit/push until "Approved."

### Phase 3 — Workbench schema migration (container flag + sidecar + label flags)  ⛔ APPROVAL GATE
- **Scope:** `supabase/migrations/<today>_workbench_schema.sql` per **Migration B** (`projects.kind`, `workbench_sheets` sidecar + RLS, `units.spans_levels/level_note/has_void`). Regenerate types; add `WorkbenchSheet` domain type + extend `Unit`; narrow any new JSONB.
- **Approval gates:** ⛔ **DDL** — present SQL and STOP; apply dev/branch first. Additive + nullable only; no backfill of existing rows (defaults handle it). New `workbench_sheets` RLS follows the units→sheets→project_members membership pattern; never grant `anon`.
- **Exit criteria:** typecheck green (regenerated + derived types line up) · migration applied/verified on dev/branch · existing app unaffected (new columns nullable + unused by live UI) · close with verify-feature; do not commit/push until "Approved."

### Phase 4 — Workbench shell: route + hidden container + library list + dashboard hiding
- **Scope:** new full-page route (e.g. `src/app/workbench/page.tsx`), entry button on the dashboard (gated by the existing **admin-only** `adminProjects` signal — owner decision 2026-06-17; NOT `useCurrentUserRole`, which is project-scoped and unused on the dashboard — see the Phase 4 kickoff). **Bootstrap the single shared container**: a server path mirroring `api/projects/route.js` that creates a `projects` row with `kind='workbench'` (+ a `project_members` row for the creating user, role `'admin'` like `api/projects` — NOT the `create_new_project` RPC) if none exists. **Dashboard contamination guard**: the project-list query in `dashboard/page.jsx` must exclude `kind='workbench'`. Add **dedicated filter-applying hooks** (`useWorkbenchContainer`, `useWorkbenchSheets`) that always scope to the container. Render the (initially empty) library list of workbench drawings (sheets + `workbench_sheets` metadata). **No status/schedule/sync UI mounted.**
- **Approval gates:** ⛔ none structural; the container-creation route uses the service-role key like `api/projects` — keep it server-side. Do NOT widen RLS.
- **Exit criteria:** typecheck + test + build green · live click-through: open Drawing Library from the dashboard; the workbench container does **NOT** appear in the Projects Dashboard list; the library renders (empty) and never shows status controls · close with verify-feature.

### Phase 5 — PDF ingest + per-sheet metadata capture (standard §8)  ✅ SHIPPED 2026-06-17
- **Scope:** a "New drawing" action in the library: create a `sheets` row under the container, upload the PDF via the existing `uploadFloorplanService` (sheet-scoped — reuse `handleAddLevel`'s shape), and capture §8 metadata into `workbench_sheets` (`sheet_project_type` from the 9 types, `level_label`, `source_sheet_number`, `vector_quality`, `is_partial`; scale via the existing scale tooling on `sheets`). Snapping vectors extract automatically through the existing pipeline.
- **Approval gates:** ⛔ none beyond reusing the existing upload service unchanged.
- **Exit criteria:** typecheck + test + build green · live click-through: add a drawing (upload a real historical PDF), set its metadata, it appears in the library with that metadata and **still** never appears in the Projects Dashboard · close with verify-feature.
- **As shipped (branch `claude/workbench-phase5-pdf-ingest`):**
  - `useCreateWorkbenchDrawing` (`src/hooks/useWorkbenchActions.ts`) — TanStack mutation; insert `sheets` → `uploadFloorplanService` → write `base_image_url` → insert `workbench_sheets` sidecar via the pure `buildWorkbenchSidecarInsert` (`src/utils/workbench.ts`, unit-tested). `review_state` left to its `'draft'` DB default. Invalidates only `workbenchSheets` + `snappingVectors`.
  - **Atomicity decision (resolved):** **cleanup-on-failure** — the `sheets` row is created before the sheet-scoped upload; any failure after that deletes the orphan sheet (sidecar cascades) + removes its storage objects, so a retry starts clean. The sidecar is written only after a successful upload.
  - **Hardening (in scope — defends the load-bearing contamination guard):** the mutation guards at the write site, refusing to write unless the target container is `kind='workbench'`. Surfaced because the Phase-4 container query is `staleTime:Infinity` + IndexedDB-persisted and was found pointing at a **live** project (poisoned cache). Deeper fix (validate/expire the container in the Phase-4 *read* hook) is a Phase-6/7 follow-up — see Open decisions.
  - `useWorkbenchStore` (Zustand, modal visibility) + `NewDrawingModal` capture form; `DrawingCard` now shows the server-converted preview + metadata chips. No `main.py`/RLS/service-role changes.
  - **Verified live:** uploaded a real PDF end-to-end (real backend on :8001) → drawing persists, renders preview + chips, never appears on the dashboard. Real container after verification: `1a0b0343-29ab-400f-a498-12c62d11df42`; a test drawing `8ae5a09f…` ("Verification Drawing — L2") was intentionally left in the library.

### Phase 6 — Workbench tracing: reuse the canvas to bank labels
- **Scope:** open a library drawing into a tracing view that mounts the **reused `FloorplanCanvas`** (set the workbench sheet as `activeSheetId`; pass **empty** `activeStatuses`/`rawStatuses` and no `applicabilityIndex`). Wire `onPolygonComplete` → the existing naming popover, feeding the picker the **sheet's** `sheet_project_type` (not a project-level type). Save labels via `useCreateUnit(sheetId)` exactly like the live flow (set `unit_type` = sub-type name + `top_level_role` + `subtype_id` + `computed_area`). Reuse `useMapActions`' create path (prefer a slim workbench-scoped wrapper over forking the whole hook). No status UI, no bulk dock.
- **Approval gates:** ⛔ none; reuses online create path. Do NOT mount anything that writes `status_logs`.
- **Exit criteria:** typecheck + test + build green · live click-through: open a drawing, trace 2–3 locations, name + role + sub-type each, tag one "Other (pending)"; labels persist and reload; the live app is unaffected · close with verify-feature.

### Phase 7 — Standard-enforcing labeling UX (A4): naming rules + label metadata + Definition-of-Done/review
- **Scope:**
  - **Naming (pure `workbenchNaming.ts` + popover wiring):** trim + collapse double spaces on save; **uniqueness-within-sheet** validation (block/flag dupes); **auto-increment** suggestion following the established designator pattern; **required role + sub-type** before save.
  - **Label metadata:** `spans_levels` toggle + `level_note`, and a `has_void` toggle, added to the workbench naming/edit form (writes the Phase-3 `units` columns).
  - **Interior-face guidance** (standard §3): lightweight inline guidance text in the tracing view (no geometry enforcement).
  - **Definition-of-Done + second-person review (standard §9):** a per-drawing §9 checklist (computed by `definitionOfDoneChecks`), and a `review_state` lifecycle on `workbench_sheets` (`draft → ready_for_review → reviewed`, stamping `reviewed_by`/`reviewed_at`); a drawing can be marked "reviewed" only when the checklist passes. New UI state → a Zustand store with an explicit interface (`useHydratedStore` for any persisted prefs).
- **Approval gates:** ⛔ none beyond the online-write rule. If this phase grows past one session, split naming/metadata (7a) from DoD/review (7b).
- **Exit criteria:** typecheck + test + build green (`workbenchNaming.test.ts` covers normalize/unique/auto-increment/DoD) · live click-through: a name with stray spaces is trimmed; a duplicate is rejected; auto-increment suggests the next designator; a drawing flips to "reviewed" only after the §9 checklist passes · close with verify-feature.

## Hard guardrails (AGENTS.md / brief — do not violate)
- **No backend changes** — the sheet-scoped `verify_sheet_access` / JWKS-ES256 auth path stays exactly as-is (AGENTS.md §7). The workbench reuses existing sheet-scoped endpoints unchanged.
- **`status_logs` / `status_audit_log` / offline queue untouched** — workbench writes no status; never mount the field/status/bulk UI; `pendingChanges` stays local `useState`; don't touch the IDB key format or `hasRehydrated` guard.
- **Additive migrations only** — keep `unit_type`; new columns nullable + guarded + idempotent; `CHECK … NOT VALID` then `VALIDATE`. Data-touching `UPDATE`s (Phase 2) are a gated, dev/branch-first step.
- **Contamination guard is load-bearing** — `kind='workbench'` containers must be excluded from the dashboard and every "all projects/units" surface; route workbench access through the dedicated filter-applying hooks. A workbench row must never enter a live-project view or `progressAnalytics`.
- **Canonical vs display** — store/export only the canonical role string; `roleLabel`/display labels are presentation-only (AGENTS.md §4 / taxonomy plan decision 3).
- **Types** — new table/columns → `database.types.ts` → derive in `domain.ts`; narrow new JSONB at the query boundary; no `any`; new files `.ts`/`.tsx`.
- **Don't fork** `progressAnalytics` / `bottleneck` / `mapDisplayStatuses` / the established Query hooks; reuse the online create/update paths.
- **Verify with typecheck + test + build** — whole-repo lint is NOT a gate (~1850 pre-existing problems).

## Verification commands (the exit-criteria gate)
Run npm with an absolute `--prefix` (Bash cwd persists; a stray `cd` triggers a prompt):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (target one file: ... run test -- src/utils/workbenchNaming.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components / new routes)
```
Live UI/canvas verification: `npm run dev:3010` from `sitepulse-next/` (port 3010, not 3000). Vitest globals are OFF — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `foo.test.ts` next to `foo.ts`.

## Open decisions (resolve in the noted phase)
- **Container bootstrap timing/ownership** (Phase 4): lazily create the single shared `kind='workbench'` container on first privileged visit, vs. an explicit "set up library" action. Default: lazy-create on first visit. (One shared container for v1; collections deferred.)
- **`Hotel` display label** (Phase 2) — **RESOLVED & SHIPPED**: `Housing → program:'Units'`, `Hotel → program:'Rooms'` (in `ROLE_DISPLAY_LABELS` + `locationTaxonomy.test.ts`, live on `main`).
- **Duplicate-name handling** (Phase 7): hard-block vs. warn-and-allow on a within-sheet name collision. Default: block (standard §4.5 makes within-sheet uniqueness mandatory), with auto-increment offered as the one-click fix.
- **Container query robustness** (Phase 6/7 follow-up — surfaced in Phase 5): `useWorkbenchContainer` is `staleTime:Infinity` + IndexedDB-persisted, so a deleted or mis-cached container is served indefinitely (Phase 5 found it pointing at a *live* project). Phase 5 added a **write-site** `kind='workbench'` guard as the immediate fix; the deeper fix is to validate/expire the container in the *read* hook (re-resolve via the route when the cached project is missing or not `kind='workbench'`) so reads self-correct too. Default: do it as a small hardening pass alongside Phase 6 tracing (which also writes under the container).
