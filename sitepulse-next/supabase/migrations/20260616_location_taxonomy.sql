-- ============================================================
-- Migration: Location Taxonomy Foundation (Phase 2)
-- Purpose: Give every project a canonical "project type" and every
--          location (units row) a canonical "top-level role" + an
--          optional sub-type drawn from a single GLOBAL governed
--          dictionary (the new `subtypes` table). See:
--            - docs/location-labeling-standard.md §5 / §5.7
--            - Notes/plans/Location-Taxonomy-Foundation-Plan.md (Phase 2)
--          The seed + the backfill ROLE mapping MIRROR
--          src/utils/locationTaxonomy.ts (SEED_SUBTYPES,
--          PENDING_SUBTYPE_NAME, mapLegacyUnitType) exactly — that file
--          is the source of truth, not this SQL. ONE deliberate
--          divergence (owner-approved): legacy strings that mapLegacyUnitType
--          sends to the "Other (pending)" sentinel are backfilled with
--          subtype_id = NULL (role known, sub-type unassigned) instead of
--          pointing at the sentinel, so units.top_level_role is the single
--          source of truth and no location carries a role-mismatched
--          sub-type pointer. See STEP 6.
--
-- ADDITIVE ONLY. `units.unit_type` is intentionally KEPT (milestone
-- applicability / getAppliesTo keys on it — AGENTS.md §2). Nothing in
-- the status_logs / status_audit_log / sync pipeline is touched.
--
-- IDEMPOTENT: Safe to re-run. Every step is guarded; the seed uses
-- ON CONFLICT (name) DO NOTHING and the backfill only fills NULLs.
-- ============================================================

