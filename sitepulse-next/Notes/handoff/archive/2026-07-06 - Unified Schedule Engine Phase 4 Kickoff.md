# Kickoff — Unified Schedule Engine, Phase 4: import as anchor-loading + baseline / re-import diff ⛔

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of the Unified Schedule Engine** (baseline snapshots + re-import
> diff-and-approve; align the MS Project importer into the level-window layer). Read these
> in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Unified Schedule Engine Phase 4 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Unified-Schedule-Engine-Plan.md` (Phase 4 + guardrails)
> - `sitepulse-next/AGENTS.md` (§2 status_logs rules, §4 migration conventions, §6 TS)
>
> Work on branch `feat/unified-schedule-engine-phase-4` (already exists; carries the
> DRAFTED migration). ⛔ The migration is the HARD GATE — do not apply it to prod without
> the owner's explicit sign-off. Don't commit or push until the owner says "Approved."

## State at handoff (2026-07-06, end of the Fable 5 session)
- Phases 1–3 are DONE + merged to main (crew-flow stagger `fbcbfbc`, Save/Apply UX
  `d8a89fc`, re-flow + level chaining `77df368`; main == origin == 63878e8).
- **The Phase 4 migration is AUTHORED but NOT applied and NOT signed off:**
  `supabase/migrations/20260710_schedule_baselines.sql` (uncommitted on this branch).
  One isolated append-only table `schedule_baselines` (whole-project JSONB snapshot of
  BOTH layers; RLS read=member, insert/delete=owner/admin/pm, NO update policy;
  mirrors the lookahead_plans isolation + subtypes write posture). The SQL was
  presented to the owner at the gate — check the chat/plan for the verdict before
  proceeding. If not yet signed off, RE-PRESENT it and STOP.

## Build order after sign-off (per the create-migration skill, .agent/skills/)
1. Apply the migration (Supabase MCP `apply_migration` or CLI) + run its verification
   queries (bottom of the SQL file).
2. Regenerate `src/types/database.types.ts`; derive `ScheduleBaseline` in domain.ts;
   add a versioned `isScheduleBaselineSnapshot` JSONB guard (narrow inside queryFn).
3. Hooks (`useScheduleBaselines`, `useSetBaseline`, `useDeleteBaseline`) — online-first,
   never the offline queue.
4. Pure diff math (new `src/utils/scheduleBaseline.ts` + tests): snapshot capture
   (levels from `sheets.activity_schedules`, locations from `status_logs` planned
   dates — NEVER progress fields) and `diffBaseline(snapshot, current)` →
   added/removed/moved windows per level×activity + per location.
5. Importer alignment: `MspImportPanel` writes its matched task windows into Layer 1
   (level windows) so import and manual entry feed the same engine (reuse
   `reflowLevelToLocations` — Phase 3's provenance guard already preserves hand-edits).
6. Re-import diff-and-approve UI: "Set baseline" button (Schedule view) + on re-import
   show what moved vs the baseline, accept/reject per change; NEVER touch field actuals.
7. Gates (typecheck/test/build) + live dev:3010 on a SAFE project + README migration
   table row + `verify-feature` → STOP for approval.

## Hard guardrails
- ⛔ Migration applies ONLY after explicit owner sign-off, and never touch prod data
  without the go-ahead. The dev server points at the PRODUCTION database.
- `status_logs` writes stay on `.upsert(onConflict:'unit_id,activity_id')` /
  `upsert_status_log` — never `.insert()`, never the offline queue.
- Baselines version the PLAN only — never snapshot/restore progress fields.
- No changes to the Phase 1–3 engine semantics (staggering, provenance re-flow,
  chaining) — Phase 4 builds on top.
