# Unified Schedule Engine — one model that flows dates across locations (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `sitepulse-next/Notes/plans/Scheduling-Activities-Master-Plan.md`
> (builds on Slice A Foundation + Slice B Analytics, both shipped).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) + the parent master plan.
2. Re-read the files named below **fresh** — do not trust line numbers; they drift.
3. Build the phases in order. Verify after each (§ Verification commands).
4. Keep the owner (product owner, not a developer) in the loop: lead with a
   1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
Today, planned dates enter the app through several disconnected doors (the MS Project
importer, the level `CascadePanel`, and Gantt bar-drag), each with its own rules. This
workstream unifies them into **one model**: you set a **planned start + completion date
for a task on a level**, and the system **spreads that window across the level's
locations in crew-flow order** (staggered), instead of giving every location the same
dates. The window's **duration is derived** from the dates (end − start), never typed
separately. When this is done, setting one level×activity window lays out a realistic,
staggered per-location schedule automatically; hand-tweaks survive; and the importer
becomes just another way to *fill those level windows* rather than a rival date-entry tool.

## Locked product decisions (from the owner, 2026-07-06)
- **Input = planned start + planned completion date** per task per level (NOT a typed
  duration, NOT a rate). This is what the owner already enters in `CascadePanel`.
- **Duration is DERIVED** from that window (end − start), and is **specific to a given
  task on a given level** — there is **no reused per-project duration template**.
