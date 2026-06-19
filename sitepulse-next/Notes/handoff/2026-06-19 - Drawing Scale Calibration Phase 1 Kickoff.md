# Kickoff — Drawing Scale & Calibration, Phase 1: Foundation (schema + pure scale math)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Drawing Scale & Calibration** (DB schema + pure scale math; no app behavior change yet). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-19 - Drawing Scale Calibration Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Drawing-Scale-Calibration-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. ⛔ The migration is an approval gate: present the exact SQL and **STOP** — do not apply it (especially against production data) until I say go. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this phase is
The foundation only: the data model and the pure, unit-tested math. **No UI, no behavior
change** for the user yet — Phases 2 (the dock tool) and 3 (corrected areas + recalculate)
build on this. Keep it small and clean so the migration can be reviewed in isolation.

## Required reading (fresh — line numbers in the plan WILL have drifted)
- `sitepulse-next/AGENTS.md` — esp. §4 (schema changes → types), §6 (TS guardrails, JSONB
  narrowing, IDB serialization), §2 (RLS posture: no `anon` grants, additive/nullable only).
- `sitepulse-next/Notes/plans/Drawing-Scale-Calibration-Plan.md` — the whole plan, but build
  only the **Phase 1** section. Note the "The bug this fixes" + "Data model" + "Pure logic" sections.
- `sitepulse-next/supabase/migrations/20260619_units_standard_version.sql` — copy its
  additive/nullable/idempotent/RLS-unchanged style for the new migration.
- `sitepulse-next/src/types/database.types.ts` (`sheets` Row/Insert/Update) and
  `src/types/domain.ts` (`Sheet`, the existing `isPercentPointArray` guard pattern).
- `sitepulse-next/src/utils/workbench.ts` (`computeLabelArea`) and
  `src/hooks/useMapActions.ts` (`saveNewUnitFromPopover` inline area loop) — so you understand
  exactly what the new `computeAreaFromUnitsPerPx` will replace in Phase 3 (don't change them
  this phase; just match their pixel basis: `base_image_url` natural dims).
- `sitepulse-next/src/utils/geometry.ts` — aspect/percent-space notes + shoelace pattern.
- The backend PDF→PNG converter (in `sitepulse-backend/`, the PyMuPDF `get_pixmap`/zoom
  matrix) — to **confirm the render DPI** for `ESTIMATED_RENDER_DPI`.

## Scope (build exactly this)
1. **Migration** `sitepulse-next/supabase/migrations/20260619_drawing_scale.sql`:
   `ADD COLUMN IF NOT EXISTS` on `public.sheets`:
   - `scale_units_per_px numeric` — canonical scale = real **feet per base-image pixel**.
   - `scale_unit text` — `'ft'` in v1 (future-proofs metric).
   - `scale_calibration jsonb` — provenance/re-edit (`{p1,p2,length,unit,source,preset,at}`).
   Additive + nullable, **no backfill**, **RLS unchanged**, idempotent, with `COMMENT ON COLUMN`.
2. **Types:** hand-add the three columns to `database.types.ts` (`sheets` Row/Insert/Update).
   Add `isScaleCalibration()` JSONB guard in `domain.ts` (mirror `isPercentPointArray`).
   `Sheet` derives from the Row automatically — don't hand-duplicate the shape.
3. **`src/utils/scale.ts` + `src/utils/scale.test.ts`** — all pure logic from the plan's
   "Pure logic" section: `ARCH_SCALE_PRESETS`, `pixelDistance`, `unitsPerPxFromCalibration`,
   `presetUnitsPerPx` (+ exported `ESTIMATED_RENDER_DPI`), `computeAreaFromUnitsPerPx`,
   `parseFeetInches`, `formatFeetInches`, `formatArea`. No `Date.now()` inside — callers stamp.

## ⛔ Approval gates (hard stops)
- **DB migration:** present the exact SQL and **STOP**. Do not apply it (use the
  `create-migration` skill conventions to show it). Never run it against production data
  without my explicit go-ahead.
- If you can't confirm `ESTIMATED_RENDER_DPI` from the backend, say so and keep the preset
  result clearly approximate (calibration is the trusted path regardless) — don't guess silently.

## Exit criteria (Definition of Done → then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green;
  `scale.test.ts` covers calibration, preset, corrected-area, and feet-inch parse/format —
  including null/degenerate inputs (zero-length line, <3 points, missing dims, unparseable text).
- Build not required this phase (no component edits).
- Vitest globals are OFF — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate the test.
- Close with the **`verify-feature`** skill (Definition of Done → stop). **Do not commit or
  push** until the owner says "Approved." Migration stays unapplied until approved.

## Guardrails specific to this phase
- Lint is **not** a gate (~1850 pre-existing problems) — typecheck + test only here.
- Don't touch the create paths / area call sites yet (that's Phase 3).
- Keep everything in `scale.ts` pure and JSON-serializable; no class instances, no I/O.
