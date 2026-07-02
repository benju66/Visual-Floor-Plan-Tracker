-- ============================================================
-- Migration: Playbooks — reusable, project-type-scoped activity sequences
--            (Scheduling Foundation, Slice A, Phase 5 — the LAST phase of Slice A)
--
-- FILENAME NOTE: authored 2026-07-02, dated 2026-07-04 so it sorts/applies
--   strictly AFTER 20260703_activity_dependencies.sql on a fresh replay. It
--   DEPENDS on activity_dictionary (20260702_activity_dictionary.sql) — a
--   playbook item references a canonical dictionary entry.
--
-- WHAT & WHY (plain English):
--   Today a new project starts from a blank activity list, or hand-picks
--   dictionary entries in the Schedule view's first-run wizard. A PLAYBOOK is a
--   saved recipe — e.g. "Multifamily — Interior Finishes": an ORDERED list of
--   dictionary activities plus their usual Finish-to-Start links. Starting a
--   project (or an empty Schedule view) from a playbook seeds the whole activity
--   set + sequence + dependencies in ONE action. It is a starting point, not a
--   straitjacket: everything stays fully editable afterwards, and choosing a
--   playbook is never required (blank + hand-pick stay).
--
--   Storage shape (owner-confirmed 2026-07-02): GOVERNED TABLES that reference
--   the global activity_dictionary (NOT a JSONB snapshot) — consistent with the
--   dictionary + dependencies already shipped in Slice A, shareable company-wide,
--   and a playbook stays tied to canonical activities (renames/aliases follow via
--   the dictionary; no drift). Two tables:
--     * playbooks       — the named, project-type-scoped recipe (global, governed).
--     * playbook_items  — its ordered activities (each → a dictionary entry), with
--                         the FS predecessor + lag captured AS A SELF-REFERENCE
--                         among the playbook's own items (the v1 dependency model
--                         is one-predecessor-per-activity; this maps 1:1 onto an
--                         activity_dependencies row when the playbook is applied).
--
--   Seed content (owner-confirmed 2026-07-02): START EMPTY — nothing is
--   pre-loaded. The first real playbook is created in one click via "Save current
--   project as a playbook" (privileged roles). No data snapshot is baked into this
--   migration.
--
-- ADDITIVE ONLY: two brand-new tables + their RLS. Nothing existing is touched —
--   not the status pipeline (status_logs / upsert_status_log / the audit trigger),
--   not activities, not activity_dependencies, not activity_dictionary (it is only
--   REFERENCED, read-only, by a NOT NULL FK on playbook_items). Applying a playbook
--   later writes ORDINARY `activities` + `activity_dependencies` rows through the
--   existing hooks — this migration adds no triggers and no new write path.
--
-- IDEMPOTENT: safe to re-run — create table if not exists, guarded RLS policies,
--   create index if not exists.
--
-- RLS: playbooks are GLOBAL, company-wide governance artifacts — the SAME posture
--   as activity_dictionary (copied verbatim): READ = any authenticated project
--   member; WRITE = privileged roles (owner/admin/pm) in at least one project;
--   NEVER granted to `anon` (no anon policy under enabled RLS = anon denied).
-- ============================================================

