-- ============================================================
-- Migration: Light activity dependencies (Finish-to-Start + lag)
--            (Scheduling Foundation, Slice A, Phase 3b)
--
-- FILENAME NOTE: authored 2026-07-01, dated 2026-07-03 so it sorts/applies
--   strictly AFTER 20260702_activity_dictionary.sql on a fresh replay — it
--   DEPENDS on the `activities` table from 20260701_activity_model.sql.
--
-- WHAT & WHY (plain English):
--   A project's activities have an order (sequence_order) but no way to say
--   "Drywall starts after Framing finishes, plus 2 days". This adds ONE small
--   table of Finish-to-Start edges between a project's activities, each with a
--   lag in days. That's the whole feature: COARSE sequencing for the Schedule
--   view's predecessor picker (and the Phase-4 MSP import can carry links in).
--
--   Explicitly NOT here (out of scope for Slice A, per the plan):
--     * no critical-path / float / resource-leveling math anywhere;
--     * no SS/FF/SF relationship types — `type` is pinned to 'FS' by a CHECK
--       (the column exists so a later slice can widen the CHECK additively);
--     * the v1 UI authors at most ONE predecessor per activity (a chain);
--       the table is pair-unique so a DAG remains possible later.
--
-- ADDITIVE ONLY: a brand-new table; nothing existing is touched. The status
--   pipeline (status_logs / upsert_status_log / audit trigger) is untouched.
--
-- IDEMPOTENT: safe to re-run — create table if not exists, guarded policies,
--   create index if not exists.
--
-- RLS: rows are project-scoped THROUGH their activities FKs (the table carries
--   no project_id). READ = any member of the project owning the successor
--   activity. WRITE = privileged members (owner/admin/pm) of that project, and
--   INSERT additionally requires predecessor + successor to belong to the SAME
--   project (a cross-project edge is meaningless and would leak names).
--   NEVER granted to `anon` — mirrors the `activities` / `subtypes` posture.
-- ============================================================

-- ============================================================
-- STEP 1: The edges table.
--   ON DELETE CASCADE on both FKs: deleting an activity silently drops its
--   edges (matching status_logs / applicability overrides). UNIQUE pair =
--   no duplicate edge; CHECK <> = no self-dependency; CHECK type='FS' pins
--   the coarse model. lag_days may be negative (a lead).
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_dependencies (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  predecessor_activity_id  UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  successor_activity_id    UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  type                     TEXT NOT NULL DEFAULT 'FS' CHECK (type = 'FS'),
  lag_days                 INTEGER NOT NULL DEFAULT 0,
  created_by               UUID,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (predecessor_activity_id, successor_activity_id),
  CHECK (predecessor_activity_id <> successor_activity_id)
);

-- The read path fetches a project's edges by successor id; the v1 "replace my
-- predecessor" write deletes by successor id too.
CREATE INDEX IF NOT EXISTS idx_activity_dependencies_successor
  ON activity_dependencies (successor_activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_dependencies_predecessor
  ON activity_dependencies (predecessor_activity_id);

-- ============================================================
-- STEP 2: RLS.
-- ============================================================
ALTER TABLE activity_dependencies ENABLE ROW LEVEL SECURITY;

-- READ: any member of the project that owns the successor activity.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activity_dependencies'
      AND policyname = 'Members can view activity dependencies'
  ) THEN
    CREATE POLICY "Members can view activity dependencies"
      ON activity_dependencies FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM activities a
          JOIN project_members pm ON pm.project_id = a.project_id
          WHERE a.id = activity_dependencies.successor_activity_id
            AND pm.user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

-- INSERT: privileged members only, and both endpoints must sit in the SAME
-- project the writer is privileged in.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activity_dependencies'
      AND policyname = 'Privileged members can insert activity dependencies'
  ) THEN
    CREATE POLICY "Privileged members can insert activity dependencies"
      ON activity_dependencies FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM activities suc
          JOIN activities pre ON pre.project_id = suc.project_id
          JOIN project_members pm ON pm.project_id = suc.project_id
          WHERE suc.id = activity_dependencies.successor_activity_id
            AND pre.id = activity_dependencies.predecessor_activity_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- UPDATE: privileged members of the successor's project.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activity_dependencies'
      AND policyname = 'Privileged members can update activity dependencies'
  ) THEN
    CREATE POLICY "Privileged members can update activity dependencies"
      ON activity_dependencies FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM activities a
          JOIN project_members pm ON pm.project_id = a.project_id
          WHERE a.id = activity_dependencies.successor_activity_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- DELETE: privileged members of the successor's project.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activity_dependencies'
      AND policyname = 'Privileged members can delete activity dependencies'
  ) THEN
    CREATE POLICY "Privileged members can delete activity dependencies"
      ON activity_dependencies FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM activities a
          JOIN project_members pm ON pm.project_id = a.project_id
          WHERE a.id = activity_dependencies.successor_activity_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- ============================================================
-- STEP 3: Documentation comments (idempotent; catalog metadata only).
-- ============================================================
COMMENT ON TABLE activity_dependencies IS
  'Light Finish-to-Start dependency edges between a project''s activities '
  '(Scheduling Foundation Slice A, Phase 3b): "successor starts after '
  'predecessor finishes, +lag_days". COARSE by design — type is pinned to FS '
  'by CHECK; no CPM/float math exists. Project scope flows through the '
  'activities FKs (no project_id column). The v1 UI authors one predecessor '
  'per activity; the pair-unique constraint allows a DAG later.';
COMMENT ON COLUMN activity_dependencies.type IS
  'Relationship type — pinned to ''FS'' (finish-to-start) by CHECK. Widen the '
  'CHECK additively if SS/FF/SF ever become in-scope (deferred past Slice A).';
COMMENT ON COLUMN activity_dependencies.lag_days IS
  'Whole days between predecessor finish and successor start. May be negative (a lead).';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- table + constraints present:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'activity_dependencies'::regclass ORDER BY conname;
--     -- expect: pair UNIQUE, self-dep CHECK, type='FS' CHECK, both FKs CASCADE
--
--   -- RLS shape (read=member, writes=owner/admin/pm, TO authenticated, no anon):
--   SELECT policyname, cmd, roles FROM pg_policies
--     WHERE tablename='activity_dependencies' ORDER BY policyname;   -- 4 policies
--
--   -- empty on arrival (additive, no backfill):
--   SELECT count(*) FROM activity_dependencies;                      -- 0
-- ============================================================
