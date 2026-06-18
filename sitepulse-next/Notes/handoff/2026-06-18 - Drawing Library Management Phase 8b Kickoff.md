# Kickoff — Drawing Library Management & Corpus Health, Phase 8b: soft-delete (archive + restore)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 8b of Drawing Library Management** (soft-delete: archive a drawing + restore it, behind one additive migration). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-18 - Drawing Library Management Phase 8b Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Drawing-Library-Management-Plan.md` (Phase 8b + § Data model + § Hard guardrails + § Open decisions)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. ⛔ **Approval gate (DDL):** this phase needs a database migration — write the SQL, present it in full, and **STOP for explicit owner approval before applying it** (dev/branch-first). The migration is **additive + nullable only** (`ADD COLUMN IF NOT EXISTS workbench_sheets.deleted_at TIMESTAMPTZ` + optional `deleted_by UUID`); no backfill, no RLS widening, no `anon` grant. Keep the contamination guard intact — every workbench read/write stays container-scoped and never touches the live dashboard or `progressAnalytics`. Carry the `assertWorkbenchContainer` write-site guard onto the new archive/restore writes. Don't commit or push until I say "Approved."

---

> Context for the session (everything below is the detail the launch prompt points at). Self-contained: read this, then the files it names, then build.
> **✅ Phase 8a is SHIPPED** on branch `claude/workbench-phase8a-library-cockpit` (commits `e23d341` docs + `e6af418` feat — review-state badges + the collapsible corpus-health strip; read-only, no DB). Phase 8b is the first slice of this workstream that touches the database, so it is **migration-gated**.
> **Branch off `main`.** Small reviewable commits; `typecheck` + `test` + `build` before each. Do NOT commit/push until the owner says "Approved."

## What you're building
**Phase 8b of the Drawing Library Management plan** — let the owner tidy the library without losing expensive hand-traced training data:
1. **One additive migration** — `workbench_sheets.deleted_at TIMESTAMPTZ` (nullable; `null` = active, non-null = archived) + recommended `deleted_by UUID` (cheap provenance, mirrors `reviewed_by`/`reviewed_at`). Idempotent (`ADD COLUMN IF NOT EXISTS`), no backfill, no `CHECK` needed for a nullable timestamp. Then regenerate `database.types.ts` and let `domain.ts`'s `WorkbenchSheet` pick the column up.
2. **Read filtering** — `useWorkbenchSheets(containerId)` **excludes `deleted_at IS NOT NULL` by default**, with an explicit **"Show archived"** path (a param/flag, not a second hook that forks the scoping).
3. **Archive + restore writes** — `useArchiveWorkbenchDrawing` / `useRestoreWorkbenchDrawing` in `useWorkbenchActions.ts` (set/clear `deleted_at`, stamp `deleted_by` on archive, carry the `assertWorkbenchContainer` guard, invalidate `workbenchSheets` **and** `workbenchCorpusUnits`).
4. **Card actions** — `DrawingCard` gets an **Archive** action (and **Restore** when viewing archived). ⚠️ The card is a full-card `<Link>`; an action button must NOT nest an interactive control inside the link — restructure (split the clickable region, or `stopPropagation`/`preventDefault` on the action) so opening the drawing and archiving it don't fight.
5. **Health strip excludes archived** — the 8a strip already only counts labels for drawings in the list it's given, so excluding archived from the default `useWorkbenchSheets` list **automatically** drops them from the metrics. Just make sure the **"Show archived"** view doesn't feed archived drawings into `summarizeCorpus` (keep the strip fed by the active list, regardless of what the grid is showing).

**Nothing here may appear on the live Projects Dashboard, and none of it may flow through `progressAnalytics`.**

## Required reading (in order, fresh — do not trust line numbers; they drift)
1. `sitepulse-next/AGENTS.md` — **§2** (online-first writes via the established TanStack mutation hooks; do NOT touch the offline `pendingChanges` queue or `status_logs`; **RLS posture — never widen RLS, never grant `anon`, never flip a function to `SECURITY DEFINER`**), **§3** (`progressAnalytics` is the single source of truth — the workbench must never enter it), **§4** (taxonomy canonical), **§6** (TS guardrails: **new column → `database.types.ts` → derive in `domain.ts`**; no `any`; new files `.ts`/`.tsx`; explicit Zustand interfaces).
2. `sitepulse-next/Notes/plans/Drawing-Library-Management-Plan.md` — read **Phase 8b** in full, **§ Data model** ("New schema this plan adds — Phase 8b only"), **§ Build-on inventory**, **§ Hard guardrails**, and **§ Open decisions** (soft-delete column name + `deleted_by`; "do archived count in the health metrics?" → **no**).
3. **The code you're extending, fresh:**
   - `src/hooks/useWorkbench.ts` — `useWorkbenchSheets` (add the `deleted_at` default filter + the "show archived" path) and `useWorkbenchCorpusUnits` (8a; container-scoped units aggregate — confirm it still reflects only active drawings once archiving lands).
   - `src/hooks/useWorkbenchActions.ts` — `assertWorkbenchContainer` (reuse on every new write), `useUpdateWorkbenchReviewState` (the template for a `workbench_sheets` write that invalidates `workbenchSheets`), `useCreateWorkbenchDrawing` (its cleanup-on-failure block, for reference). Add `useArchiveWorkbenchDrawing` / `useRestoreWorkbenchDrawing` here.
   - `src/app/workbench/page.tsx` — `DrawingGrid` + `DrawingCard` (the full-card `<Link>` restructure) and where a **"Show archived"** toggle mounts (header area). The 8a badge + health strip live here.
   - `src/store/useWorkbenchStore.ts` — add the **"show archived"** floating UI flag (explicit interface; transient, not persisted — mirrors `isHealthStripCollapsed`).
   - `src/types/domain.ts` — `WorkbenchSheet` (picks up `deleted_at`/`deleted_by` automatically after you regenerate `database.types.ts`).
   - `sitepulse-next/supabase/migrations/20260617_workbench_schema.sql` — mirror its style/header for the new migration; use the **create-migration** skill if present in `.agent/skills/`.

