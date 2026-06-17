# Locations & Status Management — Production Build Plan

> Status: planning (2026-06-15). Owner decisions locked. This is the target for the
> *finished* desktop management experience, delivered in phases.

## 0. Review addendum (2026-06-15) — codebase was ahead of the first draft

A pre-build review found the plan's first draft was written against a **stale snapshot**.
HEAD (clean tree, `2ac7612`) is ahead. Confirmed deltas that change the plan:

1. **Field list already simplified:** `DesktopCardGrid` + the Table/Cards toggle were removed
   (commit `66386b5`). Desktop List renders only `StatusTable`; `useFieldData` no longer takes
   `defaultView`. The workspace replaces a single desktop branch — cleaner than assumed. Do not
   reference `DesktopCardGrid`.
2. **`src/utils/progressAnalytics.ts` is the single source of truth for schedule-variance/lag math**
   (`computeUnitVariance`, `varianceFill`/`varianceLabel`/`VARIANCE_LEGEND`, `summarizeGroup`).
   Consumers: Map Lag Mode, hover tooltip, Unit Journey, dashboard FloorPulse/TypeScorecard.
   → Phase 3 Gantt "behind schedule" coloring MUST reuse this (and pass applicability-filtered
   milestones), never fork it.
3. **Dashboard already does all-project fetching + has a scope control:** `ProjectDashboard`
   fetches all-project units/statuses/history; the `FloorPulse` rail is the per-level rollup AND
   the scope control (it replaced an Active/All-Levels toggle). → Align the all-levels management
   scope with this existing pattern; reuse `useAllProjectUnits`/`useAllProjectStatuses`.
4. **Lag Mode guardrail:** never recolor `mapDisplayStatuses` in `page.jsx` (it feeds write paths).
   Bulk write paths may *read* its bottlenecks but must not mutate/recolor it.
5. **Offline parity is cheaper than planned:** bulk **status** routes through the existing
   `handleTimelineUpdate` staging buffer (already keyed `${unit.id}_${milestone}`), so Phase 1 gets
   offline replay for free with **no `PendingChange` change**. The `PendingChange` `kind`
   generalization (§4.2) moves to **Phase 2/3** (when field/delete/schedule edits need it).

Revised phasing: Phase 0 = manage store + pure filter/selection utils (no type change).
Phase 1 = bulk status via existing staging + filters/search/scope. PendingChange generalization → Phase 2.

## 1. Goal

Turn the desktop **List view** from a one-row-at-a-time status editor into a
**Locations & Status management workspace** — a construction-grade data grid where
finding, bulk-editing, scheduling, and managing locations is the primary job, with
the Map as its visual twin.

