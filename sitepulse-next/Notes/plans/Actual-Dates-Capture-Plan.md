# Actual-Dates Capture — let the team type the real actual-start date (self-contained build plan)
> ✅ STATUS: **Phase 1 COMPLETE + APPROVED + COMMITTED** 2026-07-08 (`ef320e4` on branch
> `schedule-variance-columns-phase-2`; migration `20260711_status_logs_actual_start.sql` APPLIED to
> prod). Verified live (Orchard read-only + Test-project write round-trip + IDB offline durability).
> Merge to `main` (with Schedule Variance Columns P1-P3) pending owner go-ahead. The master-schedule /
> baseline / production-rate consumption of the captured actuals remains a FUTURE workstream.
>
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent workstream: `Notes/plans/Schedule-Variance-Columns-Plan.md` (this is the WRITE-PATH
> follow-up to that display-only workstream — see "Why this exists" below).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants — esp. §2 status_logs/upsert_status_log,
   offline queue, RLS posture; §3 progressAnalytics no-fork + applicability; §4 migrations; §6 types).
2. Re-read the files named below fresh — do not trust line numbers; they drift.
3. Build the single phase; verify with the § commands; close with `verify-feature` → STOP.
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Why this exists (plain English)
The Schedule Variance Columns workstream added per-activity actuals to the desktop List's
expanded rows, but "when did it actually start" is **guessed** from a field "ongoing" tap the
team often can't do reliably (supers batch-log on a morning walk; subs move between locations
unseen). So the guessed start — and everything derived from it (Actual Duration, Variance
Start/Duration) — is frequently the completion-day fallback and misleading ("ran 0d", inflated
"16d late to start"). Completion dates are captured cleanly; planned numbers are solid.

**Owner decision:** stop guessing the start — let the team **type the real actual-start date at
the computer** when they know it. Entered → reliable. This captured plan-vs-actual history is
also the raw material for a *later* master-schedule / baseline / production-rate update (that
consumption is OUT of scope here — this phase is capture + store + display only).

## Goal
On the desktop List's expanded per-activity rows, **Actual Started** becomes an **editable date
chip** (like the existing Planned Start / Planned Completion / Actual Completed chips). The value
is **stored per activity slot** in a new `status_logs.actual_start_date` column, saved through the
existing offline-durable write path. When present, the entered date **drives** Actual Started /
Actual Duration / Variance Start / Variance Duration and **wins** over the guessed "ongoing" mark.
When there is neither an entered date nor a genuine "ongoing" event, those four cells go **blank**
(no misleading completion-day guess) — the two reliable numbers (planned duration, finished
late/early) still show.

## Out of scope / deferred
- **Master-schedule / baseline / production-rate consumption** of the captured actuals — a future
  workstream. This phase only captures + stores + displays.
- **`status_audit_log.actual_start_date`** — display reads the *current* `status_logs` row (the
  modal already receives it via `currentStatuses`), so history capture of the actual-start is
  deferred until the master-schedule-feed phase needs the timeline.
- **A separate actual-end / actual-completion field** — `status_logs.logged_date` already IS the
  editable actual completion (the "Actual Completed" chip). No new end column.
- **Bulk / all-levels actual-date entry** — v1 is per-activity manual entry on the expanded rows.
- **Mobile entry** — actuals are a desk activity; the expanded per-activity rows are desktop-only.
- **Auto-deriving start from predecessor completion / completion-to-completion cadence** — a
  separate idea discussed but not built here.

## Locked product decisions (from the owner — recommended defaults; flag at kickoff if wrong)
- **One new nullable column** `status_logs.actual_start_date DATE`; **no** separate actual-end
  (`logged_date` covers it).
- **Entered date WINS**, then a genuine `ongoing` mark, else **BLANK** the start/duration cells.
  This intentionally *removes* Phase-3's completion-day fallback FROM THE NUMBERS (it was the
  misleading case) — the Journey timeline's own visual fallback can stay as-is.
- **Editable on the desktop List expanded rows only**, mirroring the existing date chips.
- **Defer** the audit-log column and all master-schedule consumption.

## Data model (read the real files fresh)
Per activity slot = one `status_logs` row, `UNIQUE(unit_id, activity_id)` (unchanged).
- **New column:** `status_logs.actual_start_date DATE NULL` (additive, nullable).
- **RPC `upsert_status_log(log_data jsonb)`** (current def in
  `supabase/migrations/20260701_activity_model.sql`; **SECURITY INVOKER**, `search_path` set,
  Last-Write-Wins `client_timestamp` guard, `ON CONFLICT (unit_id, activity_id)`): it lists columns
  **explicitly** in INSERT + VALUES + `DO UPDATE SET`. Add `actual_start_date` in all three places:
  `NULLIF(log_data->>'actual_start_date','')::date` and `actual_start_date = EXCLUDED.actual_start_date`.
  Keep everything else **verbatim** (INVOKER, guard, grants — never grant anon, never flip to DEFINER; AGENTS.md §2).
