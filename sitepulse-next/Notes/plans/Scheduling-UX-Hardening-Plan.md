# Scheduling UX Hardening — make the Schedule module intuitive & production-grade (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent specs: `Notes/plans/Scheduling-Foundation-Slice-A-Plan.md` (the module this
> hardens) and `Notes/plans/Scheduling-Activities-Master-Plan.md` (the roadmap it sits under).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) + the two parent plans above.
2. Re-read the files named in each phase **fresh** — do not trust line numbers; they drift.
3. Build the phases **in order**. Each is one fresh session. Close each with the
   `verify-feature` skill (Definition of Done → STOP). Do not commit/push until the owner
   says "Approved."
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
The Scheduling module (the **Schedule view**: activity manager + Gantt + dictionary-backed
pickers + MS Project importer + the playbook first-run wizard) is functionally complete but
still feels rough to a first-time user. When this workstream is done: adding a scope of work
works and is discoverable; picking activities is searchable; the activity panel can be resized
so nothing is cramped; the company **activity dictionary is curatable** from a Global Settings
tab (like the Location Library), so the messy imported tags can be cleaned; and the MS Project
importer explains itself and lets you add a missing activity without leaving it. No change to
the offline status pipeline, the Look-Ahead, or the playbooks data model.

This plan came out of the owner's hands-on review (2026-07-02) of the Slice A scheduling build.
Each item below is a verified finding, not a guess.

## Out of scope / deferred (captured so it's not lost)
- **First-class Scopes/Tracks** (a real saved `scopes` list per project with stable IDs —
  rename/reorder/recolor in one place, empty scopes persist). The owner leaned toward this for
  long-term health; it is deliberately **NOT** in this pass. Reason: a scope is currently the
  `track` TEXT tag carried on `activities` **and `status_logs`**, and read by the offline sync
  engine, the map scope selector (`useMapStore.trackingMode`), `progressAnalytics`, `ganttMath`,
  and `sheets.activity_schedules`. Promoting it to an ID is the same size/risk as the Slice A
  Phase 1 milestone→activity re-key and touches the strictest-safety area (the offline mutation
  queue). It deserves its **own dedicated workstream + migration**, planned deliberately — not
  bundled into a polish pass. → future `Scopes-First-Class-Plan.md`.