-- ============================================================
-- STEP 1: playbooks — the named, project-type-scoped recipe (global, governed).
--   Mirrors activity_dictionary where shared: globally-UNIQUE canonical `name`,
--   governed `status`, JSONB `default_project_types` (narrowed in TS at the query
--   boundary via isProjectTypeArray). `status` is active/archived — archiving hides
--   a playbook from pickers without deleting it (governance prefers this to a hard
--   delete). NO durations/dates ever live here (locked product decision: templates
--   hold identity + order + edges only).
-- ============================================================
CREATE TABLE IF NOT EXISTS playbooks (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  description           TEXT,
  default_project_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','archived')),
  created_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Picker lookups filter to active playbooks.
CREATE INDEX IF NOT EXISTS idx_playbooks_status ON playbooks (status);

-- ============================================================
-- STEP 2: playbook_items — the ordered activities in a playbook.
--   Each item REFERENCES a canonical activity_dictionary entry (NOT NULL — a
--   governed item is meaningless without one; ON DELETE RESTRICT so a dictionary
--   entry in use by a playbook can't be hard-deleted out from under it —
--   governance deprecates instead of destroying playbook data). Name / type /
--   default track are DERIVED from that dictionary entry at apply time (the point
--   of the governed shape — no drift); `track` and `color` here are OPTIONAL
--   per-item overrides (apply falls back to the dictionary default track / a
--   rotating default color when NULL).
--
--   The FS dependency is a SELF-REFERENCE among the playbook's own items:
--   `predecessor_item_id` → playbook_items(id), ON DELETE SET NULL (removing the
--   predecessor item just drops the edge, never the successor). `lag_days` may be
--   negative (a lead). This mirrors the one-predecessor-per-activity model of the
--   v1 activity_dependencies UI and maps 1:1 onto an activity_dependencies row when
--   the playbook is applied. The app guarantees a predecessor is a sibling of the
--   SAME playbook (apply only resolves predecessor_item_id among that playbook's
--   own items, so a stray reference is ignored, never corrupting). Deleting a
--   playbook cascade-drops its items.
-- ============================================================
CREATE TABLE IF NOT EXISTS playbook_items (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  playbook_id           UUID NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
  dictionary_id         UUID NOT NULL REFERENCES activity_dictionary(id) ON DELETE RESTRICT,
  sequence_order        INTEGER NOT NULL DEFAULT 0,
  track                 TEXT,       -- optional per-item scope/track override
  color                 TEXT,       -- optional per-item color override
  predecessor_item_id   UUID REFERENCES playbook_items(id) ON DELETE SET NULL,
  lag_days              INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  CHECK (predecessor_item_id IS NULL OR predecessor_item_id <> id)
);

-- Read path loads a playbook's items in order; RESTRICT delete-guard needs the
-- dictionary index to check references cheaply.
CREATE INDEX IF NOT EXISTS idx_playbook_items_playbook ON playbook_items (playbook_id);
CREATE INDEX IF NOT EXISTS idx_playbook_items_dictionary ON playbook_items (dictionary_id);

-- ============================================================
-- STEP 3: RLS for playbooks — copied VERBATIM from activity_dictionary.
--   READ  = any authenticated user who is a member of at least one project
--           (playbooks are a GLOBAL company-wide library, not project-scoped).
--   WRITE = privileged roles only (owner / admin / pm). NEVER granted to `anon`.
-- ============================================================
ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated project member
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'playbooks'
      AND policyname = 'Members can view playbooks'
  ) THEN
    CREATE POLICY "Members can view playbooks"
      ON playbooks FOR SELECT
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
    WHERE tablename = 'playbooks'
      AND policyname = 'Privileged members can insert playbooks'
  ) THEN
    CREATE POLICY "Privileged members can insert playbooks"
      ON playbooks FOR INSERT
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
    WHERE tablename = 'playbooks'
      AND policyname = 'Privileged members can update playbooks'
  ) THEN
    CREATE POLICY "Privileged members can update playbooks"
      ON playbooks FOR UPDATE
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

