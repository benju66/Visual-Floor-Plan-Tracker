# Phase 3 — Gantt / Timeline Schedule (self-contained build plan)

> Audience: a **fresh Claude Code session** with no memory of the chat that produced this.
> Read this top-to-bottom first, then re-read the actual current files before editing (the
> codebase moves faster than docs — see "Verify before you trust" below).
> Parent spec: `sitepulse-next/Notes/Locations-Status-Management-Plan.md` (§8 has full build status).

---

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) and the parent plan §8.
2. Re-read the files named below **fresh** — do not trust line numbers here; they drift.
3. Build in the sub-phases in §8. **Verify after each slice** with typecheck + tests + build (§9).
4. Keep the user (a product owner, not a developer) in the loop: lead answers with a 1–2
   sentence plain-English summary; explain jargon in passing; keep it short.

## 1. What this is
The desktop **List view** has been rebuilt into a "Locations & Status management workspace"
(`viewMode === 'list'`). Already shipped & verified (Phases 0–2b):
- Search + faceted filters + "Select all N matching" (`ManageToolbar`, `useManageStore`, `utils/locationFilters.ts`).
- Offline-durable **bulk status** via the existing staging buffer (`utils/bulkStatus.ts` → `pendingTimelineChanges`).
- **All-levels scope** (`scope: 'level' | 'all'`) with a loud amber banner + Level labels; cross-sheet
  current-status via `utils/bottleneck.ts` (extracted from `page.jsx`'s `mapDisplayStatuses`).
- Per-location **row actions** (Rename / Change type / Locate on map / History / Delete) + **assignee**
  column/picker + **bulk assign/delete** (`components/manage/*`).
  NOTE: assign/type/delete are **online** mutations (status edits are the offline-durable path).

Phase 3 adds the **schedule** dimension as a first-class, visual experience.

## 2. Goal
Replace the buried, row-by-row "Location Schedule Builder" (in `SettingsMenu.tsx`,
`activeTab === 'schedule'`) with a real **Gantt/timeline**: horizontal bars per
location × milestone you can read and drag, a **level → location date cascade**, milestone
**dependencies**, and **behind-schedule** coloring. One canonical date editor shared with the
list's inline dates and the bulk "Set dates".

## 3. Locked product decisions (from the owner)
- **Full Gantt** (not just a smarter date grid): draggable bars, level→location cascade, dependencies,
  behind-schedule surfacing.
- Works at **both scopes** (this level / all levels), mirroring the management workspace.
- **Offline parity is the end goal but is Phase 4, NOT Phase 3.** Build the entire Gantt with **online**
  date edits (consistent with how field/delete already work today). Offline-durable date edits land in
  **Phase 4's single `PendingChange`-generalization pass**, shared with the deferred field/delete offline
  work — the whole reason to build Gantt online-first is so that hardened queue is generalized **once, not twice**.

## 4. Data model (schedule lives in two places — unify them)
- **Per-location dates:** `status_logs` rows carry `planned_start_date`, `planned_end_date`,
  `logged_date` (actual), plus `temporal_state`, `milestone`, `track`, `unit_id`, `status_color`.
  One row per `(unit_id, track, milestone)` slot (UNIQUE constraint). This is the per-bar data.
- **Level defaults:** `sheets.milestone_schedules` is `Record<milestoneName, {start_date, end_date}>`
  (domain type `MilestoneSchedules`). Edited via `useUpdateSheetSchedule(projectId)`. The
  **cascade** should let a level's milestone dates flow down to its locations, with per-location override.
- Milestone order/dependencies come from `project_milestones.sequence_order` (already used everywhere).
- Applicability: N/A (unit × milestone) slots must be excluded from bars/denominators — use
  `utils/applicability.ts` (`isMilestoneApplicable`, `ApplicabilityIndex`) and
  `progressAnalytics.applicableMilestones`, exactly like the rest of the app.

## 5. Build-on inventory (read these fresh before using)
- `src/utils/progressAnalytics.ts` — **single source of truth for schedule-variance/lag math**
  (`computeUnitVariance`, `varianceFill` / `varianceLabel` / `VARIANCE_LEGEND`, `summarizeGroup`,
  `applicableMilestones`). **Reuse for behind-schedule coloring — do NOT fork.** It's applicability-aware.
- `src/utils/bottleneck.ts` — current/bottleneck status per unit (Phase 1b). Tested.
- `src/hooks/useProjectQueries.ts` — `useUpdateSheetSchedule`, `useStatuses`, `useAllProjectStatuses`,
  `useAllProjectUnits`, `useMilestones`, `useBulkInsertStatusLogs`, `useUpdateStatus` (the last two are
  how the current schedule builder writes; `useUpdateStatus` already optimistically updates +
  invalidates `['all_project_statuses']`).
- `src/store/useManageStore.ts` — `scope` + `filters` (reuse for scope; consider a `schedule` UI slice).
- `src/store/useUIStore.ts` — `viewMode` (currently `'list' | 'map' | 'dashboard'`). A `'schedule'` view
  is the cleanest home; wire the toggle in `src/components/TopHeader.tsx`.
- `src/components/SettingsMenu.tsx` (`activeTab === 'schedule'`) — the existing builder to replace/retire
  (`stageScheduleUpdate`, `handleApplyScheduleChanges`, `scheduleLevelId`, `scheduleTypeFilter`).
- `src/components/ProjectDashboard.tsx` + `dashboard/FloorPulse.tsx` — the established **all-project
  fetch + level scope control** pattern; mirror it, don't reinvent.
- `src/components/manage/AnchoredMenu.tsx` — reusable portal dropdown (Phase 2a) for any popovers.
- Libraries available: **`date-fns`** (date math — use it), `@dnd-kit/*` (present, but Gantt drag is
  usually custom pointer math; dnd-kit is optional). Icons: `lucide-react`. Styling: Tailwind v4.

## 6. Architecture
- **New view** `viewMode === 'schedule'` (add to `useUIStore` union + `TopHeader` toggle + `page.jsx`
  render branch). Alternative: a tab inside the list — but a dedicated view matches the owner's
  "first-class scheduling" intent.
- **`components/schedule/ScheduleWorkspace.tsx`** — container: scope (reuse `useManageStore`), level/all
  data (reuse `useAllProjectUnits`/`useAllProjectStatuses` + `bottleneck`/raw statuses), zoom (day/week/
  month), date-window state, toolbar.
- **`GanttTimeline.tsx`** — the grid: time axis (dates), one row per location (or per location×milestone
  expandable), a "today" line, behind-schedule coloring from `progressAnalytics`.
- **`GanttBar.tsx`** — a single milestone bar; drag the body to shift, drag edges to resize; commits
  `planned_start_date`/`planned_end_date`. Snap to day. Disable drag on N/A slots.
- **Cascade control** — set a milestone's dates at the level (`useUpdateSheetSchedule`) and offer
  "apply to locations without an override". Unify with the list's date editing so there's ONE editor.
- **Virtualization** — all-levels can be hundreds of rows; use windowing (e.g. a light virtual list)
  if row counts get large. (Deferred from Phase 4 but may bite here first.)

## 7. Pure logic to extract + unit-test (this is where the load-bearing correctness lives)
Create `src/utils/ganttMath.ts` (+ `.test.ts`) — framework-free, deterministic. Suggested functions:
- `dateToX(date, windowStart, pxPerDay)` / `xToDate(...)` and `barRect(start, end, ...)`.
- `snapToDay(x, pxPerDay, windowStart)`.
- `buildScheduleRows(units, statuses, milestones, applicabilityIndex, track)` → bars per applicable
  slot with start/end/state/variance inputs (feed colors from `progressAnalytics`, don't recompute).
- `cascadeLevelToLocations(levelSchedule, units, existing, { overrideExisting })` → the writes to apply.
- Validation: `clampEndAfterStart`, dependency checks (milestone B start ≥ A end by `sequence_order`).
Pass timestamps IN (don't call `Date.now()` inside pure fns — keeps tests deterministic; the app layer
stamps `client_timestamp` at capture time per AGENTS.md §2).

## 8. Sub-phasing (ship + verify each; online-first)
- **3a — Read-only Gantt + cascade view. ✅ SHIPPED & verified (2026-06-15).** New view, time axis, bars
  from existing dates, today line, behind-schedule coloring (progressAnalytics), zoom, scope. Cascade
  *display* + a one-shot "apply level dates to locations" using existing **online** writes
  (`useUpdateStatus`/`useBulkInsertStatusLogs`/`useUpdateSheetSchedule`). SettingsMenu builder retired →
  redirect card. Files: `utils/ganttMath.ts` (+test, 19), `components/schedule/{ScheduleWorkspace,
  GanttTimeline,GanttBar,CascadePanel}.tsx`. tsc clean · 218 tests · build green. (Live click-through pending.)
- **3b — Drag to edit.** Drag/resize bars → online date writes (optimistic). Validation + dependency
  guards. Keyboard/a11y where reasonable.
- **3c — Dependencies / critical path polish.** Surface slack, behind-schedule rollups (reuse
  `summarizeGroup`), forecast honesty (don't fake forecasts for tiny samples — AGENTS.md §3 dashboard rule).
> **Phase 4 (NOT part of Phase 3 — listed here only so you build Gantt online-first):** the single
> offline-durability pass. It generalizes the staging buffer (`PendingChange` gains a `kind` discriminant:
> `status | field | delete | schedule`) so Gantt date edits AND the deferred field/delete edits both queue
> offline and replay. Touches `types/domain.ts`, `hooks/useFieldData.ts` (`handleApplyAll` dispatch),
> `utils/pendingChangesStore.ts` (+tests), and the mobile `components/PendingReviewDrawer.tsx` (must render
> new kinds sensibly). High-care, well-tested — do it once, covering field/delete + schedule together.

## 9. Verify before you trust (session learnings — these WILL save you)
- **Re-read files fresh.** The chat that wrote this hit stale snapshots (a removed `DesktopCardGrid`
  still appeared in cached reads). Always re-read the real file before editing.
- **Glob quirk:** `**/Name.*` works; `sitepulse-next/...`-**prefixed** globs silently miss files here.
- **Bash cwd persists** across calls (a `cd` sticks). Run npm with an **absolute prefix**:
  `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run <script>`.
- **Verification gate** (AGENTS.md §9 — lint is NOT a gate; ~1850 pre-existing lint problems):
  - `... run typecheck`  (tsc --noEmit, whole project)
  - `... run test`       (vitest run; target one file with `... run test -- src/utils/ganttMath.test.ts`)
  - `... run build`      (next build — run after editing live components)
  - Tests import `{ describe, it, expect, vi }` from `'vitest'` (globals are OFF). Co-locate `foo.test.ts`.
  - No E2E framework — **live click-through in `npm run dev` is the only UI verification**; recommend it
    before declaring done.
- **Local dev runs on port 3010** via `npm run dev:3010` (from `sitepulse-next/`), not the default 3000.
  If you hit `Jest worker … exceeding retry limit`, it's usually a stale dev server / `.next` cache:
  stop it, `Remove-Item -Recurse -Force .next`, restart (and check for duplicate `node` dev servers).

## 10. Hard guardrails (AGENTS.md — do not violate)
- `status_logs` writes: **only** `upsert_status_log` RPC or `.upsert({ onConflict: 'unit_id,track,milestone' })`.
  Never `.insert()`. Keep `client_timestamp` at capture time. Don't touch the LWW guard / RLS posture.
- Don't migrate `pendingChanges`/`pendingTimelineChanges` off local `useState`; keep the IDB key format
  `sitepulse-pending-changes-${projectId}` and the `hasRehydrated` guard; keep cache values JSON-serializable.
- Don't fork `progressAnalytics` math; respect applicability everywhere.
- Never recolor `mapDisplayStatuses` (it feeds write paths). New TS files only; derive domain types from
  `database.types.ts`; prefer `unknown` + narrowing over `any`.

## 11. Open decisions — RESOLVED with the owner (2026-06-15)
- **Dedicated `'schedule'` view** (not a List tab). ✅ shipped in 3a.
- **Rows per location**, milestone bars inline (not per location × milestone). ✅ shipped in 3a.
- **Default zoom = week**; cascade default = **only-empty** (non-destructive), overwrite is an explicit opt-in. ✅ shipped in 3a.
- 3c critical-path: **follow-up**, not v1 (3a/3b ship first).

## 12. Definition of done (Phase 3a, first shippable slice)
Schedule view renders bars from real dates at both scopes, behind-schedule colored via progressAnalytics,
today line + zoom work, the level→location cascade applies online, the old SettingsMenu builder is
retired/redirected, `ganttMath` is unit-tested, and `typecheck + test + build` are green — then a live
click-through in the app.
