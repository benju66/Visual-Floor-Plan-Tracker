-- ============================================================
-- Migration: Look-Ahead Schedule plans (Lookahead Absorption — Phase 0a)
-- Purpose: Lay the DATABASE FOUNDATION for absorbing the standalone Look-Ahead
--          Schedule app into SitePulse as a 5th project view — and NOTHING that
--          touches any existing table. It adds exactly ONE new, fully isolated
--          table: `lookahead_plans`, a 1:1 sidecar to `projects` that stores the
--          Look-Ahead document (`ProjectBlob`) VERBATIM in an opaque `doc jsonb`
--          column. See:
--            - Notes/plans/Lookahead-Absorption-Plan.md (§ Data model, Phase 0a)
--            - Notes/handoff/2026-06-23 - Lookahead Absorption Phase 0a Kickoff.md
--
--          One SitePulse project = one look-ahead plan (enforced by
--          UNIQUE(project_id)). Lookahead's multi-AREA support (interior /
--          exterior / …) lives INSIDE the blob, not as extra rows.
--
-- ADDITIVE + ISOLATED. Touches NO existing table / RPC / RLS: not status_logs,
-- units, sheets, project_milestones, projects (only references projects(id) by
-- FK). The `doc` column is opaque to Postgres — no FKs reach into it, no triggers,
-- no constraints on its contents; its shape is owned by the app (`ProjectBlob` in
-- the vendored Look-Ahead types) and narrowed at the query boundary by the app's
-- `isProjectBlob` guard. The live app is unaffected: nothing existing reads this table.
--
-- IDEMPOTENT: safe to re-run. Every step is guarded (CREATE TABLE IF NOT EXISTS,
-- pg_policies existence checks).
-- ============================================================

-- ============================================================
-- STEP 1: lookahead_plans — 1:1 sidecar to `projects` for the look-ahead doc.
--   project_id  UNIQUE + FK to projects(id) ON DELETE CASCADE: one plan per
--               project; deleting a project removes its plan automatically. The
--               UNIQUE constraint also provides the index used for upserts/lookups.
--   doc         the Look-Ahead ProjectBlob, stored opaquely (NOT NULL).
--   created_by  auth.uid() at create time (DEFAULT). Nullable; left untouched on
--               update so the upsert path preserves the original author.
--   created_at / updated_at  standard timestamps; the app stamps updated_at on save.
-- ============================================================
CREATE TABLE IF NOT EXISTS lookahead_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  doc         JSONB NOT NULL,
  created_by  UUID DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- STEP 2: RLS for lookahead_plans.
-- Simpler join than workbench_sheets — straight to project_members on project_id
-- (no sheets hop), since the plan is project-scoped, not drawing-scoped.
--   READ  = any authenticated member of the project.
--   WRITE = ANY authenticated member of the project (INSERT/UPDATE/DELETE).
-- Owner decision (Phase 0a gate): anyone on the project can edit the plan — no
-- privileged-role restriction. This mirrors the milestone_applicability_overrides
-- ("anyone can mark N/A") posture, where read and write are the same membership
-- check, rather than the privileged-role gate used by sheets/units/workbench_sheets.
-- NEVER granted to `anon`; every policy is scoped TO authenticated. auth.uid() is
-- wrapped in a scalar sub-select per the rls_perf init-plan optimization.
-- ============================================================
ALTER TABLE lookahead_plans ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated member of the project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lookahead_plans'
      AND policyname = 'Members can view lookahead_plans'
  ) THEN
    CREATE POLICY "Members can view lookahead_plans"
      ON lookahead_plans FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = lookahead_plans.project_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- WRITE (INSERT): any member of the project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lookahead_plans'
      AND policyname = 'Members can insert lookahead_plans'
  ) THEN
    CREATE POLICY "Members can insert lookahead_plans"
      ON lookahead_plans FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = lookahead_plans.project_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- WRITE (UPDATE): any member of the project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lookahead_plans'
      AND policyname = 'Members can update lookahead_plans'
  ) THEN
    CREATE POLICY "Members can update lookahead_plans"
      ON lookahead_plans FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = lookahead_plans.project_id
            AND pm.user_id = (SELECT auth.uid())
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = lookahead_plans.project_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- WRITE (DELETE): any member of the project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lookahead_plans'
      AND policyname = 'Members can delete lookahead_plans'
  ) THEN
    CREATE POLICY "Members can delete lookahead_plans"
      ON lookahead_plans FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = lookahead_plans.project_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- table + RLS enabled:
--   SELECT to_regclass('public.lookahead_plans');                 -- expect public.lookahead_plans
--   SELECT relrowsecurity FROM pg_class WHERE relname='lookahead_plans'; -- expect true
--
--   -- the 4 RLS policies present:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename='lookahead_plans' ORDER BY cmd;
--
--   -- UNIQUE(project_id) + FK to projects exist:
--   SELECT conname, contype FROM pg_constraint
--     WHERE conrelid = 'lookahead_plans'::regclass ORDER BY contype;
--
--   -- columns / nullability / defaults:
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns WHERE table_name='lookahead_plans' ORDER BY ordinal_position;
-- ============================================================
