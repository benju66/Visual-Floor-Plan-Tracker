# Kickoff — Drawing Library Management & Corpus Health, Phase 8c: hard-delete (permanent purge)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 8c of Drawing Library Management** (hard-delete: permanently purge a drawing + its labels/storage, with a type-to-confirm). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-18 - Drawing Library Management Phase 8c Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Drawing-Library-Management-Plan.md` (Phase 8c + § Data model + § Build-on inventory + § Hard guardrails + § Open decisions)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. ⛔ **No DB migration this phase — but it is IRREVERSIBLE.** The type-to-confirm dialog (type the drawing's exact name) is mandatory spec, not optional, and there must be NO purge path that skips it. Carry the `assertWorkbenchContainer` write-site guard onto the purge write; keep every workbench read/write container-scoped — never touch the live dashboard or `progressAnalytics`, never widen RLS or grant `anon`. **Live-verify ONLY against a throwaway drawing you create for the test — never purge one of the owner's real drawings without explicit approval.** Don't commit or push until I say "Approved."

---

> Context for the session (everything below is the detail the launch prompt points at). Self-contained: read this, then the files it names, then build.
> **✅ Phases 8a + 8b are SHIPPED to `main` + prod.** 8a = review-state badges + corpus-health strip (read-only). 8b = soft-delete (archive + restore) behind the additive migration `20260618_workbench_soft_delete.sql` (`workbench_sheets.deleted_at` + `deleted_by`), applied to prod and browser-verified. Phase 8c is the **irreversible** counterpart to 8b's reversible archive — it needs **no migration** (it reuses the existing FK cascade + the explicit storage/`sheet_vectors` cleanup), so the gate here is **destructiveness**, not DDL.
> **Branch off `main`.** Small reviewable commits; `typecheck` + `test` + `build` before each. Do NOT commit/push until the owner says "Approved."

## What you're building
**Phase 8c of the Drawing Library Management plan** — let a privileged user **permanently destroy** a drawing they're certain they don't want, with enough friction that it can't happen by accident:
1. **A purge mutation** — `useHardDeleteWorkbenchDrawing(containerId)` in `useWorkbenchActions.ts`, mirroring `handleDeleteSheet` but **simpler** (workbench drawings have no `status_logs` and the `tiles/` path is dead — see § The hard-delete template). It permanently removes the drawing's storage objects, its cached vectors, and the `sheets` row (the FK cascade takes the `workbench_sheets` sidecar **and** the `units` labels with it). Carries the `assertWorkbenchContainer` guard; invalidates `workbenchSheets` **and** `workbenchCorpusUnits`.
2. **A type-to-confirm modal** — names the drawing, shows **how many labels will be lost**, and requires the user to **type the drawing's exact name** before the destructive button enables. **Reviewed drawings are still purgeable, but the dialog shows an extra, stronger warning** (owner decision, 2026-06-18). There must be no purge path that bypasses this dialog.
3. **A per-card "Delete permanently" action** — added to `DrawingCard` (already restructured in 8b so the action button is a **sibling** of the full-card `<Link>`, never nested in the `<a>`). It must be **harder to reach than Archive** (archive is the easy, reversible default; purge is the rare, irreversible one) — see § Card UI for the recommended placement.
4. **Floating UI state** — the "which drawing is awaiting purge confirmation" lives in `useWorkbenchStore` (explicit interface, transient, mirrors the existing flags) — NOT `useState`.

**Nothing here may appear on the live Projects Dashboard, and none of it may flow through `progressAnalytics`.**

