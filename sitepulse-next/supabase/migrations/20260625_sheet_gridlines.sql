-- ============================================================
-- Migration: sheet_gridlines (AI Tracing Assist — Phase 3b)
-- Purpose: Store the structural grid a user CONFIRMS for a sheet — one row per
--          sheet holding the list of gridlines `[{ label, p1, p2, axis }]`, each
--          captured in two assisted gestures: (a) box the grid BUBBLE (the app
--          reads its label "A"/"1" from the cached PDF text), (b) drag the AXIS
--          line across the grid line (the app snaps both endpoints to the long
--          straight vector). A whole sheet's grids are banked in one "accept all"
--          upsert. Confirmed grids also seed the Phase-3c calibration
--          (grid lineweight/color → subtractable snapping noise).
--          See: Notes/plans/AI-Tracing-Assist-Plan.md (Phase 3, Annotation tool
--               #3 gridlines, Data model — "sheet_gridlines"),
--               Notes/handoff/2026-06-25 - AI Tracing Assist Phase 3b Kickoff.md.
--
-- WHY A NEW 1:1 TABLE (JSONB array, not row-per-grid): matches the cache/annotation
-- shape of sheet_vectors / sheet_text / sheet_metadata (keyed by sheet_id, one
-- write-through row, RLS via sheets -> project_members), so "accept all" is ONE
-- upsert and the per-sheet provenance columns live on the row. The gridlines list
-- is small and always read/written whole, so a JSONB array beats a child table.
--
-- ONE additive change: a brand-new isolated table that nothing existing reads or
-- writes. Mirrors the posture of 20260625_sheet_metadata.sql exactly.
--
-- IDEMPOTENT: safe to re-run. Every step is guarded (CREATE TABLE IF NOT EXISTS,
-- pg_policies existence checks).
-- ============================================================

-- ============================================================
-- STEP 1: sheet_gridlines — 1:1 confirmed gridlines for a sheet.
--   sheet_id        PK = FK to sheets(id) ON DELETE CASCADE: one row per sheet,
--                   removed automatically if the sheet is hard-deleted (mirrors
--                   sheet_metadata / sheet_text / sheet_vectors).
--   gridlines       JSONB array `[{ label, p1:{pctX,pctY}, p2:{pctX,pctY},
--                   axis:'h'|'v' }]` — the CONFIRMED grids. `label` = the bubble
--                   ("A"/"B"/"1"/"2"); p1/p2 = the snapped endpoints in the SAME
--                   percent space (0..1) as units.polygon_coordinates /
--                   sheet_vectors; axis = the line's orientation
--                   ('h' = horizontal grid line, 'v' = vertical). NOT NULL
--                   DEFAULT '[]' so a row always carries a well-formed array.
--   ---- Milestone-1 capture provenance (mirrors sheet_metadata.* exactly; the
--        gridline read is the same "app proposes → human confirms" flow as the
--        title block, so it banks the same signal). Plain TEXT, no CHECK enums —
--        matches the location-taxonomy / trace_events / sheet_metadata convention
--        so a new source value never needs a migration. ----
--   source          'human' | 'ai_suggested' | 'ai_accepted' | 'ai_edited' —
--                   the rolled-up provenance of the confirmed labels (human = no
--                   bubble was machine-read; accepted = every read kept; edited =
--                   any read corrected or hand-typed).
--   model_version   id of the parser that produced the proposals (NULL = manual).
--   suggested_gridlines  JSONB array — the FROZEN original machine proposal
--                   (same geometry + the READ labels), index-aligned with
--                   `gridlines`, preserved even after the human edits a label.
--                   The before-vs-final delta is the correction signal; it cannot
--                   be reconstructed later.
--   review_status   'unreviewed' | 'confirmed' (set 'confirmed' on accept-all).
--   spec_version    annotation-spec version this row was captured under.
--   created_at      first capture time.
--   updated_at      last accept-all time (set by the app on each upsert).
-- ============================================================
CREATE TABLE IF NOT EXISTS sheet_gridlines (
  sheet_id            UUID PRIMARY KEY REFERENCES sheets(id) ON DELETE CASCADE,
  gridlines           JSONB NOT NULL DEFAULT '[]'::jsonb,
  source              TEXT,
  model_version       TEXT,
  suggested_gridlines JSONB,
  review_status       TEXT,
  spec_version        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- STEP 2: RLS for sheet_gridlines.
-- Mirrors sheet_metadata exactly (table -> sheets -> project_members):
--   READ  = any authenticated member of the parent sheet's project.
--   WRITE = privileged roles only (owner / admin / pm).
-- Like sheet_metadata (and unlike sheet_text), THIS table is written by the CLIENT
-- (the frontend-pure gridline flow), so the privileged write policies are
-- load-bearing — the workbench user is `admin` of the hidden container, so the
-- write is allowed. NEVER granted to `anon`. auth.uid() is wrapped in a scalar
-- sub-select per the rls_perf init-plan optimization, matching sheet_metadata.
-- ============================================================
ALTER TABLE sheet_gridlines ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated member of the parent sheet's project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sheet_gridlines'
      AND policyname = 'Members can view sheet_gridlines'
  ) THEN
    CREATE POLICY "Members can view sheet_gridlines"
      ON sheet_gridlines FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_gridlines.sheet_id
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
    WHERE tablename = 'sheet_gridlines'
      AND policyname = 'Privileged members can insert sheet_gridlines'
  ) THEN
    CREATE POLICY "Privileged members can insert sheet_gridlines"
      ON sheet_gridlines FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_gridlines.sheet_id
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
    WHERE tablename = 'sheet_gridlines'
      AND policyname = 'Privileged members can update sheet_gridlines'
  ) THEN
    CREATE POLICY "Privileged members can update sheet_gridlines"
      ON sheet_gridlines FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_gridlines.sheet_id
            AND pm.user_id = (SELECT auth.uid())
            AND pm.role IN ('owner','admin','pm')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_gridlines.sheet_id
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
    WHERE tablename = 'sheet_gridlines'
      AND policyname = 'Privileged members can delete sheet_gridlines'
  ) THEN
    CREATE POLICY "Privileged members can delete sheet_gridlines"
      ON sheet_gridlines FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM sheets s
          JOIN project_members pm ON pm.project_id = s.project_id
          WHERE s.id = sheet_gridlines.sheet_id
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
--   SELECT to_regclass('public.sheet_gridlines');                          -- expect public.sheet_gridlines
--   SELECT relrowsecurity FROM pg_class WHERE relname='sheet_gridlines';      -- expect true
--
--   -- the 4 RLS policies present (SELECT + INSERT + UPDATE + DELETE):
--   SELECT policyname, cmd FROM pg_policies
--     WHERE tablename='sheet_gridlines' ORDER BY cmd;
--
--   -- columns + the FK (sheet CASCADE):
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--     WHERE table_name='sheet_gridlines' ORDER BY ordinal_position;
--   SELECT conname, confdeltype FROM pg_constraint
--     WHERE conrelid='sheet_gridlines'::regclass AND contype='f';            -- expect 'c' (CASCADE)
-- ============================================================
