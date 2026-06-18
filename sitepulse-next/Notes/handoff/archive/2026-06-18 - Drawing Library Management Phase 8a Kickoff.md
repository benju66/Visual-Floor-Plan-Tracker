# Kickoff — Drawing Library Management & Corpus Health, Phase 8a: review-state badge + corpus-health strip

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 8a of Drawing Library Management** (add a review-state badge to the library cards + a corpus-health strip on `/workbench`). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-18 - Drawing Library Management Phase 8a Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Drawing-Library-Management-Plan.md` (Phase 8a + § Hard guardrails + § Open decisions)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 8a** (read-only display; **no DB migration**). ⛔ Hard guardrail: the health metrics must stay scoped to the workbench container and must **never** touch the live Projects Dashboard or `progressAnalytics` (the contamination guard) — use a container-scoped units read, never an all-project/rollup query. Don't commit or push until I say "Approved."

---

> Context for the session (everything below is the detail the launch prompt points at). Self-contained: read this, then the files it names, then build.
> **✅ Workbench Phases 1–7 are SHIPPED on `main`.** This is the start of the follow-on workstream (**Phase 8 — Drawing Library Management & Corpus Health**). Phase 8a is the smallest, safest slice: read-only display on the existing `/workbench` library page. No schema, no destructive actions, no new routes.
> **Branch off `main`.** Small reviewable commits; `typecheck` + `test` before each. Do NOT commit/push until the owner says "Approved."

## What you're building
**Phase 8a of the Drawing Library Management plan** — turn the flat `/workbench` library into an at-a-glance cockpit:
1. **Review-state badge on each `DrawingCard`** — Draft / Ready for review / Reviewed. The data is already loaded (`drawing.workbench.review_state` via `useWorkbenchSheets`); reuse the Phase-7 presentation helpers `REVIEW_STATE_BADGE` / `REVIEW_STATE_LABELS` / `narrowReviewState` from `src/utils/workbench.ts`. Trivial — do this first as a warm-up.
2. **A corpus-health strip at the top of `/workbench`** — the review funnel (# drawings draft/ready/reviewed), corpus size (total labels, avg labels per drawing, # drawings that pass the Definition-of-Done), taxonomy coverage (labels by role/sub-type + the count of `top_level_role` set but `subtype_id` null = the dictionary-growth/review-queue signal), and data-quality signals (clean vs scanned `vector_quality`, project-type coverage). Extract the math into a **pure, unit-tested** `src/utils/workbenchStats.ts` (`summarizeCorpus`), reusing `definitionOfDoneChecks` (`src/utils/workbenchNaming.ts`) — do NOT re-implement the DoD logic. Feed it the drawings + a **container-scoped units aggregate**.

**Nothing here may appear on the live Projects Dashboard, and none of it may flow through `progressAnalytics`.**

## Required reading (in order, fresh — do not trust line numbers; they drift)
1. `sitepulse-next/AGENTS.md` — **§2** (TanStack hooks; online-first; RLS posture; do NOT touch the offline queue/`status_logs`), **§3** (`progressAnalytics` is the single source of truth — do NOT fork it, and the workbench must never enter it), **§4** (taxonomy: `top_level_role` is the single source of truth for role — count the canonical role, not a display label), **§6** (TS guardrails: derive types from `database.types.ts`, no `any`, new files `.ts`/`.tsx`, explicit Zustand interfaces, Vitest globals OFF).
2. `sitepulse-next/Notes/plans/Drawing-Library-Management-Plan.md` — read **Phase 8a** in full, **§ Pure logic to extract + unit-test** (the `summarizeCorpus` contract), **§ Build-on inventory**, **§ Hard guardrails**, and **§ Open decisions** (note: in 8a there is no "archived" concept yet — Phase 8b adds soft-delete and will make the metrics exclude archived; write `summarizeCorpus` so an `isArchived`/exclusion is easy to add later, but do not invent the column now).
3. **The code you're extending, fresh:**
   - `src/app/workbench/page.tsx` — the library page + `DrawingGrid` + `DrawingCard`. ⚠️ `DrawingCard` is a full-card `<Link>`; the badge is display-only so it drops in cleanly, but keep it inside the link without nesting an interactive control. The health strip is a new block above `DrawingGrid`.
   - `src/utils/workbench.ts` — `REVIEW_STATE_BADGE`, `REVIEW_STATE_LABELS`, `narrowReviewState` (reuse for the badge).
   - `src/utils/workbenchNaming.ts` — `definitionOfDoneChecks` (reuse for the DoD-ready count; the `LabelForReview` shape is `{ unit_number, top_level_role }`).
   - `src/hooks/useWorkbench.ts` — `useWorkbenchSheets(containerId)` (the container-scoped drawings read). Add the new **container-scoped units aggregate** here (e.g. `useWorkbenchCorpusUnits(containerId)`) so it stays filter-applying — units joined to the container's sheets ONLY, never an all-project units query. Add a `workbenchCorpusStats`/`workbenchCorpusUnits` key to `src/types/queryKeys.ts` following the existing `workbenchSheets` shape.
   - `src/hooks/useProjectQueries.ts` — `useUnits(sheetId)` for the per-sheet shape and the query-key conventions (reference only; do NOT reuse an all-project key).
   - `src/types/domain.ts` — `WorkbenchDrawing`, `Unit` (derive any new shapes; narrow JSONB at the boundary if you touch it — you shouldn't need to here).

## Files this phase will likely touch (verify against the live tree first)
- **NEW** `src/utils/workbenchStats.ts` + `src/utils/workbenchStats.test.ts` — pure `summarizeCorpus(drawings, unitsBySheet)` → review funnel, totals, DoD-ready count (via `definitionOfDoneChecks`), role/sub-type coverage, untyped-or-pending count, vector-quality split, project-type coverage. Tests: empty corpus, mixed states/roles, the untyped/pending count, the "Unspecified" buckets.
- **NEW** a container-scoped units aggregate read in `src/hooks/useWorkbench.ts` (e.g. `useWorkbenchCorpusUnits(containerId)`) — scoped to the container's sheets; never an all-project key. + a key in `src/types/queryKeys.ts`.
- **NEW** a `WorkbenchHealthStrip` component (e.g. `src/components/workbench/WorkbenchHealthStrip.tsx`) rendering the `summarizeCorpus` output.
- **EDIT** `src/app/workbench/page.tsx` — add the badge to `DrawingCard`; mount the health strip above the grid.
- **REUSE UNCHANGED:** the review-state helpers, `definitionOfDoneChecks`, the container-scoped read hooks. **No `progressAnalytics`, no live dashboard, no `main.py`/RLS/migration.**

## How it should behave
- Each library card shows a colored badge with its review state (matching the tracer header badge).
- The top of `/workbench` shows a compact health strip with the real funnel + corpus counts + coverage for the drawings in the hidden container.
- The live app is **completely unaffected**; the workbench container/drawings/labels never appear on the Projects Dashboard, and no workbench data flows through `progressAnalytics`.

## Guardrails (must not violate)
- **Container-scoped reads only** — the units aggregate must join the container's sheets; never reuse an all-project/units rollup key. A workbench label must never enter a live surface or `progressAnalytics`.
- **Reuse, don't fork** — `definitionOfDoneChecks` for DoD, the review-state helpers for the badge; do NOT touch `progressAnalytics`/`bottleneck`/`mapDisplayStatuses` or the live dashboard.
- **Pure logic is framework-free + deterministic** — `summarizeCorpus` takes data in (no I/O, no `Date.now()`); co-located Vitest tests; no `any`; new files `.ts`/`.tsx`.
- **No DB, no destructive actions** — that's Phases 8b (soft-delete, migration-gated) and 8c (hard-delete). Stay read-only.

## Verify before closing (exit criteria)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test -- src/utils/workbenchStats.test.ts
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Then a live `npm run dev:3010` (from `sitepulse-next/`, port 3010) check: cards show the correct state badge; the health strip reflects the real counts for the existing drawings; the Projects Dashboard is unchanged. (The :8001 backend is only needed for NEW PDF ingest — not for this phase.)

Close the phase with the **verify-feature** skill (Definition of Done → stop). **Do not commit or push until the owner says "Approved."**

## Scope discipline
This session builds **only Phase 8a** — the review-state badge + the read-only corpus-health strip. Do **NOT** build soft-delete/archive (8b — needs a migration), hard-delete (8c), or grouping/filtering (8d). If the slice grows past one session, ship the badge first and split the health strip into its own kickoff.
