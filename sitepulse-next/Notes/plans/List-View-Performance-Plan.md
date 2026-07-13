# List View Performance & Smoothness — make the desktop List fast at scale (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: none (new workstream). Related: `Notes/Locations-Status-Management-Plan.md` (the List's product roadmap).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` in full (CRITICAL invariants — esp. §2 offline queue / `pendingChanges` local-state / `upsert_status_log`-only / capture-time `client_timestamp`; §3 Container/Presenter, `progressAnalytics` non-fork, `statusColors.ts` palette).
2. Re-read the files named in each phase **fresh** — do NOT trust line numbers in this doc; they drift.
3. Build the phases in order. Verify after each (§ Verification). Phases 1–3 are independent and could reorder; Phase 4 (virtualization) builds ON Phase 3, so keep it last.
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short. Close each phase with the `verify-feature` skill and STOP — do not commit/push until the owner says "Approved."

## Goal
When this is done, the desktop **List view** (the spreadsheet-grid `StatusTable`) stays smooth as a project grows from ~40 locations into the **hundreds or low thousands** — scrolling doesn't stutter, expanding rows (including "expand all") doesn't freeze the tab, editing a date/status feels instant, and clicking **Apply** on a batch of staged status changes finishes in a few seconds instead of grinding through them one at a time.

This is a **rendering + write-throughput** workstream. There are **no database schema changes** in any phase — every fix is frontend, and every status write keeps flowing through the existing `upsert_status_log` path with its capture-time timestamp and last-write-wins guard.

## The four performance axes (what we're actually fixing)
The List is slow for four *independent* reasons.

1. **Scroll cost — everything is in the DOM.** `StatusTable` renders **every** visible row (`visible.map(...)`), no virtualization. Each collapsed row carries ~15 cells including **4–5 native `<input type="date">` boxes** (individually expensive) plus three dropdown triggers. At 300 locations that's ~1,200–1,500 date inputs mounted before anyone scrolls. → **Phase 4 (virtualization)** is the durable fix.
2. **Expand-all is a cliff.** Each expanded location renders `currentActivities.length` child rows (each with 4 date inputs + a status control), **and mounts its own `ExpandedActivityAudit` → `useUnitHistory(unitId)` query**. Expand-all on 300 locations ≈ 4,500 extra rows, ~18,000 date inputs, and **300 simultaneous audit queries**. → **Phase 2**.
3. **Every edit re-renders the whole table.** Typing a date calls `handleLocalUpdate` → `setPendingChanges` in the container; `StatusTable` isn't memoized and rows aren't a memoized component, so **all rows rebuild on every keystroke/change**. The `useFieldData` handlers aren't `useCallback`'d, so their identity changes each render — which currently blocks any memoization from helping. → **Phase 3** (and the foundation Phase 4 builds on).
4. **Apply is sequential.** `handleApplyAll` loops the staged changes with `await onApplyPendingChanges([change])` **one at a time**, each a full network round-trip, with a per-item crash-safety checkpoint after each. 50 staged changes = 50 serial round-trips. → **Phase 1**.

## Out of scope / deferred
- **No DB migrations, no RLS/auth changes, no backend changes.** Pure frontend.
- **Mobile `MobileSwipeDeck`** is not touched — it already renders a bounded, swipeable subset. Desktop `StatusTable` only.
- **Map/canvas performance** — separate concern (canvas decomposition workstream).
- **Changing what the columns show / the schedule math** — `progressAnalytics` / `scheduleBaseline` reused verbatim; this is about *how fast* we render/write.
- **Exported / printed report** — a future, separate feature built **from the data layer** (query units + statuses → generate PDF/CSV), NOT by printing the rendered table. It does not depend on and does not conflict with virtualization. Explicitly TBD; not this workstream.
- **`content-visibility` scroll trick — considered and rejected.** It solves the same problem as virtualization (Phase 4) and would become build-then-delete once virtualization lands. The owner committed to the full structural end-state, so we skip the stopgap. (If virtualization were ever cut, content-visibility would return as the cheap fallback.)
- **Server-side pagination** of the status/unit queries (1000-row cap) — existing `fetchAllIn`/pagination already handles fetching; this plan renders what's fetched. Revisit only past a few thousand locations.

