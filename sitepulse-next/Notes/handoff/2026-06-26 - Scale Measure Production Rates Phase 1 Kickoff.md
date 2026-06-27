# Kickoff — Scale, Measure & Production Rates, Phase 1: Rescue the scale foundation

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Scale, Measure & Production Rates** (rescue the stranded scale-foundation code onto main; no migration). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-26 - Scale Measure Production Rates Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Scale-Measure-Production-Rates-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**: port the scale-only files (`scale.ts` + test, the `sheets` scale columns in `database.types.ts`, `ScaleCalibration` + `isScaleCalibration` in `domain.ts`) from branch `claude/code-repo-review-2vre2c` — **scale files ONLY, not the magnifier work**. No component edits, no behavior change. There is **no migration** (the columns are already live — confirm that first). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
We already wrote the math for setting a drawing's real-world scale and computing
correct square-footage — it's fully tested — but it got stranded on an abandoned
branch and never reached the live app. This phase just **carries that code over to
`main`** cleanly so the rest of the feature can build on it. Nothing the user sees
changes yet. It's deliberately tiny and low-risk: a clean base to start from.

## Why this phase exists / what's true right now
- The scale **database columns are ALREADY LIVE** on the `sheets` table
  (`scale_units_per_px numeric`, `scale_unit text`, `scale_calibration jsonb`,
  alongside legacy `scale_ratio` / `scale_preset`). Verified against the live DB
  (project `pmccdxmuszuykawvlphj`, Visual-Floor-Plan-Tracker) on 2026-06-26.
  **So this phase has NO migration.**
- The matching **code is written but stranded**, unmerged, on branch
  `claude/code-repo-review-2vre2c`. That branch also carries unrelated
  magnifier / inside-face-snap work — **do not bring that over**.
- `main` today still has the **area bug** (`area = pixelArea × scale_ratio`, a
  linear factor applied to an area). This phase does NOT fix it yet (Phase 3 does);
  it only lands the corrected math util so Phase 3 can use it.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §6 (TypeScript guardrails: `database.types.ts`
   is hand-maintained; narrow JSONB at the query boundary; keep Query-cache values
   JSON-serializable) and §9 (Vitest: globals OFF — import
   `{ describe, it, expect, vi }` from `'vitest'`; co-locate `*.test.ts`).
2. `sitepulse-next/Notes/plans/Scale-Measure-Production-Rates-Plan.md` — read the
   whole thing, then **Phase 1** + "Critical starting facts" + "Pure logic".
3. The stranded source you're porting (read via git, do not check out the branch
   over your work):
   - `git show claude/code-repo-review-2vre2c:sitepulse-next/src/utils/scale.ts`
   - `git show claude/code-repo-review-2vre2c:sitepulse-next/src/utils/scale.test.ts`
   - `git show claude/code-repo-review-2vre2c:sitepulse-next/src/types/domain.ts`
     (diff out only `ScaleCalibration` + `isScaleCalibration`)
   - `git show claude/code-repo-review-2vre2c:sitepulse-next/src/types/database.types.ts`
     (diff out only the three `sheets` scale columns in Row/Insert/Update)
4. The current targets on `main` you'll merge into, read FRESH (line numbers drift):
   `src/types/domain.ts`, `src/types/database.types.ts` (the `sheets` block).

## Scope (build ONLY this)
1. **Confirm the columns are live first.** Run (Supabase MCP, project
   `pmccdxmuszuykawvlphj`):
   `select column_name from information_schema.columns where table_name='sheets' and column_name like 'scale_%';`
   Expect all five (`scale_units_per_px`, `scale_unit`, `scale_calibration`,
   `scale_ratio`, `scale_preset`). If the three new ones are missing, **STOP** and
   tell the owner — do not write a migration without sign-off.
2. Add `src/utils/scale.ts` + `src/utils/scale.test.ts` (port verbatim from the
   stranded branch; adjust only if an import path or a util it references has
   changed on `main`).
3. Add the three `sheets` scale columns to `src/types/database.types.ts`
   (Row / Insert / Update) **by hand**. `Sheet` in `domain.ts` derives them
   automatically — don't hand-duplicate the shape.
4. Add `ScaleCalibration` + the null-safe `isScaleCalibration` JSONB guard to
   `src/types/domain.ts` (mirror the existing `isPercentPointArray` pattern).
5. **No component edits. No behavior change. No migration.**

## Approval gates
- **No hard ⛔ gate** (no migration — columns already live). The one hard stop:
  if step 1 shows the new columns are absent, STOP and report before doing anything
  schema-related.
- Standard rule: **do not commit or push until the owner says "Approved."**

## Exit criteria (Definition of Done)
- `typecheck` green (primary gate) and `test` green — `scale.test.ts` passes under
  `main`'s toolchain:
  ```
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test -- src/utils/scale.test.ts
  ```
  (`build` optional — no component edits this phase.)
- No `Json` leaks into props; the calibration guard is null-safe.
- Close the phase with the **`verify-feature`** skill (Definition of Done → STOP).
  Then draft the Phase 2 kickoff per the post-approval ritual.

## Guardrails specific to this phase
- Bring over **scale files only** — never the magnifier/inside-face-snap code on
  that branch.
- `database.types.ts` is **hand-maintained** (memory `schema-types-drift`) — add the
  columns by hand; do not regenerate the whole file.
- `scale.ts` is pure: **no `Date.now()` inside** (callers stamp `at`); everything
  stays JSON-serializable.
- Vitest globals are OFF — import test fns from `'vitest'`; keep the test file
  type-clean (it's included in `typecheck`).
