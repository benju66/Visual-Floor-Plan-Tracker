# Scheduling Foundation (Slice A) — activity model, Schedule view & MS Project import (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `sitepulse-next/Notes/plans/Scheduling-Activities-Master-Plan.md` (Slice A).
> Supersedes: the later phases (6–8) of `Scale-Measure-Production-Rates-Plan.md` are NOT
> touched here — they become Slice B (cost codes + production rates) and will adopt that
> plan's `cost_codes` / `productionRates.ts` design. This plan is Slice A only.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` in full — CRITICAL invariants: `status_logs` upsert-only /
   no `.insert()` (§2), the slot-unique constraint, `pendingChanges` stays local (§2), capture-time
   `client_timestamp`, RLS posture (§2), no `progressAnalytics` fork + applicability (§3), TS/JSONB
   guardrails (§6).
2. Re-read the files named in each phase **fresh** — do not trust line numbers; they drift.
3. Build the phases **in order**. Each is one fresh session. Close each with the `verify-feature`
   skill (Definition of Done → STOP). Do not commit/push until the owner says "Approved."
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
When Slice A is done, a project's schedule is a first-class thing. "Milestones" are renamed
**Activities**, each with a **stable ID** (so renaming one never orphans its history), a **type**
(a durational *task* vs a zero-duration *milestone* marker), and — after the dictionary phase — a
shared, **company-wide governed dictionary** with aliases (so "MEP Rough-In" and "Rough-Ins" resolve
to the same thing). Activities, their sequence, and light dependencies are authored from a new
first-class **Schedule view** (a toggled view like Map/Dashboard), with the floor plan present — not
buried in Settings. A team can **import a Microsoft Project schedule** (`.xml`) and map it onto their
activities to **auto-populate planned dates**, and can **start a new project from a playbook**
(a reusable, project-type-scoped activity sequence) instead of a blank list.

## Out of scope / deferred
- **Cost codes + production-rate analytics** → Slice B (adopts `Scale-Measure-Production-Rates-Plan.md`
  Phases 6–8). Slice A only reserves the `cost_code_id` slot on the dictionary.
- **Systems / Areas** (trash chute, roof→rough-in cross-scope work) → deferred; activities attach to
  **Locations** (and, for building-scale work, a sheet/level) only in Slice A.
- **Critical path / float, resource leveling, non-FS relationships** → not built. Dependencies stay
  **Finish-to-Start + lag, coarse**.
- **P6 `.xer` / `.mpp` import** → deferred; MSPDI `.xml` only.
- **Look-Ahead integration + PPC / reason-for-variance** → the Look-Ahead stays a standalone tool;
  Slice A does NOT touch or absorb it.
