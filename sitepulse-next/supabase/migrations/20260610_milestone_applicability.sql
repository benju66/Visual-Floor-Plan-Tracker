-- ============================================================
-- Migration: Milestone Applicability (N/A) + temporal_state CHECK
-- Purpose: Some milestones do not apply to some locations
--          (gypcrete vs slab-on-grade, appliances vs corridors).
--          Applicability lives OUTSIDE the status pipeline:
--            1. Unit-type rules on project_milestones
--            2. Per-unit overrides in milestone_applicability_overrides
--          status_logs / audit / sync engine are untouched, and a
--          CHECK constraint pins temporal_state to the 4-value set
--          so applicability can never leak in as a fifth state.
--
-- IDEMPOTENT: Safe to re-run. Every step is guarded.
-- ============================================================

-- ============================================================
-- STEP 1: Unit-type rules column
-- NULL (or empty array) = milestone applies to ALL unit types.
-- Non-empty JSONB array of unit_type strings = applies only to those.
-- ============================================================
ALTER TABLE project_milestones
  ADD COLUMN IF NOT EXISTS applies_to_unit_types JSONB DEFAULT NULL;

-- ============================================================
-- STEP 2: Per-unit overrides table
-- Override beats rule. is_applicable cuts both ways:
--   false = exclude a unit a rule would include
--   true  = re-include a unit a rule would exclude
-- FK by id (not name string) so milestone renames are free and
-- deletes cascade.
-- ============================================================
CREATE TABLE IF NOT EXISTS milestone_applicability_overrides (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  milestone_id  UUID NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  unit_id       UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  is_applicable BOOLEAN NOT NULL,
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (milestone_id, unit_id)
);

-- Index for the project-wide fetch path (join via project_milestones)
CREATE INDEX IF NOT EXISTS idx_milestone_overrides_milestone
  ON milestone_applicability_overrides (milestone_id);

-- ============================================================
-- STEP 3: RLS — any project member may read and write.
-- Mirrors the status_logs membership pattern
-- (units -> sheets -> project_members), since "anyone can mark N/A"
-- is the intended posture. Tighten to privileged roles later by
-- editing these policies only.
-- ============================================================
ALTER TABLE milestone_applicability_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'milestone_applicability_overrides'
      AND policyname = 'Members can view applicability overrides'
  ) THEN
    CREATE POLICY "Members can view applicability overrides"
      ON milestone_applicability_overrides FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM units u
          JOIN sheets s ON u.sheet_id = s.id
          JOIN project_members pm ON s.project_id = pm.project_id
          WHERE u.id = milestone_applicability_overrides.unit_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'milestone_applicability_overrides'
      AND policyname = 'Members can insert applicability overrides'
  ) THEN
    CREATE POLICY "Members can insert applicability overrides"
      ON milestone_applicability_overrides FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM units u
          JOIN sheets s ON u.sheet_id = s.id
          JOIN project_members pm ON s.project_id = pm.project_id
          WHERE u.id = milestone_applicability_overrides.unit_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'milestone_applicability_overrides'
      AND policyname = 'Members can update applicability overrides'
  ) THEN
    CREATE POLICY "Members can update applicability overrides"
      ON milestone_applicability_overrides FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM units u
          JOIN sheets s ON u.sheet_id = s.id
          JOIN project_members pm ON s.project_id = pm.project_id
          WHERE u.id = milestone_applicability_overrides.unit_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'milestone_applicability_overrides'
      AND policyname = 'Members can delete applicability overrides'
  ) THEN
    CREATE POLICY "Members can delete applicability overrides"
      ON milestone_applicability_overrides FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM units u
          JOIN sheets s ON u.sheet_id = s.id
          JOIN project_members pm ON s.project_id = pm.project_id
          WHERE u.id = milestone_applicability_overrides.unit_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- ============================================================
-- STEP 4: Pin temporal_state to the canonical 4-value set.
-- Applicability is intentionally NOT a temporal_state; this
-- constraint enforces that decision against the unguarded bulk
-- upsert path. NOT VALID first so the ALTER takes no long lock,
-- then VALIDATE scans existing rows (verified clean pre-migration).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'status_logs_temporal_state_check'
  ) THEN
    ALTER TABLE status_logs
      ADD CONSTRAINT status_logs_temporal_state_check
      CHECK (temporal_state IN ('planned','ongoing','completed','none')) NOT VALID;
    ALTER TABLE status_logs VALIDATE CONSTRAINT status_logs_temporal_state_check;
  END IF;
END
$$;
