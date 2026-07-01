-- ============================================================
-- Migration: Global governed activity dictionary
--            (Scheduling Foundation, Slice A, Phase 2)
--
-- FILENAME NOTE: authored 2026-07-01, dated 2026-07-02 so it sorts/applies
--   strictly AFTER 20260701_activity_model.sql on a fresh replay — it DEPENDS on
--   that migration's `activities` table (+ its `type` column) and reads from it
--   to seed the dictionary. (activity_dictionary < activity_model lexically, so a
--   same-day name would replay first and fail — hence the +1 day.)
--
-- WHAT & WHY (plain English):
--   Today each project types its own activity names by hand, so the same real
--   step is spelled many ways across projects ("MEP Rough-In", "Rough-Ins",
--   "MEP Rough-ins Completed"). This adds a SHARED, company-wide DICTIONARY of
--   canonical activities — each with aliases (so those spellings map to one
--   thing), a type (task/milestone), a project-type scope, and a governance
--   status (active/pending/deprecated). A project activity can point at a
--   dictionary entry via the new nullable `activities.dictionary_id` — exactly
--   like a location's `units.subtype_id` points at the global `subtypes`
--   dictionary. Governance is NON-BLOCKING: a needed word missing from the
--   dictionary can be added as "Other (pending)" and promoted later.
--
--   This MIRRORS the governed-dictionary pattern already shipped for location
--   sub-types (20260616_location_taxonomy.sql + src/utils/locationTaxonomy.ts):
--   the same globally-UNIQUE canonical `name`, the same governed `status`, the
--   same JSONB `aliases` / `default_project_types` (narrowed in TS at the query
--   boundary), the same RLS shape, and the same "Other (pending)" sentinel. See:
--     - Notes/plans/Scheduling-Foundation-Slice-A-Plan.md (Phase 2, Data model)
--     - Notes/handoff/2026-07-01 - Scheduling Foundation Phase 2 Kickoff.md
--
-- ADDITIVE ONLY. Nothing in the Phase-1 status pipeline (status_logs / the
--   activity_id slot key / upsert_status_log / the audit trigger) is touched.
--   `activities.dictionary_id` is nullable and starts NULL for every existing
--   activity (the review queue: dictionary_id IS NULL). Because it is additive +
--   nullable, the live app ignores the new table/column until the editor reads it
--   — this migration is NOT deploy-coupled (unlike Phase 1).
--
-- IDEMPOTENT: safe to re-run. `create table if not exists`, guarded RLS policies,
--   `add column if not exists`, guarded FK, and seeds via ON CONFLICT (name)
--   DO NOTHING (so re-runs and later manual edits are preserved).
--
-- OWNER-CONFIRMED DECISIONS (2026-07-01):
--   * SEED the dictionary from the distinct activity names already in `activities`
--     (a head start), and LEAVE activities.dictionary_id NULL (a review queue) —
--     no activity is auto-linked, mirroring the taxonomy backfill posture (legacy
--     rows land in a review queue, not silently merged).
--   * The dictionary entry carries an OPTIONAL default `track` (a grouping hint);
--     identity is the globally-UNIQUE `name` only, so "Framing" (which appears in
--     two tracks today) collapses to ONE shared entry.
--   * The project-level global-default OVERRIDE TABLE is DEFERRED (not built here):
--     the project-specific bits (sequence_order, color, local track,
--     applies_to_unit_types) already live on `activities`, and a separate override
--     table has no consumer yet (YAGNI). It can be added additively later, when a
--     concrete override need appears.
-- ============================================================

-- ============================================================
-- STEP 1: The governed activity dictionary (global, cross-project).
--   Mirrors `subtypes` column-for-column where shared: globally-UNIQUE `name`,
--   governed `status`, JSONB `aliases` / `default_project_types`, `proposed_note`,
--   `created_by`, `created_at`. Adds the activity-specific bits: `type`
--   (task/milestone), an optional default `track`, a RESERVED `cost_code_id`
--   (Slice B fills it — column only, no FK/table yet), and `updated_at`.
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_dictionary (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  track                 TEXT,
  type                  TEXT NOT NULL DEFAULT 'task'
                          CHECK (type IN ('task','milestone')),
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','pending','deprecated')),
  aliases               JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_project_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  cost_code_id          UUID,          -- RESERVED for Slice B (no FK/table yet)
  proposed_note         TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Review-queue lookups ("show me all status='pending' proposals").
-- Mirrors idx_subtypes_status.
CREATE INDEX IF NOT EXISTS idx_activity_dictionary_status ON activity_dictionary (status);

-- ============================================================
-- STEP 2: RLS for activity_dictionary — copied VERBATIM from `subtypes`.
--   READ  = any authenticated user who is a member of at least one project
--           (it is a GLOBAL dictionary, not project/unit-scoped).
--   WRITE = privileged roles only (owner / admin / pm), mirroring the status_logs
--           / subtypes membership pattern. NEVER granted to `anon`.
-- ============================================================
ALTER TABLE activity_dictionary ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated project member
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activity_dictionary'
      AND policyname = 'Members can view activity_dictionary'
  ) THEN
    CREATE POLICY "Members can view activity_dictionary"
      ON activity_dictionary FOR SELECT
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
    WHERE tablename = 'activity_dictionary'
      AND policyname = 'Privileged members can insert activity_dictionary'
  ) THEN
    CREATE POLICY "Privileged members can insert activity_dictionary"
      ON activity_dictionary FOR INSERT
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
    WHERE tablename = 'activity_dictionary'
      AND policyname = 'Privileged members can update activity_dictionary'
  ) THEN
    CREATE POLICY "Privileged members can update activity_dictionary"
      ON activity_dictionary FOR UPDATE
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
    WHERE tablename = 'activity_dictionary'
      AND policyname = 'Privileged members can delete activity_dictionary'
  ) THEN
    CREATE POLICY "Privileged members can delete activity_dictionary"
      ON activity_dictionary FOR DELETE
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
-- STEP 3: Seed.
--   3a. The non-blocking "Other (pending)" sentinel (mirrors PENDING_SUBTYPE_NAME):
--       status 'pending', so pickers can offer a never-stuck "propose" path.
--   3b. The distinct activity names already in `activities` as `active` entries
--       (owner-confirmed head start). The globally-UNIQUE `name` collapses a name
--       that spans tracks (e.g. "Framing") to ONE row; DISTINCT ON (name) keeps the
--       alphabetically-first track as the default hint, and its `type`.
--   ON CONFLICT (name) DO NOTHING everywhere so re-runs + later manual curation are
--   preserved. This step only INSERTS into the brand-new table — it reads
--   `activities` but modifies no existing data.
-- ============================================================
INSERT INTO activity_dictionary (name, status, type)
VALUES ('Other (pending)', 'pending', 'task')
ON CONFLICT (name) DO NOTHING;