- **Offline-durable** schedule/activity/import edits → **online-first** (consistent with the
  Scale plan's posture). The field crew's status-marking path stays fully offline; these new
  authoring/admin actions are online-first.

## Locked product decisions (from the owner)
- **Rename milestones → activities everywhere, schema included.** Safe: negligible real data (internal
  testing only). A column named `milestone` that means "activity" is a permanent papercut.
- **Stable IDs, done right now.** Instances key to an **activity id**, not the mutable name string —
  the simplest path (rename in place + re-key), NOT an `activity_id` FK dual-read (no data to protect).
- **Clean model first, global dictionary next** (owner, 2026-07-01). Lock the stable-ID activity
  model project-scoped (Phase 1), then promote to the global governed dictionary (Phase 2). The
  identity model is done right once, so this is incremental delivery, not a retrofit of the core.
- **Playbooks are in Slice A, sequenced last** (owner, 2026-07-01) — after the dictionary exists.
- **No durations on templates.** Timing lives on instances: imported → (later) measured rate ×
  quantity → manual. Templates hold identity + classification + relationships only.
- **Governance is non-blocking** — `Other (pending)` sentinel; a user is never stuck mid-onboarding.
- **The Schedule view is the home for activity management** — it absorbs the Settings milestone
  manager and the scattered Gantt authoring pieces. Consolidate, don't add a fifth surface.

## Data model
Read `src/types/database.types.ts` + `src/types/domain.ts` fresh; both are hand-maintained and drift
(memory `schema-types-drift`). All migrations additive/idempotent, present SQL + STOP (⛔).

**Today (verify first):**
- `project_milestones` (id, project_id, sequence_order, name, color, track, applies_to_unit_types).
- `status_logs` — the instance/progress row. Slot key is `UNIQUE(unit_id, track, milestone)` where
  **`milestone` is the TEXT name**. Writes go through the `upsert_status_log` RPC + a trigger that
  mirrors to `status_audit_log`. **This name-keying is the fragility being fixed.**
- `milestone_applicability_overrides` — already keys on a `milestone_id` FK → `project_milestones`
  (the id-keyed pattern to mirror).
- `sheets.milestone_schedules` — JSONB planned-date map **keyed by milestone name** (the cascade
  source for planned dates). Also needs re-keying to id.

**After Phase 1 (project-scoped clean model):**
- Rename `project_milestones` → **`activities`**; add `type text not null default 'task'`
  (`'task'` | `'milestone'`). Keep `sequence_order`, `track`, `applies_to_unit_types`, `color`.
- `status_logs`: replace the `milestone` TEXT column with **`activity_id uuid` → `activities(id)`**;
  slot key becomes `UNIQUE(unit_id, activity_id)` (track is derivable from the activity — decide at
  migration time whether to keep track in the key; leaning `(unit_id, activity_id)`). Update the
  `upsert_status_log` RPC, the audit trigger, and `status_audit_log`'s column to match.
- `sheets.milestone_schedules` → re-key by `activity_id` (rename to `activity_schedules` or keep the
  column name, JSON keys become ids). Convert existing keys name→id in the migration.
- `milestone_applicability_overrides` → rename references to activities (already id-keyed).

**After Phase 2 (global governed dictionary — mirrors `subtypes`):**
- NEW global `activity_dictionary` table (cross-project, governed): `id`, `name`, `track`/scope,
  `type`, `status` (`active`/`pending`/`deprecated`), `aliases text[]`, `default_project_types text[]`,
  reserved `cost_code_id uuid null` (Slice B fills it), timestamps. **RLS read = any member, write =
  owner/admin/pm, never anon** (copy `subtypes` / `sheet_metadata` policy shape). Seed an
  `Other (pending)` sentinel.
- `activities.dictionary_id uuid null → activity_dictionary(id)` (like `units.subtype_id → subtypes`);
  a project activity points at a global definition. Project-specific bits (sequence_order, color,
  local label override) stay on `activities`.
- Project-level overrides for global defaults (mirror `milestone_applicability_overrides`).

**After Phase 3 (light dependencies):**
- NEW `activity_dependencies` (predecessor_activity_id, successor_activity_id, type `'FS'`, lag_days
  int default 0). Additive; references `activities(id)`. Kept coarse.

## Build-on inventory (read these fresh before using)
REUSE — do not reinvent or fork:
- `src/store/useUIStore.ts` — `viewMode` (string) + `setViewMode`; the new Schedule view registers here.
- `src/components/TopHeader.tsx` — where view tabs render; add the Schedule tab here.
- `src/components/SettingsMenu.tsx` — the current `milestones` tab (management UI to MOVE into the
  Schedule view), and `sheets.milestone_schedules` editing.
- `src/hooks/useProjectQueries.ts` — `useMilestones`, `useUpdateMilestone`, `useMilestoneOverrides`,
  `useSetMilestoneApplicability`, `useUpdateMilestoneRules`, `updateSheetScaleMutation`. Extend/rename
  these; don't add parallel hooks.
- `src/hooks/useMapActions.ts` — `commitUnitMilestone`, the planned-date cascade
  (`sheetSchedule.start_date/end_date` → status), `handleApplyBulkStatus`. The import's planned-date
  write reuses this cascade.
- `src/components/schedule/` — `GanttBar`, `GanttTimeline`, `ScheduleWorkspace`, `CascadePanel`
  (the scattered Gantt authoring pieces to consolidate into the Schedule view).
- `src/utils/procoreDirectoryCsv.ts` (+ `.test.ts`) — the tested import-parser pattern the MSPDI
  parser mirrors (pure, deterministic).
- `src/utils/locationTaxonomy.ts` + the `subtypes` migration (`20260616_location_taxonomy.sql`) — the
  governed-dictionary + aliases + `default_project_types` + `Other (pending)` pattern Phase 2 mirrors.
- `src/utils/bottleneck.ts`, `src/utils/progressAnalytics.ts` (`orderedTrackMilestones`),
  `src/utils/ganttMath.ts` — read on `sequence_order` today; update to the renamed model. **Do not
  fork `progressAnalytics`.**
- `src/store/useMapStore.ts` — `ToolMode` union (calibration/measure precedent for any Schedule-view
  canvas interaction).

## Pure logic to extract + unit-test
Framework-free, deterministic, no I/O, never call `Date.now()` inside (callers pass timestamps):
- **`src/utils/mspImport.ts`** (+ test, Phase 4) — parse MSPDI `.xml` → `{ id, name, start, finish,
  outlineLevel, wbs }[]`; pure string→struct. Test against a real sample (place under a fixtures dir).
- **`src/utils/scheduleReconcile.ts`** (+ test, Phase 4) — alias-assisted match of imported tasks →
  activities; envelope subdivision (coarse task date window → per-location planned dates weighted by
  `computed_area`/quantity). Pass everything in; suppress (don't fake) when area is missing.
- **`src/utils/activityDictionary.ts`** (+ test, Phase 2) — alias resolution / canonicalization,
  `default_project_types` filtering (mirror `locationTaxonomy` helpers).
- **`src/utils/playbooks.ts`** (+ test, Phase 5) — apply a playbook → an ordered activity set + edges.

## Sub-phasing (ship + verify each)

> Each phase = one fresh session. Master-plan mapping: master "Phase 1" expands into Slice-A
> Phases 1, 2 and 5; master "Phase 2" = Slice-A Phase 3; master "Phase 3" = Slice-A Phase 4.

### Phase 0 — Housekeeping: backfill the scale-columns migration ⛔ migration (no-op)
- **Scope:** Write `supabase/migrations/<date>_sheets_scale_columns.sql` reflecting the ALREADY-LIVE
  `sheets` scale columns (`scale_units_per_px numeric`, `scale_unit text`, `scale_calibration jsonb`;
  legacy `scale_ratio`, `scale_preset` if not already in a migration). Additive + idempotent
  (`ADD COLUMN IF NOT EXISTS`), a **no-op against prod**. Verify exact live types/defaults first
  (`select column_name, data_type, is_nullable, column_default from information_schema.columns where
  table_name='sheets' and column_name like 'scale_%';`). No code/behavior change.
- **Approval gate:** ⛔ present the SQL via the `create-migration` skill and STOP; it must be a
  verified no-op — do not touch prod data.
- **Exit criteria:** SQL confirmed no-op against live schema · `typecheck` green · close with
  `verify-feature`. (Tiny — the implementing session can knock it out fast; it also exercises the
  SQL-approval gate before Phase 1's big migration.)

### Phase 1 — Activity model: rename + template/instance + stable IDs + type ⛔ migration
- **Scope:**
  1. ⛔ **Migration:** rename `project_milestones`→`activities` (+ `type` column); re-key `status_logs`
     from `milestone` TEXT to `activity_id` FK (+ new slot constraint); update `upsert_status_log`,
     the audit trigger, and `status_audit_log`; re-key `sheets.milestone_schedules` name→id; update
     `milestone_applicability_overrides` references. Additive-where-possible but this IS a rename —
     present full SQL + STOP.
  2. Update `database.types.ts` + `domain.ts` (rename types, add `type`; instances carry `activity_id`).
  3. Sweep the code rename (milestone→activity) across hooks/components/utils/stores; update
     `bottleneck.ts` / `orderedTrackMilestones` / `ganttMath.ts` to the new names + id-keying. Keep
     behavior identical — this phase changes names + keys, not features.
- **Approval gate:** ⛔ DB migration touching `status_logs` + the RPC (the offline-sync slot invariant).
  Present SQL + STOP. Do NOT weaken the upsert-only rule or LWW guard.
- **Exit criteria:** `typecheck` + `test` + `build` green · existing status tracking works unchanged
  (live `dev:3010`: mark a status, reload, history intact) · renaming an activity does not orphan its
  history · close with `verify-feature`. **Consider splitting: 1a = migration + types; 1b = code sweep.**

### Phase 2 — Global governed activity dictionary (aliases, add-custom, project-type scoping) ⛔ migration
- **Scope:**
  1. ⛔ **Migration:** NEW global `activity_dictionary` (see Data model), RLS read=member/write=
     owner·admin·pm/never anon (copy `subtypes`), seed `Other (pending)`; add
     `activities.dictionary_id` FK; project-override table (mirror applicability overrides). Present SQL + STOP.
  2. `activityDictionary.ts` (pure: alias resolution, project-type filtering) + tests.
  3. Query hooks (read=member, writes=privileged) + wire the activity editor to pick from the
     dictionary (aliases searchable) with a non-blocking add-custom / propose path.
- **Approval gate:** ⛔ DB migration + RLS. Present SQL + STOP.
- **Exit criteria:** `typecheck` + `test` + `build` green · pick a dictionary activity by an alias;
  add a custom one without being blocked · close with `verify-feature`.

### Phase 3 — Consolidated "Schedule" view (+ light dependency authoring)
- **Scope:**
  1. New `viewMode` value + `TopHeader` tab + the Schedule view component. **Move** the activity
     management UI out of `SettingsMenu` into this view; **consolidate** the `schedule/` Gantt pieces
     here. Floor plan present for space-bound authoring. First-run **wizard mode** for onboarding.
  2. ⛔ small **migration:** `activity_dependencies` (FS + lag). Minimal authoring UI (ordering + a
     simple predecessor picker) — coarse, no CPM. Present SQL + STOP.
  3. Do NOT touch the standalone Look-Ahead.
- **Approval gate:** ⛔ the (small) dependencies migration. UI otherwise ungated.
- **Exit criteria:** `typecheck` + `test` + `build` green · live: build/edit a project's activity set
  + sequence entirely from the Schedule view; Settings no longer owns it; Look-Ahead untouched · close
  with `verify-feature`. **Consider splitting: 3a = view shell + management move; 3b = dependencies.**

### Phase 4 — MS Project `.xml` import → reconciliation → planned dates
- **Scope:**
  1. `mspImport.ts` (MSPDI parse) + `scheduleReconcile.ts` (alias match + envelope subdivision) +
     tests, against a real sample fixture.
  2. Two-pane reconciliation UI in the Schedule view: imported tasks ↔ activities/locations; confirm
     mappings; **generate planned dates** on instances via the existing sheet-schedule cascade
     (`useMapActions`), subdividing coarse task windows by `computed_area`. Online-first bulk write
     (NOT `status_logs.insert`, NOT the offline buffer — via the established mutation path).
  3. Degrade honestly when area is missing (fall back to even split; never fake precision).
- **Approval gate:** none hard (reuses existing write paths; no schema change). Confirm the planned-date
  write count with the user before firing the bulk write.
- **Exit criteria:** `typecheck` + `test` + `build` green · `mspImport`/`scheduleReconcile` tests pin
  the parse + subdivision · live: import a real `.xml`, map it, planned dates populate across locations
  with no hand-entry · close with `verify-feature`. **Consider splitting: 4a = parser + pure logic;
  4b = reconciliation UI + date generation.**

### Phase 5 — Playbooks (reusable project-type-scoped activity sequences) + project overrides
- **Scope:**
  1. ⛔ **migration:** playbook storage (a named, project-type-scoped, ordered set of dictionary
     activities + their default FS edges). Present SQL + STOP.
  2. `playbooks.ts` (pure: apply playbook → activities + edges) + tests.
  3. UI: on project create (and from the Schedule view), start from a playbook → seeds the project's
     activities + sequence + dependencies. Non-blocking; fully editable after.
- **Approval gate:** ⛔ DB migration.
- **Exit criteria:** `typecheck` + `test` + `build` green · a new project starts from a playbook and
  gets a full activity set + sequence in one action · close with `verify-feature`.

## Verification commands (exit-criteria gate)
Run npm with an absolute prefix (bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (one file: ... run test -- src/utils/mspImport.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components)
```
- **Lint is NOT a gate** (~1850 pre-existing problems). Verify with typecheck + test + build.
- **No E2E** — UI verified via `npm run dev:3010` (from `sitepulse-next/`, port 3010, not 3000).
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `*.test.ts`.

## Hard guardrails (AGENTS.md — do not violate)
- **status_logs (Phase 1):** writes stay on `upsert_status_log` / `.upsert(onConflict)` — NEVER plain
  `.insert()` (§2). Keep the LWW timestamp guard and capture-time `client_timestamp`. The slot key
  changes from name to id — do not otherwise weaken the invariant. `pendingChanges` stays local (§2/§6).
- **Migrations:** additive + idempotent, guarded RLS, **no `anon` grants**, `COMMENT ON`. Present SQL
  and **STOP** (⛔) — Phases 0, 1, 2, 3, 5.
- **Types:** `database.types.ts` hand-maintained; derive domain types from the Row; narrow JSONB at the
  query boundary; no `Json` into props (§6).
- **Pure fns:** no `Date.now()` inside `mspImport`/`scheduleReconcile`/`activityDictionary`/`playbooks`;
  callers pass timestamps. Keep Query-cache values JSON-serializable (§6).
- **Don't fork `progressAnalytics`**; respect applicability (N/A out of denominators, §3); don't recolor
  `mapDisplayStatuses`; don't break the offline mutation queue or the snapping-vector pipeline.
- **Don't touch the Look-Ahead** (`src/lookahead/`) or `sheets.milestone_schedules` semantics beyond the
  name→id re-key.
- **Consolidate, don't add** — remove the Settings milestone manager when the Schedule view takes over;
  don't leave two homes.

## Open decisions
- **Phase 1 slot key** — keep `track` in the constraint (`(unit_id, track, activity_id)`) or simplify to
  `(unit_id, activity_id)` since the activity determines track. Decide at migration time; leaning simpler.
- **Phase 3 dependency authoring depth** — ordering + simple predecessor picker in v1; richer graph UI
  deferred. Confirm at Phase 3.
- **Playbook storage shape** (Phase 5) — global governed vs seeded-from-dictionary snapshot. Resolve at
  Phase 5 start (depends on how governed the dictionary feels after Phase 2).
