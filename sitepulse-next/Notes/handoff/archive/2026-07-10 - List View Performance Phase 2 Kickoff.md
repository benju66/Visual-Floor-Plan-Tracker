# Kickoff — List View Performance & Smoothness, Phase 2: Tame "expand all" (query storm + DOM explosion)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of List View Performance & Smoothness** (stop the desktop List from freezing when many locations are expanded at once). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-10 - List View Performance Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/List-View-Performance-Plan.md` (esp. Phase 2 + "Pure logic to extract")
> - `sitepulse-next/AGENTS.md` (esp. §3 — Container/Presenter, `ExpandedActivityAudit`/`useUnitHistory`, `statusColors.ts`; §2 for the read-hook/React-Query conventions)
>
> Branch off `main`. Build **only Phase 2**. Frontend only — no schema/RLS/backend, no migration. Resolve the expand-all-behavior open decision with me at the start (recommend: viewport-only/staggered audit fetch + a soft confirm above ~50). Close with `verify-feature` and STOP — don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Each expanded location renders a full sub-table (one child row per activity, each with date inputs + a status control) **and** mounts its own `ExpandedActivityAudit`, which fires a per-location history query (`useUnitHistory`). Clicking **"expand all"** on a large list therefore detonates two bombs at once: thousands of extra DOM rows, and **N simultaneous history queries** (300 locations ≈ 300 in-flight requests). The tab freezes. This phase removes that freeze with two independent levers — without touching what a single expanded row shows.

This is the second of the cheap, self-contained wins (no virtualization yet). It also *dovetails* with Phase 4: the viewport-only audit approach is the same idea virtualization generalizes.

## Required reading (fresh — do not trust line numbers)
- `sitepulse-next/AGENTS.md` §3 — the **Container/Presenter** split (`FieldStatusTable` → `useFieldData` → `StatusTable`); `ExpandedActivityAudit` is the per-location lazy audit; never fork `progressAnalytics`; never hardcode a temporal-state color (`statusColors.ts`). §2 — read data only via the established React Query hooks; React Query already dedupes/caches identical queries.
- `src/components/StatusTable.tsx` — the desktop presenter. Read the **expand mechanism**: `expandedUnitIds: Set<string>` state, `isAllExpanded`, `toggleExpandAll` (currently fills the set with *every* visible id in one shot), `toggleRowExpanded`, and where `{expandedUnitIds.has(unit.id) && <ExpandedActivityAudit … />}` mounts the audit + sub-table per location.
- `src/components/manage/ExpandedActivityAudit.tsx` — the per-location audit wrapper: it calls `useUnitHistory(unitId)`. **This is the query that multiplies.** Understand its loading/empty states and what it renders.
- `src/hooks/useProjectQueries.ts` `useUnitHistory` — the history query (reads `status_audit_log`). Note its `queryKey`, `staleTime`/`gcTime`, and that React Query dedupes concurrent identical keys but still runs **distinct** keys (one per unit) in parallel.
- `src/hooks/useFieldData.ts` — `visible` (the rendered row list) and how `StatusTable` consumes it. No apply-loop changes here in Phase 2.
- `List-View-Performance-Plan.md` → Phase 2 + "Pure logic to extract" (`shouldGuardExpandAll(count, threshold)`).

## Scope (build only this — two independent levers, do BOTH)
1. **Stop the audit-query storm.** The per-location `ExpandedActivityAudit` → `useUnitHistory` must not all fire at once. Preferred: **viewport-only fetching** — only expanded rows at/near the viewport actually run their audit query (e.g. gate the query `enabled` on an IntersectionObserver / near-viewport check), which also sets up Phase 4. Acceptable alternative if viewport-gating is too fiddly pre-virtualization: **cap/stagger** concurrent audit queries. React Query dedupes + caches, so the goal is simply to avoid N concurrent in-flight requests. Single-row expand must stay instant.
2. **Guard the "expand all" toggle.** Above a threshold (~50 locations), don't blindly expand everything: either a **soft confirm** ("Expand all 312 locations? This may be slow") or **batched expansion**. Put the trivial decision logic in a pure, tested helper `shouldGuardExpandAll(count, threshold)` (or a small batching helper). Owner picks exact behavior — see Open decision.

## Explicitly DO NOT
- Do **not** change what a single expanded row shows (the sub-table, the "Current" row, the actual-start "ongoing" fallback, the audit content). This is about *how many mount/fetch at once*, not the row's contents.
- Do **not** fork `progressAnalytics`/`scheduleBaseline`; do **not** hardcode a temporal-state color (use `statusColors.ts`).
- Do **not** move business logic into `StatusTable` (keep the Container/Presenter split). Do **not** touch the Apply loop / offline queue (that was Phase 1).

## Open decision (resolve at the start, with the owner)
- **Expand-all behavior above the threshold:** soft-confirm vs. batched expansion. **Recommendation:** viewport-only/staggered audit fetch (lever 1) + a soft confirm above ~50 (lever 2). Confirm the threshold and the confirm-vs-batch choice before building.

## Guardrails
- Frontend only; no schema/RLS/backend; no migration; no new dependency unless the owner OKs it (viewport gating can use a small `useInView`-style hook or the native `IntersectionObserver` — prefer native/no-dep).
- Derive types from `database.types.ts`; no `any`; keep anything through the React Query cache JSON-serializable.

## Exit criteria (close with `verify-feature`, then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green (incl. the new `shouldGuardExpandAll`/batch helper test).
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Live check on `dev:3010`: expand-all on a large list no longer freezes (measure via Profiler / network panel — audit requests are viewport-bounded/staggered, not N-at-once); single-row expand is unchanged and instant; the expand-all guard fires above the threshold.
- Present to the owner; do NOT commit or push until the owner says "Approved."