-- WRITE (DELETE): privileged roles only (governance prefers status='archived',
-- but a hard delete is still gated to privileged roles, never anon).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'playbooks'
      AND policyname = 'Privileged members can delete playbooks'
  ) THEN
    CREATE POLICY "Privileged members can delete playbooks"
      ON playbooks FOR DELETE
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
-- STEP 4: RLS for playbook_items — same GLOBAL posture as playbooks / the
--   dictionary (read = any member, write = privileged). Item scope is the global
--   library, not a project, so no per-project join is needed.
-- ============================================================
ALTER TABLE playbook_items ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated project member
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'playbook_items'
      AND policyname = 'Members can view playbook_items'
  ) THEN
    CREATE POLICY "Members can view playbook_items"
      ON playbook_items FOR SELECT
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
    WHERE tablename = 'playbook_items'
      AND policyname = 'Privileged members can insert playbook_items'
  ) THEN
    CREATE POLICY "Privileged members can insert playbook_items"
      ON playbook_items FOR INSERT
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
    WHERE tablename = 'playbook_items'
      AND policyname = 'Privileged members can update playbook_items'
  ) THEN
    CREATE POLICY "Privileged members can update playbook_items"
      ON playbook_items FOR UPDATE
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

-- WRITE (DELETE): privileged roles only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'playbook_items'
      AND policyname = 'Privileged members can delete playbook_items'
  ) THEN
    CREATE POLICY "Privileged members can delete playbook_items"
      ON playbook_items FOR DELETE
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
-- STEP 5: Documentation comments (idempotent; catalog metadata only).
-- ============================================================
COMMENT ON TABLE playbooks IS
  'Reusable, project-type-scoped activity sequences (Scheduling Foundation Slice A, '
  'Phase 5). A named recipe of dictionary activities + their default FS links that '
  'seeds a new/empty project''s activities + sequence + dependencies in one action. '
  'GLOBAL + governed (mirrors activity_dictionary RLS): read = any member, write = '
  'owner/admin/pm, never anon. Templates hold identity + order + edges only — never '
  'dates/durations. status archived hides from pickers without deleting.';
COMMENT ON COLUMN playbooks.default_project_types IS
  'JSONB text[] of ProjectType values this playbook is scoped/ordered for (grouping '
  'hint only, never a hard filter — narrowed in TS via isProjectTypeArray).';
COMMENT ON COLUMN playbooks.status IS
  'Governance: ''active'' (offered in pickers) or ''archived'' (retired, hidden but '
  'not deleted). No ''pending'' — playbooks have no propose flow.';
COMMENT ON TABLE playbook_items IS
  'The ordered activities of a playbook. Each references a canonical '
  'activity_dictionary entry (NOT NULL, ON DELETE RESTRICT — deprecate a dictionary '
  'entry, do not hard-delete one a playbook uses). name/type/default-track derive '
  'from the dictionary at apply time (governed, no drift); track/color are optional '
  'per-item overrides. The FS predecessor is a self-reference among the playbook''s '
  'own items (predecessor_item_id + lag_days) — one predecessor per item, mapping '
  '1:1 onto an activity_dependencies row when applied.';
COMMENT ON COLUMN playbook_items.predecessor_item_id IS
  'Self-FK → playbook_items(id) (same playbook, app-enforced), ON DELETE SET NULL. '
  'The item''s single FS predecessor; NULL = no predecessor. Applied as an '
  'activity_dependencies FS edge (+lag_days).';
COMMENT ON COLUMN playbook_items.lag_days IS
  'Whole days between predecessor finish and this item''s start when applied. May be '
  'negative (a lead). Mirrors activity_dependencies.lag_days.';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- both tables present + empty on arrival (additive, start-empty, no seed):
--   SELECT count(*) FROM playbooks;        -- 0
--   SELECT count(*) FROM playbook_items;   -- 0
--
--   -- constraints present:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'playbook_items'::regclass ORDER BY conname;
--     -- expect: playbook_id FK CASCADE, dictionary_id FK RESTRICT,
--     --         predecessor_item_id self-FK SET NULL, self-ref CHECK
--
--   -- RLS shape mirrors the dictionary (read=member, writes=owner/admin/pm,
--   -- TO authenticated, no anon) — 4 policies on each table:
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--     WHERE tablename IN ('playbooks','playbook_items')
--     ORDER BY tablename, policyname;      -- 8 rows, all {authenticated}
-- ============================================================
