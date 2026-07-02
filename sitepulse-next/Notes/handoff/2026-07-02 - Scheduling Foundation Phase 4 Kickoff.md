# Kickoff — Scheduling Foundation (Slice A), Phase 4: MS Project `.xml` import → reconciliation → planned dates

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of Scheduling Foundation (Slice A)** — import a Microsoft Project schedule (MSPDI `.xml`), reconcile its tasks against the project's activities, and **auto-populate planned dates** across locations. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-02 - Scheduling Foundation Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scheduling-Foundation-Slice-A-Plan.md` (Phase 4 + Pure logic + Hard guardrails + Build-on inventory)
> - `sitepulse-next/AGENTS.md` (§2 status_logs upsert-only + offline posture, §3 no `progressAnalytics` fork + applicability, §4 activity dictionary/dependencies invariants, §6 types + JSONB narrowing)
>
> Branch off `main` if the phase-2/phase-3 stack has been merged; otherwise stack on `feat/scheduling-foundation-phase-3`. **No migration in this phase** (⛔ none hard) — but **confirm the planned-date write count with me before firing the bulk write** (both in the live UI flow and in any verification you run). Consider splitting **4a = parser + pure reconcile logic (+ tests)** and **4b = reconciliation UI + date generation**. Do NOT touch the standalone Look-Ahead (`src/lookahead/`). Don't commit/push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Where Phase 3 left us (read before starting)
Phase 3 shipped the **consolidated Schedule view** (branch `feat/scheduling-foundation-phase-3`,
commits 382d6b8 + aca1832; migration `20260703_activity_dependencies.sql` applied to prod
`pmccdxmuszuykawvlphj`). State now:
- The **Schedule view is the single home for activity management**: `src/components/schedule/`
  holds `ScheduleWorkspace` (toolbar + layout), `ActivityManagerPanel` (add/edit/reorder/
  applies-to + the FS predecessor picker), `ScheduleSetupWizard` (first-run dictionary seeding),
  `SchedulePlanPanel` (floor-plan reference), `GanttTimeline`/`GanttBar`, `CascadePanel`
  (level dates → locations). Settings no longer owns any of it.
- **`activity_dependencies`** is live: coarse FS edges + `lag_days` (see AGENTS.md §4 — FS-only
  CHECK, one-predecessor-per-activity in the v1 UI, `wouldCreateCycle` guard).
- The **activity dictionary** (Phase 2) gives every canonical activity **aliases** —
  `resolveActivityByName` / `searchActivityDictionary` in `src/utils/activityDictionary.ts` are
  the alias-matching helpers the import's reconciler should lean on.
- Planned dates today enter via `CascadePanel` (level defaults → `cascadeLevelToLocations` →
  `useBulkInsertStatusLogs` upsert). **The import reuses this exact write path.**

## What this phase is (plain English)
A team already builds their schedule in Microsoft Project. Instead of retyping dates, they
**export it as `.xml` (MSPDI)**, drop it into the Schedule view, match each imported task to one
of the project's activities (aliases make most matches automatic), pick which levels/locations it
covers, and the app **writes the planned start/end dates** onto those locations' status slots —
the same slots the cascade fills today. Coarse task windows subdivide across locations
**weighted by room area when we have it, evenly when we don't** (degrade honestly, never fake
precision).

## Verify the live surface FIRST (confirm; don't trust this doc)
- `docs/Schdules/real_project_schedule.xml` — the REAL sample (the `.mpp` beside it is out of
  scope; MSPDI `.xml` only). Read its structure fresh: `<Task>` UIDs, names, start/finish,
  outline levels, WBS; check how summary vs leaf tasks and milestone (zero-duration) tasks look.
- `src/utils/procoreDirectoryCsv.ts` (+ `.test.ts`) — the tested pure-import-parser pattern to
  mirror (string in → typed structs out, no I/O).
- `src/utils/ganttMath.ts` — `cascadeLevelToLocations` (the non-destructive planned-date write
  builder the import should generalize or mirror) + `clampEndAfterStart`.
- `src/hooks/useProjectQueries.ts` — `useBulkInsertStatusLogs` (the chunked **upsert** bulk
  write; NEVER plain `.insert()` on status_logs), `useUpdateSheetSchedule`.
