-- ============================================================
-- Migration: sheet_text (AI Tracing Assist — Phase 1)
-- Purpose: Cache the PDF text layer of a floor-plan sheet (the room numbers,
--          names, sheet titles, and grid labels that are REAL searchable text,
--          not pixels) along with each word's position. This is the free data
--          foundation that later capture tools read from to auto-fill room
--          names, parse the title block, and label gridlines. Nothing is
--          user-visible yet — this is plumbing only.
--          See: Notes/plans/AI-Tracing-Assist-Plan.md (Phase 1 + Data model),
--               docs/ai-tracing-pipeline-plan.md (M2.1 + Feasibility findings).
--
-- It IS the `sheet_vectors` pattern, for text: a 1:1 write-through cache keyed
-- by sheet_id, holding a JSONB array of words in the SAME percent space used by
-- sheet_vectors / units.polygon_coordinates (positions mapped through the same
-- PDF→percent transform). Don't invent a different shape, RLS posture, or
-- caching strategy (AGENTS.md §5).
--
-- ONE additive change: a brand-new isolated cache table that nothing existing
-- reads or writes. Mirrors the posture of 20260617_workbench_schema.sql
-- (workbench_sheets) for the sheet → project → project_members RLS hop.
--
-- IDEMPOTENT: safe to re-run. Every step is guarded (CREATE TABLE IF NOT EXISTS,
-- pg_policies existence checks).
-- ============================================================

-- ============================================================
-- STEP 1: sheet_text — 1:1 cache of a sheet's extracted text words.
--   sheet_id  PK = FK to sheets(id) ON DELETE CASCADE: one cache row per sheet,
--             removed automatically if the sheet is hard-deleted (mirrors
--             sheet_vectors / workbench_sheets).
--   text      JSONB array of [{ text, pctX, pctY }] — each extracted word and
--             its position (word-bbox center) in percent space (0..1), the same
--             coordinate system as sheet_vectors and units.polygon_coordinates.
--             NOT NULL DEFAULT '[]': a scanned PDF with no text layer caches an
--             EMPTY array, which is the legitimate "no words / OCR candidate"
--             state — never an error. The empty array IS the OCR-later flag.
--   created_at  when the row was first cached (matches sheet_vectors; an
--             on-conflict re-extract refreshes `text`, not this timestamp).
-- ============================================================
CREATE TABLE IF NOT EXISTS sheet_text (
  sheet_id    UUID PRIMARY KEY REFERENCES sheets(id) ON DELETE CASCADE,
  text        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- STEP 2: RLS for sheet_text.
-- Mirrors the workbench_sheets membership pattern (table -> sheets ->
-- project_members), which itself mirrors sheet_vectors' posture:
--   READ  = any authenticated member of the parent sheet's project.
--   WRITE = privileged roles only (owner / admin / pm).
-- The backend write-through runs as the service role, which BYPASSES RLS, so
-- these policies govern only any future client-side access. NEVER granted to
-- `anon`. auth.uid() is wrapped in a scalar sub-select per the rls_perf
-- init-plan optimization, matching workbench_sheets / project_contacts.
-- ============================================================
ALTER TABLE sheet_text ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated member of the parent sheet's project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sheet_text'
      AND policyname = 'Members can view sheet_text'
  ) THEN
    CREATE POLICY "Members can view sheet_text"
      ON sheet_text FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_text.sheet_id
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
    WHERE tablename = 'sheet_text'
      AND policyname = 'Privileged members can insert sheet_text'
  ) THEN
    CREATE POLICY "Privileged members can insert sheet_text"
      ON sheet_text FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_text.sheet_id
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
    WHERE tablename = 'sheet_text'
      AND policyname = 'Privileged members can update sheet_text'
  ) THEN
    CREATE POLICY "Privileged members can update sheet_text"
      ON sheet_text FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_text.sheet_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_text.sheet_id
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
    WHERE tablename = 'sheet_text'
      AND policyname = 'Privileged members can delete sheet_text'
  ) THEN
    CREATE POLICY "Privileged members can delete sheet_text"
      ON sheet_text FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_text.sheet_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      );
  END IF;
END
$$;

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- table exists, RLS on:
--   SELECT to_regclass('public.sheet_text');                          -- expect public.sheet_text
--   SELECT relrowsecurity FROM pg_class WHERE relname='sheet_text';     -- expect true
--
--   -- the 4 RLS policies present (SELECT + INSERT + UPDATE + DELETE):
--   SELECT policyname, cmd FROM pg_policies
--     WHERE tablename='sheet_text' ORDER BY cmd;
--
--   -- columns + the FK (sheet CASCADE):
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--     WHERE table_name='sheet_text' ORDER BY ordinal_position;
--   SELECT conname, confdeltype FROM pg_constraint
--     WHERE conrelid='sheet_text'::regclass AND contype='f';            -- expect 'c' (CASCADE)
-- ============================================================
