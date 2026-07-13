# Kickoff — List View Performance & Smoothness, Phase 4: True row virtualization (the durable scroll fix)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 4 of List View Performance & Smoothness** (the final phase — make the desktop List scroll smoothly into the thousands by only drawing the rows on screen). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-10 - List View Performance Phase 4 Kickoff.md` (this file — incl. the Phase-3 DOM measurement + the granularity decision it settles)
> - `sitepulse-next/Notes/plans/List-View-Performance-Plan.md` (esp. Phase 4 + "Pure logic to extract" + "Phase order rationale")
> - `sitepulse-next/AGENTS.md` (esp. §3 — Container/Presenter split, the Phase-2 viewport-gated audit invariant, and the **Phase-3 memoized-`LocationRow` invariant**: per-row primitives/slices + stable callbacks, never the shared objects; §2 — `pendingChanges` local `useState`→IDB; §6 — TypeScript guardrails, no `any`)
> - The Phase-3 shipped code: `src/components/StatusTable.tsx`, `src/components/manage/LocationRow.tsx`, `src/components/StatusTable.memo.test.tsx`, `src/hooks/useViewportPresence.ts`
>
> Branch off `main`. Build **only Phase 4**. Frontend only — no schema/RLS/backend, no migration. **This phase ADDS a dependency (`@tanstack/react-virtual`) — confirm with the owner before installing.** Preserve every earlier invariant: the Phase-2 viewport-gated audit (fail-open), the Phase-3 memoized row (don't defeat the memo), and the `pendingChanges`/IDB contract. Close with `verify-feature` and STOP — don't commit or push until the owner says "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Even after Phase 3 (each edit redraws only its row), **every** row is still mounted in the DOM before you scroll. The Phase-3 measurement below shows that's ~53 DOM elements and 3–4 native date-input boxes per row — so 300 locations ≈ 16,000 DOM nodes and ~1,000 date inputs sitting in the page, and 500 ≈ 26,500 nodes / ~1,500–2,000 date inputs. That's the scroll-stutter the owner ranked as pain #1. Virtualization fixes it durably: draw only the handful of location "blocks" actually on screen and recycle them as you scroll, so the DOM stays small no matter how many locations exist. It's built on Phase 3 — the memoized `LocationRow` **is** the block a virtualizer recycles.

## Phase-3 measurement — what it settles (do not re-measure to decide; decide from this)
Real `StatusTable` render in jsdom, per **collapsed** location row (uniform, independent of `currentActivities`):
| metric | per row | 300 rows | 500 rows (extrap.) |
|---|---|---|---|
| total DOM elements | ~53 | ~15,900 | ~26,500 |
| `<td>` | 14 | 4,200 | 7,000 |
| native `<input type=date>` | 3 ongoing / 4 completed | 900–1,200 | 1,500–2,000 |
| all inputs (+checkbox) | 4–5 | 1,200–1,500 | 2,000–2,500 |
| buttons | 8 | 2,400 | 4,000 |
| svg icons | 3 | 900 | 1,500 |

**Expanded block:** each expanded location adds `currentActivities.length` child `<tr>`s (all rendered, incl. N/A rows), each ~4 date inputs + a status control. So a location is **variable-height: 1 `<tr>` collapsed → 1 + N `<tr>` expanded**, and each location is already its own `<tbody>` with a sticky-pinned parent row while expanded.

**→ Granularity decision (was the Phase-4 open decision): virtualize per-location BLOCKS with dynamic height measurement, NOT a flat row list.** The rows are heavy and uniform, each location is a self-contained `<tbody>`, and the expanded parent sticky-pins to `top: headerH`. A flat-`<tr>` windower would fight both the `<tbody>`-per-location grouping and that sticky pin; a block windower measures each location (1 row collapsed / 1+N expanded) as one recyclable unit. Single-row edits are already granular (Phase 3), so the only remaining axis is DOM-mount count on scroll.

## Required reading (fresh — do not trust line numbers)
- `List-View-Performance-Plan.md` → **Phase 4** (scope + the three hard parts) and "Pure logic to extract" (any flat-index → location-block mapping math must be pure + unit-tested; `Date.now()`-free).
- `src/components/StatusTable.tsx` — owns the `<table>`/`<thead>`, the `visible.map`, per-row derivations, the measured `headerH`, the frozen-column classes (`FZ_CHECK` = `sticky left-0`, `FZ_LOC` = `sticky left-12`), and `useViewportPresence`. This is where the windower goes. **The virtualizer must keep feeding `LocationRow` the same stable per-row props** (don't reintroduce shared-object props to satisfy the windower).
- `src/components/manage/LocationRow.tsx` — the memoized block. Note it renders a `<tbody>` (parent `<tr>` + expanded `<tr>`s). Its height is dynamic; the virtualizer must measure it (react-virtual `measureElement`), not assume a fixed row height.
- `src/hooks/useViewportPresence.ts` — Phase-2's `IntersectionObserver` gate. Under virtualization only on-screen expanded blocks mount at all, which *subsumes* much of this — but keep the fail-open gate wired (it's cheap and correct); don't rip it out.
- `src/components/FieldStatusTable.tsx` — the container. The scroll container currently lives here (`flex-1 min-h-0 overflow-y-auto`) wrapping `StatusTable`, and separately `StatusTable`'s own `overflow-auto` div gives the horizontal scroll + sticky header. **Resolve which element is the scroll parent before wiring the virtualizer** (react-virtual needs a definite `getScrollElement`).

## The hard parts (the plan calls these out — plan for them explicitly)
1. **`<table>` vs virtualization.** You cannot `position: absolute` `<tr>`/`<tbody>` inside a real `<table>` and keep layout. Two viable routes — **pick one at the start and show the owner the shape**:
   - **(a) Keep `<table>` semantics** with a virtualizer spacer technique (top/bottom padding `<tbody>` rows sizing the scroll range; render only the visible `<tbody>` blocks between them). Preserves native table column sizing + the existing sticky/frozen CSS with the least churn.
   - **(b) Move to CSS grid / div rows** (`display: grid` "table"), which makes absolute positioning + measurement natural but re-implements column widths, the frozen sticky-left columns, and the sticky header from scratch.
   Recommendation: try **(a)** first (least risk to the frozen columns + horizontal scroll that already work); fall back to (b) only if table + windowing genuinely can't co-measure the variable-height expanded blocks.
2. **Variable row heights** — a collapsed block is 1 `<tr>`; expanded is 1 + N. Use dynamic measurement (`measureElement`), not an estimate that breaks on expand/collapse. Re-measure on expand/collapse and on the baseline-column toggle (adds 3 columns / widths, not height, but the expanded N/A rows change).
3. **Sticky header + frozen sticky-left columns** — the header (`thead`, `z-20`) and the checkbox/Location columns (`FZ_CHECK`/`FZ_LOC`, `z-[11]`/`z-30`) must keep working through the windower. The expanded parent row's `top: headerH` sticky pin must survive.

## Scope (build only this)
- Confirm with the owner, then add `@tanstack/react-virtual` (React 19 compatible).
- Virtualize the **location blocks** in `StatusTable` per the decision above (route (a) preferred). Feed `LocationRow` the same stable per-row props Phase 3 established.
- Put any flat-index → location-block mapping / windowing math not covered by the lib in a **pure, unit-tested** helper (§ Pure logic).
- Verify under virtualization: sticky header, frozen columns + horizontal scroll, expand/collapse (incl. the sticky expanded-parent pin), the "Show baseline" column toggle, selection incl. **shift-range** across off-screen rows, and the pending-changes FAB.

## Preserve earlier phases (do not regress)
- **Phase 2:** keep the viewport-gated audit fetch + fail-open (`!viewportSupported || nearIds.has(id)`). Don't un-gate.
- **Phase 3:** keep `LocationRow` memoized and keep passing per-row primitives/slices + stable callbacks. Don't hand the windowed rows the shared `pendingChanges`/`selectedUnitIds`/`nearIds` objects to make wiring easier — that silently defeats the memo. `StatusTable.memo.test.tsx` must stay green.
- **§2:** `pendingChanges`/`pendingTimelineChanges` stay local `useState`→IDB; don't touch the Apply loop or the offline queue.

## Explicitly DO NOT
- Do not change what a row renders (columns, expanded sub-table, baseline columns, "Current" row, N/A toggles), the schedule math (`progressAnalytics`/`scheduleBaseline`), or a temporal-state color (`statusColors.ts`). This is a scroll-perf refactor.
- Do not virtualize `MobileSwipeDeck` (out of scope — it already renders a bounded subset).
- Do not add server-side pagination or touch the 1000-row fetch path (separate, deferred).
- Do not lose native Ctrl+F silently without noting it — the owner already accepted this (toolbar filters serve "find a location"); just don't regress the toolbar.

## Open decisions (resolve at the START of Phase 4, show the owner the shape)
- **Table route (a) vs (b)** above — recommend (a). This is the one architectural fork; get a quick owner nod on the approach before deep implementation, since (b) is a bigger visual-risk rewrite.
- **Scroll parent** — which element owns vertical scroll (the container's `overflow-y-auto` vs StatusTable's `overflow-auto` div). Pick one; the virtualizer's `getScrollElement` needs it definite.
- **`overscan`** — how many off-screen blocks to keep mounted (trades scroll-blank-flash vs DOM count). Start ~5–8; tune against the measurement.

## Guardrails
- Frontend only; no schema/RLS/backend; no migration.
- **Adds `@tanstack/react-virtual`** — the one dependency this workstream adds; confirm with the owner (⛔ approval gate) before `npm install`.
- Derive types from `database.types.ts`; no `any`; everything through the React Query cache stays JSON-serializable.
- Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate any new `*.test.ts(x)`.

## Exit criteria (close with `verify-feature`, then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green — `StatusTable.memo.test.tsx` still green; new windowing helper unit-tested.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Live check on `dev:3010` (owner-driven if browser-locked): scroll smooth at ~300–500+ rows (measure DOM-mounted rows drop vs the Phase-3 ~53/row baseline); sticky header + frozen columns + horizontal scroll + expand/collapse + baseline toggle + shift-range select all correct under virtualization; single-row edit still re-renders only its row (Phase-3 memo intact).
- Present to the owner; do NOT commit or push until the owner says "Approved." **This closes the List View Performance workstream.**