- `src/utils/activityDictionary.ts` — alias resolution for task↔activity matching.
- `src/utils/applicability.ts` — N/A slots must be skipped when generating per-location dates.
- `units` area column — verify the exact live column the Scale workstream populates (SF /
  computed area) before weighting by it; fall back to an even split when it's missing/zero.
- `src/components/schedule/ScheduleWorkspace.tsx` — where the import entry point (a toolbar
  button) and the reconciliation UI mount.

## Scope (only this phase)
**4a — parser + pure logic (+ tests, no UI):**
1. `src/utils/mspImport.ts` — pure MSPDI parse: `.xml` string → `{ uid, name, start, finish,
   outlineLevel, wbs, isMilestone, isSummary }[]`. No `Date.now()`, no I/O; callers pass text.
   Test against a fixture derived from the real sample (trim it if the full file is unwieldy).
2. `src/utils/scheduleReconcile.ts` — pure: alias-assisted match of imported tasks →
   activities (exact name → alias → fuzzy-ish contains, in that order; unmatched stays unmatched
   for the human to resolve), and **envelope subdivision** — a task's date window → per-location
   planned start/end weighted by area (even split fallback; suppress — don't fake — when data is
   missing). Respect applicability (N/A slots get nothing).
**4b — reconciliation UI + date generation:**
3. Two-pane reconciliation in the Schedule view: imported tasks on one side, the project's
   activities/locations on the other; confirm/adjust mappings; show exactly what will be written
   (**N dates across M locations**) and require an explicit confirm before the bulk write fires.
4. Write via the established path: build `StatusLogInsert[]` (like `cascadeLevelToLocations`) →
   `useBulkInsertStatusLogs` (**upsert**, online-first, NOT the offline buffer). Non-destructive
   by default (existing per-location dates keep unless an explicit overwrite toggle is set —
   mirror CascadePanel's posture).

## ⛔ Approval gate
No schema change → no SQL gate. The **human gate is the write count**: present "this will set
planned dates on N slots across M locations" and STOP for confirmation in the UI flow — and if
the implementing session runs a live import against real data, confirm with the owner first
(no-live-write-probes: never overwrite existing rows in verification).

## Exit criteria (Definition of Done)
- `typecheck` + `test` + `build` green; `mspImport` + `scheduleReconcile` tests pin the parse +
  matching + subdivision (incl. the even-split and suppress-when-missing branches).
- Live (`npm run dev:3010`): import the real `.xml`, map its tasks (aliases auto-match most),
  planned dates populate across locations with no hand-entry; the Gantt shows the bars.
- Close with the **`verify-feature`** skill. **Do not commit/push until owner says "Approved."**
  Then draft the **Phase 5 kickoff** (playbooks) + hand off.

## Guardrails
- **status_logs writes stay upsert-only** (§2) — the import goes through
  `useBulkInsertStatusLogs` / the RPC path; never plain `.insert()`, never the offline queue.
- **Pure fns stay pure** — no `Date.now()` inside `mspImport`/`scheduleReconcile`; pass
  timestamps/text in. Keep Query-cache values JSON-serializable (§6).
- **Degrade honestly** — even split when area is missing; suppress rather than fake.
- Don't fork `progressAnalytics`; respect applicability; don't recolor `mapDisplayStatuses`;
  don't touch the Look-Ahead (`src/lookahead/`) or the snapping-vector pipeline.
- P6 `.xer` / `.mpp` are **out of scope** (MSPDI `.xml` only).

## Open decisions to resolve at start
- **4a / 4b split or one session?** Leaning two, per the plan.
- **Carry FS links from the import into `activity_dependencies`?** The table now exists, but the
  plan scopes Phase 4 to planned dates. Leaning dates-only v1; links as a cheap follow-on if the
  mapping UI makes them nearly free. Confirm with owner.
- **Import granularity** — per-level task windows vs per-location: the broader interview
  decisions were locked 2026-06-24 (granularity / review-UI / baseline / re-import diff /
  export-actuals — see the Schedule Import feature notes); re-confirm which slice applies to
  this phase before building the UI.
