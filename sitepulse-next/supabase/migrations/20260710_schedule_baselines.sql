-- ============================================================
-- Migration: Schedule baselines (Unified Schedule Engine — Phase 4)
-- Purpose: Add exactly ONE new, fully isolated table: `schedule_baselines` —
--          named, immutable snapshots of a project's schedule (both layers:
--          the level×activity windows AND the per-location planned dates) so a
--          re-import can be DIFFED against the plan-of-record and approved
--          change-by-change instead of silently overwriting it. See:
--            - Notes/plans/Unified-Schedule-Engine-Plan.md (§ Phase 4)
--
--          Granularity (owner decision at the migration gate): WHOLE-PROJECT
--          snapshot per row. A whole-project snapshot subsumes per-level×activity
--          baselines — the diff scopes client-side — and keeps this one isolated
--          table with an opaque payload (the `lookahead_plans` precedent).
--          Multiple named baselines per project are allowed (no UNIQUE(project_id));
--          the app defaults to diffing against the newest.
--
-- ADDITIVE + ISOLATED. Touches NO existing table / RPC / RLS: not status_logs,
-- units, sheets, activities, projects (only references projects(id) by FK).
-- The `snapshot` column is opaque to Postgres — no FKs reach into it, no
-- triggers, no constraints on its contents; its shape is owned by the app
-- (versioned `ScheduleBaselineSnapshot`, narrowed at the query boundary by a
-- domain.ts guard):
--   { "version": 1,
--     "track": "Construction",
--     "levels":    { [sheetId]: { [activityName]: { "start_date", "end_date" } } },
--     "locations": [ { "unit_id", "activity_id",
--                      "planned_start_date", "planned_end_date" } ] }
--
-- APPEND-ONLY BY DESIGN: there is deliberately NO UPDATE policy — with RLS
-- enabled, updates are denied for everyone, so a captured baseline can never
-- drift. Correcting a bad baseline = delete it (privileged) and set a new one.
-- Field actuals (temporal_state / logged_date / status_color) are NOT part of
-- the snapshot — baselines version the PLAN, never progress.
--
-- RLS mirrors the `subtypes` / `activity_dependencies` posture (NOT lookahead's
-- any-member): READ = any authenticated project member; INSERT/DELETE =
-- owner/admin/pm only; never `anon`. auth.uid() is wrapped in a scalar
-- sub-select per the rls_perf init-plan optimization.
--
-- IDEMPOTENT: safe to re-run. Every step is guarded (CREATE TABLE IF NOT
-- EXISTS, CREATE INDEX IF NOT EXISTS, pg_policies existence checks).
-- ============================================================

-- ============================================================
-- STEP 1: schedule_baselines — append-only, project-scoped snapshots.
--   project_id  FK to projects(id) ON DELETE CASCADE (no UNIQUE — many
--               baselines per project over time).
--   name        display label ("Baseline", "Pre re-import 2026-07-10", …).
--   track       which activity track the snapshot covers (matches the app's
--               trackingMode; 'Construction' today).
--   snapshot    the versioned two-layer payload, stored opaquely (NOT NULL).
--   created_by  auth.uid() at capture time (nullable; kept if the user goes).
--   created_at  capture timestamp — the diff picks the newest by default.
-- ============================================================
CREATE TABLE IF NOT EXISTS schedule_baselines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Baseline',
  track       TEXT NOT NULL DEFAULT 'Construction',
  snapshot    JSONB NOT NULL,
  created_by  UUID DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest-first lookups per project (the only query shape the app uses).
CREATE INDEX IF NOT EXISTS idx_schedule_baselines_project_created
  ON schedule_baselines (project_id, created_at DESC);

-- ============================================================
-- STEP 2: RLS — read = member; insert/delete = owner/admin/pm; NO update policy.
-- ============================================================
ALTER TABLE schedule_baselines ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated member of the project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'schedule_baselines'
      AND policyname = 'Members can view schedule_baselines'
  ) THEN
    CREATE POLICY "Members can view schedule_baselines"
      ON schedule_baselines FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = schedule_baselines.project_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- WRITE (INSERT): privileged members only — setting a baseline is a schedule-
-- authoring act, like editing activities/dependencies.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'schedule_baselines'
      AND policyname = 'Privileged members can insert schedule_baselines'
  ) THEN
    CREATE POLICY "Privileged members can insert schedule_baselines"
      ON schedule_baselines FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = schedule_baselines.project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner', 'admin', 'pm')
        )
      );
  END IF;
END
$$;

-- WRITE (DELETE): privileged members only (prune old / mistaken baselines).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'schedule_baselines'
      AND policyname = 'Privileged members can delete schedule_baselines'
  ) THEN
    CREATE POLICY "Privileged members can delete schedule_baselines"
      ON schedule_baselines FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = schedule_baselines.project_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner', 'admin', 'pm')
        )
      );
  END IF;
END
$$;

-- (Deliberately NO UPDATE policy: baselines are immutable once captured.)

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- table + RLS enabled:
--   SELECT to_regclass('public.schedule_baselines');              -- expect public.schedule_baselines
--   SELECT relrowsecurity FROM pg_class WHERE relname='schedule_baselines'; -- expect true
--
--   -- exactly 3 policies (SELECT / INSERT / DELETE — no UPDATE):
--   SELECT policyname, cmd FROM pg_policies WHERE tablename='schedule_baselines' ORDER BY cmd;
--
--   -- FK + index present:
--   SELECT conname, contype FROM pg_constraint
--     WHERE conrelid = 'schedule_baselines'::regclass ORDER BY contype;
--   SELECT indexname FROM pg_indexes WHERE tablename='schedule_baselines';
-- ============================================================
