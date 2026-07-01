# Kickoff — Scheduling Foundation (Slice A), Phase 1: Activity model (rename + template/instance + stable IDs + type)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Scheduling Foundation (Slice A)** — the keystone activity-model migration: rename `milestones`→`activities`, split template/instance with **stable IDs** (re-key `status_logs` from the `milestone` TEXT name to an `activity_id` FK), and add a `type` flag (task vs milestone). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-01 - Scheduling Foundation Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scheduling-Foundation-Slice-A-Plan.md` (Phase 1 + Data model + Hard guardrails)
> - `sitepulse-next/AGENTS.md` (§2 status_logs/RPC/LWW/pendingChanges, §4 schema-change flow, §6 types)
>
> Branch off `main`. ⚠️ This is a **destructive schema change touching `status_logs` + the `upsert_status_log` RPC + the audit trigger** — the offline-sync slot invariant. **Recommended: split into 1a (migration + types) and 1b (code sweep), each its own approval.** Present the full SQL and **STOP** before applying anything; never touch production data without my explicit go-ahead. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this phase is (plain English)
Today, a floor-plan location's progress is stored keyed to the milestone's **name** (a text string like
"MEP Rough-In"). Rename that milestone and you orphan its history. Phase 1 fixes the fragile part: it
renames "milestones" to **activities** everywhere (schema included), gives each activity a **stable id**,
and re-keys the progress rows (`status_logs`) to that **id** instead of the mutable name — so renaming an
activity never loses its history. It also adds a `type` flag distinguishing a durational **task** from a
zero-duration **milestone** marker. Behavior stays identical; this changes **names + keys**, not features.

This is the keystone of Slice A — everything after it (dictionary, Schedule view, MSP import, playbooks)
builds on the id-keyed activity model. It is safe to do the simple way (rename in place + re-key directly,
no dual-read transition) because there is **negligible real data** (internal testing only) — the owner
locked this decision.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — **§2** (the `status_logs` upsert-only / `UNIQUE(unit_id, track, milestone)`
   slot rule, the `upsert_status_log` RPC + LWW `client_timestamp` guard, the `status_audit_log` append-only
   trigger, `pendingChanges` stays local, RLS posture — **all load-bearing here**), **§4** (schema-change →
   regenerate types → derive domain types → wire hooks flow), **§6** (types hand-maintained, JSONB narrowing).
2. `sitepulse-next/Notes/plans/Scheduling-Foundation-Slice-A-Plan.md` — **Phase 1** section, the **Data model**
   section ("Today (verify first)" + "After Phase 1"), the **Build-on inventory**, and **Hard guardrails**.
3. The `create-migration` skill (`.agent/skills/create-migration/SKILL.md`) — the migration workflow + gate.
4. `Notes/handoff/2026-07-01 - Scheduling Foundation Phase 0 Kickoff.md` — the just-closed prior phase (the
   scale-columns backfill), for the approval-gate rhythm.

## Verify the live schema FIRST (do not trust the plan's description — confirm it)
Before writing any SQL, query prod (`pmccdxmuszuykawvlphj`) to pin the exact current shape of everything
this migration rewrites — `database.types.ts` is hand-maintained and drifts (memory `schema-types-drift`):
- `project_milestones` — columns/types/defaults (expect: id, project_id, sequence_order, name, color,
  track, applies_to_unit_types).
- `status_logs` — the full column list, the `UNIQUE(unit_id, track, milestone)` constraint, its FKs.
- `upsert_status_log` — the current function body (it reads/writes `milestone` by name + the LWW guard).
- the audit trigger + `status_audit_log`'s `milestone` column.
- `sheets.milestone_schedules` — confirm it's JSONB keyed by milestone **name** (the cascade source).
- `milestone_applicability_overrides` — confirm it already keys on `milestone_id` (the id-keyed pattern to
  mirror; leave its shape, just update naming/references).
