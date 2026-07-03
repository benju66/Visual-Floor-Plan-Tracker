-- ============================================================
-- Migration: Per-link "shift dates" flag on activity dependencies
--            (Scheduling Analytics, Slice B, Phase 4 follow-up)
--
-- WHAT & WHY (plain English):
--   A Finish-to-Start link between two activities does two jobs: (1) it shows
--   make-ready state (ready vs. blocked), and (2) it lets a predecessor's slip
--   ripple downstream planned dates. The owner wants those decoupled per link:
--   some links should ONLY drive ready/blocked and NEVER auto-move dates.
--
--   This adds ONE boolean per edge, `ripple_dates`:
--     * FALSE (default) — the link drives make-ready (ready/blocked) and shows
--                         sequence, but a slip NEVER proposes a date shift for
--                         it. This is the conservative default: a predecessor
--                         slip that the crew absorbs must not silently drag the
--                         whole downstream tail, and trades routinely overlap.
--     * TRUE            — a slip on the predecessor offers to shift this
--                         successor's planned dates (the date-ripple), for the
--                         hard links where a delay genuinely cascades.
--
--   COARSE model unchanged: still FS + lag, no critical-path/float math.
--
-- ADDITIVE ONLY: one column (NOT NULL DEFAULT FALSE) on an existing table. No
--   RLS change needed — the existing INSERT/UPDATE policies (owner/admin/pm of
--   the successor's project) already govern who can set it. Nothing else moves.
--
-- BACKFILL: DEFAULT FALSE means every existing edge becomes sequencing-only —
--   NO link auto-proposes a date shift until a user opts it in. The ripple
--   feature (Slice B P4) is thus opt-in per link, matching the owner's intent.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS; re-runnable.
-- ============================================================

ALTER TABLE activity_dependencies
  ADD COLUMN IF NOT EXISTS ripple_dates BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN activity_dependencies.ripple_dates IS
  'When TRUE, a slip on the predecessor offers to shift this successor''s '
  'planned dates (the date-ripple). When FALSE (default), the link still '
  'drives make-ready (ready/blocked) but a slip never proposes a date shift. '
  'Decouples sequencing/visibility from date propagation (Slice B P4 follow-up).';

-- ============================================================
-- VERIFICATION (run after applying; read-only — NOT part of the migration):
--
--   -- column present, correct default:
--   SELECT column_name, data_type, column_default, is_nullable
--     FROM information_schema.columns
--     WHERE table_name = 'activity_dependencies' AND column_name = 'ripple_dates';
--     -- expect: boolean, 'false', NO
--
--   -- every existing edge defaulted to false (sequencing-only until opted in):
--   SELECT ripple_dates, count(*) FROM activity_dependencies GROUP BY ripple_dates;
-- ============================================================
