-- ============================================================
-- Migration: sheet_metadata (AI Tracing Assist — Phase 3a)
-- Purpose: Store the title-block facts a user CONFIRMS for a sheet — the
--          **sheet number** ("A-201"), the **sheet name** ("SECOND FLOOR
--          PLAN"), and the **architect/firm** ("RSP Architects") — read from the
--          cached PDF text (sheet_text) the moment the user drags a box over the
--          title block. The architect/firm is the key that groups the training
--          corpus and (Phase 3c) keys the per-set calibration profile.
--          See: Notes/plans/AI-Tracing-Assist-Plan.md (Phase 3, Annotation tool
--               #2, Data model — "Sheet metadata: columns vs new table"),
--               Notes/handoff/2026-06-25 - AI Tracing Assist Phase 3 Kickoff.md.
--
-- WHY A NEW 1:1 TABLE (not columns on `sheets`): `sheets` is the shared, central
-- operational table (live projects AND workbench drawings) with no provenance
-- pattern, and it ALREADY has a `sheet_name` column meaning the user's drawing
-- LABEL — adding a second title-block-read "sheet_name" there would collide.
-- This is a verified-capture ANNOTATION carrying Milestone-1 provenance
-- (source / frozen suggestion / review_status), which is exactly the
-- cache/annotation shape of sheet_text / sheet_vectors / trace_events: keyed by
-- sheet_id, RLS via sheets -> project_members. Keeping it isolated leaves the
-- shared `sheets` table clean (AGENTS.md §4 / plan § Data model).
--
-- ONE additive change: a brand-new isolated table that nothing existing reads
-- or writes. Mirrors the posture of 20260625_sheet_text.sql exactly.
--
-- IDEMPOTENT: safe to re-run. Every step is guarded (CREATE TABLE IF NOT EXISTS,
-- pg_policies existence checks).
-- ============================================================

-- ============================================================
-- STEP 1: sheet_metadata — 1:1 confirmed title-block facts for a sheet.
--   sheet_id        PK = FK to sheets(id) ON DELETE CASCADE: one row per sheet,
--                   removed automatically if the sheet is hard-deleted (mirrors
--                   sheet_text / sheet_vectors).
--   sheet_number    e.g. "A-201" — the drawing's sheet number (TEXT, free-form).
--   sheet_name      e.g. "SECOND FLOOR PLAN" — the drawing TITLE as printed in
--                   the title block. Distinct from sheets.sheet_name, which is
--                   the user's library label for the drawing.
--   architect_firm  e.g. "RSP Architects" — the corpus + calibration key.
--   title_block_bbox  JSONB { x0, y0, x1, y1 } — the percent-space (0..1) box the
--                   human dragged over the title block. The geometry the human
--                   drew (the "where"), in the SAME percent space as
--                   units.polygon_coordinates / sheet_vectors / sheet_text.
--   ---- Milestone-1 capture provenance (mirrors the units.* provenance columns;
--        the title-block read is the same "app proposes → human confirms" flow as
--        room-name auto-fill, so it banks the same signal). Plain TEXT, no CHECK
--        enums — matches the location-taxonomy / trace_events convention so a new
--        source value never needs a migration. ----
--   source          'human' | 'ai_suggested' | 'ai_accepted' | 'ai_edited' —
--                   provenance of the FINAL confirmed values.
--   model_version   id of the parser that produced the proposal (NULL = manual).
--   suggested_fields  JSONB { sheetNumber, sheetName, architectFirm } — the FROZEN
--                   original machine proposal, preserved even after the human
--                   edits the live values. The before-vs-final delta is the
--                   correction signal; it cannot be reconstructed later.
--   review_status   'unreviewed' (proposal not yet confirmed) | 'confirmed'.
--   spec_version    annotation-spec version this row was captured under.
--   created_at      first capture time.
--   updated_at      last confirmation time (set by the app on each upsert).
-- ============================================================
CREATE TABLE IF NOT EXISTS sheet_metadata (
  sheet_id         UUID PRIMARY KEY REFERENCES sheets(id) ON DELETE CASCADE,
  sheet_number     TEXT,
  sheet_name       TEXT,
  architect_firm   TEXT,
  title_block_bbox JSONB,
  source           TEXT,
  model_version    TEXT,
  suggested_fields JSONB,
  review_status    TEXT,
  spec_version     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- STEP 2: RLS for sheet_metadata.
-- Mirrors sheet_text exactly (table -> sheets -> project_members):
--   READ  = any authenticated member of the parent sheet's project.
--   WRITE = privileged roles only (owner / admin / pm).
-- Unlike sheet_text (written server-side as the service role), THIS table is
-- written by the CLIENT (the frontend-pure title-block flow), so the privileged
-- write policies are load-bearing — the workbench user is `admin` of the hidden
-- container, so the write is allowed. NEVER granted to `anon`. auth.uid() is
-- wrapped in a scalar sub-select per the rls_perf init-plan optimization,
-- matching sheet_text / trace_events / project_contacts.
-- ============================================================
ALTER TABLE sheet_metadata ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated member of the parent sheet's project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sheet_metadata'
      AND policyname = 'Members can view sheet_metadata'
  ) THEN
    CREATE POLICY "Members can view sheet_metadata"
      ON sheet_metadata FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_metadata.sheet_id
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
    WHERE tablename = 'sheet_metadata'
      AND policyname = 'Privileged members can insert sheet_metadata'
  ) THEN
    CREATE POLICY "Privileged members can insert sheet_metadata"
      ON sheet_metadata FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_metadata.sheet_id
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
    WHERE tablename = 'sheet_metadata'
      AND policyname = 'Privileged members can update sheet_metadata'
  ) THEN
    CREATE POLICY "Privileged members can update sheet_metadata"
      ON sheet_metadata FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_metadata.sheet_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_metadata.sheet_id
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
    WHERE tablename = 'sheet_metadata'
      AND policyname = 'Privileged members can delete sheet_metadata'
  ) THEN
    CREATE POLICY "Privileged members can delete sheet_metadata"
      ON sheet_metadata FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_metadata.sheet_id
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
--   SELECT to_regclass('public.sheet_metadata');                          -- expect public.sheet_metadata
--   SELECT relrowsecurity FROM pg_class WHERE relname='sheet_metadata';     -- expect true
--
--   -- the 4 RLS policies present (SELECT + INSERT + UPDATE + DELETE):
--   SELECT policyname, cmd FROM pg_policies
--     WHERE tablename='sheet_metadata' ORDER BY cmd;
--
--   -- columns + the FK (sheet CASCADE):
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--     WHERE table_name='sheet_metadata' ORDER BY ordinal_position;
--   SELECT conname, confdeltype FROM pg_constraint
--     WHERE conrelid='sheet_metadata'::regclass AND contype='f';            -- expect 'c' (CASCADE)
-- ============================================================