- **Crew-flow stagger, not envelope:** the level window is spread across the level's
  locations in walk order (the importer's "subdivide" behaviour), area-weighted only
  when every target unit has a positive `computed_area`, else an even split.
- **Non-destructive by default, opt-in overwrite:** re-generating/re-flowing fills
  untouched locations and leaves hand-adjusted planned dates alone unless the user
  explicitly chooses to overwrite. **Field-completed actuals are ALWAYS preserved**
  (`temporal_state` / `logged_date` / `status_color` never reset — hard invariant).

## Out of scope / deferred
- **No new duration column, no migration** for Phases 1–3 (duration is derived from
  existing dates in `sheets.activity_schedules` + `status_logs`).
- **Cross-level / whole-building crew flow** (crew finishes Level 1 → flows into Level 2)
  → Phase 5, deferred; leans on the existing `activity_dependencies` FS edges.
- **Baseline snapshot + full re-import diff-and-approve** (needs a new isolated
  `schedule_baselines` table — the one ⛔ migration) → Phase 4, gated.
- **Offline-durable schedule edits** — schedule authoring stays **online-first**
  (`useBulkInsertStatusLogs` / `useUpdateStatus`), never the offline mutation queue,
  consistent with import/cascade/Gantt today (AGENTS.md §2).
- **Critical-path / float / resource-leveling** — explicitly not built (AGENTS.md; the
  dependency model is coarse FS-only by design).

## Data model (no schema change in Phases 1–3)
- **Level plan (Layer 1):** `sheets.activity_schedules` (JSONB) — `Record<activityName,
  { start_date, end_date }>`. Already exists; edited by `CascadePanel`. The **duration**
  is `end_date − start_date` for that level×activity — derived, stored nowhere.
- **Location dates (Layer 2):** `status_logs`, one row per `(unit_id, activity_id)` slot
  (`UNIQUE(unit_id, activity_id)`), carrying `planned_start_date` / `planned_end_date`.
  All writes go through the `upsert_status_log` RPC or `.upsert({ onConflict:
  'unit_id,activity_id' })` — **never `.insert()`** (AGENTS.md §2). Strip the synthesized
  display-only `activityName` before any write.
- **Ordering:** `units.walk_sequence` (nullable int, user-set via `WalkSequenceModal`),
  tie-broken by `unit_number` (numeric-aware). `units.computed_area` drives area weighting.
- **Dependencies (Phase 3+):** `activity_dependencies` FS edges (`predecessor_activity_id`,
  `successor_activity_id`, `lag_days`, `ripple_dates` opt-in). Coarse, FS-only.

## Build-on inventory (read these FRESH before using — do NOT fork)
- `src/utils/scheduleReconcile.ts` → **`subdivideTaskWindow(start, end, units, mode)`** —
  the crew-flow stagger. Pure, tested, portable. Returns `{ windows: LocationWindow[],
  weighting }`. **This is the engine to reuse in the cascade path** (today only the
  importer calls it).
- `src/utils/ganttMath.ts` → **`cascadeLevelToLocations({...})`** — the current level→
  location writer. It is **envelope-only** (same window to every unit) and already
  non-destructive + N/A-aware + progress-preserving. Phase 1 generalizes it to offer
  crew-flow stagger by delegating to `subdivideTaskWindow`.
- `src/components/schedule/CascadePanel.tsx` — the level date editor (per-activity
  start/end inputs; "Save level dates" vs "Apply to locations"; override checkbox).
- `src/utils/dateRipple.ts` → `rippleForward(edges, plannedDates, slippedId, newFinish)`
  + `buildRippleWrites(...)` — FS+lag forward push, per-location, push-only. Reuse in Phase 3.
- `src/utils/activityDependencies.ts` → `predecessorEdgeFor` / `wouldCreateCycle`.
- `src/components/schedule/MspImportPanel.tsx` + `src/utils/mspImport.ts` +
  `scheduleReconcile.ts` (`matchTasksToActivities`, `buildImportWrites`) — the importer
  already staggers via `subdivideTaskWindow`; Phase 4 aligns its output into Layer 1.
- `src/utils/progressAnalytics.ts` — variance/forecast single source of truth. **Do NOT
  fork.** Respect applicability (`applicableMilestones`/`applicableActivities`).
- Hooks: `useUpdateSheetSchedule`, `useBulkInsertStatusLogs`, `useUpdateStatus`
  (`src/hooks/useProjectQueries.ts`).

## Pure logic to extract + unit-test (where correctness lives)
- Generalize the level→location writer so it can **stagger**: either extend
  `cascadeLevelToLocations` with a `flowMode: 'subdivide' | 'envelope'` that delegates to
  `subdivideTaskWindow` per activity, or add a sibling `flowLevelToLocations` in
  `ganttMath.ts`. Keep it pure (timestamps in, no `Date.now()`), co-locate `.test.ts`.
- A tiny `deriveDuration(start, end)` helper (inclusive-day count, null-safe) so the
  derived duration is shown consistently in the UI. Unit-test edge cases (missing date,
  end < start, single day).
- Preserve every existing invariant already covered by `cascadeLevelToLocations` tests:
  N/A slots skipped, hand-edited slots skipped unless `overrideExisting`, progress fields
  carried over. Extend those tests for the staggered path.

## Sub-phasing (ship + verify each)

### Phase 1 — Stagger the cascade (crew-flow dates for one level) — ✅ DONE (fbcbfbc, Approved)
> Landed: `cascadeLevelToLocations` gains `flowMode: 'subdivide' | 'envelope'`
> ('envelope' default = pre-Phase-1 behavior byte-identical). 'subdivide'
> delegates to the importer's `subdivideTaskWindow` and mirrors
> `buildImportWrites` exactly — subdivision spans ALL applicable units (a
> hand-dated location still consumes its slice of the walk), the
> non-destructive skip applies at write time, one-sided windows coalesce to a
> same-day window. `CascadeParams.units` widened to the importer's
> `TargetUnit` shape (walk_sequence/unit_number/computed_area ride along).
> `deriveDuration(start, end)` (inclusive days, null-safe, normalizes reversed
> windows) added to ganttMath; CascadePanel gains the Spread/Same-window
> segmented toggle (labels + default 'subdivide' mirroring MspImportPanel), the
> area-vs-even explainer, and a live Duration column. The
> scheduleReconcile↔ganttMath import cycle is deliberate + safe (hoisted
> function declarations only; commented). 11 new tests (1,065 total) pin exact
> slice boundaries, walk-order, skip-not-redistribute, override, N/A exclusion,
> area weighting, coalesce, progress preservation, envelope default. Live
> dev:3010 (Test project): L4 Framing Aug 3–12 staggered area-weighted across
> 5 locations (Aug 3–5 · 6 · 7–8 · 9–10 · 11–12), 65 dated slots skipped,
> re-open shows nothing-to-apply, override previews 65 without writing; L2
> all-dated shows nothing-to-apply. (The staggered L4 Framing dates remain on
> the Test project as legitimate output.)
- **Scope:** Give `CascadePanel` a "Spread across locations (crew flow)" vs "Same window
  everywhere" toggle (mirroring the importer's `DistributionMode`). Route the write
  through the generalized `ganttMath` flow function that delegates to `subdivideTaskWindow`
  for the staggered case. Surface the **derived duration** per activity row (e.g.
  "12 days" next to the start/end inputs). Reuse the existing non-destructive +
  opt-in-overwrite + live-count machinery. Files: `src/utils/ganttMath.ts` (+test),
  `src/components/schedule/CascadePanel.tsx`, maybe a small `deriveDuration` util (+test).
- **Approval gates:** none (no migration, no RLS, no offline-queue, no push until Approved).
- **Exit criteria:** typecheck + test + build green · new/extended pure-logic unit tests ·
  live dev:3010 click-through: set a level window, choose "spread", confirm the two-step
  dialog writes **staggered** per-location dates (each location a contiguous slice, walk
  order) and that a hand-dated location is skipped unless override is on · close with
  `verify-feature` (DoD → stop; do not commit/push until owner says "Approved").

### Phase 2 — Make the two layers legible + fix the Save/Apply confusion — ✅ DONE (d8a89fc, Approved)
> Landed: header reframed ("Level plan — {level}" + "flows down to this level's N
> locations"); per-activity Locations column ("{dated}/{applicable} dated · fills N",
> override-aware) via new pure `cascadeFillCounts` in ganttMath (+2 tests, 1,067
> total — shares the cascade's slot-keying so counts always agree with a real
> apply); buttons collapsed to primary "Save & apply to locations" + quiet
> secondary "Save dates only" (OWNER DECISION: keep the draft-only save).
> Global override checkbox KEPT (per-activity override passed on — the per-row
> counts give the visibility). Write payloads byte-identical. Live-verified on
> Test L4: MEP Rough-ins showed 0/5 dated · fills 5 → Save & apply → same
> two-step confirm → 5 staggered area-weighted slices (Aug 13–15·16·17–18·
> 19–20·21–22) chaining after Framing; all-dated rows read 5/5 dated.
- **Scope:** Reframe `CascadePanel` around the model: a visible "Level plan → these N
  locations" framing; collapse the confusing dual buttons (recall "Apply to locations"
  already saves the level defaults, so standalone "Save level dates" is nearly redundant)
  into one clear primary action ("Save & apply") plus an explicit secondary "Save draft
  only" if kept; show per-activity how many locations are already dated vs will be filled;
  consider per-activity overwrite instead of one global checkbox. Pure UX/relabel pass,
  no data-model change. Files: `CascadePanel.tsx` (+ small presenter helpers/tests).
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · live click-through confirming the
  relabeled flow writes exactly as before · `verify-feature` → stop.