## Files this phase will likely touch (verify against the live tree first)
- **NEW** `sitepulse-next/supabase/migrations/<today>_workbench_soft_delete.sql` — additive `ADD COLUMN IF NOT EXISTS workbench_sheets.deleted_at TIMESTAMPTZ` (+ optional `deleted_by UUID REFERENCES auth.users`). Idempotent, nullable, no backfill, no RLS change.
- **EDIT** `src/types/database.types.ts` — regenerate (or hand-add the two columns to the `workbench_sheets` Row/Insert/Update blocks, matching the generator's shape) so the types reflect the new columns.
- **EDIT** `src/hooks/useWorkbench.ts` — default `deleted_at IS NULL` filter + a "show archived" path.
- **EDIT** `src/hooks/useWorkbenchActions.ts` — `useArchiveWorkbenchDrawing` / `useRestoreWorkbenchDrawing` (kind-guarded, invalidate `workbenchSheets` + `workbenchCorpusUnits`).
- **EDIT** `src/app/workbench/page.tsx` — per-card Archive/Restore action (un-nest from the `<Link>`) + a "Show archived" toggle; keep the health strip fed by the active list.
- **EDIT** `src/store/useWorkbenchStore.ts` — "show archived" flag.
- **REUSE UNCHANGED:** `summarizeCorpus`, the review-state helpers, the container-scoped read hooks, `assertWorkbenchContainer`. **No `progressAnalytics`, no live dashboard, no `main.py`, no RLS widening.**

## How it should behave
- Archiving a drawing removes it from the default library grid **and** from the corpus-health counts; its labels/storage are untouched (recoverable).
- A **"Show archived"** toggle reveals archived drawings (visually distinct), each with a **Restore** action that brings it straight back.
- The live app is **completely unaffected**; workbench rows never reach the Projects Dashboard or `progressAnalytics`.

## Guardrails (must not violate)
- ⛔ **Migration gate** — present the full SQL and **STOP** for owner approval; apply dev/branch-first. **Additive + nullable only**, idempotent, no backfill. Never widen RLS, never grant `anon`.
- **Container-scoped reads/writes only** — archive/restore carry `assertWorkbenchContainer`; reads stay scoped to the container. A workbench row must never enter a live surface or `progressAnalytics`.
- **Online-first writes** — reuse the established mutation-hook pattern (like `useUpdateWorkbenchReviewState`); do NOT route workbench writes through the offline `pendingChanges`/`status_logs` queue.
- **Types** — new columns → `database.types.ts` → derive in `domain.ts`; no `any`; new files `.ts`/`.tsx`; explicit Zustand interface for the new flag.
- **Don't fork** `progressAnalytics` / `bottleneck` / `mapDisplayStatuses` / the established Query hooks; reuse the online update path.
- **Verify with typecheck + test + build** — whole-repo lint is NOT a gate (~1850 pre-existing problems).

## Verify before closing (exit criteria)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- Migration **applied + verified on dev/branch first** (after owner approval) — confirm the column exists and is nullable.
- Live `npm run dev:3010` (from `sitepulse-next/`, port 3010): archiving a drawing hides it from the default grid **and** drops it from the health counts; "Show archived" reveals it; **Restore** brings it back; the Projects Dashboard is unchanged. (The :8001 backend is only needed for NEW PDF ingest — not for this phase.)

Close the phase with the **verify-feature** skill (Definition of Done → stop). **Do not commit or push until the owner says "Approved."**

## Scope discipline
This session builds **only Phase 8b** — soft-delete (archive + restore) behind one additive migration. Do **NOT** build hard-delete/permanent purge (8c — irreversible, needs the type-to-confirm UX) or grouping/filtering (8d). If the slice grows past one session, ship the migration + read filter first and split the card actions into their own kickoff.