-- ============================================================
-- STEP 1: The governed sub-type dictionary (global, not per-project).
-- `name` is globally UNIQUE — a café in a hospital reuses Restaurant's
-- "Dining Area"; project type only orders the pick-list, never restricts.
-- `aliases` / `default_project_types` are JSONB arrays (narrowed in TS
-- at the query boundary, like polygon_coordinates).
-- ============================================================
CREATE TABLE IF NOT EXISTS subtypes (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  top_level_role        TEXT NOT NULL
                          CHECK (top_level_role IN ('program','common','support','other')),
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','pending','deprecated')),
  aliases               JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_project_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_note         TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Review-queue lookups ("show me all status='pending' proposals").
CREATE INDEX IF NOT EXISTS idx_subtypes_status ON subtypes (status);

-- ============================================================
-- STEP 2: RLS for subtypes.
--   READ  = any authenticated user who is a member of at least one
--           project (it is a global dictionary, so it is not unit-scoped).
--   WRITE = privileged roles only (owner / admin / pm), mirroring the
--           status_logs membership pattern. NEVER granted to `anon`.
-- (Open decision in the plan: lightweight-admin write could be widened
--  to any authenticated member later by editing these policies only.)
-- ============================================================
ALTER TABLE subtypes ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated project member
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'subtypes'
      AND policyname = 'Members can view subtypes'
  ) THEN
    CREATE POLICY "Members can view subtypes"
      ON subtypes FOR SELECT
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
    WHERE tablename = 'subtypes'
      AND policyname = 'Privileged members can insert subtypes'
  ) THEN
    CREATE POLICY "Privileged members can insert subtypes"
      ON subtypes FOR INSERT
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
    WHERE tablename = 'subtypes'
      AND policyname = 'Privileged members can update subtypes'
  ) THEN
    CREATE POLICY "Privileged members can update subtypes"
      ON subtypes FOR UPDATE
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
    WHERE tablename = 'subtypes'
      AND policyname = 'Privileged members can delete subtypes'
  ) THEN
    CREATE POLICY "Privileged members can delete subtypes"
      ON subtypes FOR DELETE
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
-- STEP 3: Seed the dictionary from SEED_SUBTYPES (locationTaxonomy.ts),
-- PLUS the "Other (pending)" sentinel (PENDING_SUBTYPE_NAME) as its own
-- row: role 'other', status 'pending'. ON CONFLICT (name) DO NOTHING so
-- re-runs and any later manual edits are preserved.
-- `default_project_types` mirrors each seed's defaultProjectTypes:
--   universal Common/Support list all 8 types; Program sub-types list
--   their own; "Lab" is ONE global row defaulting to Healthcare+Industrial.
-- ============================================================
INSERT INTO subtypes (name, top_level_role, status, default_project_types) VALUES
  -- Universal — Common (every vertical)
  ('Lobby/Entry',             'common', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Vestibule',               'common', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Corridor',                'common', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Stair',                   'common', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Elevator/Elevator Lobby', 'common', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Public Restroom',         'common', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Reception/Waiting',       'common', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Amenity/Lounge',          'common', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),

  -- Universal — Support (every vertical)
  ('Mechanical',              'support', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Electrical',              'support', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Data/IT/Telecom',         'support', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Plumbing/Riser',          'support', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Storage',                 'support', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Janitor/Custodial',       'support', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Trash/Refuse',            'support', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Loading/Receiving',       'support', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),
  ('Staff-Only',              'support', 'active', '["Commercial","Educational","Government","Healthcare","Housing and Hotel","Industrial","Restaurant","Workplace"]'::jsonb),

  -- Program — Commercial
  ('Retail Sales Floor',      'program', 'active', '["Commercial"]'::jsonb),
  ('Tenant Suite (shell)',    'program', 'active', '["Commercial"]'::jsonb),
  ('Showroom',                'program', 'active', '["Commercial"]'::jsonb),
  ('Salon Studio',            'program', 'active', '["Commercial"]'::jsonb),
  ('Fitness Studio',          'program', 'active', '["Commercial"]'::jsonb),
  ('Service Counter',         'program', 'active', '["Commercial"]'::jsonb),

  -- Program — Educational
  ('Classroom',               'program', 'active', '["Educational"]'::jsonb),
  ('Lecture Hall',            'program', 'active', '["Educational"]'::jsonb),
  ('Teaching Lab',            'program', 'active', '["Educational"]'::jsonb),
  ('Library/Media Center',    'program', 'active', '["Educational"]'::jsonb),
  ('Gymnasium',               'program', 'active', '["Educational"]'::jsonb),
  ('Cafeteria/Dining',        'program', 'active', '["Educational"]'::jsonb),
  ('Art/Music Studio',        'program', 'active', '["Educational"]'::jsonb),

  -- Program — Government
  ('Office',                  'program', 'active', '["Government"]'::jsonb),
  ('Courtroom',               'program', 'active', '["Government"]'::jsonb),
  ('Hearing/Council Chamber', 'program', 'active', '["Government"]'::jsonb),
  ('Public Service Counter',  'program', 'active', '["Government"]'::jsonb),
  ('Records',                 'program', 'active', '["Government"]'::jsonb),
  ('Holding/Detention',       'program', 'active', '["Government"]'::jsonb),

  -- Program — Healthcare ("Lab" is ONE global row → Healthcare + Industrial)
  ('Patient Room',            'program', 'active', '["Healthcare"]'::jsonb),
  ('Exam Room',               'program', 'active', '["Healthcare"]'::jsonb),
  ('Operating Room',          'program', 'active', '["Healthcare"]'::jsonb),
  ('Procedure Room',          'program', 'active', '["Healthcare"]'::jsonb),
  ('Dental Operatory',        'program', 'active', '["Healthcare"]'::jsonb),
  ('Imaging/Radiology',       'program', 'active', '["Healthcare"]'::jsonb),
  ('Treatment Bay',           'program', 'active', '["Healthcare"]'::jsonb),
  ('Nurses'' Station',        'program', 'active', '["Healthcare"]'::jsonb),
  ('Pharmacy',                'program', 'active', '["Healthcare"]'::jsonb),
  ('Lab',                     'program', 'active', '["Healthcare","Industrial"]'::jsonb),

  -- Program — Housing and Hotel
  ('Dwelling Unit',           'program', 'active', '["Housing and Hotel"]'::jsonb),
  ('Guestroom',               'program', 'active', '["Housing and Hotel"]'::jsonb),
  ('Suite',                   'program', 'active', '["Housing and Hotel"]'::jsonb),
  ('Live/Work Unit',          'program', 'active', '["Housing and Hotel"]'::jsonb),
  ('Event/Ballroom',          'program', 'active', '["Housing and Hotel"]'::jsonb),
  ('Meeting Room',            'program', 'active', '["Housing and Hotel"]'::jsonb),

  -- Program — Industrial
  ('Manufacturing Floor',     'program', 'active', '["Industrial"]'::jsonb),
  ('Assembly Area',           'program', 'active', '["Industrial"]'::jsonb),
  ('Warehouse Bay',           'program', 'active', '["Industrial"]'::jsonb),
  ('Clean Room',              'program', 'active', '["Industrial"]'::jsonb),
  ('Process Area',            'program', 'active', '["Industrial"]'::jsonb),
  ('Cold Storage',            'program', 'active', '["Industrial"]'::jsonb),

  -- Program — Restaurant (open item §9: production Kitchen seeded as Program)
  ('Dining Area',             'program', 'active', '["Restaurant"]'::jsonb),
  ('Bar/Lounge',              'program', 'active', '["Restaurant"]'::jsonb),
  ('Private Dining',          'program', 'active', '["Restaurant"]'::jsonb),
  ('Kitchen',                 'program', 'active', '["Restaurant"]'::jsonb),
  ('Prep',                    'program', 'active', '["Restaurant"]'::jsonb),
  ('Outdoor/Patio Dining',    'program', 'active', '["Restaurant"]'::jsonb),

  -- Program — Workplace
  ('Open Workstation Area',   'program', 'active', '["Workplace"]'::jsonb),
  ('Private Office',          'program', 'active', '["Workplace"]'::jsonb),
  ('Conference Room',         'program', 'active', '["Workplace"]'::jsonb),
  ('Huddle/Phone Room',       'program', 'active', '["Workplace"]'::jsonb),
  ('Training Room',           'program', 'active', '["Workplace"]'::jsonb),
  ('Collaboration Area',      'program', 'active', '["Workplace"]'::jsonb),

  -- The non-blocking "no fit yet" sentinel (PENDING_SUBTYPE_NAME).
  ('Other (pending)',         'other',  'pending', '[]'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- STEP 4: projects.project_type — one of the 8 (or NULL).
-- Existing projects are intentionally left NULL (open decision: surface
-- a picker per project in Phase 3, do not guess). NOT VALID then VALIDATE
-- mirrors the milestone-applicability migration's CHECK style.
-- ============================================================
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS project_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_project_type_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_project_type_check
      CHECK (
        project_type IS NULL OR project_type IN (
          'Commercial','Educational','Government','Healthcare',
          'Housing and Hotel','Industrial','Restaurant','Workplace'
        )
      ) NOT VALID;
    ALTER TABLE projects VALIDATE CONSTRAINT projects_project_type_check;
  END IF;
END
$$;

-- ============================================================
-- STEP 5: units.top_level_role (canonical 4) + units.subtype_id (→ dict).
-- Both nullable & additive. unit_type is KEPT untouched. subtype_id uses
-- ON DELETE SET NULL so removing a dictionary entry never deletes or
-- blocks a location (governance prefers status='deprecated' anyway).
-- ============================================================
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS top_level_role TEXT;

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS subtype_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'units_top_level_role_check'
  ) THEN
    ALTER TABLE units
      ADD CONSTRAINT units_top_level_role_check
      CHECK (
        top_level_role IS NULL
        OR top_level_role IN ('program','common','support','other')
      ) NOT VALID;
    ALTER TABLE units VALIDATE CONSTRAINT units_top_level_role_check;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'units_subtype_id_fkey'
  ) THEN
    ALTER TABLE units
      ADD CONSTRAINT units_subtype_id_fkey
      FOREIGN KEY (subtype_id) REFERENCES subtypes(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_units_subtype_id ON units (subtype_id);

-- ============================================================
-- STEP 6: Backfill top_level_role + subtype_id from the legacy unit_type.
-- ⛔ DATA-TOUCHING STEP.
--
-- ROLE mirrors mapLegacyUnitType() EXACTLY (the confident, load-bearing layer):
--     Apartment Unit   -> program
--     Common Area      -> common
--     Back of House    -> support
--     Commercial Space -> program
--     Other / unknown  -> other
--
-- SUB-TYPE is named ONLY where the legacy string maps unambiguously to a real
-- seed sub-type (Apartment Unit -> Dwelling Unit). Every other legacy string is
-- too generic, so its subtype_id stays NULL (role known, sub-type UNASSIGNED) —
-- it does NOT point at the "Other (pending)" sentinel. This keeps
-- units.top_level_role the single source of truth and avoids a role-mismatched
-- sub-type pointer. (Owner-approved divergence from mapLegacyUnitType's sub-type
-- name; the role mapping is unchanged.)
--
-- THE REVIEW QUEUE is therefore: top_level_role IS NOT NULL AND subtype_id IS NULL.
--
-- unit_type itself is NOT modified. Guarded to top_level_role IS NULL so re-runs
-- and any later manual edits are preserved. LEFT JOIN => unmatched sub-type
-- names resolve to subtype_id = NULL.
-- ============================================================
WITH mapping AS (
  SELECT
    u.id AS unit_id,
    CASE btrim(COALESCE(u.unit_type, ''))
      WHEN 'Apartment Unit'   THEN 'program'
      WHEN 'Common Area'      THEN 'common'
      WHEN 'Back of House'    THEN 'support'
      WHEN 'Commercial Space' THEN 'program'
      WHEN 'Other'            THEN 'other'
      ELSE 'other'
    END AS role,
    CASE btrim(COALESCE(u.unit_type, ''))
      WHEN 'Apartment Unit'   THEN 'Dwelling Unit'
      ELSE NULL
    END AS subtype_name
  FROM units u
  WHERE u.top_level_role IS NULL
)
UPDATE units u
SET top_level_role = m.role,
    subtype_id     = s.id
FROM mapping m
LEFT JOIN subtypes s ON s.name = m.subtype_name
WHERE u.id = m.unit_id;