- **Audit trigger `fn_status_log_audit`** (in `20260706_audit_activity_name.sql`) uses an **explicit
  column list** — verified — so adding a `status_logs` column does **not** break it. Leave the audit
  table/trigger untouched (audit column deferred).
- **Write path is already generic** — the entered date just becomes one more date field riding
  proven rails:
  - `DateChipCell.onChange` → `handleTimelineUpdate(unit, childLog, state, { …, actualStartDate, activityObj })`
    (`src/hooks/useFieldData.ts`) — stages into `pendingTimelineChanges` (offline IDB queue via
    `PendingChange.extraProps`; keep it there, do NOT move to Zustand/Query — AGENTS.md §2/§6).
  - `commitUnitActivity` (`src/hooks/useMapActions.ts`, the `newLogData` object) — add
    `actual_start_date: extraProps.actualStartDate !== undefined ? (extraProps.actualStartDate || null) : (existing ?? null)`.
  - `useUpdateStatus` (`src/hooks/useProjectQueries.ts`) already spreads `newLogData` into `safeData`,
    strips `activityName`/`milestone`/`created_at`/`id`, stamps `client_timestamp`, and calls
    `rpc('upsert_status_log', { log_data: safeData })` — so `actual_start_date` flows through with **no
    change** once the RPC handles it. ⚠ Watch the `if (safeData.logged_date === null) delete safeData.logged_date`
    quirk — decide the parallel clear-semantics for `actual_start_date` (passing `''`/null must CLEAR it via the
    RPC's `NULLIF`; confirm a delete-when-null doesn't leave a stale value).
  - **Never** `.insert()`; keep `.upsert(onConflict:'unit_id,activity_id')` / the RPC (AGENTS.md §2).
  - **Bulk path** (`useBulkUpdateStatus`/`handleApplyBulkStatus`) authors *planned* dates only — v1
    does not bulk-set actuals; leave it unchanged.
- **Types:** add `actual_start_date` to `status_logs` Row/Insert/Update in
  `src/types/database.types.ts`; `StatusLog` in `domain.ts` derives from Row automatically (it only
  adds the synthesized `activityName`). No hand-written duplicate (AGENTS.md §6).

## Build-on inventory (read these fresh before using)
- `src/components/StatusTable.tsx` — the expanded per-activity child rows. The Phase-3 "Actual
  Started" display sub-line (under Planned Start) becomes a `DateChipCell`. Copy the exact wiring of
  the Planned Start / Planned Completion / Actual Completed chips already in that same row
  (value/pending/onChange→`handleTimelineUpdate`/`ariaLabel`/`compact`). `DateChipCell` is defined at
  the top of this file. `ExpandedActivityAudit` (Phase 3) still supplies the audit events for the
  ongoing-mark fallback.
- `src/components/UnitHistoryModal.tsx` — the Journey tab derives actual start via `firstOngoingIso`;
  make it prefer the current log's `actual_start_date` (it has `current` from `currentStatuses`) so the
  timeline and the list agree. Keep the bar's own visual fallback; only the "actual start" source changes.
- `src/utils/progressAnalytics.ts` — `resolveActualStartIso` / `activitySchedule` / `VARIANCE_COLORS`.
  **Extend, never fork.** Prefer teaching `resolveActualStartIso` an `enteredStart` input (entered wins;
  else real `ongoing`; else null) so there is ONE definition both consumers call.
- `src/hooks/useFieldData.ts` (`handleTimelineUpdate`, `pendingTimelineChanges`),
  `src/hooks/useMapActions.ts` (`commitUnitActivity`), `src/hooks/useProjectQueries.ts`
  (`useUpdateStatus`) — the write path above.
- `src/types/domain.ts` (`StatusLog`, `PendingChange`), `src/types/database.types.ts`.
- `supabase/migrations/20260701_activity_model.sql` (current RPC body to copy),
  `20260706_audit_activity_name.sql` (audit trigger to leave alone), and the `create-migration` skill.

## Pure logic to extract + unit-test (`progressAnalytics.ts` + `.test.ts`)
- Extend `resolveActualStartIso(events, { state, loggedDate, enteredStart })`:
  - `enteredStart` present → return it (entered wins, even over a real ongoing).
  - else first genuine `ongoing` event (existing `firstOngoingIso` path).
  - else `null` — **no completion-day fallback for the numbers** (that was the misleading case).
  - Tests: entered wins over ongoing; entered wins with no ongoing; ongoing used when no entry; a
    completed-but-never-ongoing, no-entry slot → `null` (blank); clamp/ordering unchanged.
- The consumers (`StatusTable`, `UnitHistoryModal`) feed the resolved start into `activitySchedule`
  exactly as today; `activitySchedule` itself is unchanged.
- Framework-free, deterministic, `Date.now()`-free (pass `todayIso`/timestamps IN).

## Sub-phasing (one phase — ship + verify)

