# Kickoff — Band vs Promise, Phase 1: Project Info settings tab + the two date columns

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Band vs Promise** (a Project Info settings tab with Construction
> Start + Contract Completion dates on the project, backed by one additive migration). Read
> these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-08 - Band vs Promise Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Band-vs-Promise-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. ⛔ The DB migration is an approval gate: author
> the SQL with the `create-migration` skill, present the exact SQL, and STOP — I apply it to
> production, never you. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase
Band vs Promise makes the dashboard answer "are we going to keep our word?" — but there is
no "word" stored yet. The `projects` table has **no date columns**. Phase 1 lays the
foundation: two nullable date fields on the project and a place to enter them. Phase 2 (a
separate session) reads the contract completion date and draws the confidence band against
it on the hero card. Nothing renders on the dashboard in Phase 1.

## Required reading
- `sitepulse-next/AGENTS.md` §2 (RLS posture, online-first project writes, no offline-queue
  contact), §4 (project-scoped settings live in `SettingsMenu`; one home only), §6 (derive
  types from `database.types.ts`, no `any`).
- `sitepulse-next/Notes/plans/Band-vs-Promise-Plan.md` — the plan-of-record (Data model +
  Phase 1). This kickoff is the execution detail; the plan is the source of truth.
- The `create-migration` skill (for the migration workflow + SQL authoring).

## Scope (build ONLY this)
1. **Migration** (additive, nullable — model it on `20260629_project_ai_training_optout.sql`):
   add `construction_start_date date NULL` and `contract_completion_date date NULL` to
   `public.projects`. Name it to sort after `20260711_status_logs_actual_start.sql` (e.g.
   `20260712_project_dates.sql`). No new RLS policy — the existing `projects` UPDATE policy
   governs the row (already used by `useUpdateProject` and the ai-training toggle); confirm
   that and flag if it's somehow column-scoped (not expected).
2. **Types:** add the two columns to `src/types/database.types.ts` (`projects` Row/Insert/
   Update); derive in `src/types/domain.ts` only if a `Project` domain type exists there.
3. **UI:** a new **"Project Info"** tab in `src/components/SettingsMenu.tsx` (it already
   imports `useProject` + `useUpdateProject`). Two native date inputs (Construction Start,
   Contract Completion) pre-filled from `useProject`, saved via `useUpdateProject` (empty
   input → save `null`). Gate editing to privileged roles the same way the file already gates
   other project edits. Mirror the existing tab's read→edit→save idiom; do not add a new
   write hook.

## Guardrails specific to this phase
- ⛔ **Do not apply the migration.** Present the SQL and STOP. The owner runs it on prod.
- Reuse `useUpdateProject` — no new project-write hook; online-first, never the offline queue.
- No dashboard / forecast changes in this phase. No `status_logs` contact.
- New/edited files `.ts`/`.tsx`; no `any`; tests (if any) import from `'vitest'`.

## Exit criteria
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green · `... run build` green
- dev:3010: Settings → Project Info on a real project — enter both dates, reload, they
  persist; clear one, it saves empty.
- Close with the **verify-feature** skill (Definition of Done → STOP). Commit; do NOT push
  until the owner says "Approved." Then draft the Phase 2 kickoff (standing ritual).
