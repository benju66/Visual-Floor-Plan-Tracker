-- ============================================================
-- Migration: Per-Project AI-Training Opt-Out
-- Purpose: Let a project admin stop an individual project from contributing to
--          AI features — BOTH the training corpus (trace_events + the units
--          provenance columns from 20260625_trace_capture.sql) AND the live
--          naming-vocabulary learning (useNamingVocabulary). The toggle lives
--          in Global Settings -> Projects (left of Delete). Stop-future-only:
--          this flag gates new capture; it never deletes existing data.
--          See: Notes/plans/Project-AI-Training-Optout-Plan.md
--
-- ONE additive change:
--   projects.ai_training_enabled  BOOLEAN NOT NULL DEFAULT true
--
-- ADDITIVE + SAFE. The column is NOT NULL DEFAULT true, so it is metadata-only
-- on add: every existing project row becomes `true` (keeps contributing) with no
-- separate backfill, and existing reads/writes are unaffected. Mirrors the
-- projects.kind / projects.project_type additive-column posture
-- (20260617_workbench_schema.sql, 20260616_location_taxonomy.sql).
--
-- RLS: NONE NEEDED. `projects` already has "Privileged members can update
-- projects" (UPDATE, role in owner/admin) and "Users can view assigned projects"
-- (SELECT, membership) — the existing policies govern this column too.
--
-- IDEMPOTENT: safe to re-run (ADD COLUMN IF NOT EXISTS; COMMENT is unconditional).
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ai_training_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN projects.ai_training_enabled IS
  'When false, this project stops contributing to AI training: the client skips '
  'writing trace_events + units provenance for traces here, and useNamingVocabulary '
  'excludes its rooms from the company-wide naming model. Default true (opt-out model). '
  'Stop-future-only — does not affect already-captured data.';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- column exists, defaults true, every existing row is true:
--   SELECT ai_training_enabled, count(*) FROM projects GROUP BY 1;   -- expect only true
--   SELECT column_default, is_nullable FROM information_schema.columns
--     WHERE table_name='projects' AND column_name='ai_training_enabled'; -- expect true, NO
-- ============================================================