- **Importer modal → docked side-by-side redesign** (the full "use the Activities panel beside
  the open importer" rework). The owner chose "explain now, redesign later." This pass adds the
  explainer + an inline add-activity shortcut; the docked-layout rework is a later phase/workstream.
- **Any change to the playbooks data model** (Slice A Phase 5) or the status/audit pipeline.

## Locked product decisions (from the owner, 2026-07-02)
- **Scopes stay lightweight this pass** — fix the bug + pick-or-type menu, NO database change.
  First-class scopes captured as a future workstream (above).
- **Activity tags = editable "default scope" hint + cleanup.** Keep the tag in pickers as a
  helpful, editable, optional default-scope suggestion; make the messy seeded values curatable
  (and bulk-clearable) via the new manager. NOT dropped from the pickers.
- **The Activity Library manager is a new tab in Global Settings**, alongside the existing
  **Location Library** tab — the activity dictionary is global/company-wide config.
- **Importer: explain now, redesign later** (explainer/empty-state + inline add-activity; keep
  it a modal for this pass).
- **No DB migration in this entire workstream** (given lightweight scopes). Curation is data
  edits through existing RLS-gated hooks, not schema/DDL. If any phase discovers it needs one,
  STOP and raise it (⛔) before writing SQL.

## Data model (what these phases touch — mostly READ, no schema change)
Read `src/types/database.types.ts` + `src/types/domain.ts` fresh (both hand-maintained, drift).
- `activities` — a project's activities; `track` (TEXT) is the "scope of work". Scopes are
  **derived** = the distinct `track` values across a project's activities (no scopes table).
- `activity_dictionary` — GLOBAL governed dictionary (Slice A Phase 2). Each entry: `name`
  (globally unique), optional `track` hint (the "tag"), `type`, `status`
  (active/pending/deprecated), `aliases`, `default_project_types`. **RLS: read = member, write =
  owner/admin/pm, never anon.** Write hooks already exist and are unwired (see below).
- No writes to `status_logs`, `activity_dependencies`, `playbooks`, or `sheets` in this workstream.

## Build-on inventory (read these fresh before using — REUSE, do not fork)
- `src/components/schedule/ActivityManagerPanel.tsx` — the activity manager (scopes-of-work tabs,
  auto-advance, dictionary-backed add row via `ActivityDictionaryField`, drag-reorder, edit form,
  predecessor picker). The `w-[360px]` panel. **Scope bug lives here** (`uniqueScopes` derived +
  the "New Scope" `+` handler only `setActiveTrack`s, never persists).
- `src/components/schedule/ScheduleSetupWizard.tsx` — the first-run wizard (playbook tab +
  Pick-Activities multiselect + the free-text "Scope of work" box). **#5/#6 live here.**
- `src/components/schedule/ScheduleWorkspace.tsx` — hosts the panel + Gantt + importer; where a
  resizable divider (#1) is wired.
- `src/components/schedule/MspImportPanel.tsx` — the importer (full-screen modal `fixed inset-0`).
  **#7-partial/#8 live here.**
- `src/components/ActivityDictionaryField.tsx` — the existing dictionary typeahead (search +
  add-custom) used by the panel's add row; **reuse its search pattern for the wizard (#6)**.
- `src/components/taxonomy/LocationLibraryPanel.tsx` — the **exact template** for the Activity
  Library manager (#4): review queue + add + status-filter + search + per-row status/alias edit +
  learned alias suggestions. Mirror it.
- `src/components/GlobalSettingsModal.jsx` — hosts the "Location Library" tab; **add the new
  "Activity Library" tab here** the same way (`activeTab === 'activity-library'`).
- `src/hooks/useActivityDictionary.ts` — `useActivityDictionary`, `useUpsertActivityDictionaryEntry`,
  `useSetActivityDictionaryStatus`, `useAddActivityAlias`, `useProposePendingActivity` — **all
  already built, just unwired.** The manager consumes these (mirrors `useSubtypes` usage).
- `src/utils/activityDictionary.ts` / `src/utils/subtypes.ts` (`filterSubtypesForAdmin`,
  `groupSubtypesByRole`) — mirror the admin filter/group helpers for activities.
- `src/store/useSettingsStore.ts` (`useHydratedStore`) — where a persisted panel-width (#1) lives.
- Do NOT fork `progressAnalytics`, `ganttMath`, `bottleneck`, the status write hooks, or the
  offline queue. Do NOT touch `src/lookahead/`.

## Pure logic to extract + unit-test
Framework-free, deterministic, no `Date.now()` inside (pass values in):
- **`src/utils/activityLibraryAdmin.ts`** (+ test, Phase 3) — `filterActivitiesForAdmin(entries,
  statusFilter, search)` (name + alias + track match) and any grouping/sort for the manager list.
  Mirror `filterSubtypesForAdmin`. This is where the manager's list correctness is pinned.
- Wizard search/filter (Phase 1) can reuse a tiny pure matcher (name + track, case-insensitive);
  co-locate a test if it grows beyond a one-liner.

## Sub-phasing (ship + verify each)

### Phase 1 — Quick wins: scope bug + pick-or-type scope + searchable activity picker
- **Scope:** (all frontend, two files, no migration)
  1. **#2 scope bug** (`ActivityManagerPanel`): a newly-added scope must show its tab
     immediately. Hold added-but-empty scopes in local component state and merge with the derived
     `uniqueScopes` so the tab renders + stays selected; an activity added while it's active
     materializes it (its `track`). (Ephemeral is fine — an empty scope has nothing to persist.)
  2. **#5 pick-or-type scope** (`ActivityManagerPanel` "New Scope" + `ScheduleSetupWizard` "Scope
     of work"): replace the free-text inputs with a combobox — pick an existing scope OR type a
     new one — to stop typos/duplicate-track drift.
  3. **#6 searchable picker** (`ScheduleSetupWizard` Pick-Activities): add a search box (and,
     since tags stay, an optional filter-by-tag) over the flat ~30-item list. Reuse the
     `ActivityDictionaryField` search pattern; keep it a multiselect.
- **Approval gates:** none (no migration, no status-pipeline/RLS change).
- **Exit criteria:** typecheck + test + build green · live `dev:3010`: add a new scope → its tab
  appears at once; scope box is a pick-or-type menu in both places; the wizard list filters as you
  type · close with `verify-feature`.

### Phase 2 — Resizable Activities panel / Gantt divider
- **Scope:** (frontend only)
  1. **#1**: make the boundary between `ActivityManagerPanel` and the Gantt draggable
     (a splitter in `ScheduleWorkspace`), replacing the fixed `w-[360px]`; clamp to a sensible
     min/max; persist the chosen width in `useSettingsStore` (via `useHydratedStore`).
  2. While here, relieve the cramped **edit form** (the reported "cut off" feeling) so it reads
     cleanly at the default width.
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · live: drag the divider, width persists across
  reloads, the edit form is no longer clipped · close with `verify-feature`.

### Phase 3 — Activity Library manager (Global Settings tab) + tag cleanup
- **Scope:** (mirrors the Location Library; **consider splitting 3a panel/tab, 3b cleanup+wiring**)
  1. **`src/utils/activityLibraryAdmin.ts`** (+ tests) — the admin filter/group helpers.
  2. **`ActivityLibraryPanel.tsx`** mirroring `LocationLibraryPanel`: review queue of
     `status='pending'` proposals (promote / alias / retire), add-entry, full list filterable by
     status + searchable across name/aliases, per-row edit incl. the **`track` / default-scope
     hint** and `type`, alias controls. Reuse the existing `useActivityDictionary` write hooks.
  3. Add the **"Activity Library" tab to `GlobalSettingsModal`** next to "Location Library".
  4. **#3/#4 cleanup:** let the owner fix/blank the messy `track` tags in-place, plus a one-click
     **"clear all default-scope tags"** bulk action (data edits via the existing RLS-gated update
     hook — **not** a SQL migration). Curation is owner-driven (they're the domain expert on which
     tags are wrong); do not blind-migrate.
- **Approval gates:** none (writes go through existing RLS-gated hooks; no DDL). If a bulk action
  tempts a raw SQL data-migration, STOP (⛔) and confirm with the owner first.
- **Exit criteria:** typecheck + test + build green · `activityLibraryAdmin` tests pin the
  filter/search · live: open Global Settings → Activity Library, edit/retire/alias an entry, fix a
  bad tag, bulk-clear tags; changes reflect in the Schedule pickers · close with `verify-feature`.

### Phase 4 — Importer: explain it + add-activity without leaving
- **Scope:** (`MspImportPanel`, keep it a modal this pass)
  1. **#8**: an onboarding/empty-state explainer of the flow — drop MSPDI `.xml` → match tasks to
     your activities (aliases auto-match most) → pick the levels/locations → write planned dates —
     shown before a file is loaded and as inline hints in the reconciliation table.
  2. **#7 (partial)**: an inline **"add activity"** affordance inside the importer (reuse
     `ActivityDictionaryField` + the existing add-activity handler) so an unmatched task can get a
     new activity without closing the importer.
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · live: a first-time user can read what the
  importer does before touching it, and add a missing activity mid-reconcile · close with
  `verify-feature`.

## Verification commands (exit-criteria gate)
Run npm with an absolute prefix (bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (one file: ... run test -- src/utils/activityLibraryAdmin.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build         # next build (after editing live components)
```
- **Lint is NOT a gate** (~1850 pre-existing problems). Verify with typecheck + test + build.
- **No E2E** — UI verified via `npm run dev:3010` (from `sitepulse-next/`, port 3010, not 3000).
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `*.test.ts`.

## Hard guardrails (AGENTS.md — do not violate)
- **No `status_logs` / offline-queue changes.** These phases never write status, never touch
  `upsert_status_log` / `.upsert(onConflict)`, and keep `pendingChanges` local (§2). The `track`
  string stays a string this workstream (first-class scopes is deferred).
- **Dictionary writes stay RLS-gated** to owner/admin/pm via the existing hooks; never widen to
  `anon`; the manager only *hides* controls when the user can't manage (mirror `canManage`).
- **No DB migration** in this workstream. If one seems needed, STOP (⛔) and raise it.
- **Types:** derive from `database.types.ts`; narrow JSONB (`aliases`/`default_project_types`) at
  the query boundary; no `Json` into props (§6).
- **Don't fork** `progressAnalytics` / `ganttMath` / `bottleneck`; don't recolor
  `mapDisplayStatuses`; don't touch the Look-Ahead (`src/lookahead/`) or the snapping pipeline.
- **Consolidate, don't add surfaces** — the Activity Library lives in Global Settings (one home,
  beside Location Library); do not spawn a second dictionary editor in the Schedule view.

## Open decisions
- **First-class Scopes/Tracks** — deferred to its own workstream (see Out of scope). Revisit when
  the owner wants to prioritize it; it needs its own plan + a status-pipeline-aware migration.
- **Phase 3 split** — build the panel+tab (3a) and the tag-cleanup wiring (3b) together or as two
  sessions; decide at Phase 3 start based on the size of the mirrored panel.
- **Importer full dock** (#7 complete) — deferred; becomes a layout-rework phase once the
  explainer (Phase 4) lands and the owner still wants side-by-side.
