# Kickoff — Drawing Library Management & Corpus Health, Phase 8d: client-side grouping & filtering

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 8d of Drawing Library Management** (client-side grouping & filtering of the `/workbench` drawing list — group/filter by project type, level, review state, vector quality). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-18 - Drawing Library Management Phase 8d Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Drawing-Library-Management-Plan.md` (Phase 8d + § Out of scope + § Pure logic to extract + § Hard guardrails + § Open decisions)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. ⛔ **No DB / backend / RLS this phase — it's pure client-side display over the already-loaded drawings.** Extract the grouping/filter logic as a pure, unit-tested `workbenchGrouping.ts`; keep grouping/filter UI state in `useWorkbenchStore` with an explicit interface; never trigger a new fetch and never let a workbench row reach the live dashboard or `progressAnalytics`. Build **only Phase 8d**. Don't commit or push until I say "Approved."

---

> Context for the session (everything below is the detail the launch prompt points at). Self-contained: read this, then the files it names, then build.
> **✅ Phases 8a + 8b + 8c are SHIPPED to `main` + prod.** 8a = review-state badges + corpus-health strip (read-only). 8b = soft-delete (archive + restore) behind the additive migration `20260618_workbench_soft_delete.sql`. 8c = hard-delete (permanent purge) behind a privileged-role gate + a per-card "⋯" overflow menu + a type-the-exact-name `ConfirmPurgeModal` (no migration). **Phase 8d is the LAST sub-phase of this workstream** and the cheapest: it adds NO schema and NO server work — it reorganizes the flat library grid in the browser over data that's already loaded.
> **Branch off `main`.** Small reviewable commits; `typecheck` + `test` + `build` before each. Do NOT commit/push until the owner says "Approved."

## What you're building
**Phase 8d of the Drawing Library Management plan** — make the flat `/workbench` library stay navigable as the corpus grows, by letting the user **group** and **filter** the drawing cards by their already-loaded metadata. No new data, no schema, no fetch — just a smarter arrangement of the cards already on screen:
1. **A pure, tested grouping/filtering module** — `src/utils/workbenchGrouping.ts` (+ co-located `workbenchGrouping.test.ts`), framework-free and deterministic, modeled on the existing `workbenchStats.ts`:
   - `groupDrawings(drawings, key)` where `key ∈ 'project_type' | 'level' | 'review_state' | 'vector_quality'` → **ordered groups**, each `{ key, label, drawings }`, with a stable **`Unspecified`** bucket (reuse the `UNSPECIFIED` constant convention from `workbenchStats.ts`) sorted last.
   - `filterDrawings(drawings, filters)` → the subset matching the active filters (a drawing with no sidecar value for a faceted filter falls in `Unspecified`, so filtering on `Unspecified` must include it).
   - Pure: pass the drawings IN; no `Date.now()`, no I/O, no React. Define a minimal **input shape** that is a structural **supertype of `WorkbenchDrawing`** (exactly like `CorpusDrawing` in `workbenchStats.ts`) so the page passes its loaded `WorkbenchDrawing[]` straight in with no cast — it needs `id` + the sidecar fields `review_state`, `sheet_project_type`, `vector_quality`, **and `level_label`** (note: `level_label` is NOT in `CorpusDrawing` — add it to this module's own input type).
2. **Grouping + filter controls** on `/workbench` — a small controls bar above the grid: a **group-by** selector (`None` / Project type / Level / Review state / Vector quality) and a compact set of **filter** chips for the same facets. Clearing returns the plain flat list. When grouping is active, render the grid as **labeled sections** (group label + count, then that group's cards) reusing the **unchanged** `DrawingCard`.
3. **Floating UI state in `useWorkbenchStore`** — the selected group-by key + the active filters live in the store with an **explicit interface**, mirroring the existing transient flags (`showArchivedDrawings`, `isHealthStripCollapsed`, `openCardMenuId`, `purgeTargetId`). **Recommended: transient (not persisted)** — a reload returns to the default flat, unfiltered view, consistent with the rest of the workbench floating UI. (If the owner wants the grouping remembered across reloads, that's the one spot to use `useHydratedStore` — see § Open decisions; default to transient unless they ask.)

**Nothing here may appear on the live Projects Dashboard, and none of it may flow through `progressAnalytics`.** Grouping/filtering is pure display over the in-memory, already-container-scoped `drawings` array.

## How grouping must interoperate with what's already there (the load-bearing details)
- **It operates over the already-loaded list — never a new fetch.** `useWorkbenchSheets(container?.id, { includeArchived })` already returns the drawings; `groupDrawings`/`filterDrawings` run on that array in a `useMemo`. Do NOT add a query key, a server filter, or a second fetch.
- **The "Show archived" toggle (8b) still owns archived visibility.** Grouping/filtering applies to whatever `useWorkbenchSheets` returns for the current toggle state. Don't re-implement archived filtering inside the grouping module — that's the read hook's job. (An archived drawing carries `workbench.deleted_at`; the page already derives `activeDrawings` from it for the health strip.)
- **The corpus-health strip stays ACTIVE-only and is NOT affected by filters.** It already summarizes `activeDrawings` (the unarchived set), independent of the grid. A grid filter must NOT change the health counts — keep the strip fed by `activeDrawings`, not by the filtered/grouped view.
- **Canonical vs display (§4).** Group/label review-state via the existing `narrowReviewState` + `REVIEW_STATE_LABELS`; project-type/level/vector-quality are presentation strings from the sidecar. Counting/grouping keys on the canonical value; the chip text is display-only.

## Required reading (in order, fresh — do not trust line numbers; they drift)
1. `sitepulse-next/AGENTS.md` — **§2** (floating UI in Zustand with an explicit interface; data via the established TanStack hooks — do NOT add a fetch for a pure client-side view; never widen RLS / grant `anon`), **§3** (`progressAnalytics` is the single source of truth — the workbench must never enter it), **§6** (TS guardrails: no `any`; new files `.ts`/`.tsx`; explicit Zustand interfaces; narrow at boundaries).
2. `sitepulse-next/Notes/plans/Drawing-Library-Management-Plan.md` — **Phase 8d** in full, **§ Out of scope / deferred** (persistent collections / folders stay DEFERRED — 8d is in-memory only, no `collection_id`/`workbench_collections`), **§ Pure logic to extract + unit-test** (the `workbenchGrouping.ts` contract), **§ Hard guardrails**, **§ Open decisions** (grouping persistence).
3. **The code you're extending, fresh:**
   - `src/utils/workbenchStats.ts` — the **pattern to mirror**: pure module, hand-written minimal input shape (`CorpusDrawing`) that's a structural supertype of `WorkbenchDrawing`, the `UNSPECIFIED` bucket constant, deterministic. `workbenchGrouping.ts` should look and test like this.
   - `src/utils/workbenchStats.test.ts` + `src/utils/workbench.test.ts` — the test conventions (Vitest globals OFF: import `{ describe, it, expect }` from `'vitest'`; empty-corpus + mixed-state + unspecified-bucket cases).
   - `src/app/workbench/page.tsx` — the library page. `useWorkbenchSheets` → `drawings`; `activeDrawings` derived for the health strip; `DrawingGrid` renders the flat list of `DrawingCard`s; the header already holds the "Show archived" + "New drawing" buttons. Add the controls bar + grouped rendering here; **leave `DrawingCard` unchanged** (badge/archive/⋯-purge already shipped).
   - `src/store/useWorkbenchStore.ts` — the explicit `WorkbenchState` interface + the transient-flag pattern (`showArchivedDrawings`/`openCardMenuId`/`purgeTargetId`, each with an `Updater<T>` setter). Add the group-by key + filter state the same way.
   - `src/utils/workbench.ts` (`narrowReviewState`, `REVIEW_STATE_LABELS`, `VECTOR_QUALITIES`) and `src/utils/locationTaxonomy.ts` (`PROJECT_TYPES`) — reuse for the facet option lists + display labels; do NOT hardcode parallel lists.
   - `src/types/domain.ts` — `WorkbenchDrawing = Sheet & { workbench: WorkbenchSheet | null }`; the sidecar fields (`sheet_project_type`, `level_label`, `review_state`, `vector_quality`) are nullable text.

## Files this phase will likely touch (verify against the live tree first)
- **NO migration. NO backend. NO RLS.**
- **NEW** `src/utils/workbenchGrouping.ts` — `groupDrawings(drawings, key)` + `filterDrawings(drawings, filters)` (pure; `Unspecified` bucket; ordered groups).
- **NEW** `src/utils/workbenchGrouping.test.ts` — each grouping key + the empty/unspecified bucket + filter combinations.
- **EDIT** `src/store/useWorkbenchStore.ts` — group-by key + active-filters state (explicit interface; transient by default).
- **EDIT** `src/app/workbench/page.tsx` — the group-by + filter controls bar; grouped section rendering over `DrawingGrid`; clearing returns the flat list. Health strip stays `activeDrawings`-fed.
- **REUSE UNCHANGED:** `DrawingCard`, `useWorkbenchSheets` (no new fetch), `summarizeCorpus`, the review-state helpers, `PROJECT_TYPES`/`VECTOR_QUALITIES`, the `UNSPECIFIED` convention. **No `progressAnalytics`, no live dashboard, no `main.py`, no migration, no RLS.**

## How it should behave
- A **group-by** control reorganizes the grid into labeled sections (e.g. "Healthcare (3)", "Housing (2)", "Unspecified (1)"); each section reuses the existing cards. `None` returns the flat grid.
- **Filter** chips narrow the visible cards by one or more facets; an `Unspecified` filter matches drawings with that sidecar field unset. Clearing all filters restores the full list.
- Grouping/filtering is **instant** (in-memory, no spinner, no fetch) and **survives nothing** by default (transient — a reload is back to flat/unfiltered).
- The **corpus-health strip is unchanged** by grid filters (still the active corpus), and the **live Projects Dashboard is completely unaffected**.

## Guardrails (must not violate)
- ⛔ **No DB / backend / RLS / auth changes** — no migration, no `main.py`, no new query key, no server-side filter, no `anon` grant. Pure client-side display over the already-loaded `drawings`.
- **No new fetch** — `groupDrawings`/`filterDrawings` run in a `useMemo` over the existing `useWorkbenchSheets` result. Don't fork the read hook or add a rollup query.
- **Contamination guard still holds** — grouping is display-only over container-scoped data; a workbench row must never reach a live surface or `progressAnalytics`.
- **Persistent collections stay DEFERRED** — 8d is in-memory grouping ONLY; do NOT add a `collection_id`/`group_label` column or a `workbench_collections` table (that's a separate, later schema workstream — § Out of scope).
- **Floating UI in Zustand** — group-by key + filters in `useWorkbenchStore` with an explicit interface + `Updater<T>` setters; transient by default (`useHydratedStore` only if the owner asks to persist the grouping).
- **Types** — no `any`; new files `.ts`/`.tsx`; the grouping input shape is a structural supertype of `WorkbenchDrawing` (mirror `CorpusDrawing`); narrow nullable sidecar text at the boundary.
- **Don't fork** `progressAnalytics` / `bottleneck` / `mapDisplayStatuses` / the established Query hooks.
- **Verify with typecheck + test + build** — whole-repo lint is NOT a gate (~1850 pre-existing problems).

## Verify before closing (exit criteria)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test -- src/utils/workbenchGrouping.test.ts
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- `workbenchGrouping.test.ts` green (each key + empty corpus + `Unspecified` bucket + filter combos).
- Live `npm run dev:3010` (from `sitepulse-next/`, port 3010): group-by reorganizes the library into labeled sections incl. an `Unspecified` bucket; filter chips narrow the cards (incl. an `Unspecified` filter); clearing returns the flat list; the corpus-health counts are UNCHANGED by a grid filter; the "Show archived" toggle still works alongside grouping; the Projects Dashboard is unaffected. (No `:8001` backend needed — no new ingest.)

Close the phase with the **verify-feature** skill (Definition of Done → stop). **Do not commit or push until the owner says "Approved."** This is the **last sub-phase** — when it ships, the Drawing Library Management workstream (8a–8d) is complete.

## Scope discipline
This session builds **only Phase 8d** — client-side grouping/filtering. It needs **no migration, no backend, no RLS**. Do **NOT** build persistent collections/folders (deferred), revisit 8a/8b/8c (shipped), or add any new fetch. If the slice somehow grows past one session, ship `workbenchGrouping.ts` + the group-by control first and split the filter chips into a follow-up.

## Open decisions (resolve with the owner if it comes up)
- **Persist the chosen grouping/filter across reloads?** — **Recommended: NO (transient)**, mirroring every other workbench floating flag; the corpus is small and a reload-clean view is predictable. If the owner wants it remembered, persist ONLY the group-by key via `useHydratedStore` (the §2-sanctioned hook for persisted prefs) — not the transient filters.
- **Multi-select filters within a facet?** — **Recommended: yes within a facet (OR), AND across facets**, but keep v1 minimal — a single group-by + a small chip row is enough; don't build a faceted-search panel. Flag if you want richer filtering.