### Phase 3 — Re-flow on change + dependency chaining within a level
- **Scope:** When a level×activity window changes, re-distribute its locations and let FS
  dependencies + lag chain the next activity's window (reusing `dateRipple.rippleForward`
  + `buildRippleWrites`, opt-in per edge via `ripple_dates`). Preserve hand-edits;
  count-confirm before applying downstream shifts. Files: `CascadePanel.tsx` /
  `ScheduleWorkspace.tsx` wiring, reuse `dateRipple.ts` + `activityDependencies.ts`
  (extend tests only).
- **Approval gates:** none (no migration).
- **Exit criteria:** typecheck + test + build green · pure ripple math tested · live
  click-through: moving one activity's level window flows the dependent activity and
  re-staggers locations, hand-edits preserved · `verify-feature` → stop.

### Phase 4 — Import as anchor-loading + baseline / re-import diff ⛔
- **Scope:** Align `MspImportPanel` output into **Layer 1** (level×activity windows) so
  import and manual entry feed the same engine; add a "Set baseline" snapshot and
  re-import **diff-and-approve** (highlight what moved, accept/reject) that **never
  overwrites field actuals**. Needs a **new isolated `schedule_baselines` table**.
- **Approval gates:** ⛔ **DB migration** — author via the `create-migration` skill, show
  the exact SQL, and **STOP** for explicit owner sign-off before applying (mirror the
  `subtypes` RLS: read = member, write = owner/admin/pm, never anon). ⛔ never touch
  production data without the owner's go-ahead.
- **Exit criteria:** migration reviewed + approved + applied · typecheck + test + build
  green · live import→diff→approve click-through on a safe project · `verify-feature` → stop.

### Phase 5 — Cross-level / whole-building crew flow (deferred)
- **Scope:** Let the crew flow level→level (finish Level 1 Drywall → start Level 2
  Drywall) via cross-level FS edges, so one action lays out the whole building's staggered
  schedule; integrate the Slice B forecast. Its own slice; scope when Phases 1–4 land.
- **Approval gates:** TBD at kickoff.

## Hard guardrails (AGENTS.md — do not violate)
- `status_logs` writes go ONLY through `upsert_status_log` / `.upsert(onConflict:
  'unit_id,activity_id')` — never `.insert()`. Strip synthesized `activityName` before writing.
- Schedule authoring is **online-first** — never route these writes through the offline
  mutation queue / `pendingChanges`.
- Do NOT fork `progressAnalytics`; respect applicability (N/A slots never re-enter denominators).
- Never reset a location's progress on a cascade — only planned dates change.
- Derive all types from `database.types.ts` → `domain.ts`; narrow JSONB at the query
  boundary; keep pure logic deterministic (no `Date.now()` inside pure fns).
- Lint is NOT a gate; verify with typecheck + test + build.

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- Live UI check only via `npm run dev:3010` (from `sitepulse-next/`, port 3010). The
  Schedule view + `CascadePanel` are **desktop-only** (narrow viewport shows the mobile
  field deck). ⚠ Do NOT run `next build` while `dev:3010` is live (shared `.next` corrupts
  the dev server → blank render; recover via `scripts/restart-dev.ps1`). Gate mid-session
  with typecheck + test; save `build` for the end.

## Open decisions (resolve at the phase that hits them)
- **Phase 2:** keep a "Save draft only" button or fully collapse to one "Save & apply"?
  (Decide live with the owner during the UX pass.)
- **Phase 3:** does re-flow trigger automatically on window edit, or stay a button? (Lean
  button, consistent with today's explicit two-step.)
- **Phase 4:** baseline granularity (per level×activity vs whole-project snapshot) — settle
  in the migration design with the owner.
