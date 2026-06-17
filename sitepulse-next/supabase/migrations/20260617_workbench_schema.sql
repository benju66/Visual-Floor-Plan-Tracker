-- ============================================================
-- Migration: Location Labeling Workbench infrastructure (Migration B / Phase 3)
-- Purpose: Lay the DATABASE FOUNDATION for the Location Labeling Workbench —
--          and NOTHING visible yet. The workbench is a "hidden container"
--          surface: its drawings live as normal `sheets`/`units` rows under a
--          single `projects` row flagged `kind = 'workbench'`, reusing 100% of
--          the proven canvas / PDF-upload / snapping / taxonomy pipeline with
--          ZERO backend changes (the sheet-scoped `verify_sheet_access` auth
--          path stays as-is — AGENTS.md §7). See:
--            - Notes/plans/Location-Labeling-Workbench-Plan.md (§ Data model,
--              "New schema this plan adds → Migration B", and Phase 3)
--            - Notes/handoff/2026-06-17 - Location Labeling Workbench Phase 3 Kickoff.md
--
--          This migration adds exactly three things:
--            (1) projects.kind  — marks a project row as a hidden workbench
--                container vs. a normal 'live' project (indexed; the dashboard
--                and every "all projects" surface will exclude 'workbench' in
--                Phase 4).
--            (2) workbench_sheets — a 1:1 sidecar to `sheets` holding per-drawing
--                metadata (workbench drawings are heterogeneous, unlike a live
--                project's single project_type). Keeps the shared `sheets` table
--                clean. Scale stays on `sheets` (reuse the existing scale tooling).
--            (3) units.spans_levels / level_note / has_void — additive nullable
--                LABEL flags (metadata belongs with the label, like computed_area).
--                Faithful to the labeling standard's two-level + donut workarounds
--                without changing polygon geometry / area math / snapping / export.
--
-- ADDITIVE + NULLABLE ONLY. No backfill of existing rows — defaults handle it
-- (projects.kind defaults 'live'; the three units columns are NULL). `units.unit_type`
-- is KEPT untouched (milestone applicability / getAppliesTo keys on it — AGENTS.md
-- §§2,4). Nothing in status_logs / status_audit_log / the offline sync pipeline is
-- touched. The live app is unaffected: every new column is nullable/defaulted and
-- unread by existing UI.
--
-- IDEMPOTENT: safe to re-run. Every step is guarded (ADD COLUMN IF NOT EXISTS,
-- CREATE TABLE IF NOT EXISTS, pg_constraint / pg_policies existence checks,
-- CREATE INDEX IF NOT EXISTS).
-- ============================================================

-- ============================================================
-- STEP 1: projects.kind — the hidden-container marker.
-- NOT NULL DEFAULT 'live' so the column is metadata-only on add and every
-- existing project row becomes 'live' with no separate backfill. CHECK is added
-- NOT VALID then VALIDATE, matching the taxonomy template's constraint style.
-- Indexed: the dashboard / "all projects" queries will filter `kind = 'live'`.
-- ============================================================
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'live';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_kind_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_kind_check
      CHECK (kind IN ('live','workbench')) NOT VALID;
    ALTER TABLE projects VALIDATE CONSTRAINT projects_kind_check;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_projects_kind ON projects (kind);

-- ============================================================
-- STEP 2: workbench_sheets — 1:1 sidecar to `sheets` for a workbench drawing.
-- PK = FK to sheets(id) with ON DELETE CASCADE: deleting a drawing removes its
-- sidecar row automatically. `sheet_project_type` mirrors PROJECT_TYPES in
-- src/utils/locationTaxonomy.ts (the 9-value list — that file is the source of
-- truth; this CHECK follows it, AGENTS.md §4). All metadata columns are nullable
-- except the two with sensible defaults (is_partial=false, review_state='draft').
-- ============================================================
CREATE TABLE IF NOT EXISTS workbench_sheets (
  sheet_id            UUID PRIMARY KEY REFERENCES sheets(id) ON DELETE CASCADE,
  sheet_project_type  TEXT
                        CHECK (
                          sheet_project_type IS NULL OR sheet_project_type IN (
                            'Commercial','Educational','Government','Healthcare',
                            'Hotel','Housing','Industrial','Restaurant','Workplace'
                          )
                        ),
  level_label         TEXT,
  source_sheet_number TEXT,
  vector_quality      TEXT
                        CHECK (vector_quality IN ('clean','scanned') OR vector_quality IS NULL),
  is_partial          BOOLEAN NOT NULL DEFAULT false,
  review_state        TEXT NOT NULL DEFAULT 'draft'
                        CHECK (review_state IN ('draft','ready_for_review','reviewed')),
  reviewed_by         UUID,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- STEP 3: RLS for workbench_sheets.
-- Mirrors the units membership pattern (units -> sheets -> project_members):
--   READ  = any authenticated member of the parent sheet's project.
--   WRITE = privileged roles only (owner / admin / pm), like sheets/units.
-- NEVER granted to `anon` (all policies are scoped TO authenticated, stricter
-- than the legacy units SELECT which used TO public + a membership USING clause).
-- The join walks workbench_sheets.sheet_id -> sheets.id -> sheets.project_id ->
-- project_members.project_id. (auth.uid() is wrapped in a scalar sub-select per
-- the rls_perf migration's init-plan optimization.)
-- ============================================================
ALTER TABLE workbench_sheets ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated member of the parent sheet's project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workbench_sheets'
      AND policyname = 'Members can view workbench_sheets'
  ) THEN
    CREATE POLICY "Members can view workbench_sheets"
      ON workbench_sheets FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = workbench_sheets.sheet_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- WRITE (INSERT): privileged members of the parent sheet's project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workbench_sheets'
      AND policyname = 'Privileged members can insert workbench_sheets'
  ) THEN
    CREATE POLICY "Privileged members can insert workbench_sheets"
      ON workbench_sheets FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = workbench_sheets.sheet_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- WRITE (UPDATE): privileged members of the parent sheet's project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workbench_sheets'
      AND policyname = 'Privileged members can update workbench_sheets'
  ) THEN
    CREATE POLICY "Privileged members can update workbench_sheets"
      ON workbench_sheets FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = workbench_sheets.sheet_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = workbench_sheets.sheet_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- WRITE (DELETE): privileged members of the parent sheet's project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'workbench_sheets'
      AND policyname = 'Privileged members can delete workbench_sheets'
  ) THEN
    CREATE POLICY "Privileged members can delete workbench_sheets"
      ON workbench_sheets FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = workbench_sheets.sheet_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- ============================================================
