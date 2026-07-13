# Save Visibility — a status update is never silently lost or silently failed (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Predecessor: `Notes/plans/Robustness-Trust-Hardening-Plan.md` — same "never lose a save silently" theme. That plan's P1 (wiring guard) + P4 (dev-DB banner) already SHIPPED (absorbed into Codebase Health Slice 0). This plan SUPERSEDES the remaining, not-started part of it with a **narrower, status-focused scope** the owner chose 2026-07-11 (its old P2/P3 were map/canvas-focused; that map/workbench save-badge work is now explicitly out of scope here — see below).
> Sibling (just completed): the Status Sequencing & Data-Integrity workstream stopped a status write from silently *corrupting* another slot; this workstream stops a status write from being silently *lost / unseen*. Different mechanism, same trust goal.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` in full — the load-bearing invariants this touches: §2 (offline mutation queue; `pendingChanges` stays LOCAL `useState`→IDB; per-item IDB checkpoint + `isSyncingRef`; capture-time `client_timestamp`; `upsert_status_log`-only, never `.insert()`; RLS posture), §3 (Container/Presenter: `FieldStatusTable` → `useFieldData` → `StatusTable`/`MobileSwipeDeck`; `statusColors.ts` is the TEMPORAL palette), §6 (no `any`, derive types from `database.types.ts`, no class instances in the RQ cache/IDB), §9 (Vitest globals OFF; `renderWithQuery` harness; no `msw`).
2. Re-read the files named below **fresh** — do NOT trust line numbers in this doc; they drift.
3. Build the phases in order. Verify after each (§ Verification commands). Close each with the `verify-feature` skill (Definition of Done → STOP; do not commit/push until the owner says "Approved").
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
When this is done, **anyone updating a status always knows whether their change saved** — and a failed save is impossible to miss. Concretely: staged status edits already show a "pending" count and sync when you tap **Apply**. Today, if a save *fails*, the item quietly slips back into that same "N pending" count (or, if toasts are turned off, gives **no signal at all**), so it looks identical to a change you simply haven't applied yet. After this workstream, a failure shows a distinct, unmissable **"N failed to save — Retry"** state (red) everywhere the pending count already appears, you can **see exactly which changes are waiting vs. failed**, and you can **retry or dismiss** them — with fast automated tests locking the behavior so it can't regress. No schema change; the underlying queue already keeps failed work safely — this surfaces it.

## Out of scope / deferred
- **Map / canvas / workbench save badges** (the old Robustness plan's P2). Owner chose **status updates only** (2026-07-11). The immediate map quick-status / canvas-commit / workbench-geometry writes go straight through `commitUnitActivity`/their mutations (not the pending queue) and keep their existing toast on failure; adding a saving/saved/failed badge there is a possible later, separate pass — do NOT start it here.
- **Auto-retry on reconnect.** Owner chose **manual retry** (2026-07-11). Apply/Retry stays user-initiated. Auto-retry-when-back-online (reconnect detection + retry-storm guards) is a deferred follow-on; note it, don't build it.
- **Persisting the "failed" annotation across reload.** v1 tracks failed state **in memory (per session)**. No data is lost either way — failed items stay in the IDB queue and re-appear as "pending" after a reload, so the worst case on reload is losing the *red* flag, not the change. Persisting the failed flag to IDB is a clean later add (see Open decisions).
- **Any change to the offline queue mechanics, `status_logs` writes, `upsert_status_log`, capture-time stamping, the LWW guard, or RLS.** This workstream only **READS** queue/apply state to display it. Zero writes to the DB beyond the existing Apply path, which is untouched.
- **No schema change. No migration. No DDL.**

## Locked product decisions (from the owner, 2026-07-11)
- **Status pending-queue surfaces only** — desktop List (`StatusTable` pending FAB) + mobile swipe deck (`SyncIndicator` + `PendingReviewDrawer`). Not the map/canvas.
- **Manual retry** — show the failure + a Retry affordance; the user decides when to re-send. No background auto-retry.
- **(Implementation call, documented)** Failed-state is **in-memory/session** for v1; IDB persistence of the failed flag is deferred. Rationale: the queued item itself already survives reload (no data loss); the failed *flag* is a strong within-session nudge and can be persisted later without rework.

## Data model
**No schema change.** This is presentation- + test-layer only.
- **READS:** the existing pending-queue signals already exposed by `useFieldData` (`pendingChanges`, `pendingTimelineChanges`, `pendingCount`, `isApplying`, `hasRehydrated`) and the **per-item Apply outcome** already produced by `handleApplyAll` (`runWithConcurrency` returns `ConcurrencyResult[]` with `{ index, ok, error }`, and `handleApplyAll` already returns `{ succeeded, failed }`). Online/offline is read from `navigator.onLine` / React Query's `onlineManager` (read-only) to distinguish "waiting" from "failed".
- **WRITES (client state only):** a new **failed-key set** in `useFieldData` (local `useState`, exactly like `pendingChanges` — NOT Zustand, NOT the RQ cache, NOT IDB). It annotates *which already-queued items failed the last Apply*; it never changes what is queued.
- **Never touches:** `status_logs` / the `upsert_status_log` RPC / the `UNIQUE(unit_id, activity_id)` slot / the IDB mutation queue's contents or checkpoint logic / RLS.

## Build-on inventory (read these fresh before using)
REUSE — do not fork:
- `src/hooks/useFieldData.ts` — **the one owner of queue state.** `handleApplyAll` runs `runWithConcurrency(finalChanges, APPLY_CONCURRENCY, …)`; each `results[i]` maps to `finalChanges[i]`. Add failed-key tracking HERE (nowhere else). Keep `pendingChanges` local `useState`→IDB, `isSyncingRef`, and the per-item `checkpoint` **exactly** as they are — only read the results.
- `src/utils/concurrency.ts` — `runWithConcurrency` → `ConcurrencyResult[]` (`index`/`ok`/`error`). Reuse to identify the failed items by index; do not modify it.
- `src/app/project/[projectId]/page.tsx` — `onApplyPendingChanges` (~618) already re-throws on `!result.ok` so a failed commit is recorded as a failure and the item **stays queued** (the load-bearing behavior this workstream surfaces). Do not change this contract.
- `src/components/ui/SyncIndicator.tsx` — the mobile status dot (loading / syncing / "N unsaved" / synced). **Extend** it with the 4th `error` state; reuse its dot + label pattern, don't restyle from scratch.
- `src/components/StatusTable.tsx` — the desktop pending **FAB** (`pendingCount > 0` → "N pending / Discard / Apply", ~549). It currently **ignores** `handleApplyAll`'s `{ succeeded, failed }` return — wire the failed state + a Retry here.
- `src/components/MobileSwipeDeck.tsx` + `src/components/PendingReviewDrawer.tsx` — the mobile `SyncIndicator` mount + the "Review (N)" drawer. Extend the drawer for per-item waiting/failed + retry/remove (Phase 2).
- `src/components/FieldStatusTable.tsx` — the container threading `useFieldData` → both presenters. Add the new `failedCount`/`failedUnitIds` (+ any retry/dismiss callbacks) as props down each branch (keep per-row primitives stable — List View Perf Phase 3 memo rule: feed a per-row `isFailed` boolean, NOT the shared failed set, so `React.memo(LocationRow)` still holds).
- `handleRemovePendingItem` (in `useFieldData`) — reuse for per-item dismiss (Phase 2).
- `src/test/renderWithQuery.tsx` + the Supabase-mock recipe (canonical example `src/hooks/useProjectQueries.test.tsx` / `useMapActions.test.tsx`) — for the wiring tests (Phase 3). No `msw`.
NOT to fork: `progressAnalytics`/`bottleneck`/`scheduleBaseline`; the established Query hooks; `statusColors.ts`.

## Pure logic to extract + unit-test
Framework-free, deterministic functions in `src/utils/` (+ co-located `.test.ts`) — no React, no `Date.now()` inside (pass anything time-derived IN):
- **`src/utils/syncStatus.ts` — `deriveSyncState(input) → SyncState`** where `input = { hasRehydrated: boolean; isApplying: boolean; pendingCount: number; failedCount: number }` and `SyncState = 'loading' | 'syncing' | 'pending' | 'error' | 'synced'`. Precedence (pin in tests): **not rehydrated → `loading`; else applying → `syncing`; else failedCount>0 → `error`; else pendingCount>0 → `pending`; else `synced`.** Add `syncStateLabel(state, { pendingCount, failedCount })` → the short human string and `syncStateTone(state) → 'neutral'|'amber'|'emerald'|'red'`. Cover every branch + precedence (error beats pending; syncing masks error until the apply settles).
- **`src/utils/pendingChangeKey.ts` — `pendingChangeKey(change) → string`** = the `` `${change.unit.id}_${aName}` `` key currently duplicated inline in `useFieldData` (`pendingCount`, `handleApplyAll` dedupe, `checkpoint`). Extract it once so failed-key mapping uses the SAME key as the dedupe/checkpoint (prevents drift), and unit-test it (primary vs. timeline-activity keying). Rewire the existing inline uses to it (pure refactor, no behavior change).

## Sub-phasing (ship + verify each)

### Phase 1 — Surface the failed / unsynced state where the count already shows (the core fix)
- **Plain-English:** today a failed status save quietly rejoins the "N pending" count — or is fully silent if toasts are off. This phase makes a failure unmistakable: a red **"N failed to save — Retry"** everywhere the pending count already appears (the mobile dot and the desktop pending bar), with one-tap Retry.
- **Scope:**
  - Add pure `src/utils/pendingChangeKey.ts` + `src/utils/syncStatus.ts` (+ tests); rewire the inline key uses in `useFieldData`.
  - `useFieldData`: after `runWithConcurrency`, compute `failedKeys` from `results.filter(r => !r.ok)` mapped via `pendingChangeKey(finalChanges[r.index])`; store as local `useState`. **Clear** a key when that item next applies successfully, is edited (`handleLocalUpdate`/`handleTimelineUpdate`), removed, or on Discard. Expose `failedCount` + `failedUnitIds` (a set/array of unit ids for per-row marking). "Retry" = the existing `handleApplyAll` (it already re-applies everything still pending, incl. failed) — no new write path; just relabel/expose it as Retry when `failedCount>0`.
  - Extend `SyncIndicator` to render the `error` state (red dot + "N failed") via `deriveSyncState` — pass `failedCount` in from `FieldStatusTable`.
  - Desktop FAB (`StatusTable`): **await** `handleApplyAll` and drive the bar off `deriveSyncState`; when `failedCount>0`, show it red — "N failed to save" + a **Retry** button (re-runs Apply on the still-pending) beside Discard. When some succeeded and some failed, the count reflects only the remaining/failed.
  - Thread `failedCount`/`failedUnitIds` through `FieldStatusTable` → both presenters; feed `LocationRow` a per-row `isFailed` **boolean** (not the shared set) to preserve the Phase-3 memo.
  - READ-ONLY w.r.t. the queue: `pendingChanges`/IDB/checkpoint/`commitUnitActivity` untouched; failed tracking is UI state only.
- **Approval gates:** none (no migration / no queue-mechanic / no RLS change). Standard: don't commit/push until "Approved".
- **Exit criteria:** typecheck + test + build green · `syncStatus`/`pendingChangeKey` unit-tested · `dev:3010` click-through: stage a status change, force a failure (go offline / block the write) → Apply → SEE red "N failed — Retry" on the desktop bar AND the mobile dot; go back online → Retry → clears to "All changes synced" · close with `verify-feature`.

### Phase 2 — "See what's stuck" + per-item retry / dismiss (the drill-in)
- **Plain-English:** a place to see exactly which changes are waiting vs. failed and retry or drop them one at a time — so one bad change can't hold up the rest or hide inside a count.
- **Scope:**
  - Extend the mobile `PendingReviewDrawer` to tag each item **waiting** vs **failed** (failed = its key is in `failedKeys`; waiting/offline = pending and `!navigator.onLine`) and add per-item **Retry** + **Remove** (reuse `handleRemovePendingItem`; add a single-item apply that reuses `onApplyPendingChanges` with a one-item array and updates `failedKeys` from its result).
  - Desktop: a small popover from the pending FAB listing the same rows (unit · activity · target state · waiting/failed) with per-item retry/remove — reuse the drawer's row component if practical.
  - Distinguish "waiting to sync / offline" from "failed last attempt" per item (read `navigator.onLine` / `onlineManager`; read-only).
- **Approval gates:** none. Standard commit/push gate.
- **Exit criteria:** typecheck + test + build green · `dev:3010`: open the review surface with mixed waiting + failed items; retry one (succeeds → leaves the list, count drops); remove one (drops without saving) · close with `verify-feature`.
- **Open decision (resolve in-phase, recommend then proceed):** desktop drill-in as a **popover from the FAB** (Recommended — least layout disruption) vs. a docked side panel. Confirm via screenshot.

### Phase 3 — Wiring / RTL regression tests (the backstop)
- **Plain-English:** a handful of fast automated tests that lock in "a failed save stays queued AND is shown as failed, and a retry clears it," so this protection can't silently regress later.
- **Scope:**
  - Using `renderWithQuery` + the Supabase mock recipe (no `msw`):
    1. **Core regression:** a failed Apply keeps the item in `pendingChanges` AND sets `failedCount>0` / `deriveSyncState → 'error'`.
    2. A subsequent **successful retry** clears the failed key → `'synced'` and empties the queue.
    3. **Mixed batch:** some succeed (leave), some fail (stay + flagged).
    4. `SyncIndicator` renders each state (loading / syncing / pending / error / synced) — a light render assertion.
  - Note the pattern in AGENTS.md §9 (a fresh queue-state UI should add a wiring test).
- **Approval gates:** none. Standard commit/push gate.
- **Exit criteria:** typecheck + test + build green · the new tests FAIL if you revert the Phase-1 failed-tracking (prove they're real guards) · total test count up + green · close with `verify-feature`.

## Hard guardrails (AGENTS.md — do not violate)
- **`pendingChanges`/`pendingTimelineChanges` stay LOCAL `useState`→IDB** (`useFieldData`). Do NOT move to Zustand/RQ. Keep `isSyncingRef` + the per-item `checkpoint` + capture-time `client_timestamp` exactly as-is — this workstream only READS apply results, never alters the Apply loop, the queue, or what gets written.
- **Never revert `status_logs` to `.insert()`; never touch `upsert_status_log`/LWW/RLS.** No new write to the DB at all.
- **`statusColors.ts` is the TEMPORAL-state palette** (none/planned/ongoing/completed). Sync-state colors (pending/synced/**error**) are NOT temporal states — keep them in `SyncIndicator`'s existing local language (amber/emerald + a new **red** for error). Do NOT pull sync colors from, or add them to, `statusColors.ts`, and never hardcode a temporal-state color.
- **No class instances in the RQ cache / IDB** (§6). `failedKeys` is local component state only; if it's ever persisted (deferred), serialize a `Set` to an array — never store a `Set`/`Map` in the cache or IDB.
- **Preserve the List View Perf Phase-3 memo:** feed `LocationRow` a per-row `isFailed` **boolean** + primitives, never the shared `failedKeys` object (its identity changes每 apply and would re-render every row).
- **Do not recolor `mapDisplayStatuses`** or write `status_logs.status_color`; the sync badge is read-only chrome.
- **Derive types from `database.types.ts`; no `any`.** **Vitest globals OFF** — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate tests. **Lint is NOT a gate** (~1850 pre-existing) — verify with typecheck + test + build.
- **Touch the canvas/`FloorplanCanvas` not at all** — map surfaces are out of scope this workstream.

## Verification commands (the exit-criteria gate)
Run npm with an absolute prefix (Bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck   # tsc --noEmit (primary gate)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test         # vitest (target one file: ... run test -- src/utils/syncStatus.test.ts)
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build        # next build (after editing live components)
```
- **Lint is NOT a gate.** **No E2E** — the UI proof is a live `npm run dev:3010` click-through (port 3010, from `sitepulse-next/`): the honest way to force a failure is to go offline in devtools (or point at a blocked write) so the Apply records a failure and the failed state must appear, then reconnect and Retry.

## Open decisions
- **Failed-flag persistence across reload** — v1 is in-memory (recommended). Revisit only if the owner wants the red flag to survive a refresh; it's an additive IDB-serialization pass (store failed keys as an array under a project-scoped key, mirror `pendingChangesStore`).
- **Desktop drill-in shape (Phase 2)** — popover from the FAB (recommended) vs. side panel; resolve in-phase with a screenshot.
- **Immediate (non-staged) write failures** — map quick-status / canvas / workbench writes keep their toast; whether they later get the same badge is the deferred map/canvas pass, not this workstream.
