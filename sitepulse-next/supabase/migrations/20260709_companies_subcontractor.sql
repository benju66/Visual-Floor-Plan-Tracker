-- ============================================================
-- Migration B: Global company directory + activity subcontractor assignment
--              (Scheduling Analytics, Slice B, Phase 5 / 5b)
--
-- WHAT & WHY (plain English):
--   Phase 6 wants to benchmark a subcontractor's productivity/reliability across
--   the GC's OWN jobs (private, within-tenant). That needs a company identity
--   that is TENANT-WIDE, not tied to one project. Today the only company data is
--   `project_contacts.company` — a free-text field scoped to a single project, so
--   the same sub spelled two ways on two jobs can't be compared.
--
--   This adds a lightweight GLOBAL `companies` dictionary (the sub/vendor
--   identity) and lets each PROJECT activity name which company does the work via
--   the new nullable `activities.subcontractor_id`. The sub is assigned at the
--   project-activity level (a GC uses different subs per job); per-area override
--   is deferred. OWNER-CONFIRMED shape (2026-07-03): a fresh companies table,
--   NOT promoted from project_contacts (kept independent; can be linked later).
--
--   Mirrors the governed-dictionary RLS pattern of `subtypes`/`activity_dictionary`
--   /`cost_codes` (read = any member / write = owner·admin·pm / never anon). See:
--     - Notes/plans/Scheduling-Analytics-Slice-B-Plan.md (Phase 5, Data model)
--     - Notes/handoff/2026-07-02 - Scheduling Analytics Phase 5 Kickoff.md
--
-- ADDITIVE ONLY. Touches NO existing data: status_logs / the activity_id slot key
--   / upsert_status_log / the audit trigger / project_contacts are all untouched.
--   `activities.subcontractor_id` is nullable and starts NULL for every activity.
--
-- IDEMPOTENT: safe to re-run. `create table if not exists`, guarded RLS policies,
--   `add column if not exists`, guarded FK + index. No seed (starts empty).
-- ============================================================

-- ============================================================
-- STEP 1: The global company directory (sub/vendor identity).
--   `name`  is the company name; UNIQUE so the app can add-or-reuse without
--           duplicating (the app trims before writing). `trade` is an optional
--           grouping hint (e.g. 'Drywall'). `status` active/deprecated retires a
--           company without delete. Tenant-wide (no project FK) — the whole point
--           is cross-project identity for Phase-6 benchmarking.
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  trade        TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','deprecated')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_by   UUID DEFAULT auth.uid(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_status ON companies (status);

-- ============================================================
-- STEP 2: RLS for companies — copied VERBATIM from `subtypes` /
--   `activity_dictionary` / `cost_codes`.
--   READ  = any authenticated user who is a member of at least one project.
--   WRITE = privileged roles only (owner / admin / pm). NEVER granted to `anon`.
-- ============================================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated project member
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'companies'
      AND policyname = 'Members can view companies'
  ) THEN
    CREATE POLICY "Members can view companies"
      ON companies FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- WRITE (INSERT): privileged roles only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'companies'
      AND policyname = 'Privileged members can insert companies'
  ) THEN
    CREATE POLICY "Privileged members can insert companies"
      ON companies FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- WRITE (UPDATE): privileged roles only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'companies'
      AND policyname = 'Privileged members can update companies'
  ) THEN
    CREATE POLICY "Privileged members can update companies"
      ON companies FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- WRITE (DELETE): privileged roles only (governance prefers status='deprecated',
-- but a hard delete is still gated to privileged roles, never anon).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'companies'
      AND policyname = 'Privileged members can delete companies'
  ) THEN
    CREATE POLICY "Privileged members can delete companies"
      ON companies FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- ============================================================
-- STEP 3: activities.subcontractor_id → companies(id).
--   Additive + nullable, ON DELETE SET NULL so deleting/retiring a company never
--   deletes or blocks a project activity. Assigned per project-activity (a GC uses
--   different subs per job). Every existing activity starts NULL.
-- ============================================================
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS subcontractor_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activities_subcontractor_id_fkey'
  ) THEN
    ALTER TABLE activities
      ADD CONSTRAINT activities_subcontractor_id_fkey
      FOREIGN KEY (subcontractor_id) REFERENCES companies(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_activities_subcontractor_id ON activities (subcontractor_id);

-- ============================================================
-- STEP 4: Documentation comments (idempotent; catalog metadata only).
-- ============================================================
COMMENT ON TABLE companies IS
  'Global, tenant-wide company/subcontractor directory (cross-project identity for '
  'private per-GC Phase-6 benchmarking). Mirrors the governed-dictionary RLS pattern '
  'of `subtypes`/`cost_codes` (read=member, write=owner/admin/pm, never anon). '
  'Independent of project_contacts (not promoted from it).';
COMMENT ON COLUMN companies.name IS
  'Company name. UNIQUE — the app trims + add-or-reuses so a sub is one row tenant-wide.';
COMMENT ON COLUMN companies.trade IS
  'Optional trade/grouping hint (e.g. ''Drywall''). Display only.';
COMMENT ON COLUMN companies.status IS
  'Governance status: ''active'' | ''deprecated'' (retire without delete).';
COMMENT ON COLUMN activities.subcontractor_id IS
  'Optional FK → companies(id), ON DELETE SET NULL. The company doing this project '
  'activity''s work. NULL = unassigned. Assigned per project-activity (per-area '
  'override deferred).';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- table + RLS + empty:
--   SELECT to_regclass('public.companies');                              -- public.companies
--   SELECT relrowsecurity FROM pg_class WHERE relname='companies';       -- true
--   SELECT count(*) FROM companies;                                      -- 0 (starts empty)
--
--   -- column + FK on activities (additive, all NULL):
--   SELECT conname FROM pg_constraint WHERE conname='activities_subcontractor_id_fkey'; -- 1 row
--   SELECT count(*) FROM activities WHERE subcontractor_id IS NOT NULL;  -- 0
--
--   -- RLS shape mirrors subtypes (read=member, writes=owner/admin/pm, TO authenticated):
--   SELECT policyname, cmd, roles FROM pg_policies
--     WHERE tablename='companies' ORDER BY policyname;                   -- 4 policies, {authenticated}
-- ============================================================