## The hard-delete template (the load-bearing detail — read `handleDeleteSheet` fresh)
`useProjectActions.ts → handleDeleteSheet` is the live-app delete and the template. For a **workbench** drawing the sequence is the same idea but **trimmed**, because the data model differs:
- ✅ **Keep:** remove storage `converted/<id>.png` + `originals/<id>.pdf` (`supabase.storage.from('floorplans').remove([...])`) → `invalidatePdfBytes(id)` → `supabase.from('sheet_vectors').delete().eq('sheet_id', id)` → `supabase.from('sheets').delete().eq('id', id)`.
- ✅ **Let the cascade work:** deleting the `sheets` row cascades the `workbench_sheets` sidecar **and** the `units` labels (FK `ON DELETE CASCADE` — § Data model). Do NOT hand-delete the sidecar or units.
- ⛔ **DROP the `status_logs` + manual `units` delete** that `handleDeleteSheet` does — workbench labels **never** have `status_logs` (the workbench never writes status), so that step is dead weight here and the cascade already removes the units.
- ⛔ **DROP the `tiles/` cleanup** — that OpenSeadragon path was removed (AGENTS.md §5; `tile_manifest_url` is vestigial). Don't reintroduce it.
- ✅ **Guard + invalidate:** `await assertWorkbenchContainer(containerId)` FIRST (same write-site contamination guard as 8b's archive/restore — the container is resolved by an IDB-persisted query that could be poisoned). On success invalidate `queryKeys.workbenchSheets(containerId)` (2-element prefix → both the active and "Show archived" variants) **and** `queryKeys.workbenchCorpusUnits(containerId)`.

Storage `remove` is best-effort/idempotent (it won't error if an object is already gone), but the `sheets` delete is the real destruction — order it last, after storage + vectors, exactly like `handleDeleteSheet`.

## ⚠️ The gate to verify FRESH — who is allowed to purge?
The plan says "gate visibility behind the same privileged signal that gates `/workbench` entry — **verify the current gate fresh; do not widen it**." Here's what's actually true today (verify it yourself before relying on it):
- `/workbench` entry is **not UI-role-gated.** `api/workbench/container` lazy-creates the single hidden container and makes the **first** visitor an `admin`; later visitors just resolve the existing container (no membership added). Any authenticated user can navigate to `/workbench` and **read**.
- **Writes are gated by RLS**, not the UI: `workbench_sheets`/`sheets`/`units` writes require an `owner`/`admin`/`pm` membership of the container (the Phase-3 policies). 8b's Archive/Restore have **no UI role check** — they render for anyone, and RLS enforces the actual write.
- **Decision for you to make (don't widen RLS):** because purge is irreversible, decide whether "Delete permanently" needs an explicit **UI role check** (there's a `queryKeys.currentUserRole(containerId)` query you can use to hide the action from non-privileged members) on top of the RLS gate + the type-to-confirm, or whether the type-to-confirm + RLS is sufficient. **Recommended:** add the UI role check so non-privileged members never even see the destructive control (defence in depth; RLS would reject their write anyway, but don't show a button that 500s). Flag your choice to the owner.

## Required reading (in order, fresh — do not trust line numbers; they drift)
1. `sitepulse-next/AGENTS.md` — **§2** (online-first writes via the established TanStack mutation hooks; do NOT touch the offline `pendingChanges` queue or `status_logs`; **RLS posture — never widen RLS, never grant `anon`, never flip a function to `SECURITY DEFINER`**), **§3** (`progressAnalytics` is the single source of truth — the workbench must never enter it), **§5** (the `floorplans` storage layout + versioned URLs + the dead `tiles/` path), **§6** (TS guardrails: no `any`; new files `.ts`/`.tsx`; explicit Zustand interfaces).
2. `sitepulse-next/Notes/plans/Drawing-Library-Management-Plan.md` — **Phase 8c** in full, **§ Data model** (the cascade: `sheets` → `workbench_sheets` + `units`; storage + `sheet_vectors` are NOT cascaded), **§ Build-on inventory**, **§ Hard guardrails**, **§ Open decisions** (hard-delete gating + confirm strength; reviewed-drawing policy → **resolved: allow with a stronger warning**).
3. **The code you're extending, fresh:**
   - `src/hooks/useProjectActions.ts` → **`handleDeleteSheet`** — the delete template (trim it per § The hard-delete template).
   - `src/hooks/useWorkbenchActions.ts` — `assertWorkbenchContainer` (reuse), `useArchiveWorkbenchDrawing` / `useRestoreWorkbenchDrawing` (8b — the closest pattern: container guard + dual invalidation), `useCreateWorkbenchDrawing` (its storage-cleanup block). Add `useHardDeleteWorkbenchDrawing` here.
   - `src/app/workbench/page.tsx` — `DrawingGrid` + `DrawingCard` (restructured in 8b: the action button is already a sibling of the `<Link>`; the card knows `isArchived`). Add the "Delete permanently" control + mount the confirm modal.
   - `src/store/useWorkbenchStore.ts` — add the **purge-target** floating flag (explicit interface, transient — mirrors `showArchivedDrawings` / `isHealthStripCollapsed`).
   - `src/hooks/useWorkbench.ts` — `useWorkbenchCorpusUnits(containerId)` gives labels grouped by `sheet_id`; reuse it (or a per-sheet count) to show "N labels will be lost" in the confirm.
   - `src/utils/pdfByteCache.ts` — `invalidatePdfBytes` (call it after removing the original PDF, like `handleDeleteSheet`).
   - `src/types/queryKeys.ts` — `workbenchSheets` (2-el invalidation prefix), `workbenchCorpusUnits`, `currentUserRole` (for the optional UI role gate).

## Files this phase will likely touch (verify against the live tree first)
- **NO migration.** (Hard-delete reuses the cascade + storage/`sheet_vectors` cleanup — confirm in § Data model.)
- **EDIT** `src/hooks/useWorkbenchActions.ts` — add `useHardDeleteWorkbenchDrawing(containerId)` (kind-guarded; trimmed `handleDeleteSheet`; invalidate `workbenchSheets` + `workbenchCorpusUnits`).
- **NEW** `src/components/workbench/ConfirmPurgeModal.tsx` (or similar) — the type-to-confirm dialog (names the drawing, shows the label count, requires typing the exact name, stronger warning when `review_state === 'reviewed'`).
- **EDIT** `src/app/workbench/page.tsx` — per-card "Delete permanently" action (harder to reach than Archive) + mount the confirm modal; pass the purge handler down through `DrawingGrid` like the 8b archive/restore handlers.
- **EDIT** `src/store/useWorkbenchStore.ts` — `purgeTargetId: string | null` (+ setter) for the pending-confirmation drawing.
- **OPTIONAL** a tiny pure helper + test if any non-trivial logic emerges (e.g. normalizing the typed-name comparison) — only if it's worth isolating.
- **REUSE UNCHANGED:** `assertWorkbenchContainer`, the container-scoped read hooks, `summarizeCorpus`, the review-state helpers, `invalidatePdfBytes`. **No `progressAnalytics`, no live dashboard, no `main.py`, no migration, no RLS widening.**

## Card UI (recommended placement — confirm with the owner)
8b put the Archive/Restore button at the card's top-left (revealed on hover for active drawings; always shown for archived). Purge is irreversible, so make it **deliberately less reachable** than Archive. Recommended: a small **overflow ("⋯") menu** on the card holding the secondary/destructive actions (so the primary corner button stays Archive/Restore and "Delete permanently" sits one click deeper, styled rose/destructive). Whatever you choose, the destructive control must (a) be a **sibling of the `<Link>`** (never nested in the `<a>` — same rule 8b followed), (b) `preventDefault`/`stopPropagation` so it never navigates, and (c) open the type-to-confirm modal — it must **never** purge on a single click.

## How it should behave
- Clicking "Delete permanently" opens a confirm that names the drawing and says **exactly how many labels will be destroyed**; the destructive button stays disabled until the user types the drawing's exact name.
- Confirming permanently removes the drawing from the library (active **and** archived views), drops its storage objects + `sheet_vectors` row + all its `units` labels, and updates the corpus-health counts.
- A **reviewed** drawing shows a stronger warning in the dialog but is still purgeable.
- The live app is **completely unaffected**; workbench rows never reach the Projects Dashboard or `progressAnalytics`.

## Guardrails (must not violate)
- ⛔ **Irreversible — the type-to-confirm is mandatory.** No code path may purge without the typed-name confirmation. Never auto-confirm, never purge from a single click.
- ⛔ **Live-verify on a throwaway only.** The exit-criteria live test PERMANENTLY deletes — run it against a **disposable drawing you create for the test** (the New-drawing flow needs the `:8001` backend for PDF ingest), **never** one of the owner's real drawings without explicit approval. (Prod currently holds the owner's real hand-traced corpus.)
- **Container-scoped reads/writes only** — the purge carries `assertWorkbenchContainer`; reads stay scoped to the container. A workbench row must never enter a live surface or `progressAnalytics`.
- **Online-first writes** — reuse the established mutation-hook pattern (like 8b's archive/restore); do NOT route through the offline `pendingChanges`/`status_logs` queue.
- **No backend / RLS / auth changes** — no `main.py`, no RLS widening, no `anon` grant, no `SECURITY DEFINER` flip, no service-role from the client. The existing privileged `DELETE` policy on `workbench_sheets` + the `sheets`/`units` policies already authorize a privileged member; do not add or widen anything.
- **Types** — no `any`; new files `.ts`/`.tsx`; explicit Zustand interface for the new flag; narrow at boundaries.
- **Don't fork** `progressAnalytics` / `bottleneck` / `mapDisplayStatuses` / the established Query hooks; reuse the online delete path.
- **Verify with typecheck + test + build** — whole-repo lint is NOT a gate (~1850 pre-existing problems).

## Verify before closing (exit criteria)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- Live `npm run dev:3010` (from `sitepulse-next/`, port 3010): on a **throwaway test drawing**, "Delete permanently" → the confirm names it + shows the label count + requires typing the exact name; confirming removes it from the library **and** drops its storage objects + `sheet_vectors` + labels (spot-check the DB/storage via the Supabase MCP); a **reviewed** drawing shows the stronger warning; the corpus-health counts update; the Projects Dashboard is unchanged. (The `:8001` backend is needed only to create the throwaway drawing, not for the purge itself.)

Close the phase with the **verify-feature** skill (Definition of Done → stop). **Do not commit or push until the owner says "Approved."**

## Scope discipline
This session builds **only Phase 8c** — hard-delete (permanent purge) with the type-to-confirm UX. It needs **no migration**. Do **NOT** build grouping/filtering (8d — client-side, no DB) or revisit soft-delete (8b, shipped). If the slice grows past one session, ship the purge mutation + confirm modal first and split the card-UI placement into its own follow-up.
