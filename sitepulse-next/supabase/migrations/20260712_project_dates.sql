-- ============================================================
-- Migration: Project Dates — Construction Start + Contract Completion
-- Purpose: Band vs Promise, Phase 1. Give a project two owner-entered dates so
--          the dashboard can later answer "are we going to keep our word?":
--            * construction_start_date  — when the job broke ground
--            * contract_completion_date — the PROMISED finish (the "word")
--          Entered in the new Settings -> Project Info tab (privileged write,
--          governed by the existing projects UPDATE policy). Phase 1 STORES +
--          DISPLAYS only; the hero-card confidence band is measured against the
--          contract completion date in Phase 2.
--          See: Notes/plans/Band-vs-Promise-Plan.md
--
-- TWO additive changes:
--   projects.construction_start_date   date NULL
--   projects.contract_completion_date  date NULL
--
-- ADDITIVE + SAFE. Both columns are NULLABLE with no default, so every existing
-- project row reads back NULL ("no date entered yet") and existing reads/writes
-- are unaffected. Dates are stored as ISO 'YYYY-MM-DD' (Postgres `date`). Mirrors
-- the projects.ai_training_enabled additive-column posture
-- (20260629_project_ai_training_optout.sql).
--
-- RLS: NONE NEEDED. `projects` already has "Privileged members can update
-- projects" (UPDATE, role in owner/admin) and "Users can view assigned projects"
-- (SELECT, membership). Both are ROW-level policies (a per-row membership check,
-- NO column allow-list — verified against prod), so they govern these new columns
-- too: privileged owner/admin writes ride the existing policy — the same path
-- useUpdateProject already uses for project_type / unit_types / ai_training_enabled.
--
-- IDEMPOTENT: safe to re-run (ADD COLUMN IF NOT EXISTS; COMMENTs unconditional).
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS construction_start_date  date,
  ADD COLUMN IF NOT EXISTS contract_completion_date date;

COMMENT ON COLUMN projects.construction_start_date IS
  'Owner-entered construction start date (Band vs Promise P1). Nullable; ISO date. '
  'Stored + displayed only in P1 — no start-anchored analytics yet.';

COMMENT ON COLUMN projects.contract_completion_date IS
  'Owner-entered contract completion date — the PROMISED finish (Band vs Promise P1). '
  'Nullable; ISO date. In P2 the hero-card confidence band is measured against this '
  'date; the promise line renders ONLY when this is set and the band is unsuppressed.';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- both columns exist, nullable, no default:
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'projects'
--      AND column_name IN ('construction_start_date', 'contract_completion_date');
--   -- expect: data_type = date, is_nullable = YES, column_default = NULL for both
-- ============================================================