- How many real `status_logs` / `project_milestones` rows exist (confirm "negligible" before choosing the
  simple rename-in-place path; if there's meaningful real data, STOP and reconfirm the approach with owner).

## Scope (only this phase) — **recommend splitting 1a / 1b**
**1a — migration + types (⛔ approval gate):**
1. Rename `project_milestones` → **`activities`**; add `type text not null default 'task'`
   (`'task'` | `'milestone'`). Keep `sequence_order`, `track`, `applies_to_unit_types`, `color`.
2. Re-key `status_logs`: replace the `milestone` TEXT column with **`activity_id uuid` → `activities(id)`**;
   the slot constraint becomes **`UNIQUE(unit_id, activity_id)`** (open decision below — leaning drop
   `track` since the activity determines it). Convert existing name→id in the migration.
3. Update **`upsert_status_log`** (keep it `SECURITY INVOKER`, keep the LWW `client_timestamp` guard, keep
   `.upsert`/`onConflict` semantics — just change the slot key from name to id), the **audit trigger**, and
   **`status_audit_log`**'s column, to the id key.
4. Re-key `sheets.milestone_schedules` name→id (convert existing JSON keys in the migration; keep the column
   or rename to `activity_schedules` — decide + note it).
5. Update `milestone_applicability_overrides` references/naming (already id-keyed — minimal).
6. Regenerate `database.types.ts`; derive/rename domain types in `domain.ts` (add `type`; instances carry
   `activity_id`); narrow any JSONB at the query boundary.

**1b — code sweep (behavior-preserving; lighter gate):**
7. Sweep the milestone→activity rename across hooks/components/utils/stores (`useProjectQueries`
   `useMilestones`/`useUpdateMilestone`/`useMilestoneOverrides`/`useSetMilestoneApplicability`/
   `useUpdateMilestoneRules`, `useMapActions` `commitUnitMilestone` + the planned-date cascade,
   `bottleneck.ts`, `progressAnalytics.ts` `orderedTrackMilestones`, `ganttMath.ts`, the `schedule/` pieces,
   `SettingsMenu` milestone tab). **Do NOT fork `progressAnalytics`.** Keep behavior identical.

## ⛔ Approval gate (hard stop)
- Present the **exact SQL** (full migration, not a summary) and **STOP** before applying. This migration
  touches `status_logs` + the RPC + the audit trigger — the offline-sync slot invariant. Do NOT weaken the
  upsert-only rule (never plain `.insert()`), the LWW guard, or capture-time `client_timestamp`. Do NOT
  re-grant EXECUTE to `anon` or flip the RPC to `SECURITY DEFINER`. Include a **name→id conversion** for
  existing `status_logs` + `milestone_schedules` rows, and — because this is destructive — call out the
  conversion explicitly and confirm a backup/point-in-time recovery window before applying.

## Exit criteria (Definition of Done)
- `typecheck` + `test` + `build` all green.
- Live (`npm run dev:3010`, port 3010): mark a status, reload → history intact; **rename an activity → its
  history is NOT orphaned** (the whole point).
- The upsert-only + LWW + capture-time-timestamp invariants still hold; `pendingChanges` stays local.
- Close with the **`verify-feature`** skill (Definition of Done → STOP). **Do not commit/push until owner
  says "Approved."** Then draft the **Phase 2 kickoff** (global governed activity dictionary) + hand off.

## Guardrails
- **status_logs is sacred:** upsert-only via `upsert_status_log` / `.upsert(onConflict)`, never `.insert()`;
  keep the LWW timestamp guard + capture-time `client_timestamp`; the slot key changes name→id but the
  invariant does not otherwise weaken. History reads stay on `status_audit_log`, not `status_logs`.
- Migration additive-where-possible, but this **is** a rename + re-key → present full SQL + STOP; idempotent
  guards where practical; guarded RLS, **no `anon` grants**, `COMMENT ON`.
- Types: regenerate `database.types.ts`, derive domain types from the Row; no `Json` into props.
- Don't touch the Look-Ahead (`src/lookahead/`) or `sheets.milestone_schedules` semantics beyond name→id.
- Add/extend a test for any changed sync-path or new guard (`write-tests` skill).

## Open decisions to resolve at migration time
- **Slot key:** keep `track` in the constraint (`(unit_id, track, activity_id)`) or simplify to
  `(unit_id, activity_id)` since the activity determines track. Plan leans **simpler**; confirm with owner.
- **`sheets.milestone_schedules`:** keep the column name (JSON keys become ids) or rename to
  `activity_schedules`. Pick one, note it, be consistent.
- **1a/1b split:** recommended, but if the code sweep is small the session may do it in one pass — the owner
  approves the SQL either way.
