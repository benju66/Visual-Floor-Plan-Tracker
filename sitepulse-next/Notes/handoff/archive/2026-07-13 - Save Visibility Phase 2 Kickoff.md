# Kickoff — Save Visibility, Phase 2: "see what's stuck" + per-item retry / dismiss (the drill-in)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Save Visibility** (a drill-in that shows exactly which staged changes are **waiting** vs **failed**, and lets you **Retry** or **Remove** them one at a time — so one bad change can't hold up the rest or hide inside a count). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-13 - Save Visibility Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Save-Visibility-Plan.md` (esp. Phase 2, Pure logic, Hard guardrails)
> - `sitepulse-next/AGENTS.md` (§2 offline queue / `pendingChanges` stays local `useState`→IDB / capture-time ts / `upsert_status_log`-only; §3 Container/Presenter + `statusColors.ts` is the TEMPORAL palette; §6 no `any`/no class instances in cache/IDB; §9 Vitest globals OFF + `renderWithQuery`)
>
> Phase 1 shipped (commit `2ec5ae2`): `useFieldData` already tracks `failedKeys` and exposes `failedCount` + `failedUnitIds`; `src/utils/syncStatus.ts` + `src/utils/pendingChangeKey.ts` are the pure, tested key/state helpers. Build **only Phase 2** on top of that. This stays **read-only w.r.t. the offline queue** — do NOT change the Apply loop, the IDB queue, `pendingChanges` locality, `isSyncingRef`, the per-item checkpoint, `upsert_status_log`, or RLS. A per-item Retry is just `onApplyPendingChanges([oneChange])` + a `failedKeys` update — no new write path. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Phase 1 made a failed save **loud** (a red "N failed to save — Retry" on the pending bar + mobile dot, and a "Failed" tag per row). But Retry today is **all-or-nothing** — it re-runs Apply over everything still queued. If one change keeps failing (a genuinely bad edit, or one location the server keeps rejecting), it sits mixed into the count and every Retry drags the whole batch along with it. This phase adds a **drill-in list**: see each pending change, whether it's just **waiting** (not applied yet / offline) or **failed** its last attempt, and **Retry or Remove that one item** without touching the others.

## What Phase 1 already gives you (build on it — don't refork)
- `useFieldData` (`src/hooks/useFieldData.ts`) owns `failedKeys` (a local `useState<Set<string>>`), keyed by **`pendingChangeKey`** (`src/utils/pendingChangeKey.ts` — the ONE canonical `${unit.id}_${activity}` key shared by count / Apply-dedupe / checkpoint). It exposes `failedCount` + `failedUnitIds`, and clears a key on successful re-apply, edit, remove, discard, and project switch.
- `src/utils/syncStatus.ts` — `deriveSyncState` / `syncStateLabel` / `syncStateTone`. Reuse for any per-item or aggregate state chrome; don't hand-roll new conditionals.
- The desktop pending FAB (`StatusTable.tsx`) + the mobile `SyncIndicator` already render the aggregate error state. Phase 2 is the **drill-in** behind them.

## The current mechanism (read the real files fresh — do not trust line numbers)
- `src/components/PendingReviewDrawer.tsx` — the mobile bottom-sheet. It ALREADY builds a per-item `pendingMap` (one row per `${unitId}_${activityName}`, primary + timeline, with a `hasConflict` flag), and each row ALREADY has an inline state-picker + a per-item **Remove** (the `X` → `handleDrawerItemRemove`). It has NO per-item waiting/failed tag and NO per-item Retry yet — that's this phase. Note its inline key-building duplicates the old inline expression; **rewire it to `pendingChangeKey`** so a row's failed lookup matches `failedKeys` exactly.
- `src/components/MobileSwipeDeck.tsx` — mounts the drawer (`isDrawerOpen`) and threads `handleApplyAll` / `handleDrawerItemRemove` / `handleTimelineUpdate` down. It already receives `failedCount` (Phase 1); it will also need `failedKeys` (or a per-key predicate) + a single-item retry callback to pass to the drawer.
- `src/components/StatusTable.tsx` — the desktop pending FAB. Phase 2 adds the desktop drill-in (recommended: a small **popover from the FAB** — see Open decision).
- `handleRemovePendingItem` (in `useFieldData`) — reuse for per-item dismiss (already wired into the drawer via `handleDrawerItemRemove`); it already clears the item's `failedKey` (Phase 1).

