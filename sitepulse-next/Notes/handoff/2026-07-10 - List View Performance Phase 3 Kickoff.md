# Kickoff — List View Performance & Smoothness, Phase 3: Memoize the row (smooth editing) + stabilize handlers

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of List View Performance & Smoothness** (make editing a date/status feel instant — typing in one row should redraw only that row, not the whole table). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-10 - List View Performance Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/List-View-Performance-Plan.md` (esp. Phase 3 + "Pure logic to extract" + "Phase order rationale")
> - `sitepulse-next/AGENTS.md` (esp. §2 — `pendingChanges` stays local `useState`→IDB, `hasRehydrated` guard, capture-time timestamps; §3 — Container/Presenter split + the Phase-2 viewport-gated audit invariant; §6 — TypeScript guardrails, no `any`)
>
> Branch off `main`. Build **only Phase 3**. Frontend only — no schema/RLS/backend, no migration. **Preserve the Phase-2 viewport gating** (don't un-gate the audit) and the `pendingChanges`/IDB contract exactly. Record a scroll/DOM measurement at ~300–500 rows to inform Phase 4. Close with `verify-feature` and STOP — don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Right now, typing a date or changing a status in the desktop List redraws **every** row, not just the one you touched. The reason: editing calls `handleLocalUpdate` → `setPendingChanges` in the container, and neither `StatusTable` nor its rows are memoized, so a single keystroke rebuilds all ~15 cells × N rows. At 300 locations that's a visible lag on every edit. This phase makes an edit re-render **only the row you changed** — which also makes editing feel instant and is the structural foundation Phase 4 (virtualization) builds on. (Virtualizing un-memoized rows fights two problems at once; that's why Phase 3 comes first.)

## Required reading (fresh — do not trust line numbers)
- `sitepulse-next/AGENTS.md` §2/§6 — **`pendingChanges` / `pendingTimelineChanges` are intentionally local `useState` in `useFieldData.ts`** feeding the IDB queue; the IDB persistence layer (`src/utils/pendingChangesStore.ts`, project-scoped key `sitepulse-pending-changes-${projectId}`), the `hasRehydrated` guard, and **capture-time `client_timestamp`** must stay intact. Do NOT migrate pending state to Zustand/React Query. §3 — the Container/Presenter split (`FieldStatusTable` → `useFieldData` → `StatusTable`) and the **Phase-2 viewport-gating invariant** (expanded-row audit fetch gated on near-viewport via `useViewportPresence`; fail-open when no `IntersectionObserver`).
- `src/components/StatusTable.tsx` — the presenter. Read the `visible.map(({ unit, log }, index) => …)` body: **each location is already its own `<tbody key={unit.id}>`** (parent `<tr>` + the expanded `ExpandedActivityAudit` children). That `<tbody>` block is the natural `LocationRow` extraction unit. Note what it closes over from the parent scope (the memos `logMap`, `staleByUnitId`, `varianceByUnitId`, `today`/`todayIso`; the handlers; the baseline props; the Phase-2 `observeRef`/`nearIds`/`viewportSupported`).
- `src/hooks/useFieldData.ts` — where `handleLocalUpdate`, `handleTimelineUpdate`, `handleRemovePendingItem`, `handleDiscardAll`, `handleApplyAll` live. Check which are already stable (`useCallback`) and which are re-created every render (identity churn is what currently defeats `React.memo`). Read how `pendingChanges` is set so you can pass a **per-row slice** without breaking the IDB persist effects.
- `src/hooks/useFieldData.test.tsx` (if present) — **must stay green.** These pin the pending-changes / apply / IDB contract.
- `src/hooks/useViewportPresence.ts` + its test — the Phase-2 hook. `observeRef(id)` is a **stable** per-id ref callback (safe to pass to a memoized row); `nearIds` is StatusTable state; `supported` is the fail-open flag.
- `List-View-Performance-Plan.md` → Phase 3 + "Pure logic to extract" (any index→row mapping helper, if one emerges, must be pure + tested).

## Scope (build only this)
1. **Extract `LocationRow`** — pull the per-location `<tbody>` block (parent row + its expanded children incl. the `ExpandedActivityAudit` render-prop) into a `LocationRow` component wrapped in `React.memo`, in `StatusTable.tsx` or a sibling file (`src/components/manage/LocationRow.tsx`). `StatusTable` still owns the `<table>`/`<thead>`, maps `visible`, and renders `<LocationRow>`s — Container/Presenter split unchanged.
2. **Stabilize the handlers** — `useCallback` the per-row callbacks in `useFieldData.ts` (`handleLocalUpdate`, `handleTimelineUpdate`, and any others a row calls) so their identity is stable across renders. **This is the prerequisite** — without it `React.memo` can't skip a re-render. Keep the pending-changes local-state + IDB behavior byte-for-byte (capture-time timestamps, `hasRehydrated` guard, `isSyncingRef`).
3. **Pass each row its own `pendingChange` slice, not the whole map** — a memoized `LocationRow` should re-render only when *its* pending entry (or its inputs) change, so `pendingChanges[unit.id]` / the relevant `pendingTimelineChanges` slices are what flow in, not the full `pendingChanges` object (which changes identity on every edit and would re-render all rows).

## Preserve Phase 2 (do not regress the viewport gating)
- The `<tbody>` inside `LocationRow` still needs `ref={isExpanded ? observeRef(unit.id) : null}`, and `ExpandedActivityAudit` still needs `enabled={!viewportSupported || nearIds.has(unit.id)}`.
- **Pass the per-row boolean `auditEnabled` into the memoized `LocationRow`, NOT the whole `nearIds` Set** — otherwise every scroll-driven `nearIds` change re-renders all rows and defeats the memo. Passing a boolean means a row re-renders only when *its own* near-state flips. (This is a nice synergy: Phase 3 makes Phase 2's scroll re-renders granular.) `observeRef(unit.id)` is already stable, so it's safe to pass through memo.

## Explicitly DO NOT
- Do **not** move business logic into `StatusTable`/`LocationRow` (keep the Container/Presenter split). The row is presentation; the handlers/state stay in `useFieldData`.
- Do **not** migrate `pendingChanges`/`pendingTimelineChanges` off local `useState`→IDB, change the IDB key format, or drop the `hasRehydrated` guard (§2/§6).
- Do **not** touch the Apply loop / offline queue (Phase 1) or the audit-gating mechanism (Phase 2) beyond threading its per-row props into the extracted row.
- Do **not** fork `progressAnalytics`/`scheduleBaseline`; do **not** hardcode a temporal-state color (`statusColors.ts`).
- Do **not** change what a row renders (columns, expanded sub-table, baseline columns, "Current" row, N/A toggles) — this is a re-render-scope refactor, not a visual change.

## Open decisions
- **None blocking for Phase 3.** The Phase-4 virtualization granularity (flat-row vs. per-location "block") is decided *by the Phase-3 measurement*, not now — so **record a scroll + edit re-render measurement at ~300–500 rows** (React DevTools Profiler: confirm a single edit re-renders only its row; note row-height behavior for expanded blocks) and write it into the Phase-4 kickoff. If the memoization refactor turns out larger than a clean extract (e.g. the row closes over many parent memos), show the owner the diff shape before finalizing (§ AGENTS approval note for `useFieldData`).

## Guardrails
- Frontend only; no schema/RLS/backend; no migration; no new dependency (Phase 4 adds `@tanstack/react-virtual`, not this phase).
- Derive types from `database.types.ts`; no `any`; keep everything through the React Query cache JSON-serializable.
- Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate any new `*.test.tsx`.

## Exit criteria (close with `verify-feature`, then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green — **existing `useFieldData` tests still pass**; add/extend a test if a pure helper emerges.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Live check on `dev:3010` (owner-driven if browser-locked): editing one date/status re-renders **only that row** (React DevTools Profiler); Apply / Discard / pending counts unchanged; expand/collapse + the Phase-2 viewport audit-loading still work; single-row expand still instant.
- **Record the ~300–500-row scroll/edit measurement for Phase 4.**
- Present to the owner; do NOT commit or push until the owner says "Approved."

---

## ✅ Phase 3 outcome (built 2026-07-10 — awaiting owner "Approved")

**What shipped (frontend only; no schema/RLS/backend/migration; no new dependency):**
- `useFieldData.ts` — `handleLocalUpdate` + `handleTimelineUpdate` wrapped in `useCallback([])` (both drive state through the functional setter + stamp `capturedAt` at call-time, so empty deps are correct, not a stale closure). The `pendingChanges`/`pendingTimelineChanges` local-`useState`→IDB contract, `hasRehydrated` guard, `isSyncingRef`, and per-item checkpoint are **byte-for-byte unchanged** (§2). All existing `useFieldData` contract tests stay green.
- **New `src/components/manage/LocationRow.tsx`** — the per-location `<tbody>` block (parent grid row + its expanded per-activity children incl. the viewport-gated `ExpandedActivityAudit`) extracted verbatim and wrapped in `React.memo`. The row-only helpers (`DateInputCell`/`DurationCell`/`VarianceCell`/`BaselineDateCell`/`BaselineFlagCell`/`deriveSchedule`/`computeBaselineForSlot`) moved with it. Presentation only — no store access, Container/Presenter split intact (§3).
- `StatusTable.tsx` — still owns `<table>`/`<thead>`, maps `visible`, renders one `<LocationRow>` each. Feeds each row **per-row primitives/slices** (never the shared objects): `pendingChange = pendingChanges[unit.id]`, `pendingTimelineForUnit` (this unit's slice of a memoized `pendingTimelineByUnit` group), `isSelected`/`isExpanded`/`isSaving` booleans, and the **Phase-2 `auditEnabled` boolean** (NOT the `nearIds` Set). Callbacks from the page/container are made referentially stable via a local `useStableCallback` (a latest-ref wrapper); presence-gated ones (Locate/Delete/N-A) keep their "is it provided?" signal. `observeRef(unit.id)` is passed through (already stable).

**Phase-2 gating preserved:** `<tbody ref={isExpanded ? observeRef(unit.id) : null}>` and `ExpandedActivityAudit enabled={auditEnabled}` where `auditEnabled = !viewportSupported || nearIds.has(unit.id)` — fail-open unchanged. Passing the per-row boolean means a scroll that flips one row's near-state now re-renders only that row.

**Verification (typecheck + test + build all green; 1254 tests):**
- Headless proof of the phase goal in **`src/components/StatusTable.memo.test.tsx`** (a shallow-`memo` render-counting spy for `LocationRow`, faithful to the real `React.memo(LocationRowInner)`). Proves — even while the "parent" hands StatusTable FRESH inline callbacks every render — that: a primary edit to one row re-renders **only that row** (a,b,c → edit b → counts 1,2,1); a per-activity/timeline edit routes to only its row via the per-unit slice; a `savingUnitId` flip re-renders only the saving row; and the audit gate **fails open** in jsdom (no IntersectionObserver → every row `auditEnabled=true`). This is the repeatable stand-in for the owner's live Profiler check.
- **Live click-through NOT run** (List is auth-gated on the prod DB; browser-locked) — owner drives the Profiler confirmation on `dev:3010`: edit one date/status → only that row repaints; Apply/Discard/pending counts unchanged; expand/collapse + Phase-2 audit-loading still work; single-row expand still instant.

### 📏 Phase-4 DOM measurement (real `StatusTable` render in jsdom, throwaway harness)
Per **collapsed** location row (uniform, independent of `currentActivities`):
| metric | per row | 300 rows | 500 rows (extrap.) |
|---|---|---|---|
| total DOM elements | ~53 | ~15,900 | ~26,500 |
| `<td>` | 14 | 4,200 | 7,000 |
| **native `<input type=date>`** | **3** ongoing / **4** completed | 900–1,200 | 1,500–2,000 |
| all inputs (+checkbox) | 4–5 | 1,200–1,500 | 2,000–2,500 |
| buttons | 8 | 2,400 | 4,000 |
| svg icons | 3 | 900 | 1,500 |

**Expanded block (analytical):** each expanded location adds `currentActivities.length` child `<tr>`s (all rendered, incl. N/A rows), each carrying ~4 date inputs + a status control. So a location is **variable-height: 1 `<tr>` collapsed → 1 + N `<tr>` expanded**, and each is its own `<tbody>` with a sticky-pinned parent row while expanded.

**Implication for Phase-4 granularity (flat-row vs per-location "block"):** the numbers back the plan's lean toward **per-location BLOCK virtualization with dynamic height measurement**, not flat-row. Rows are heavy and uniform (~53 nodes, 3–4 native date inputs each — the pre-scroll DOM load the plan flagged), and each location is already a self-contained `<tbody>` whose expanded parent row sticky-pins to `top: headerH`. A flat-`<tr>` windower would fight both the `<tbody>`-per-location grouping and that sticky pin; a block windower measures each location (1 row collapsed / 1+N expanded) as one unit and preserves the frozen sticky-left columns + horizontal scroll. Phase 3's memoized `LocationRow` is exactly the block a virtualizer recycles. Confirm the sticky header + frozen columns + expand/collapse + baseline toggle + shift-range select under the windower (Phase-4 exit criteria).
