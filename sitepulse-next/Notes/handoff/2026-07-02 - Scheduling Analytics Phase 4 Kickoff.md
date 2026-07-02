# Kickoff — Scheduling Analytics (Slice B), Phase 4: dependency behavior (make-ready + date-ripple)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of Scheduling Analytics (Slice B)** (dependency *behavior*: make-ready + date-ripple — the FS edges already exist, this turns them into value). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-02 - Scheduling Analytics Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scheduling-Analytics-Slice-B-Plan.md` (Phase 4)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 4**. **No DB migration** (the `activity_dependencies` edges already exist). Stay coarse — Finish-to-Start + lag, NO critical-path/float engine. The date-ripple writes only *planned dates* via the existing path (online-first, never `.insert()`, never the offline buffer) — **confirm the affected count before the bulk write.** Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this is (plain English)
The app already lets a user draw dependencies between activities (e.g. "drywall comes after framing").
This phase makes those dependencies *do something*: **make-ready** shows what's ready to work vs. what's
blocked, and **date-ripple** means when one activity slips, the activities that depend on it have their
planned dates pushed automatically. This is where the schedule starts predicting instead of just
recording — the immediate win for the weekly foreman's meeting.

## Critical ground-truth facts (verify fresh)
- **The dependency edges already exist** — `activity_dependencies` table (predecessor/successor/type/lag)
  and `src/utils/activityDependencies.ts` (`predecessorEdgeFor`, `wouldCreateCycle`, `dependencyLabel`).
  **No migration in this phase.**
- **Planned dates** live on `status_logs` (`planned_start_date`/`planned_end_date`); completion history is
  in `status_audit_log`. The ripple recomputes downstream *planned* dates.
- **Applicability matters** — a blocked/ready computation must skip N/A (unit × activity) slots
  (`buildApplicabilityIndex` / `isMilestoneApplicable`, AGENTS.md §3).

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — §2 (`status_logs` upsert-only, offline queue, `pendingChanges` local),
   §3 (don't fork `progressAnalytics`, applicability), §6 (types).
2. `sitepulse-next/Notes/plans/Scheduling-Analytics-Slice-B-Plan.md` — **Phase 4** + Data model +
   Build-on inventory + Hard guardrails.
3. Read fresh: `src/utils/activityDependencies.ts`, `src/utils/applicability.ts`,
   `src/utils/progressAnalytics.ts` (for the shared date helpers + the suppress-don't-fake posture),
   the Schedule view (`src/components/schedule/`), and how planned dates are written today
   (`src/hooks/useMapActions.ts` cascade + `src/hooks/useProjectQueries.ts`).

## Scope (only this)
1. **Pure logic (+ tests):**
   - `src/utils/activityReadiness.ts` — `readinessFor(unit, activity, deps, completedSet)` →
     `ready | blocked | done` (+ blocking predecessors). Skip N/A slots.
   - `src/utils/dateRipple.ts` — `rippleForward(edges, plannedDates, slippedActivityId, newFinish,
     lagByEdge)` → downstream planned-date deltas (FS + lag). Cycle-safe (reuse `wouldCreateCycle`);
     coarse; deterministic (pass `today`/dates IN — no `Date.now()`).
2. **Make-ready surfacing (read-only):** ready vs. blocked per unit×activity on the Schedule view and
   the floor plan; precise out-of-sequence from real edges (not just `sequence_order`).
3. **Date-ripple (write):** on a predecessor slip, recompute downstream planned dates and persist via the
   **existing planned-date write path** — online-first, NOT the offline `pendingChanges` buffer, NEVER
   `.insert()` (status writes stay on `upsert_status_log`). **Confirm the affected count before firing.**

## Guardrails
- **No migration / no RLS change.** No status writes — only *planned dates* via the established path.
- **Don't fork `progressAnalytics`**; reuse its date helpers + suppress-don't-fake posture.
- **Respect applicability** — N/A slots never count as blocked/ready/late.
- **Coarse FS + lag only** — no critical path, no float, no CPM engine.
- Don't break the offline mutation queue, `pendingChanges` (stays local), or the snapping pipeline.
- **Consider splitting** into 4a (readiness / read-only surfacing) and 4b (date-ripple / writes) if one
  session gets large — an extra kickoff is cheap.

## Exit criteria (Definition of Done)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- `activityReadiness.test.ts` + `dateRipple.test.ts` pin: readiness (ready/blocked/done + blockers),
  FS/lag forward propagation, cycle-safety, applicability (N/A excluded), and suppression on missing data.
- Live `dev:3010`: an activity with an incomplete predecessor shows **blocked**; completing the
  predecessor flips it to **ready**; slipping a predecessor's finish shifts the downstream planned dates
  (after the count-confirm).
- Close with the **`verify-feature`** skill (Definition of Done → STOP). **Do not commit or push until the
  owner says "Approved."** Then draft the Phase 5 kickoff and hand off with a short chat prompt.
