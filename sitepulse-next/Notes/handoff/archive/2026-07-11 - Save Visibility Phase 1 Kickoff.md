# Kickoff — Save Visibility, Phase 1: surface the failed / unsynced state where the count already shows

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Save Visibility** (make a failed status save unmistakable — a red "N failed to save — Retry" wherever the pending count already appears, on the desktop List pending bar and the mobile sync dot, with one-tap Retry). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-11 - Save Visibility Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Save-Visibility-Plan.md` (esp. Phase 1, Pure logic, Hard guardrails)
> - `sitepulse-next/AGENTS.md` (§2 offline queue / `pendingChanges` stays local `useState`→IDB / capture-time ts / `upsert_status_log`-only; §3 Container/Presenter + `statusColors.ts` is the TEMPORAL palette; §6 no `any`/no class instances in cache/IDB; §9 Vitest globals OFF + `renderWithQuery`)
>
> Branch off `main`. Build **only Phase 1**. This is **read-only w.r.t. the offline queue** — do NOT change the Apply loop, the IDB queue, `pendingChanges` locality, `isSyncingRef`, the per-item checkpoint, `upsert_status_log`, or RLS; you only READ apply results to display them. Start Phase 1 with the pure `syncStatus.ts` + `pendingChangeKey.ts` (+ tests). Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Staged status edits show an "N pending" count and sync when you tap **Apply**. Today, when a save **fails**, the item just slips back into that same "N pending" count — indistinguishable from a change you simply haven't applied — and if toasts are turned off (`settings.enableToasts`), the failure is **completely silent**. The offline queue already keeps the failed item safely (it's re-thrown in `onApplyPendingChanges` and never checkpointed, so it stays queued), so **no data is lost** — the problem is purely that the user isn't *told*. This phase makes a failure unmistakable and one-tap retryable.

## The current mechanism (read the real files fresh — do not trust line numbers)
- `src/hooks/useFieldData.ts` `handleApplyAll` runs `runWithConcurrency(finalChanges, APPLY_CONCURRENCY, worker)`. `worker` does `await onApplyPendingChanges?.([change]); await checkpoint(change);`. `runWithConcurrency` (`src/utils/concurrency.ts`) returns `ConcurrencyResult[]` — `{ index, ok, error }` per item, `results[i]` ↔ `finalChanges[i]`. A worker that throws → `ok:false` and its `checkpoint` never runs → the item **stays** in `livePending`/IDB. `handleApplyAll` already returns `{ succeeded, failed }`.
- `src/app/project/[projectId]/page.tsx` `onApplyPendingChanges` (~618): calls `commitUnitActivity`, and on `!result.ok` **re-throws** ("Status save failed — kept in the pending queue.") so the runner records the failure. **Keep this contract.**
- `src/components/StatusTable.tsx` (~549): the desktop pending **FAB** — `pendingCount > 0` → "N pending / Discard / Apply". `onClick={handleApplyAll}` **ignores** the `{ succeeded, failed }` return. This is where the desktop failed state + Retry go.
- `src/components/ui/SyncIndicator.tsx`: the mobile dot — loading / syncing / "N unsaved" / synced. **No error state.** Mounted in `src/components/MobileSwipeDeck.tsx`.
- `src/components/FieldStatusTable.tsx`: the container; threads `useFieldData` output into `StatusTable` (desktop) and `MobileSwipeDeck` (mobile). New `failedCount`/`failedUnitIds` props flow through here.

## Scope (build only this)
1. **Pure `src/utils/pendingChangeKey.ts`** — extract the `` `${change.unit.id}_${aName}` `` key (currently inline in `useFieldData`'s `pendingCount`, `handleApplyAll` dedupe, and `checkpoint`) into one tested helper; rewire those inline uses to it (pure refactor, no behavior change). This guarantees failed-key mapping uses the SAME key as dedupe/checkpoint.
2. **Pure `src/utils/syncStatus.ts`** — `deriveSyncState({ hasRehydrated, isApplying, pendingCount, failedCount }) → 'loading'|'syncing'|'pending'|'error'|'synced'` (precedence: not-rehydrated→loading; applying→syncing; failedCount>0→error; pendingCount>0→pending; else synced) + `syncStateLabel` + `syncStateTone('neutral'|'amber'|'emerald'|'red')`. Co-located test covering every branch + precedence.
3. **`useFieldData`:** after `runWithConcurrency`, set a local `failedKeys` state from `results.filter(r => !r.ok)` via `pendingChangeKey(finalChanges[r.index])`. **Clear** a key on successful re-apply, on edit (`handleLocalUpdate`/`handleTimelineUpdate`), on remove, and on Discard. Expose `failedCount` + `failedUnitIds`. (Retry = the existing `handleApplyAll`.)
4. **`SyncIndicator`:** add the `error` state (red dot + "N failed") driven by `deriveSyncState`; accept `failedCount`.
5. **`StatusTable` FAB:** `await handleApplyAll`; drive the bar off `deriveSyncState`; when `failedCount>0` render red "N failed to save" + a **Retry** button beside Discard.
6. **`FieldStatusTable`:** thread `failedCount`/`failedUnitIds` to both presenters; feed `LocationRow` a per-row `isFailed` **boolean** (never the shared set — preserves the List View Perf Phase-3 memo).

## Preserve / guardrails (AGENTS.md — do not violate)
- READ-ONLY w.r.t. the queue: do NOT change the Apply loop, `pendingChanges` locality (local `useState`→IDB), `isSyncingRef`, the per-item checkpoint, capture-time `client_timestamp`, `upsert_status_log`/LWW, or RLS.
- `failedKeys` is **local `useState`** only — never the RQ cache/IDB; if ever persisted (deferred), serialize a `Set`→array.
- Sync-state colors (pending/synced/**error**) are chrome, NOT temporal states — keep them local to `SyncIndicator` (amber/emerald + new red); do not touch `statusColors.ts`.
- Per-row `isFailed` boolean to `LocationRow` (not the shared object) so `React.memo` still skips un-edited rows.
- Derive types from `database.types.ts`; no `any`; Vitest globals OFF; lint not a gate.

## Exit criteria (close with `verify-feature` → STOP)
- `npm --prefix ".../sitepulse-next" run typecheck` / `run test` / `run build` all green.
- `syncStatus.test.ts` + `pendingChangeKey.test.ts` green (every branch/precedence).
- `dev:3010` click-through: stage a status change → go offline (or block the write) → **Apply** → SEE red "N failed — Retry" on the desktop pending bar AND the mobile dot; reconnect → **Retry** → clears to "All changes synced". A genuinely-successful Apply still clears normally.
- Do not commit/push until the owner says "Approved." No approval gates in this phase (no migration / queue-mechanic / RLS change).