Driving scenario (owner's words): *"Carpet's done on all of floor 4"* — the user
should filter to a floor (or the whole building), select the matching locations, and
set a milestone's status across all of them in one action, online **or** offline,
with a clear preview and one-click undo.

## 2. Locked decisions (2026-06-15)

1. **Scope:** support **both** "this level" and "all levels (whole building)". The
   all-levels mode must be **visually unmistakable** so a building-wide change is never
   made by accident.
2. **Offline:** bulk edits get **full offline parity** — they queue to IndexedDB and
   replay on reconnect, exactly like single-location status edits do today.
3. **Schedule:** build a **full Gantt/timeline** — draggable bars per location-milestone,
   level→location date cascade, dependencies, behind-schedule surfacing.

## 3. What already exists (build on, don't rebuild)

- **Bulk status engine:** `handleApplyBulkStatus` (`useMapActions.ts`) + `useBulkUpdateStatus`
  (`useProjectQueries.ts:673`). Supports a specific milestone→state, `__KEEP_EXISTING__`
  (change each unit's *current* milestone), `__CLEAR__`, planned/logged dates, bottleneck
  context, **auto-advance**, and **undo/redo** (`BULK_UPDATE_STATUS` action). Chunked at 800.
  ⚠️ Writes **directly** to Supabase via `.upsert({ onConflict: 'unit_id,track,milestone' })`
  — **online-only**, bypasses the offline queue.
- **Bulk applicability (N/A):** `handleBulkApplicability` + `useBulkSetApplicability`.
- **All-levels data:** `useAllProjectUnits(sheetIds)` and `useAllProjectStatuses(unitIds)`
  already exist. No new query infra needed for cross-level reads.
- **Single-unit field edits:** `useUpdateUnitFields(sheetId)` (optimistic; covers
  `unit_type`, `assigned_to`, name) and `useDeleteUnit(sheetId)`. ⚠️ Also online-only.
- **Team / assignee source:** `useProjectMembers(projectId)`; units have `assigned_to`.
- **Offline-durable status pipeline (the model to reuse):** `pendingChanges` staging buffer
  in `useFieldData.ts` (project-scoped IDB via `pendingChangesStore.ts`) →
  `handleApplyAll` → per-item `commitUnitMilestone` → queued mutation that replays offline.
  Per-item IDB checkpoint + `isSyncingRef` guard are hardened — **do not regress these.**
- **Map jump:** `floorplanRef.current.zoomToFit(unitId)` for "locate on map".
- **Selection:** `selectedUnitIds` is global in `useMapStore` (IDs only) — already
  cross-sheet-safe; shared by Map + List.

## 4. Target architecture

### 4.1 State (Zustand — per AGENTS.md, UI/filter state belongs in stores)
New slice **`useManageStore`** (or extend `useMapStore`) holding workspace UI state:
- `scope: 'level' | 'all'`
- `filters`: `{ query, types[], milestones[], states[], assignees[], behindSchedule, plannedRange, actualRange }`
- `bulkPanelOpen`, `detailDrawerUnitId`
- Selection stays in `useMapStore.selectedUnitIds` (shared with Map).
Keep persisted prefs (e.g. default scope) in `useSettingsStore` behind `useHydratedStore`.

### 4.2 Generalized offline staging buffer (the key foundation)
Today `pendingChanges` only holds **status** changes. Generalize `PendingChange` with a
discriminant so **one** offline-durable queue handles every bulk op:

```ts
type PendingChange =
  | { kind: 'status';   unit; log; state; capturedAt; extraProps }   // existing shape
  | { kind: 'field';    unit; updates: Partial<Unit>; capturedAt }   // assign / type / rename
  | { kind: 'delete';   unit; capturedAt }
  | { kind: 'schedule'; unit; milestone; dates; capturedAt }         // Gantt date edits
```
Guardrails (must hold): keep it **local `useState`** (not Zustand/RQ cache); keep the
IDB key format `sitepulse-pending-changes-${projectId}`; keep `hasRehydrated` guard;
keep values JSON-serializable; keep the per-item dequeue checkpoint. `handleApplyAll`
gains a `switch (change.kind)` dispatch to the right queued mutation.

### 4.3 Offline bulk: design
**Primary (reuse hardened path):** a bulk action fans out into N `PendingChange`
entries appended to the staging buffer (offline-durable immediately). The bulk bar shows
"N pending"; **Apply** replays them through the per-item queued mutations.
**Online fast-path:** when `onlineManager.isOnline()` and N is large, `handleApplyAll`
batches the status subset through the existing chunked `useBulkUpdateStatus` upsert
instead of per-item, then checkpoints. Offline → per-item queued replay.
*(Alternative considered: make `useBulkUpdateStatus` a `setMutationDefaults` offline
mutation with `resumePausedMutations`. Rejected as primary — more moving parts, and it
wouldn't unify field/delete/schedule ops into one queue.)*

### 4.4 Components
| Component | Role |
|---|---|
| `ManageWorkspace` | Desktop container; owns scope + filters + selection; replaces FieldStatusTable's desktop branch |
| `ManageToolbar` | Search, facet filters, **scope selector**, view toggle, export, add-location |
| `ScopeBanner` | Loud, persistent indicator when `scope === 'all'` (e.g. amber bar: "Editing ALL LEVELS — 6 floors · 214 locations") |
| `LocationsGrid` | Virtualized table (TanStack Virtual); Level column appears in all-levels mode, grouped by floor |
| `LocationRow` / `RowActionsMenu` | Inline status/dates + kebab: rename, type, assign, locate, history, duplicate, delete |
| `AssigneeColumn` / `AssigneePicker` | Shows/edits `assigned_to` from `useProjectMembers` |
| `BulkActionBar` | Evolves `BulkActionDock`; **persistent**, shows at 1+ selected, "Select all N matching", opens panel |
| `BulkEditPanel` | Multi-field bulk editor + **confirm-with-scope** ("…on 38 locations across 3 levels") |
| `LocationDetailDrawer` | Side panel: full milestone timeline, dates, history, assignee for one location |
| `ScheduleWorkspace` | First-class schedule view (promoted out of Settings modal) |
| `GanttTimeline` / `GanttBar` | SVG/CSS bars per location-milestone; drag to set dates; cascade controls |

### 4.5 New data hooks
- `useBulkUpdateUnitFields(sheetIds)` — multi-id `assigned_to` / `unit_type` (+ multi-sheet cache invalidation).
- `useBulkDeleteUnits(sheetIds)` — bulk delete + map polygon/icon cleanup + multi-sheet invalidation.
- `useAllProjectStatuses` — already exists; wire to all-levels mode.
- Export helper — selection → CSV (and reuse `exportToPDF` for PDF).
- All new mutations must support the offline staging path (§4.2), not just direct calls.

## 5. Phased delivery

### Phase 0 — Foundation
- Generalize `PendingChange` + `handleApplyAll` dispatch (§4.2). Keep all guardrails; extend
  `pendingChangesStore.ts` tests (serialization of new kinds, project-scoped key, empty-deletes-key).
- `useManageStore` (scope + filters). Generalized selection: "select all matching filter".
- Multi-sheet cache invalidation helper for bulk mutations.
- **Accept:** existing single + bulk status flows unchanged; new queue kinds round-trip through IDB.

### Phase 1 — Bulk status + find/select (the driving scenario)
- `ManageToolbar`: search + facet filters (type, milestone, **state**, assignee, behind-schedule).
- Scope selector + `ScopeBanner` (all-levels uses `useAllProjectUnits`/`useAllProjectStatuses`,
  adds Level column, groups by floor).
- "Select all N matching" in grid header.
- `BulkActionBar` persistent + counter hint when nothing selected; `BulkEditPanel` for:
  set-milestone→state (+actual date), advance-current-milestone (+auto-advance), set planned dates,
  mark N/A / applicable, clear status.
- **Confirm step echoes scope**; route through staging buffer (offline parity) + online fast-path; undo.
- **Accept:** filter to a floor → select all → set Carpet=Completed offline → reconnect → replays;
  all-levels banner present; undo reverts the batch.

### Phase 2 — Location management
- Row kebab: rename, change type, **assign**, locate-on-map, history, duplicate, delete (all offline-durable).
- `AssigneeColumn` + picker; bulk assign + bulk type in `BulkEditPanel`; **bulk delete** (confirm + scope echo).
- `LocationDetailDrawer` (click row → deep single-location panel).
- **Add location** entry point from the list (place-on-map handoff or quick-add).
- **Accept:** every "manage one" action works without leaving the list; bulk assign/type/delete + offline.

### Phase 3 — Schedule workspace (Gantt)
- Promote schedule out of the Settings modal into `ScheduleWorkspace` (a view alongside Map/List/Dashboard).
- `GanttTimeline`: bars per location × milestone, **drag to set start/end**, today line, behind-schedule
  coloring (ties to bottleneck logic). Zoom: day/week/month.
- **Level→location cascade:** set a milestone's dates at the floor level (`sheets.milestone_schedules`,
  already exists) → inherit to locations with per-location override. Unifies the two schedule surfaces.
- Validation (end ≥ start); milestone dependencies from `sequence_order`.
- **One canonical date editor** shared by list inline dates, bulk "Set dates", and the Gantt.
- Date edits flow through the offline staging buffer (`kind: 'schedule'`).
- **Accept:** drag a bar offline → queues → replays; cascade fills then per-unit override sticks.

### Phase 4 — Production hardening
- Virtualization at all-levels scale (hundreds–thousands of rows).
- Optimistic cache updates for all bulk ops; reconcile with LWW guard.
- Saved segments / views ("Floor 4 – open items").
- Export (CSV + PDF) of current selection/filter.
- Roles/permissions on destructive bulk (owner/admin/pm) — RLS already governs writes.
- Migrate the **Map's** bulk dock onto the same staging pipeline so there's one bulk path.
- **Accept:** 1000-row all-levels grid stays smooth; permissions enforced; one unified bulk pipeline.

## 6. Risks & guardrails (from AGENTS.md — must respect)
- `pendingChanges` stays local `useState`; IDB key format and `hasRehydrated` guard unchanged.
- `status_logs` writes stay on `upsert_status_log` RPC / `.upsert({ onConflict })` — never `.insert()`.
- `client_timestamp` stamped at capture time, not sync time.
- `upsert_status_log` stays `SECURITY INVOKER`; don't widen role lists or re-grant to `anon`.
- New tables/functions → add to `database.types.ts`; derive domain types via `Database[...]['Row']`.
- Keep everything in the RQ cache JSON-serializable (no class instances).
- Tests: extend pure-logic + serialization coverage (new `PendingChange` kinds, multi-sheet selection,
  cascade math, Gantt date math). Verify via typecheck + test + build (whole-repo lint is not a gate).

## 7. Open / future
- "Select all matching" across all levels can select thousands — confirm copy + a hard cap or
  "this affects N locations across M floors, continue?" gate.
- Photos/notes per location in the detail drawer (if/when that data exists).
- Mobile parity for the new bulk/manage flows (current scope is desktop).

## 8. Build status (live)

- **Phase 0 — DONE & verified.** `src/utils/locationFilters.ts` (+test, 14), `src/utils/bulkStatus.ts`
  (+test, 6), `src/store/useManageStore.ts`. Pure filter/select + offline-durable bulk-status builder.
- **Phase 1a — DONE & verified (current-level scope).** `src/components/manage/ManageToolbar.tsx`
  (search + type/milestone/status-facet filters + "Select all N matching" + clear), 
  `src/components/manage/BulkStatusBar.tsx` (offline-staging bulk: set a specific milestone OR each
  unit's current milestone → planned/ongoing/completed, optional dates). Wired into
  `FieldStatusTable.tsx`; the map-only `BulkActionDock` is now gated to the map view (`page.jsx`).
  Bulk edits stage into `pendingTimelineChanges` and sync via the existing offline queue/Apply FAB.
  Verified: `tsc --noEmit` clean, 185 tests pass, `next build` succeeds. Live click-through pending.
- **Phase 1b — DONE & verified (all-levels scope).** Extracted the bottleneck/current-status
  derivation into `src/utils/bottleneck.ts` (+test, 8) and refactored `page.jsx`'s `mapDisplayStatuses`
  to use it (1:1, single source of truth). `useFieldData` gained an optional `unitsOverride`.
  `FieldStatusTable` now fetches cross-sheet data (`useAllProjectUnits`/`useAllProjectStatuses`) and
  derives all-levels current-status when scope = 'all'. Added: scope toggle (This level / All levels)
  in `ManageToolbar`, a loud amber **ALL LEVELS banner**, and a per-row Level label in `StatusTable`.
  Cross-sheet bulk apply is correct (writes by `unit_id`; freshness via `useUpdateStatus`'s existing
  `['all_project_statuses']` optimistic update + invalidation). Verified: tsc clean, 193 tests, `next build`.
  Deferred to Phase 4: row virtualization for very large all-levels grids; cross-sheet optimistic UI
  during apply lags one invalidation tick (data is correct).
- **Phase 2a — DONE & verified.** Per-location management via a row actions menu. New:
  `manage/AnchoredMenu.tsx` (reusable portal/fixed dropdown — avoids `overflow-auto` clipping + `MenuItem`),
  `manage/RowActionsMenu.tsx` (kebab: Rename · Change type · Locate on map · View history · Delete),
  `manage/RenameLocationModal.tsx`. `StatusTable` action cell now renders the kebab; `FieldStatusTable`
  instantiates `useUpdateUnitFields` (rename → `unit_number`, change type → `unit_type`) and renders the
  rename modal; `page.jsx` passes `onLocateUnit` (switch to map + `zoomToFit`) and `onDeleteUnit`
  (`handleDeleteUnit`). Uses existing online mutations (matches how the Map already does rename/delete).
  Verified: tsc clean, 193 tests, `next build`.
- **Phase 2b — DONE & verified.** Assignee management. New `manage/assignee.ts` (pure: `memberLabel`,
  `memberOptions`, `resolveAssignee`, `initials`; +test, 6) and `manage/AssigneeCell.tsx` (avatar chip +
  picker). `StatusTable`'s type column became **Type / Assignee** (combined cell). `FieldStatusTable`
  fetches `useProjectMembers` and wires per-row assign + **bulk assign** + **bulk delete** (added to
  `BulkStatusBar` as an "Also" row); `page.jsx` passes `onDeleteUnits` (`handleDeleteUnits`).
  Verified: tsc clean, 199 tests, `next build`.
  **Trade-off:** assign / change-type / delete (per-row and bulk) use the existing **online** mutations
  (`useUpdateUnitFields` / `handleDeleteUnits`) — same as the Map's rename/delete and Phase 2a. Status
  edits remain the offline-durable path. Making field/delete edits offline-durable = the `PendingChange`
  `kind` generalization, which belongs in **Phase 4** (it also touches the mobile `PendingReviewDrawer`,
  so it deserves its own careful, tested pass rather than bundling into the status pipeline now).
- **Phase 3a — DONE & verified (read-only Gantt + cascade, online).** New `viewMode === 'schedule'`
  (4th toggle in `TopHeader`, render branch in `page.jsx`, map `BulkActionDock` re-gated to exclude it).
  Pure date math in `src/utils/ganttMath.ts` (+test, 19): `dateToX`/`xToDate`/`snapToDay`/`barRect`,
  `windowBounds`, `axisTicks`, `buildScheduleRows`, `cascadeLevelToLocations` (non-destructive), validation.
  Components in `src/components/schedule/`: `ScheduleWorkspace` (scope via `useManageStore`, all-levels via
  `useAllProjectUnits`/`useAllProjectStatuses`, zoom day/week/month, amber all-levels banner, online date
  edits via `useUpdateStatus`), `GanttTimeline` (sticky location column, time axis, today line, gridlines,
  one row per location with milestone bars, click-to-edit date popover via `AnchoredMenu`), `GanttBar`,
  `CascadePanel` (edit `sheets.milestone_schedules` defaults + non-destructive "apply to locations" via
  `useBulkInsertStatusLogs`, overwrite opt-in, confirm echoes count). Behind-schedule coloring reuses
  `progressAnalytics` (`computeUnitVariance`/`varianceFill`) — not forked; N/A slots excluded.
  Old per-unit "Location Schedule Builder" in `SettingsMenu` retired → redirect card into the Schedule view
  (dead builder state/handlers removed). Verified: tsc clean, 218 tests, `next build`. **Live click-through pending.**
  Deferred to 3b: drag/resize bars. Deferred to Phase 4: offline-durable date edits, virtualization at all-levels scale.
- **NEXT — Phase 3b (drag-to-edit bars)**, then 3c (dependencies / critical-path polish), all still **online**.
- **Phase 4 (offline + hardening)** then does ONE `PendingChange`-`kind` generalization pass covering
  **field + delete + schedule** offline durability together (don't generalize the hardened queue twice),
  plus virtualization, export, permissions, and a **batched bulk field write** (bulk assign currently loops
  N online mutations). Minor follow-ups (detail drawer, duplicate, bulk change-type) can slot in anytime.