## Scope (build only this)
1. **Expose per-item failed state from `useFieldData`.** Add a read-only way to ask "did THIS key fail?" — either expose `failedKeys` (the `Set<string>`) or a stable `isFailedKey(key) => boolean`. (If you expose the Set, keep feeding presenters per-item booleans, not the Set, wherever a memo is in play.)
2. **Single-item Retry in `useFieldData`.** Add `handleRetryItem(change: PendingChange)` (or `(key)`) that runs `onApplyPendingChanges?.([change])`, and on success checkpoints/removes that one item + clears its `failedKey`; on failure re-adds the key. **Reuse the exact same write path** as `handleApplyAll`'s worker (`onApplyPendingChanges` → `commitUnitActivity` → `upsert_status_log`, capture-time `client_timestamp`) — no new mutation, no queue-mechanic change. Serialize it against an in-flight full Apply (don't let a single retry and a batch Apply race the IDB checkpoint — respect `isSyncingRef` / the checkpoint tail).
3. **Per-item tag in `PendingReviewDrawer`.** Tag each row **waiting** vs **failed**: failed = its `pendingChangeKey` is in `failedKeys`; waiting/offline = pending and `!navigator.onLine` (read `navigator.onLine` / React Query's `onlineManager`, **read-only**). Add a per-item **Retry** button (visible/emphasized when failed) beside the existing Remove. Rewire the row key to `pendingChangeKey`.
4. **Desktop drill-in (`StatusTable` FAB → popover).** A small popover listing the same rows (unit · activity · target state · waiting/failed) with per-item retry/remove. Reuse the drawer's row presentation if practical (consider extracting a shared `PendingItemRow`); do not fork the state logic.
5. **Distinguish waiting vs failed consistently** in both surfaces via the same predicate; keep the sync-chrome colors local (amber = waiting, red = failed) — NOT from `statusColors.ts`.
6. READ-ONLY w.r.t. the queue throughout.

## Preserve / guardrails (AGENTS.md — do not violate)
- READ-ONLY w.r.t. the queue: do NOT change the Apply loop, `pendingChanges` locality (local `useState`→IDB), `isSyncingRef`, the per-item checkpoint, capture-time `client_timestamp`, `upsert_status_log`/LWW, or RLS. A per-item Retry reuses the existing write path with a one-item array.
- `failedKeys` stays **local `useState`** — never the RQ cache/IDB; if ever persisted (deferred), serialize the `Set`→array.
- Sync-state colors (waiting/failed) are chrome, NOT temporal states — keep amber/emerald/red local; do not touch `statusColors.ts`.
- Preserve the List View Perf Phase-3 memo: any per-row prop into `LocationRow`/a memoized row stays a **boolean/primitive**, never the shared `failedKeys` set.
- `navigator.onLine` / `onlineManager` reads are **read-only** — do not add reconnect auto-retry (owner chose MANUAL retry; auto-retry is a deferred follow-on).
- Derive types from `database.types.ts`; no `any`; Vitest globals OFF; lint not a gate (verify with typecheck + test + build).

## Open decision (resolve in-phase, recommend then proceed)
- **Desktop drill-in shape** — a **popover from the FAB** (Recommended — least layout disruption) vs. a docked side panel. Build the popover, confirm with a screenshot, and only switch if the owner prefers the panel.

## Exit criteria (close with `verify-feature` → STOP)
- `npm --prefix ".../sitepulse-next" run typecheck` / `run test` / `run build` all green.
- New/extended tests: the per-item retry updates `failedKeys` correctly (success clears just that key + drops the item; failure keeps it); the waiting-vs-failed predicate is unit-tested; a light render assertion on the drawer/popover rows.
- `dev:3010` click-through: open the drill-in with a **mix** of waiting + failed items; **retry one** (succeeds → leaves the list, count drops, others untouched); **remove one** (drops without saving); the aggregate bar/dot stays consistent with the remaining items.
- Do not commit/push until the owner says "Approved." No approval gates this phase (no migration / queue-mechanic / RLS change).