INSERT INTO activity_dictionary (name, track, type, status)
SELECT DISTINCT ON (btrim(a.name))
       btrim(a.name) AS name,
       a.track,
       a.type,
       'active'
  FROM activities a
 WHERE a.name IS NOT NULL
   AND btrim(a.name) <> ''
 ORDER BY btrim(a.name), a.track
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- STEP 4: activities.dictionary_id → activity_dictionary(id)
--   (additive, nullable, ON DELETE SET NULL) — a project activity MAY point at a
--   global canonical entry, exactly like units.subtype_id → subtypes. Existing
--   activities start NULL; the REVIEW QUEUE is `dictionary_id IS NULL`. Nothing is
--   auto-linked (owner-confirmed). ON DELETE SET NULL: deleting a dictionary entry
--   never deletes or blocks a project activity (governance prefers
--   status='deprecated' anyway).
-- ============================================================
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS dictionary_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activities_dictionary_id_fkey'
  ) THEN
    ALTER TABLE activities
      ADD CONSTRAINT activities_dictionary_id_fkey
      FOREIGN KEY (dictionary_id) REFERENCES activity_dictionary(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_activities_dictionary_id ON activities (dictionary_id);

-- ============================================================
-- STEP 5: Documentation comments (idempotent; catalog metadata only).
-- ============================================================
COMMENT ON TABLE activity_dictionary IS
  'Global, company-wide governed activity dictionary (cross-project). Mirrors '
  '`subtypes`: globally-unique canonical name, governed status '
  '(active/pending/deprecated), JSONB aliases + default_project_types. A project '
  'activity points here via activities.dictionary_id. `type` is task/milestone; '
  '`track` is an optional default grouping hint; `cost_code_id` is reserved for '
  'Slice B (cost codes) — no FK yet.';
COMMENT ON COLUMN activity_dictionary.track IS
  'Optional DEFAULT track/phase hint (grouping only). Identity is `name`; a '
  'project''s activities.track may differ.';
COMMENT ON COLUMN activity_dictionary.type IS
  'Activity kind: ''task'' (durational work) or ''milestone'' (zero-duration marker). Default ''task''.';
COMMENT ON COLUMN activity_dictionary.cost_code_id IS
  'RESERVED for Slice B (cost codes). No FK/table yet — additive placeholder.';
COMMENT ON COLUMN activities.dictionary_id IS
  'Optional FK → activity_dictionary(id), ON DELETE SET NULL. NULL = not yet '
  'linked to a canonical dictionary entry (the review queue). Project-specific '
  'bits (sequence_order, color, track, applies_to_unit_types) stay on activities.';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- table + sentinel + seed present:
--   SELECT count(*) FROM activity_dictionary;                         -- 1 sentinel + ~31 seeded
--   SELECT name, status, track, type FROM activity_dictionary
--     WHERE name = 'Other (pending)';                                 -- pending / task
--   SELECT count(*) FROM activity_dictionary WHERE status='active';   -- ~31 (distinct names)
--
--   -- "Framing" collapsed to ONE row despite two tracks today:
--   SELECT count(*) FROM activity_dictionary WHERE name='Framing';    -- 1
--
--   -- additive FK: every existing activity starts unlinked (the review queue):
--   SELECT count(*) FROM activities WHERE dictionary_id IS NULL;      -- = count(*) activities
--
--   -- RLS shape mirrors subtypes (read=member, writes=owner/admin/pm, TO authenticated):
--   SELECT policyname, cmd, roles FROM pg_policies
--     WHERE tablename='activity_dictionary' ORDER BY policyname;      -- 4 policies, {authenticated}
-- ============================================================