### Phase 1 — Enterable actual-start date (migration + write path + editable chip + entered-wins derivation)
- **Scope (one vertical slice):**
  1. Migration `supabase/migrations/20260711_status_logs_actual_start.sql` (idempotent): `ALTER TABLE
     status_logs ADD COLUMN IF NOT EXISTS actual_start_date DATE;` + `CREATE OR REPLACE FUNCTION
     upsert_status_log` (current body verbatim **plus** the one column in the 3 places). No RLS change
     (status_logs membership policies already cover the column). README migration table row.
  2. Types: `database.types.ts` status_logs Row/Insert/Update += `actual_start_date: string | null`.
  3. Write-path wiring: `commitUnitActivity` `newLogData` + `handleTimelineUpdate`/`pendingTimelineChanges`
     extraProps `actualStartDate` (online + offline). `useUpdateStatus` needs no change beyond the
     clear-semantics check.
  4. UI: the "Actual Started" sub-line on the expanded rows → editable `DateChipCell` (desktop List).
  5. Derivation: `resolveActualStartIso` gains `enteredStart`; StatusTable + UnitHistoryModal prefer the
     entered value; blank when neither entered nor a real ongoing exists.
  6. Tests: the extended pure helper; if feasible, a write-path/offline assertion (entered date reaches
     the RPC payload / survives the pending-changes round-trip).
- **⛔ Approval gates:**
  - **DB migration** — present the FULL SQL (ALTER + CREATE OR REPLACE RPC) via the `create-migration`
    skill and **STOP** for the owner's explicit go-ahead before applying. The dev build points at the
    **PRODUCTION** database; the migration is additive + idempotent, but apply only on approval, and
    never a live-write probe on real rows ([[no-live-write-probes]]).
  - Touching the **offline mutation queue** (`pendingTimelineChanges`/`PendingChange.extraProps`) —
    keep it local `useState` + IDB (AGENTS.md §2/§6); do not migrate it to Zustand/Query.
- **Exit criteria:** typecheck + test + build green (commands below) · extended pure helper unit-tested ·
  `dev:3010` on **Orchard Path III** (data-rich) — type an actual-start on an expanded row, confirm it
  **saves + survives reload**, drives Actual Duration / Variance Start / Duration, and **wins** over the
  ongoing guess; a jumped-to-complete row with **no** entry shows **blanks** (not 0d/guesses); **offline**
  path — enter offline, confirm it persists to IDB (`sitepulse-pending-changes-${projectId}`) and replays
  on reconnect with **no duplicate `status_logs` rows**; sanity-check **Mill Pond** (thin) opens clean.
  Close with `verify-feature` → Definition of Done → **STOP** (do not commit/push until "Approved").

## Hard guardrails (AGENTS.md — do not violate)
- **status_logs writes:** RPC / `.upsert(onConflict:'unit_id,activity_id')` ONLY, never `.insert()`;
  strip synthesized `activityName` (and legacy `milestone`) before write; preserve the LWW
  `client_timestamp` guard; `upsert_status_log` stays **SECURITY INVOKER**, never granted to `anon`.
- **Offline durability:** `pendingChanges`/`pendingTimelineChanges` stay local `useState` + project-scoped
  IDB (`sitepulse-pending-changes-${projectId}`); the actual-start edit must replay through that queue.
- **progressAnalytics:** extend, never fork; reuse `activitySchedule`/`resolveActualStartIso`/
  `VARIANCE_COLORS`; **no new colors**; respect applicability (N/A slots never get an actual/variance).
- **Types** derive from `database.types.ts`; no `any` that leaks a `Json` into props; new files `.ts`/`.tsx`.
- **Lint is NOT a gate** (~1850 pre-existing). Verify with typecheck + test + build + dev:3010.
- **Don't commit or push until the owner says "Approved."** One branch, one commit.

## Branch / base note (important — same stacking the workstream has used)
Schedule Variance Columns **P1+P2 are committed on branch `schedule-variance-columns-phase-2`** (NOT
main). **Phase 3** (expanded-list actuals *display*) is built but **UNCOMMITTED and pending owner
approval** on that same branch. This actual-dates phase **stacks on top of Phase 3** — base it on that
branch tip once Phase 3 is committed (or continue on the same branch). Flag the eventual merge order to
the owner (likely: variance P1→P2→P3 then this, to `main`, together).

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- Lint is NOT a gate. No E2E — manual `dev:3010` click-through (port 3010, from `sitepulse-next/`).
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `*.test.ts`.

## Open decisions (settle at kickoff — do not guess mid-build)
1. **No-entry fallback display.** *Recommended: blank the start/duration cells unless there's an
   entered date OR a genuine `ongoing` mark* (kills the misleading completion-day guess). Alternative:
   keep showing the guess faintly — rejected as the whole point of this phase.
2. **Clear semantics.** Entering then clearing the chip must set `actual_start_date = NULL`. Confirm the
   `useUpdateStatus` delete-when-null pattern (currently only `logged_date`) doesn't strip/keep a stale
   `actual_start_date`; the RPC's `NULLIF(...,'')::date` handles empty→NULL.
3. **Current/bottleneck activity on the PARENT row.** Phase 3 left the parent row (the location's
   current activity) without per-activity variance/actuals. *Recommended: defer* — keep this phase to
   the expanded child rows; revisit surfacing an editable actual-start on the parent row separately.
