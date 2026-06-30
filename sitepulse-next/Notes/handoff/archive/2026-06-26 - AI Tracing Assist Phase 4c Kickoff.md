# Kickoff — AI Tracing Assist, Phase 4c: review-DoD integration (openings + completeness)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4c of AI Tracing Assist** (**review-DoD integration** — the workbench review
> screen gains an openings indicator per room, a gate that blocks sign-off until reconciliation's
> flagged openings are resolved, and a per-sheet `fully_traced` completeness flag that gates training
> eligibility). Read in full:
> - `sitepulse-next/Notes/handoff/2026-06-26 - AI Tracing Assist Phase 4c Kickoff.md` (this file)
> - `sitepulse-next/Notes/handoff/archive/2026-06-25 - AI Tracing Assist Phase 4 Kickoff.md` (§ 4c, and the
>   whole-Phase-4 principles)
> - `sitepulse-next/Notes/plans/AI-Tracing-Assist-Plan.md` (§ Phase 4) · `docs/ANNOTATION_SPEC.md` (§5
>   leakage-safe grouping) · `sitepulse-next/AGENTS.md`
>
> Work on branch `claude/ai-location-tracing-pipeline-ip709o` (4a + 4b already committed there — see
> "Where we are"). **4c carries an approval-gated migration** — present the SQL via the `create-migration`
> skill and **STOP for owner approval before applying**. Verify with the live `dev:3010` click-through +
> `verify-feature`. **Do not commit or push until the owner says "Approved."**

---

## Where we are (branch state — read this before touching anything)
- Branch `claude/ai-location-tracing-pipeline-ip709o`; **4a** = commit `44772b5`, **4b** = commit `e14ff79`
  (both committed, not pushed). Re-read the actual files fresh — do not trust line numbers.
- **4a (shipped):** `units.opening_edges JSONB NOT NULL DEFAULT '[]'` = `[{ edgeIndex, type }]` (migration
  `20260626_units_opening_edges.sql`, **applied to prod**). Capture UX in `WorkbenchTracer` +
  `FloorplanCanvas` (the `O` key toggles the openings tool; hold `D`/`C`/`H`/`P` + click to mark an edge;
  edit-after = select a room + click its edges). Pure logic + guards in `src/utils/openingEdges.ts` +
  `src/types/domain.ts` (`OpeningType`/`OpeningEdge`/`isOpeningEdgeArray`). `useUnits` narrows
  `opening_edges` in a React Query **`select`** (so IndexedDB-rehydrated rows predating the column can't
  crash consumers — keep that).
- **4b (shipped):** `src/utils/openingReconcile.ts` — pure `reconcileOpenings(units, opts?)` →
  `{ openings:[{ id, segment, type, neighborUnitIds[], sourceEdges[], confidence, flagged?, flagReason? }],
  adjacency: [a,b][] }`. **This is the engine 4c consumes.** It never mutates the raw tags; a
  `type_conflict` or `ambiguous_match` opening has `flagged: true` + `flagReason`. 8 vitest fixtures pass.

## What 4c delivers (plain English)
The second-person review screen (`WorkbenchReviewTable`) becomes the place a sheet is certified as clean
training data. It gains: (1) a small **openings count per room** so a reviewer can spot a room missing its
doorways; (2) a **gate** that won't let a sheet be marked `reviewed` while reconciliation still **flags** an
opening (a door/cased-opening type conflict, or an ambiguous cross-wall match) — the human must fix the
underlying tags until nothing is flagged; (3) a per-sheet **`fully_traced`** checkbox that declares "every
room AND every floor passage on this sheet is traced," which is the **training-eligibility** gate — partial
/ product-use sheets stay `false` and are excluded from the (future) training export, so normal team usage
never poisons the corpus.

## Scope (precise)
1. **Openings indicator per row** — in `WorkbenchReviewTable`, show each location's passage count
   (`unit.opening_edges.length`) as an unobtrusive badge/column. Pure display; zero-count is fine (most
   rooms have none). Openings stay **OUT** of the field-progress status table — they're geometry metadata;
   the review DoD is their only product surface.
2. **DoD checks gating "Mark reviewed"** — extend `definitionOfDoneChecks(...)` (pure, in
   `src/utils/workbenchNaming.ts`) with two new checks ANDed into `passed`:
   - **No unresolved flagged openings** — recompute `reconcileOpenings(units)` (map each `Unit` →
     `{ id, polygon: polygon_coordinates, openingEdges: opening_edges }`) and require **zero** `flagged`
     openings. Surface the count + reason in the check's `detail` (e.g. "1 type conflict").
   - **Sheet marked complete** — `fully_traced === true`.
   The existing checks (has-labels / all-named / names-trimmed / names-unique / all-typed) stay. Keep the
   function pure + extend its co-located unit test.
3. **`fully_traced` completeness flag** — a per-sheet boolean the reviewer toggles in the review screen
   (a clear checkbox: "Every room and every floor passage on this sheet is traced"). It gates training
   eligibility broadly, not just openings. Persist it; surface it in the DoD strip.

## Key decisions / notes (resolve these the way the kickoff author intends)
- **`fully_traced` lives on `workbench_sheets`**, NOT `sheets` — it sits beside `review_state` / `deleted_at`
  / reviewer stamps (all per-drawing review lifecycle on the sidecar). The `WorkbenchDrawing.workbench`
  sidecar already carries `review_state`; add `fully_traced` there. `Database['public']['Tables']
  ['workbench_sheets']` Row/Insert/Update get the column; `WorkbenchSheet` derives it automatically.