## Locked product decisions (from the owner)
- **Full structural end-state approved, virtualization included** — build all of it for the best long-term product; do not defer the hard piece. (2026-07-10.)
- **Drop `content-visibility`** — redundant with virtualization; don't build a stopgap we'd delete.
- **Export/print is a separate future feature from the data layer** — no printing today; virtualization is safe to adopt because a future export won't rely on the rendered DOM.
- **"Find a location" is served by the toolbar filters** (`ManageToolbar` type/activity/state facets), not browser Ctrl+F — so losing native find across off-screen rows is acceptable. (If desired later, add an in-list search box.)
- **Pain priority:** (1) scrolling, (2) expand-all, (3) editing, (4) faster Apply. NOTE the build order below leads with the cheap, self-contained wins (Apply, expand-guard) and lands the top pain (scroll) via virtualization last, because virtualization must be built on the memoized rows from Phase 3. This is sequencing, not deferral — every axis ships.
- **Faster Apply must stay safe** — no sacrificing crash-safety or correctness for speed (Phase 1 guardrails).

## Phase order rationale (doing 100%, but in dependency order)
- **Phases 1–3 are independent** and each ships a felt improvement; they're ordered cheap-and-safe-first to build momentum and de-risk.
- **Phase 4 (virtualization) is built ON Phase 3** (you virtualize memoized row components; virtualizing un-memoized rows fights two problems at once). So Phase 3 precedes it, and the Phase-3 measurement *informs the virtualization strategy* (row-height handling, block granularity) rather than deciding whether to do it.
- Note: virtualization also *subsumes* much of Phase 2's DOM concern (only on-screen expanded rows mount → only their audits fire). Phase 2 still ships first because it's cheap and removes the freeze immediately for the pre-virtualization builds; its viewport-only audit approach then dovetails with Phase 4.

## Data model
**No schema changes in any phase.** Reads/writes unchanged:
- Reads: `useUnits` / `useAllProjectUnits`, `useAllProjectStatuses` / active-sheet `statuses`, `useActivities`, `useUnitHistory` (audit, per expanded location).
- Writes: **only** through `commitUnitActivity` → `upsert_status_log` RPC (`onConflict: unit_id,activity_id`, capture-time `client_timestamp`, LWW guard). Phase 1 changes *how many run at once*, never the write itself. The chunked `useBulkInsertStatusLogs` is only referenced as a Phase-1 stretch option.
- Applicability (N/A) and the `status_logs` slot key (`unit_id, activity_id`) respected exactly as today.

## Build-on inventory (read these fresh before using)
REUSE — do not fork:
- `src/components/StatusTable.tsx` — the desktop presenter being optimized.
- `src/components/FieldStatusTable.tsx` — the container; hosts `useFieldData`, owns scope/filters/baseline overlay.
- `src/hooks/useFieldData.ts` — business logic: `pendingChanges`/`pendingTimelineChanges` (local `useState` → IDB), `handleLocalUpdate`, `handleTimelineUpdate`, `handleApplyAll`, `visible`/`ranked`. **Home of the Phase 1 apply loop and the Phase 3 `useCallback` work.**
- `src/components/manage/ExpandedActivityAudit.tsx` — per-location lazy audit (`useUnitHistory`); React Query dedupes/caches. Phase 2 governs how/when it mounts.
- `src/hooks/useMapActions.ts` `commitUnitActivity` — the single-item status write (resolves activity id, **auto-advance may fire a 2nd write**, undo stack, `setSavingUnitId`, swallows errors + toasts). Phase 1 overlaps *calls* to this; do not reimplement it.
- `src/hooks/useProjectQueries.ts` `useBulkInsertStatusLogs` — chunked bulk `.upsert`; Phase-1 stretch only. NOTE it stamps **sync-time** `client_timestamp`, skips auto-advance/undo — hence not a drop-in.
- `src/utils/progressAnalytics.ts`, `src/utils/scheduleBaseline.ts`, `src/utils/statusColors.ts` — reused as-is; never fork; never hardcode a temporal-state color.
- `src/store/useSettingsStore.ts` — where a new persisted UI preference (e.g. an expand-all threshold) would live via `useHydratedStore`.

