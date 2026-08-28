# Kickoff — Undo/Redo Data-Integrity, Phase 3: failure surfacing + stack integrity + re-audit

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Undo/Redo Data-Integrity** (a failed undo must stop looking like a success). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-08-28 - Undo-Redo Data-Integrity Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Undo-Redo-Data-Integrity-Plan.md` (Phase 3)
> - `sitepulse-next/AGENTS.md`
>
> The phase's one owner decision is already **answered** — see "Locked decision" below; build to it, don't re-open it. Branch off `main`. Build **only Phase 3** — do not touch the drawing/geometry undo. Start with a failing reproduction test. No SQL, no migration, no RLS change in this workstream at all. Don't commit or push until I say "Approved."

---

## ✅ Locked decision (owner, 2026-08-28) — the phase's only gate, already cleared

**When an undo fails to write, the action goes BACK on the undo stack and is NOT pushed to redo** (option A, the plan's recommendation). The user can press Ctrl+Z again once they're back online.

This mirrors the per-item retry semantics the offline pending queue already uses (`useFieldData`) — a change that didn't save stays available to retry rather than being silently spent. The rejected alternative was consuming the action and relying on the toast alone.

**Do not re-litigate this.** The gate is cleared; there are no remaining approval gates in this phase.

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists — in one paragraph

Phases 1 and 2 made undo's writes correct and made a failed write **throw**. Nothing catches that throw. The keyboard handler calls `triggerUndo()` without awaiting it, so a failure surfaces as an unhandled promise rejection in the browser console — invisible to the user — while the optimistic screen update stands. So the original complaint is only two-thirds fixed: the write is right when it succeeds, but **a failure still looks exactly like a success.** This phase closes that, and re-runs the production audit to confirm the two shipped phases introduced no timestamp inversions.

## Required reading (in this order)
1. `sitepulse-next/AGENTS.md` — §2 for the status-write invariants (P1/P2 added the undo-specific ones; don't re-litigate the fresh-timestamp rule) and §0 for how to report back.
2. `sitepulse-next/Notes/plans/Undo-Redo-Data-Integrity-Plan.md` — Phase 3 scope + the § Audit queries you must re-run.
3. `src/hooks/useUndoRedo.ts` — `writeStatusSlot` / `writeStatusRows` are where failures originate; `triggerUndo` / `triggerRedo` are where they escape. Note the stacks are mutated **before** the write (the action is popped and pushed to redo up front), so option (A) means restoring both.
4. `src/hooks/useMapActions.ts` — the `showToast` helper (defined near the top, ABOVE the `useUndoRedo(...)` call, so it can be threaded in) and how the mutations already surface failures. Note `showToast` deliberately lets `error`/`warning` through even when toasts are switched off.
5. `src/hooks/useUndoRedo.test.tsx` — the harness you'll extend; its recording stub can already be made to fail (`rpcResult` / `statusUpsertResult` return an `{ error }`).

## Scope — build exactly this

**1. Surface the failure.** Catch inside `triggerUndo` / `triggerRedo` (a caller-side `.catch()` won't help — the keyboard handler doesn't await) and report through the existing toast mechanism. `showToast` is local to `useMapActions`, so thread it in as a prop/callback on `useUndoRedo({ toolMode, sheetId, ... })`. ⚠️ It is re-created every render — keep it in a ref (the file already uses that pattern for `undoStateRef`) rather than putting it in a `useCallback` dependency array.

**2. Keep a failed action available to retry.** Per the locked decision: on failure, put the action **back** on the undo stack and do **not** push it to redo. Mind the ordering — `triggerUndo` pops the action and pushes it to redo **before** the write runs, so the failure path has to reverse both moves. The mirror case matters too: a failed `triggerRedo` must go back on the *redo* stack and not be left on the undo stack. Pin both with tests; a stack that silently loses an action is the same class of lie this workstream exists to remove.

**3. Re-sync the screen.** The optimistic cache update has already been applied by the time the write fails, so the display is showing a revert that didn't happen. Invalidate `queryKeys.statusesBySheet(sheetId)` **and** `queryKeys.allProjectStatusesAll()` on failure — the same pair every status mutation invalidates in `onSettled`. Don't hand-roll a snapshot/rollback; a refetch is the honest source of truth.

**4. Re-run the § Audit queries** from the plan against production (read-only) and record the numbers in the Definition of Done. Inversions must still be **0**; the "none with colour" count baseline was **16**, all pre-July. ⚠️ Excluding `activity_id IS NULL` from the inversion query is load-bearing — 110 legacy rows have one, and including them produces a false positive of 33.

## Start with a failing test
The harness already supports it: make the stub return `{ error }`, drive a real undo, and assert (a) the toast callback fired with an error, and (b) the action is back on the undo stack and absent from the redo stack. Both fail today — nothing is caught, so no toast fires and the action is consumed regardless. ⚠️ Vitest **swallows `console.log`** here — assert observed values in one object (`expect({...}).toEqual({...})`) so the diff prints them.

## Live check — read this before touching a browser
This phase changes UI behaviour, so it needs a real click-through (`npm run dev:3010`, from `sitepulse-next/`). **`dev:3010` runs against the PRODUCTION database** (the `DevDbBanner` will be showing).
- **Never test a write path against a real project's rows.** Use a throwaway project/location you created for the test.
- For the failure case, force the failure in the **browser** (DevTools offline mode / block the request), not by pointing the app at anything else. An offline undo writes nothing anywhere, which is exactly the state under test.

## Out of scope for Phase 3 — do not drift into these
- **Drawing/geometry undo** — `UPDATE_GEOMETRY`, `CREATE_UNIT`, and the `units` writes inside `DELETE_UNIT`. Still owner-deferred. (Known: those writes are gated to `owner`/`admin`/`pm`, so for a plain member they silently affect zero rows — a follow-up, not this phase.)
- **The `UPDATE_STATUS` / bulk payload logic** — done in P1/P2, on main.
- **Making the undo stack survive a page refresh.** In-memory by design; that bounds the blast radius.
- **The bulk "set to Not Started" gap** — an apply that sets locations TO `'none'` records an empty `newLogs`, so blank locations leave no trace for undo. Benign (blank stays blank) and it needs a change at the push site in `useMapActions`. Note it, don't fix it here.
- **Any SQL.** This workstream changes no schema, no function, no RLS.

## Exit criteria
- All three green, run with the absolute prefix (bash cwd persists; a stray `cd` triggers a prompt):
  ```
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
  ```
- Baseline after Phase 2 is **1,523 tests**.
- A live click-through: undo online (still works, no toast), and undo with the network blocked (toast appears; the action stays on the undo stack, and pressing Ctrl+Z again once reconnected actually applies it).
- The audit queries re-run, numbers reported.
- **Lint is NOT a gate** (~1,850 pre-existing problems).
- Close with the **`verify-feature`** skill (Definition of Done → stop). Do not commit or push until the owner says "Approved."

## Useful context you would otherwise have to rediscover
- **P1 shipped as `9de426a`, P2 as `67044d7`** (both merged to `main` on 2026-08-28, Vercel auto-deploys). P1: single-slot writes through the `upsert_status_log` RPC, error-checked, fresh timestamps, plus a fix for redo-of-Clear-Status. P2: `buildBulkUndoPayloads` so a bulk undo reverts every location, not just the ones with a prior status.
- Every defect in this workstream was **runtime-reproduced** before being fixed, and every phase started with tests that failed against the old code. Keep that habit — it is why the fixes have held.
- The last status write of any kind in production was **2026-07-22**; the app is not in active field use, so there is time to do this properly.
- After this phase the workstream is **complete**. The remaining known lanes are the deferred drawing/geometry half and the non-transactional level-delete cascade (DATA-01's remaining half) — both separate, neither planned yet.