- **Flag-resolution = recompute-live, no extra column.** The "resolve flagged openings" check recomputes
  `reconcileOpenings` from the current tags each render; a human resolves a flag by **editing the tags**
  (4a edit-after: re-tag the conflicting side, or fix geometry) until nothing is flagged. So the **migration
  only needs `fully_traced`** — do NOT add a per-flag "acknowledged" table/column unless the owner asks
  (the main Phase-4 kickoff's "(+ any flag-resolution state)" is satisfied by recompute-live). If the owner
  later wants to "accept a conflict as intentional," that's a separate, gated follow-up.
- **There is NO training-export pipeline in the repo yet** (the only backend `/export-*` route is the
  status-PDF export — unrelated). So `fully_traced` is captured now as a **forward-looking** gate. Deliver a
  small **pure helper** (e.g. `isExportEligible(drawing, units)` → `reviewed && fully_traced && no flagged
  openings`) + its test, so the eventual corpus export has a single source of truth to call — but do **not**
  invent an export endpoint. The §4c exit "export excludes a `fully_traced=false` sheet" is met by that
  helper's tested logic, not a live pipeline. Note this clearly in the PR.
- **The review screen is the surface.** `fully_traced` and the openings gate appear in `WorkbenchReviewTable`
  (the DoD strip + the footer "Mark reviewed" gating), reusing the existing `dod.passed` pattern.

## ⛔ Approval-gated migration
`workbench_sheets.fully_traced BOOLEAN NOT NULL DEFAULT false`. Additive + nullable-defaulted (auto-backfill
`false` — every existing sheet is "not certified complete" until a human says so). **No RLS change** (rides
the existing `workbench_sheets` policies — privileged write, member read). Mirror the style of
`20260618_workbench_soft_delete.sql` (idempotent `ADD COLUMN IF NOT EXISTS`, verification block). Present via
`create-migration`, **STOP for approval**, apply to prod only on go-ahead. Then reflect in
`database.types.ts` + add the README migrations-table row. The project is **Visual-Floor-Plan-Tracker**
(`pmccdxmuszuykawvlphj`); apply with the Supabase MCP `apply_migration` after approval.

## Files to touch (read each fresh first)
- `src/utils/workbenchNaming.ts` — extend `definitionOfDoneChecks` (pure) + its co-located test.
- `src/utils/workbench.ts` (or a new tiny `src/utils/openingReview.ts`) — the `isExportEligible` pure helper
  + test; and any `Unit[] → ReconcileUnit[]` adapter (keep it trivial + pure).
- `src/components/workbench/WorkbenchReviewTable.tsx` — openings-per-row badge; feed the new DoD inputs
  (recomputed flagged-opening count + `fully_traced`) into the DoD strip; add the `fully_traced` checkbox;
  keep the footer "Mark reviewed" gated on `dod.passed`.
- `src/hooks/useWorkbenchActions.ts` — a write path for `fully_traced` (extend
  `useUpdateWorkbenchReviewState`, or a small `useSetWorkbenchFullyTraced(containerId)` mirroring its
  contamination guard + `workbenchSheets` invalidation). Online-first; same `kind='workbench'` guard.
- `src/types/database.types.ts` — add `fully_traced` to `workbench_sheets` Row/Insert/Update.
- `supabase/migrations/2026XXXX_workbench_fully_traced.sql` + `README.md` migrations table.

## Exit criteria
- `npm --prefix sitepulse-next run typecheck` + `run test` + `run build` green.
- DoD-check pure logic unit-tested: the two new checks (flagged-openings, completeness) plus the
  `isExportEligible` helper — fixtures for "flagged opening blocks", "incomplete blocks", "all clear passes".
- Live `dev:3010`: a sheet with an unresolved **flagged** opening (e.g. a door/cased-opening type conflict
  across a shared wall) AND `fully_traced=false` **cannot** be marked reviewed; resolving the conflict (4a
  edit-after) + ticking completeness unlocks "Mark reviewed". The openings-per-row badge reflects the tags.
- `isExportEligible` excludes a `fully_traced=false` sheet (unit-tested; no live export pipeline exists).
- `verify-feature` → **stop**. Do not commit/push until the owner says "Approved."

## Guardrails (AGENTS.md)
- **§2:** review/DoD/flag state is derived from the Query cache + recomputed live — no new global UI state
  needed; never touch the `pendingChanges` offline queue; the `fully_traced` write rides a TanStack mutation
  with the `kind='workbench'` contamination guard, not a raw insert.
- **§4/§6:** reflect `fully_traced` in `database.types.ts`; `WorkbenchSheet` derives it; no `Json` in props.
- **§7:** frontend-pure (no backend in 4c). `reconcileOpenings` is pure TS (also the future export's engine).
- Openings are NOT a tracked status — never let them into `status_logs` / the field-progress table.
- ⛔ Migration gate: `workbench_sheets.fully_traced` — SQL via `create-migration`, STOP, apply on go-ahead.

## Verification commands
```
npm --prefix sitepulse-next run typecheck
npm --prefix sitepulse-next run test     # one file: run test -- src/utils/workbenchNaming.test.ts
npm --prefix sitepulse-next run build
```
- Lint is NOT a gate. No E2E — verify via the live `dev:3010` click-through (the dev server typically runs
  on :3010 already; `npm run dev:3010` from `sitepulse-next/` if not).
- On approval: fast-forward the branch. **After 4c, Phase 4 (4a→4c) is complete** — draft the **Phase 5
  (detail callouts)** kickoff, OR **Phase 3.5 (CAD-layer extraction)** if the owner reprioritizes (it
  supersedes hand-capture on layered sheets and feeds the deferred 4d door-object layer for free). 4d
  (door-OBJECT capture) stays deferred/optional.
```