## Pure logic to extract + unit-test
Mostly rendering, but a few deterministic helpers carry the load-bearing logic and MUST be pure + unit-tested (pass values in; never call `Date.now()` inside):
- `src/utils/concurrency.ts` — bounded-concurrency runner: `runWithConcurrency(items, limit, worker) → Promise<{ index, ok, error }[]>`. **The correctness core of Phase 1.** Co-locate `concurrency.test.ts` (ordering preserved, limit never exceeded, one failure doesn't abort the rest, empty input, limit ≥ length).
- (Phase 2) `shouldGuardExpandAll(count, threshold)` / a batching helper — trivial but testable.
- (Phase 4) any windowing math not covered by the virtualization lib (mapping a flat virtual index → location + its expanded-child rows) — pure + tested.

## Sub-phasing (ship + verify each)

### Phase 1 — Faster Apply (bounded-concurrency)
- **Plain-English:** When you click Apply on a batch of staged changes, run several saves at the same time instead of strictly one-after-another — finishing in a few seconds while keeping the same crash-safety. Self-contained, no rendering risk, felt immediately.
- **Scope:**
  - Add the pure `src/utils/concurrency.ts` runner (+ tests).
  - Rework `handleApplyAll` in `useFieldData.ts` to apply the deduped changes with **bounded concurrency** (start with a small limit, e.g. 4–6) instead of the strict serial `for … await` loop. **Preserve every invariant:** capture-time `client_timestamp`, LWW, and the **per-item IDB checkpoint** (`persistCurrentQueue`) after each success — checkpoint as each promise resolves, not all-or-nothing. Keep `isSyncingRef` quiescing the reactive IDB persist effects during the run.
  - Handle the `savingUnitId` single-value gotcha: with several units saving at once, the current single-ID "saving" indicator only tracks one. Either accept it (simple) or generalize the saving indicator to a set for the apply path — decide in-phase.
  - Note the pre-existing quirk: `commitUnitActivity` swallows its own errors + toasts, returning `undefined` — so `handleApplyAll`'s try/catch may under-count failures. If accurate succeeded/failed counts are wanted, surface a real throw/return from the apply worker.
- **Stretch (flag, don't default to it): chunked bulk-upsert.** One (chunked) `useBulkInsertStatusLogs`-style round-trip is fastest, but it **skips auto-advance, undo, and capture-time timestamps** (stamps sync-time) — real regressions. Only pursue if bounded-concurrency isn't fast enough, and only after re-implementing auto-advance + capture-time stamping. Treat as its own future phase.
- **Approval gates:** ⛔ touches the **offline mutation queue / apply loop** (§2). Present the new apply flow to the owner and confirm the per-item checkpoint + LWW + capture-time timestamps are preserved before finalizing. Do NOT revert to all-or-nothing queue clearing.
- **Exit criteria:** typecheck + test + build green · `concurrency.test.ts` green · Apply of a large batch materially faster (measure vs serial baseline) · crash-mid-sync still leaves only unsynced items in IDB (reason through it) · auto-advance still fires · verify on `dev:3010` · `verify-feature` → STOP.

### Phase 2 — Tame "expand all" (query storm + DOM explosion)
- **Plain-English:** Stop the app from freezing when many locations are expanded at once — right now each expanded location fires its own history query and renders a full sub-table.
- **Scope (two independent levers — do both):**
  - **Stagger/limit the audit queries.** The per-location `ExpandedActivityAudit` → `useUnitHistory` should not all fire at once. Prefer **viewport-only fetching** (only expanded rows near the viewport fetch audit) — this also dovetails with Phase 4. Otherwise cap concurrent audit queries / stagger. React Query dedupes/caches; the goal is to avoid N concurrent in-flight requests.
  - **Guard the "expand all" toggle.** Above a threshold (e.g. > ~50 locations) require a soft confirm ("Expand all 312 locations? This may be slow"), or expand in batches. Owner picks exact behavior in-phase (see Open decisions).
- **Approval gates:** none (frontend only).
- **Exit criteria:** typecheck + test + build green · pure threshold/batch helper unit-tested (if added) · expand-all on a large list no longer freezes (measured) · single-row expand unchanged · verify on `dev:3010` · `verify-feature` → STOP.

### Phase 3 — Memoize the row (smooth editing) + stabilize handlers
- **Plain-English:** Make editing feel instant by ensuring that changing one row only re-draws that row, instead of the entire table. Also the foundation the virtualization phase builds on.
- **Scope:**
  - Extract the per-location row (parent `<tr>` + its expanded children) into a `LocationRow` component wrapped in `React.memo`, in `StatusTable.tsx` (or a sibling file). Keep the Container/Presenter split — `StatusTable` still maps `visible` and renders `LocationRow`s.
  - `useCallback` the handlers in `useFieldData.ts` (`handleLocalUpdate`, `handleTimelineUpdate`, any per-row callback) so identity is stable — **prerequisite**, or `React.memo` won't help. Keep the pending-changes local-state + IDB behavior untouched (§2/§6; existing `useFieldData` tests must stay green).
  - Pass each row its own `pendingChange` slice, not the whole `pendingChanges` map, so a memoized row re-renders only when *its* pending entry changes.
- **Approval gates:** ⛔ touches `useFieldData` (offline-queue business-logic home) — keep `pendingChanges`/IDB contract intact (local `useState` → IDB, capture-time timestamps, `hasRehydrated` guard). Show the owner the diff shape if the refactor is large.
- **Exit criteria:** typecheck + test + build green · existing `useFieldData.test.tsx` green · editing one date/status re-renders only that row (verify via Profiler) · no change to Apply/Discard/pending counts · **record a scroll/DOM measurement at ~300–500 rows to inform Phase 4's strategy** · verify on `dev:3010` · `verify-feature` → STOP.

### Phase 4 — True row virtualization (the durable scroll fix)
- **Plain-English:** Only draw the handful of rows actually on screen and recycle them as you scroll — this is what lets the list stay smooth into the thousands. Built on the memoized rows from Phase 3.
- **Scope:**
  - Add `@tanstack/react-virtual` (React 19 compatible). Virtualize the location rows.
  - Handle the three hard parts explicitly: **variable row heights** (a location expands to a tall sub-table — use dynamic measurement), the **sticky header**, and the **frozen sticky-left columns** (checkbox + Location). Prefer virtualizing location "blocks" (parent row + its expanded children measured as one unit) over virtualizing a flat `<table>` body directly; validate frozen columns + horizontal scroll still work.
  - Any index→row mapping goes in a pure, tested helper (§ Pure logic).
  - Confirm expand/collapse, the baseline-column toggle, selection (incl. shift-range), and the pending-changes FAB all still behave under virtualization.
- **Approval gates:** ⛔ adds a dependency (`@tanstack/react-virtual`) — mention it to the owner. Frontend only otherwise.
- **Exit criteria:** typecheck + test + build green · sticky header + frozen columns + horizontal scroll + expand/collapse + baseline toggle + shift-range select all correct under virtualization · scroll smooth at target scale (measured vs the Phase-3 baseline) · verify on `dev:3010` · `verify-feature` → STOP.

## Verification commands (the exit-criteria gate)
Run npm with an absolute prefix (bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (target one file: ... run test -- src/utils/concurrency.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build        # next build (after editing live components)
```
- **Lint is NOT a gate** (~1850 pre-existing problems) — verify with typecheck + test + build.
- **No E2E** — a live click-through via `npm run dev:3010` (from `sitepulse-next/`, port 3010) is the UI verification. Measure with React DevTools Profiler.
- Vitest globals are OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `foo.test.ts` next to `foo.ts`.

## Hard guardrails (AGENTS.md — do not violate)
- **`pendingChanges` / `pendingTimelineChanges` stay local `useState` → IDB** (`src/utils/pendingChangesStore.ts`, project-scoped keys, `hasRehydrated` guard). Never migrate to Zustand/React Query. (Phases 1 & 3.)
- **Status writes stay on `upsert_status_log` / `.upsert(onConflict: 'unit_id,activity_id')`** with **capture-time `client_timestamp`** + LWW. Never `.insert()`. (Phase 1.)
- **Keep the per-item IDB checkpoint + `isSyncingRef`** — no all-or-nothing queue clearing; crash-mid-sync must leave only unsynced items. (Phase 1.)
- **Container/Presenter split intact** — `FieldStatusTable` (container) → `useFieldData` (logic) → `StatusTable` (presenter). Don't move business logic into the presenter. (Phases 3–4.)
- **Never fork `progressAnalytics` / `scheduleBaseline`; never hardcode a temporal-state color** (use `statusColors.ts`). (All phases.)
- **Derive types from `database.types.ts`; no `any`; everything through React Query cache stays JSON-serializable** (no class instances). (Phases 3–4.)

## Open decisions
- **Phase 2 — expand-all behavior:** soft-confirm above a threshold vs. batched expansion (recommend: viewport-only/staggered audit fetch + a soft confirm above ~50). Resolve at the start of Phase 2.
- **Phase 1 — `savingUnitId` during parallel apply:** accept single-indicator (simple) vs. generalize to a set (nicer feedback). Resolve in-phase.
- **Phase 4 — virtualization granularity:** flat-row vs. per-location "block" virtualization, decided by the Phase-3 measurement + how expanded rows behave. Resolve at the start of Phase 4.