-- STEP 4: units label flags (additive, nullable). Metadata belongs WITH the
-- label (like computed_area). Unused by the live UI — nullable + additive, so
-- existing reads/writes are unaffected.
--   spans_levels  — loft / mezzanine / double-height: labelled on the primary
--                   turnover floor, this flags that it spans a second level
--                   (standard §7). No geometry change.
--   level_note    — free-text note for the second level.
--   has_void      — donut/cut-out honesty flag (true hole geometry is deferred
--                   to the Backlog; this does NOT change polygon/area/snapping).
-- ============================================================
ALTER TABLE units ADD COLUMN IF NOT EXISTS spans_levels BOOLEAN;
ALTER TABLE units ADD COLUMN IF NOT EXISTS level_note   TEXT;
ALTER TABLE units ADD COLUMN IF NOT EXISTS has_void     BOOLEAN;

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- projects.kind exists, defaults 'live', every existing row is 'live':
--   SELECT kind, count(*) FROM projects GROUP BY kind;                 -- expect only 'live'
--   SELECT column_default, is_nullable FROM information_schema.columns
--     WHERE table_name='projects' AND column_name='kind';              -- expect 'live'::text, NO
--
--   -- workbench_sheets table + its 4 RLS policies present:
--   SELECT to_regclass('public.workbench_sheets');                     -- expect public.workbench_sheets
--   SELECT policyname, cmd FROM pg_policies WHERE tablename='workbench_sheets' ORDER BY cmd;
--   SELECT relrowsecurity FROM pg_class WHERE relname='workbench_sheets'; -- expect true
--
--   -- the three units flags exist and are nullable:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--     WHERE table_name='units' AND column_name IN ('spans_levels','level_note','has_void');
-- ============================================================
