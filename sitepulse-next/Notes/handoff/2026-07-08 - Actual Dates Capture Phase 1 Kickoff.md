# Kickoff — Actual-Dates Capture, Phase 1: enterable actual-start date (stored, offline-durable)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Actual-Dates Capture** (make "Actual Started" an editable, stored date on
> the desktop List's expanded per-activity rows — entered value wins over the guessed "ongoing"
> mark and drives the actuals/variances; blank when neither entered nor genuinely ongoing). Read
> these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-08 - Actual Dates Capture Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Actual-Dates-Capture-Plan.md` (the plan-of-record — Phase 1)
> - `sitepulse-next/AGENTS.md` (§2 status_logs/upsert_status_log + offline queue + RLS; §3
>   progressAnalytics no-fork + applicability; §4 migrations; §6 types)
>
> Base off the `schedule-variance-columns-phase-2` branch tip (Phases 1–3 of Schedule Variance
> Columns are stacked there, NOT on `main` — see the branch note). This phase **touches the
> database + write path**: ⛔ present the FULL migration SQL and **STOP** for my go-ahead before
> applying it (the dev build points at the PRODUCTION db). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this phase is
The team can't reliably tap "ongoing" in the field, so the *derived* actual-start (and the Actual
Duration / Variance Start / Variance Duration built on it) is often a misleading completion-day
guess. This phase lets them **type the real actual-start date at the computer**, stores it per
activity slot, and makes that entered value the trusted source. It's the first **write-path** phase
of the Schedule Variance Columns work — everything before it was display-only.

Completion dates are already captured + editable (`logged_date`, the "Actual Completed" chip), so
the ONLY new field is **actual-start**.

## ⚠ Branch base (same stacking situation the prior phases hit)
Schedule Variance Columns **P1+P2 are committed on `schedule-variance-columns-phase-2`** (not main);
**Phase 3** (expanded-list actuals *display*, incl. `resolveActualStartIso` + `ExpandedActivityAudit`)
is built but **uncommitted / pending owner approval** on that branch. **Base this phase on that branch
tip** (once Phase 3 is committed) — it depends on Phase 3's expanded-row actuals + `resolveActualStartIso`.
If Phase 3 isn't committed yet, confirm with the owner. Flag the eventual merge order (variance
P1→P2→P3, then this, to `main`, together).

## Required reading (fresh — do not trust line numbers)
- `Notes/plans/Actual-Dates-Capture-Plan.md` — **Data model**, **Build-on inventory**, **Pure logic**,
  **Phase 1 scope + ⛔ gates**, **Hard guardrails**, **Open decisions**.
- `AGENTS.md` — §2 (the idempotent `status_logs` sync: `upsert_status_log` RPC only / never `.insert()`,
  LWW `client_timestamp` guard, capture-time timestamps, offline `pendingChanges` stays local +
  project-scoped IDB, RLS posture — INVOKER, never anon), §3 (progressAnalytics single source; N/A
  applicability), §4 (new column → `database.types.ts` + `domain.ts` + migration + README table), §6 (types).
- The real files: `supabase/migrations/20260701_activity_model.sql` (current `upsert_status_log` body to
  copy verbatim + extend), `20260706_audit_activity_name.sql` (audit trigger — explicit column list, so
  adding a column is SAFE; leave it alone), `src/types/database.types.ts` (`status_logs` block ~line 845,
  RPC `upsert_status_log` ~1150), `src/hooks/useMapActions.ts` (`commitUnitActivity` `newLogData`),
  `src/hooks/useProjectQueries.ts` (`useUpdateStatus` `safeData` → `rpc('upsert_status_log', …)`),
  `src/hooks/useFieldData.ts` (`handleTimelineUpdate`, `pendingTimelineChanges`),
  `src/components/StatusTable.tsx` (expanded rows + `DateChipCell`), `src/components/UnitHistoryModal.tsx`
  (Journey actual-start), `src/utils/progressAnalytics.ts` (`resolveActualStartIso`/`activitySchedule`).

## Scope (Phase 1 only — one vertical slice)
1. **Migration** `supabase/migrations/20260711_status_logs_actual_start.sql` (idempotent):
   `ALTER TABLE status_logs ADD COLUMN IF NOT EXISTS actual_start_date DATE;` + `CREATE OR REPLACE
   FUNCTION upsert_status_log` = the current body **verbatim** plus `actual_start_date` in the INSERT
   column list, VALUES (`NULLIF(log_data->>'actual_start_date','')::date`), and `ON CONFLICT … DO UPDATE
   SET actual_start_date = EXCLUDED.actual_start_date`. Keep SECURITY INVOKER, `search_path`, LWW guard,
   grants **unchanged**. No RLS change. README migration table row. **⛔ present SQL + STOP for approval.**
2. **Types:** `status_logs` Row/Insert/Update += `actual_start_date: string | null` in `database.types.ts`
   (`domain.ts` `StatusLog` derives automatically).
3. **Write path:** thread `extraProps.actualStartDate` through `handleTimelineUpdate` +
   `pendingTimelineChanges` (offline) and `commitUnitActivity`'s `newLogData`. `useUpdateStatus` already
   forwards the blob — just confirm clear-semantics (empty/null must clear via the RPC `NULLIF`).
4. **UI:** the Phase-3 "Actual Started" display sub-line on the expanded rows → an **editable
   `DateChipCell`**, wired exactly like the sibling Planned Start / Planned Completion / Actual Completed
   chips in that row (desktop List only).
5. **Derivation (entered wins):** extend `resolveActualStartIso(events, { state, loggedDate, enteredStart })`
   — entered date wins; else a genuine `ongoing` mark; else `null` → **blank** (drop the completion-day
   guess from the numbers). Apply in **both** StatusTable (list) and UnitHistoryModal (Journey) so they agree.
6. **Tests:** the extended pure helper (entered-wins / ongoing-fallback / blank cases); a write-path or
   offline round-trip assertion if feasible.

## Watch-outs
- **Never `.insert()`** into status_logs; keep the RPC / `.upsert(onConflict:'unit_id,activity_id')`.
- **Strip `activityName`/`milestone`** before the write (already done in `useUpdateStatus`).
- **Offline parity:** the actual-start edit must stage into `pendingTimelineChanges` and replay through
  the IDB queue with **no duplicate rows**; keep that state local `useState` + IDB (never Zustand/Query).
- **LWW guard + capture-time `client_timestamp`** — unchanged; the edit stamps `capturedAt` like the others.
- **Blank, not guess:** a completed-but-never-ongoing slot with no entered date shows `—` for the
  start/duration cells (the whole point). The two reliable numbers (planned Nd, finished late/early) stay.
- **One definition of actual start** — extend `resolveActualStartIso`; do not add a second derivation.
- **Applicability:** N/A slots never get an actual-start cell/number.

## Exit criteria
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green — extended `progressAnalytics.test.ts` + existing suites still green
- `... run build` green
- `dev:3010` on **Orchard Path III** (Level 4, data-rich e.g. 4101): type an actual-start on an expanded
  row → it **saves, survives reload**, drives Actual Duration / Variance Start / Duration, and **wins** over
  the ongoing guess; a jumped-to-complete row with **no** entry shows **blanks** (not 0d / inflated
  variances). **Offline:** enter offline → persists to IDB (`sitepulse-pending-changes-${projectId}`) →
  replays on reconnect with **no duplicate `status_logs` rows**. Sanity-check **Mill Pond** (thin) opens
  clean. (Read-only elsewhere — the dev build points at the PRODUCTION db; only write via the feature's own
  save path on a test row, never a probe on unrelated rows — [[no-live-write-probes]].)
- Close with `verify-feature` → Definition of Done report → **STOP**. Do not commit/push until "Approved."
- On approval: commit; mark this plan COMPLETE; update the `schedule-variance-columns` memory to note the
  actual-dates capture shipped and the master-schedule-feed remains a future workstream.
