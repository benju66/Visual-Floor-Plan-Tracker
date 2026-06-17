-- ============================================================
-- Migration: Location Taxonomy Correction (Workbench plan — Phase 2)
-- Purpose: Lock two seed corrections NOW, while the tracing corpus is still
--          empty (the labeling standard §10 forbids changing the taxonomy
--          mid-corpus). Two corrections, both decided by the owner 2026-06-17
--          (Notes/plans/Location-Labeling-Workbench-Plan.md §"Locked product
--          decisions" 3):
--
--   (A) Restaurant `Kitchen` and `Prep` move from Program -> `support`
--       (Back of House). Guest-facing Dining/Bar/Private/Patio stay Program.
--   (B) Split the single "Housing and Hotel" project type into separate
--       `Housing` and `Hotel` types (8 -> 9). Re-scope the affected sub-types:
--           Dwelling Unit, Live/Work Unit          -> Housing
--           Guestroom, Suite, Event/Ballroom,
--           Meeting Room                            -> Hotel
--       Universal Common/Support sub-types (scoped to ALL project types) get
--       BOTH Housing and Hotel in place of the retired merged type.
--
-- This SQL MIRRORS src/utils/locationTaxonomy.ts (PROJECT_TYPES, SEED_SUBTYPES
-- roles + defaultProjectTypes, ROLE_DISPLAY_LABELS) — that file is the source
-- of truth; this SQL follows it (AGENTS.md §4).
--
-- ADDITIVE/CORRECTIVE ONLY. `units.unit_type` is untouched (milestone
-- applicability keys on it — AGENTS.md §2). Nothing in status_logs /
-- status_audit_log / the offline sync pipeline is touched. `units` rows are
-- NOT re-backfilled: a unit's `top_level_role` is its own source of truth and
-- is NEVER derived from its sub-type's role (AGENTS.md §4, invariant 2).
--
-- IDEMPOTENT: safe to re-run. The constraint is dropped + re-added; the data
-- UPDATEs are value-stable (re-running sets the same values) and the project
-- remap / universal re-scope match zero rows once applied.
-- ============================================================

-- ============================================================
-- STEP 1: projects.project_type — migrate the CHECK from 8 -> 9 values and
-- remap any legacy 'Housing and Hotel' rows to 'Housing'.
--   ⛔ DATA-TOUCHING: the UPDATE below rewrites projects.project_type.
--   Expected affected rows: 0 (existing projects were intentionally left NULL
--   by the foundation migration; a picker was only added in Phase 1).
-- Order matters: the old CHECK forbids 'Housing', so we DROP it, remap, then
-- ADD the new 9-value CHECK (NOT VALID then VALIDATE, matching the template).
-- ============================================================
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_project_type_check;

UPDATE projects
SET project_type = 'Housing'
WHERE project_type = 'Housing and Hotel';

ALTER TABLE projects
  ADD CONSTRAINT projects_project_type_check
  CHECK (
    project_type IS NULL OR project_type IN (
      'Commercial','Educational','Government','Healthcare',
      'Hotel','Housing','Industrial','Restaurant','Workplace'
    )
  ) NOT VALID;
ALTER TABLE projects VALIDATE CONSTRAINT projects_project_type_check;

-- ============================================================
-- STEP 2: subtypes — Restaurant Kitchen + Prep become Back of House (support).
--   ⛔ DATA-TOUCHING. Expected affected rows: 2 (Kitchen, Prep), if the
--   foundation seed is present.
-- ============================================================
UPDATE subtypes
SET top_level_role = 'support'
WHERE name IN ('Kitchen', 'Prep');

-- ============================================================
-- STEP 3: subtypes — re-scope default_project_types off the retired
-- "Housing and Hotel" type.  ⛔ DATA-TOUCHING.
--
-- 3a. The 6 former Housing-and-Hotel Program sub-types get their specific new
--     home (scoping orders the pick-list, never restricts — every sub-type
--     stays globally available). Expected: 2 rows Housing, 4 rows Hotel.
-- ============================================================
UPDATE subtypes
SET default_project_types = '["Housing"]'::jsonb
WHERE name IN ('Dwelling Unit', 'Live/Work Unit');

UPDATE subtypes
SET default_project_types = '["Hotel"]'::jsonb
WHERE name IN ('Guestroom', 'Suite', 'Event/Ballroom', 'Meeting Room');

-- 3b. Every OTHER sub-type still listing 'Housing and Hotel' is a universal
--     Common/Support type scoped to ALL project types — replace the retired
--     element with BOTH 'Housing' and 'Hotel', deduped + sorted. Re-running
--     matches zero rows (nothing still contains 'Housing and Hotel').
--     Expected affected rows: 17 (8 Common + 9 Support universals).
UPDATE subtypes
SET default_project_types = (
  SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb)
  FROM jsonb_array_elements_text(
    (default_project_types - 'Housing and Hotel') || '["Housing","Hotel"]'::jsonb
  ) AS elem
)
WHERE default_project_types ? 'Housing and Hotel';

-- ============================================================
-- VERIFICATION (run after applying; read-only — not part of the migration):
--
--   -- No project still on the retired type:
--   SELECT count(*) FROM projects WHERE project_type = 'Housing and Hotel';     -- expect 0
--
--   -- Kitchen/Prep are now Back of House:
--   SELECT name, top_level_role FROM subtypes WHERE name IN ('Kitchen','Prep'); -- expect support, support
--
--   -- No sub-type still scoped to the retired type:
--   SELECT count(*) FROM subtypes WHERE default_project_types ? 'Housing and Hotel'; -- expect 0
--
--   -- The split sub-types landed correctly:
--   SELECT name, default_project_types FROM subtypes
--   WHERE name IN ('Dwelling Unit','Live/Work Unit','Guestroom','Suite','Event/Ballroom','Meeting Room');
-- ============================================================
