# Kickoff — Data Storytelling, Batch B: list accountability + benchmarking moves home (P3 + P4)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Batch B of Data Storytelling** — two phases on ONE branch, one commit each:
> (P3) list accountability — data age, days-behind number, ownership cell, and the
> "Actual Completed" column folded into the status cell,
> (P4) move Private Benchmarking to the home Projects Dashboard. Read these in full,
> then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-07 - Data Storytelling Batch B Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Data-Storytelling-Plan.md` (P3 + P4)
> - `sitepulse-next/AGENTS.md`
>
> ⛔ GATE: do NOT start unless **Batch A is approved and merged to `main`** (its two
> commits — `Data Storytelling P1…` + `P2…` — on `main`). Branch off `main`. Display-only:
> no DB/backend changes, no `status_logs` write-path changes, no forecast-math changes.
> Run autonomously (all decisions are pre-locked); end with ONE review summary. Don't
> commit until gates are green; don't push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this batch
Batch A fixed the story the **dashboard** tells. Batch B fixes the story the **list**
tells, and puts cross-project benchmarking where it belongs. Every list row should answer a
PM's three real questions at a glance: **how old is this data**, **how many days behind is
it** (a number, not just a color), and **whose court is the ball in**. The mostly-empty
"Actual Completed" column folds into the status cell (correction ability preserved). And
Private Benchmarking — cross-project by design — moves off the single-project dashboard to
the home Projects Dashboard. This is the LAST batch; closing it completes the workstream.

## Phase 3 — List accountability: age, days-behind, ownership, completed-fold
All in `StatusTable.tsx` + `src/components/ui/FieldStatusAtoms.tsx`; give `MobileSwipeDeck`
the same data where its card already shows the equivalent. Full scope in the plan §Phase 3.
- **New pure `src/utils/staleness.ts` (+ test):** `lastActivityIso(statusLogs): string | null`
  (max `client_timestamp` across a unit's rows) and `formatAge(lastIso, todayIso): string`
  ("today" / "3d" / "2w" / "—"). Pass dates IN — no `Date.now()`. Tests pin the age
  boundaries + null behavior. (`progressAnalytics.lastActivityAt` already does the max as a
  `Date`; `staleness` is the display-string layer — reuse, don't fork the parsing idea.)
- **Age chip (layout owner-locked 2026-07-07):** a **compact** `3d`/`2w` chip from
  `lastActivityIso`/`formatAge`, **muted, right-aligned under the location name**; hover /
  tooltip = the exact date. No new queries — `client_timestamp` is already loaded.
- **"By whom" in the Unit History modal:** resolve `status_audit_log.user_id` → name via a
  `useProjectMembers` map (the modal already has the audit rows; the hook doesn't join
  `profiles`, so build the name map client-side there). Not a list column.
- **Days-behind number** next to the variance color: render the signed day count already
  inside `VarianceInfo` (e.g. "6d late"). Colors stay Polish-owned (`statusColors.ts` /
  `VARIANCE_COLORS`) — this adds a *number*, never a new color.
- **Ownership cell (layout owner-locked 2026-07-07 = STACKED):** one "Owner" cell with the
  `assigned_to` **person on top** (via the existing `AssigneeCell` / `useProjectMembers`)
  and, when the bottleneck activity has a `subcontractor_id`, the company name **muted
  underneath** (via `useCompanies`) — not an inline badge, not hover-only. Display of
  existing data only — no writes.
- **Completed-fold:** remove the "Actual Completed" column; when a row (main OR expanded
  child) is completed, its `logged_date` renders as the **same editable date-chip pattern
  Polish P4 established** (`DateChipCell`, local to StatusTable — reuse it, don't invent a
  second) inside the status cell; keep the pending-amber treatment. Same handlers — no
  write-path change.

## Phase 4 — Private Benchmarking moves home
- Unmount `SubcontractorBenchmark` from `ProjectDashboard.tsx`; mount it on
  `src/app/dashboard/page.jsx` below the project cards. It is **zero-props + self-fetching**
  (lazy `useBenchmarkDataset(open)`, RLS-scoped, paginated past the 1000-row cap) and
  `QueryProvider` is app-wide, so it mounts as-is. Keep its section header copy
  ("your own jobs only · never shared"). Verify dark/light rendering post-theme-unification.

## Watch-outs
- ⚠ NEVER read from `.claude/worktrees/` — stale repo snapshots live there. Pin searches to
  `sitepulse-next/src`.
- **Reuse Polish P4's `DateChipCell`** for the folded completed date — do NOT create a
  second date-chip pattern (it already covers the "Actual Completed" cell today).
- Staleness derives from `status_logs.client_timestamp` (already loaded), NOT
  `useStatusHistory` (completed-only — wrong signal) and NOT a new query.
- Ownership: `units.assigned_to` for the person; the subcontractor is the **bottleneck
  activity's** `activities.subcontractor_id` → `useCompanies()` — respect applicability so
  the bottleneck is the right activity (AGENTS.md §3).
- Anything counted must respect `ApplicabilityIndex` (N/A never enters a denominator).
- After P3 touches `FieldStatusAtoms`/StatusTable, eyeball `MobileSwipeDeck` too (shared atoms).

## Hard guardrails
- Display-only. No DB/RLS/migrations; no `status_logs` write-path changes; no
  `pendingChanges`/offline-queue changes; extend (never fork) `progressAnalytics`; no
  `mapDisplayStatuses` recolor; no new unpaginated project-wide queries (the benchmark's
  own fetch already paginates — don't add another).
- Don't commit or push until the owner says "Approved." One branch for the whole batch.

## Exit criteria (whole batch)
Per phase before its commit, then once at the end:
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green (new `staleness.ts` fns covered)
- `... run build` green
- dev:3010: a completed row's date edit round-trips (incl. offline pending state); the age
  chip + days-behind number read correctly; the Owner cell shows person and/or sub; table
  width holds at laptop sizes with compact mode on/off; benchmark loads + renders on the
  home dashboard and is gone from the project dashboard; nothing else on home regressed.
- Verify on BOTH Orchard Path III (data-rich) and Mill Pond (thin/empty).
- Close with `verify-feature` across both phases → ONE review summary → STOP (no push until
  "Approved"). **End of the Data Storytelling workstream** — mark the plan + memory complete.
