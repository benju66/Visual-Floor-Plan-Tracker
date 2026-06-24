# Kickoff — Project Contacts, Phase 1: contacts table + the Project Contacts settings section

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Project Contacts** (a new `project_contacts` table + a "Project Contacts" section in the project Settings menu — manual add/edit/delete, grouped by company; no Look-Ahead changes, no import yet). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-23 - Project Contacts Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Project-Contacts-Plan.md` (Phase 1 + Data model + Guardrails)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. ⛔ Present the full migration SQL and **STOP** for my approval before applying anything to the live database — that's also where I confirm the writer-roles and the email-uniqueness decision. Don't commit or push until I say "Approved."

---

## Context for the session (the detail the launch prompt points at)

### Plain-English goal
Give a SitePulse project a **Project Contacts** directory — the people working the job (Company, name,
title, mobile, email) — managed in the project Settings menu, just like milestones are today. This phase
is the foundation: the table + the management UI. It does **not** touch Look-Ahead and does **not** import
from Procore yet (those are Phases 3 and 2). The whole point is a single shared contact list the rest of
the app will reuse instead of people re-typing subs by hand.

### Why this exists (the decision trail)
This workstream **replaces** the dropped "Lookahead Absorption Phase 1" (a one-time pre-fill). The owner
chose a shared source of truth instead of copying. A real Procore directory export
(`docs/procore_project_directory_export.csv`) showed the data is **people grouped by company** (254 people,
73 companies; Procore's own "Trade(s)" column is empty) — so we model **contacts**, named "Project
Contacts" so the section can serve other uses later.

### Required reading (in order)
1. `sitepulse-next/AGENTS.md` — invariants. Most are irrelevant (isolated additive table), but §4 (new
   table → `database.types.ts` + derive in `domain.ts`), §6 (TypeScript / no-`any`), and §2 (RLS posture,
   never `anon`) apply.
2. `sitepulse-next/Notes/plans/Project-Contacts-Plan.md` — full plan; this phase = "Phase 1", plus
   "Data model", "Build-on inventory", "Hard guardrails".
3. `sitepulse-next/supabase/migrations/20260623_lookahead_plans.sql` + `20260617_workbench_schema.sql` —
   additive-table + idempotent-RLS templates. Mirror their style (guarded `IF NOT EXISTS`, `pg_policies`
   checks, `TO authenticated`). Follow the `create-migration` skill.
4. Source to re-read fresh: `src/components/SettingsMenu.tsx` (the **Milestones manager** is the pattern to
   copy — list + add/edit/delete + dnd-kit reorder, role-gated via `useCurrentUserRole`),
   `src/hooks/useProjectQueries.ts` (`useMilestones`/`useReorderMilestones` conventions),
   `src/supabaseClient.ts`, `src/types/database.types.ts`, `src/types/domain.ts`.

### Scope checklist (Phase 1 only)
- [ ] **Migration** `supabase/migrations/<date>_project_contacts.sql`: `project_contacts` (id,
      `project_id` uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE, `company` text NOT NULL,
      `first_name`, `last_name`, `job_title`, `mobile_phone`, `email` text, `procore_id` text nullable,
      `created_by` uuid default auth.uid(), `created_at`, `updated_at`) + indexes `(project_id)` and
      `(project_id, company)` + RLS. READ = any project member; WRITE = `role IN ('owner','admin','pm')`
      (⛔ confirm ± superintendent at the gate). Consider `UNIQUE(project_id, email)` for Phase-2 de-dupe
      (⛔ confirm at the gate). Idempotent + additive.
- [ ] **Types**: add `project_contacts` to `database.types.ts` `Tables`; derive
      `ProjectContact = Database['public']['Tables']['project_contacts']['Row']` in `domain.ts`.
- [ ] **Hook**: `useProjectContacts(projectId)` (list, sorted by company then last name) + create/update/
      delete mutations in `useProjectQueries.ts`, following the milestone hooks (optimistic + invalidate).
- [ ] **UI**: a **"Project Contacts"** section in `SettingsMenu.tsx` mirroring the Milestones manager —
      contacts grouped/sorted by Company; add/edit/delete with fields Company, First Name, Last Name, Job
      Title, Mobile Phone, Email; writes role-gated. (Reorder is optional — sort by company is enough.)

### ⛔ Approval gates — STOP and wait for the owner
- **Before applying the migration to the live DB:** present the complete SQL. The owner confirms (a) the
  **writer roles** (owner/admin/pm ± superintendent) and (b) the **`UNIQUE(project_id, email)`** de-dupe
  constraint. Do not apply until told.
- **Do not commit or push to `main`** until the owner says "Approved."

### Guardrails specific to this phase
- Touch **no** existing table/RPC/RLS — `project_contacts` is fully isolated. The new table is empty, so
  exercising CRUD against it is safe; never run write probes against any OTHER table (memory: "No
  live-write probes" overwrote real data once).
- Derive types from `database.types.ts`; no `any`. Narrow at the query boundary.
- Do NOT wire into the offline `pendingChanges` queue (out of scope). Do NOT touch Look-Ahead or any
  import logic this phase.

### Exit criteria (Definition of Done for Phase 1 — then STOP)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- CRUD works against the new table; live `dev:3010` click-through: open Settings → **Project Contacts** →
  add/edit/delete a contact → reload → it persisted; other Settings sections + Map/List/Dashboard/Schedule/
  Look-Ahead all unaffected.
- Close the phase with the **`verify-feature`** skill (Definition of Done → stop). Do not commit/push until
  the owner says "Approved." Then hand off Phase 2 (CSV import) with a short chat pointer + a Phase 2 kickoff file.
