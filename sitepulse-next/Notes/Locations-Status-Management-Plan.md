# Locations & Status Management — Production Build Plan

> Status: planning (2026-06-15). Owner decisions locked. This is the target for the
> *finished* desktop management experience, delivered in phases.

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
