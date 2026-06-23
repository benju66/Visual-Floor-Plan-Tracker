-- ============================================================
-- Migration: Project Contacts (Project Contacts — Phase 1)
-- Purpose: Lay the DATABASE FOUNDATION for a shared, project-level contact
--          directory — the people working the job (Company, name, title, mobile,
--          email) — managed once in the project Settings menu and (later) reused
--          by Look-Ahead as a cell palette and bulk-imported from a Procore CSV.
--          See:
--            - Notes/plans/Project-Contacts-Plan.md (§ Data model, Phase 1)
--            - Notes/handoff/2026-06-23 - Project Contacts Phase 1 Kickoff.md
--
--          This migration adds exactly ONE new, fully isolated table:
--          `project_contacts`, a many-rows-per-project child of `projects`
--          (one row per person, grouped by company).
--
-- ADDITIVE + ISOLATED. Touches NO existing table / RPC / RLS: not status_logs,
-- units, sheets, project_milestones, lookahead_plans, project_members — it only
-- REFERENCES projects(id) by FK and reads project_members in its RLS policies.
-- The live app is unaffected: nothing existing reads or writes this table.
--
-- IDEMPOTENT: safe to re-run. Every step is guarded (CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, pg_policies existence checks).
-- ============================================================

-- ============================================================
-- STEP 1: project_contacts — one row per person on a project.
--   project_id    FK to projects(id) ON DELETE CASCADE: deleting a project
--                 removes its contacts automatically. NOT NULL — a contact
--                 always belongs to exactly one project.
--   company       NOT NULL — the grouping key; the directory is people-by-company.
--   first/last/job_title/mobile_phone/email  nullable per-person fields.
--   procore_id    nullable; reserved for the Phase 4 live Procore sync. Unused
--                 in Phases 1-3.
--   created_by    auth.uid() at create time (DEFAULT). Nullable.
--   created_at / updated_at  standard timestamps; the app stamps updated_at on save.
--
--   UNIQUE (project_id, email)  — de-dupe key for the Phase 2 Procore CSV import
--                 (upsert onConflict 'project_id,email'). Postgres treats NULL
--                 emails as DISTINCT, so blank-email rows never collide. ⛔ This
--                 constraint is one of the two Phase-1 gate decisions; drop it if
--                 the owner expects duplicate emails per project.
-- ============================================================
CREATE TABLE IF NOT EXISTS project_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company       TEXT NOT NULL,
  first_name    TEXT,
  last_name     TEXT,
  job_title     TEXT,
  mobile_phone  TEXT,
  email         TEXT,
  procore_id    TEXT,
  created_by    UUID DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_contacts_project_email_key UNIQUE (project_id, email)
);

-- Indexes for the company-grouped list (the settings section sorts by company).
CREATE INDEX IF NOT EXISTS idx_project_contacts_project    ON project_contacts (project_id);
CREATE INDEX IF NOT EXISTS idx_project_contacts_company    ON project_contacts (project_id, company);

-- ============================================================
-- STEP 2: RLS for project_contacts.
-- Straight join to project_members on project_id (no sheets hop) — the directory
-- is project-scoped. Mirrors the project-config posture used by sheets/units/
-- workbench_sheets:
--   READ  = any authenticated member of the project.
--   WRITE = privileged members only — role IN ('owner','admin','pm',
--           'superintendent'). 'owner' is assigned by create_new_project
--           (AGENTS.md §2), so it must stay in the list. Superintendent write was
--           confirmed at the Phase-1 gate (the super is the one who picks subs in
--           Look-Ahead, so they manage the directory too).
-- NEVER granted to `anon`; every policy is scoped TO authenticated. auth.uid() is
-- wrapped in a scalar sub-select per the rls_perf init-plan optimization.
-- ============================================================
ALTER TABLE project_contacts ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated member of the project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'project_contacts'
      AND policyname = 'Members can view project_contacts'
  ) THEN
    CREATE POLICY "Members can view project_contacts"
      ON project_contacts FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = project_contacts.project_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- WRITE (INSERT): privileged members of the project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'project_contacts'
      AND policyname = 'Privileged members can insert project_contacts'
  ) THEN
    CREATE POLICY "Privileged members can insert project_contacts"
      ON project_contacts FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = project_contacts.project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm','superintendent')
        )
      );
  END IF;
END
$$;

-- WRITE (UPDATE): privileged members of the project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'project_contacts'
      AND policyname = 'Privileged members can update project_contacts'
  ) THEN
    CREATE POLICY "Privileged members can update project_contacts"
      ON project_contacts FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = project_contacts.project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm','superintendent')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = project_contacts.project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm','superintendent')
        )
      );
  END IF;
END
$$;

-- WRITE (DELETE): privileged members of the project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'project_contacts'
      AND policyname = 'Privileged members can delete project_contacts'
  ) THEN
    CREATE POLICY "Privileged members can delete project_contacts"
      ON project_contacts FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = project_contacts.project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm','superintendent')
        )
      );
  END IF;
END
$$;

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- table + RLS enabled:
--   SELECT to_regclass('public.project_contacts');                      -- expect public.project_contacts
--   SELECT relrowsecurity FROM pg_class WHERE relname='project_contacts'; -- expect true
--
--   -- the 4 RLS policies present:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename='project_contacts' ORDER BY cmd;
--
--   -- FK to projects + UNIQUE(project_id, email) exist:
--   SELECT conname, contype FROM pg_constraint
--     WHERE conrelid = 'project_contacts'::regclass ORDER BY contype;
--
--   -- indexes present:
--   SELECT indexname FROM pg_indexes WHERE tablename='project_contacts' ORDER BY indexname;
--
--   -- columns / nullability / defaults:
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns WHERE table_name='project_contacts' ORDER BY ordinal_position;
-- ============================================================
