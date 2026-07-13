# Kickoff — List View Performance & Smoothness, Phase 1: Faster Apply (bounded-concurrency)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of List View Performance & Smoothness** (make the List's **Apply** run several staged status-saves at once instead of one-by-one). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-10 - List View Performance Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/List-View-Performance-Plan.md` (esp. Phase 1)
> - `sitepulse-next/AGENTS.md` (esp. §2 — offline queue, `upsert_status_log`, capture-time `client_timestamp`, per-item IDB checkpoint)
>
> Branch off `main`. Build **only Phase 1**. ⛔ This touches the offline mutation queue / apply loop — you MUST preserve the per-item IDB checkpoint, capture-time `client_timestamp`, and the LWW guard; do NOT revert to all-or-nothing clearing. Present the new apply flow and confirm those invariants before finalizing. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
When the user stages a batch of status changes in the List and clicks **Apply**, the app currently saves them **strictly one at a time** — it waits for each save's network round-trip to finish before starting the next. With dozens of changes that's a visible grind. This phase runs a handful of saves concurrently (bounded, e.g. 4–6 at once) so a big batch finishes in a few seconds — **without** giving up the crash-safety that the current one-at-a-time loop provides.

This is the most self-contained of the four performance fixes and carries **no rendering risk** — it's a good first slice.

## Required reading (fresh — do not trust line numbers)
- `sitepulse-next/AGENTS.md` §2 — the offline mutation queue, `pendingChanges` staying local, `upsert_status_log`-only writes, **capture-time `client_timestamp`**, and the **Per-Item IDB Checkpoint** rule (`handleApplyAll` dequeues per item; `isSyncingRef` quiesces the persist effects; crash-mid-sync must leave only unsynced items). These are the invariants you must NOT break.
- `src/hooks/useFieldData.ts` — `handleApplyAll` is the serial loop you're reworking (dedupes `pendingChanges` + `pendingTimelineChanges`, then `for … await onApplyPendingChanges([change])`, with `persistCurrentQueue` checkpoint after each success). Read the whole function + `isSyncingRef` usage.
- `src/app/project/[projectId]/page.tsx` — the `onApplyPendingChanges` wiring (calls `commitUnitActivity` per change).
- `src/hooks/useMapActions.ts` `commitUnitActivity` — **read it fully.** It does more than one write: resolves the activity id, runs **auto-advance** (a completed status can fire a *second* `upsert_status_log`), maintains the undo stack, toggles a single `savingUnitId`, and **swallows its own errors** (try/catch + toast, returns `undefined`). This is why you overlap *calls* to it rather than reimplementing the write.
- `List-View-Performance-Plan.md` → Phase 1 + "Pure logic to extract".

## Scope (build only this)
1. **Pure `src/utils/concurrency.ts` + `concurrency.test.ts`.** A small bounded-concurrency runner, e.g. `runWithConcurrency(items, limit, worker) → Promise<{ index, ok, error }[]>`. Deterministic given a fake async worker. Tests: preserves per-item result mapping, **never exceeds the limit** concurrently, **one worker failure doesn't abort the rest**, empty input, `limit ≥ length`. Never call `Date.now()` inside.
2. **Rework `handleApplyAll`** to drive the deduped changes through the runner (start limit 4–6) instead of the strict serial loop. **Preserve exactly:**
   - capture-time `client_timestamp` (from `PendingChange.capturedAt`) still threaded through;
   - the **per-item IDB checkpoint** — checkpoint (`persistCurrentQueue`) as *each* change resolves, so a crash leaves only unsynced items (concurrent-safe: guard the shared live-snapshot mutation);
   - `isSyncingRef` still quiescing the reactive IDB persist effects for the whole run;
   - LWW / `upsert_status_log` write path untouched (you're not changing the write, only overlapping calls).
3. **`savingUnitId` gotcha:** several units now save at once but `savingUnitId` is a single id. Either accept it (simplest) or generalize the "saving" signal to a set for the apply path. Decide + note which you chose.

## Explicitly DO NOT
- Do **not** switch the batch to the chunked bulk-upsert (`useBulkInsertStatusLogs`). It skips auto-advance, undo, and stamps **sync-time** (not capture-time) timestamps — real regressions. It's a flagged future stretch, not this phase.
- Do **not** move `pendingChanges` off local `useState`/IDB. Do **not** clear the queue all-or-nothing.

## Guardrails
- Frontend only; no schema/RLS/backend. No migration.
- Keep `commitUnitActivity`'s behavior (auto-advance, undo) intact — you overlap calls, you don't rewrite it.
- Derive types from `database.types.ts`; no `any`; keep cache values JSON-serializable.

## Exit criteria (close with `verify-feature`, then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green (incl. new `concurrency.test.ts` and the existing `useFieldData.test.tsx`).
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Live check on `dev:3010`: stage a batch of status/date changes and Apply — materially faster than serial, all changes land, auto-advance still fires, and the pending FAB clears. Reason through crash-mid-sync: only unsynced items remain in IDB.
- Present the new apply flow to the owner; confirm the per-item checkpoint + capture-time timestamp + LWW are preserved.
- Do NOT commit or push until the owner says "Approved."
