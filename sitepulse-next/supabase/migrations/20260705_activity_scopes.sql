-- ============================================================
-- Migration: Global managed "scopes of work" palette
--            (Scheduling UX Hardening — durable default-scope list)
-- File: 20260705_activity_scopes.sql  (sorts after 20260704_activity_playbooks)
--
-- WHAT & WHY (plain English):
--   Today "scopes of work" aren't stored anywhere — they're derived on the fly
--   from the distinct `track` text on a project's activities and the company
--   dictionary's default-track hints. So a scope with no activities can't exist,
--   and there's no way to rename/delete/reorder one. This adds a small SHARED,
--   company-wide list of scope names you can curate. Scopes stay linked to
--   activities BY NAME (loose coupling) — `activities.track` /
--   `activity_dictionary.track` remain plain text — so NOTHING in the Phase-1
--   status pipeline, the map's scope tabs, progress analytics, or the offline
--   queue is touched. This is the light "managed palette", NOT a re-key of the
--   pipeline onto scope IDs (that stays a deferred, separate workstream).
--
--   Governance MIRRORS `activity_dictionary` / `subtypes`: global (cross-project),
--   read = any project member, write = owner/admin/pm, never `anon`.
--
-- ADDITIVE ONLY. New table + a seed from existing track strings. No existing
--   table or column is altered. Not deploy-coupled (the app ignores it until the
--   new UI reads it). IDEMPOTENT: create-if-not-exists, guarded RLS, seed via
--   ON CONFLICT (name) DO NOTHING.
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_scopes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','archived')),
  created_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Ordered listing (curated order, then name) + active/archived filtering.
CREATE INDEX IF NOT EXISTS idx_activity_scopes_sort   ON activity_scopes (sort_order, name);
CREATE INDEX IF NOT EXISTS idx_activity_scopes_status ON activity_scopes (status);

-- ---- RLS: copied verbatim from activity_dictionary --------------------------
ALTER TABLE activity_scopes ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated project member
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='activity_scopes' AND policyname='Members can view activity_scopes') THEN
    CREATE POLICY "Members can view activity_scopes"
      ON activity_scopes FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = (SELECT auth.uid())));
  END IF;
END $$;

-- INSERT: privileged roles only
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='activity_scopes' AND policyname='Privileged members can insert activity_scopes') THEN
    CREATE POLICY "Privileged members can insert activity_scopes"
      ON activity_scopes FOR INSERT TO authenticated
      WITH CHECK (EXISTS (SELECT 1 FROM project_members pm
        WHERE pm.user_id = (SELECT auth.uid()) AND pm.role IN ('owner','admin','pm')));
  END IF;
END $$;

-- UPDATE: privileged roles only
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='activity_scopes' AND policyname='Privileged members can update activity_scopes') THEN
    CREATE POLICY "Privileged members can update activity_scopes"
      ON activity_scopes FOR UPDATE TO authenticated
      USING (EXISTS (SELECT 1 FROM project_members pm
        WHERE pm.user_id = (SELECT auth.uid()) AND pm.role IN ('owner','admin','pm')));
  END IF;
END $$;

-- DELETE: privileged roles only
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE tablename='activity_scopes' AND policyname='Privileged members can delete activity_scopes') THEN
    CREATE POLICY "Privileged members can delete activity_scopes"
      ON activity_scopes FOR DELETE TO authenticated
      USING (EXISTS (SELECT 1 FROM project_members pm
        WHERE pm.user_id = (SELECT auth.uid()) AND pm.role IN ('owner','admin','pm')));
  END IF;
END $$;

-- ---- Seed: the scope names already in use, so the palette starts populated ---
-- Distinct non-empty track strings from BOTH a project's activities and the
-- company dictionary's default-track hints. ON CONFLICT keeps any later curation.
INSERT INTO activity_scopes (name, sort_order)
SELECT btrim(t.track), (ROW_NUMBER() OVER (ORDER BY btrim(t.track)))::int - 1
  FROM (
    SELECT DISTINCT btrim(track) AS track FROM activities          WHERE btrim(coalesce(track,'')) <> ''
    UNION
    SELECT DISTINCT btrim(track) AS track FROM activity_dictionary WHERE btrim(coalesce(track,'')) <> ''
  ) t
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE activity_scopes IS
  'Global, company-wide curated list of scope-of-work names (the "default scopes" '
  'palette). Loosely linked to activities BY NAME — activities.track / '
  'activity_dictionary.track stay plain text — so the status/progress/offline '
  'pipeline is untouched. Governance mirrors activity_dictionary '
  '(read=member, write=owner/admin/pm, never anon).';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--   SELECT count(*) FROM activity_scopes;                                  -- seeded from existing tracks
--   SELECT name, sort_order, status FROM activity_scopes ORDER BY sort_order;
--   SELECT policyname, cmd, roles FROM pg_policies
--     WHERE tablename='activity_scopes' ORDER BY policyname;               -- 4 policies, {authenticated}
-- ============================================================
