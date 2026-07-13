# Kickoff — Status Sequencing & Auto-Advance Data-Integrity Fix, Phase 3: editing a planned date on a completed activity keeps its completion date

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of the Status Sequencing & Auto-Advance Data-Integrity Fix** (editing a *planned* start/end date on an already-completed activity must stop silently resetting that activity's completion date to today). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-10 - Status Sequencing Data Integrity Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Status-Sequencing-Data-Integrity-Plan.md` (esp. Phase 3 + "Data model" [the `upsert_status_log` NULLIF-on-absent behavior] + "Testing philosophy")
> - `sitepulse-next/AGENTS.md` (§2 status-write / capture-time `client_timestamp` / offline-queue invariants, §6 no `any`)
> - `sitepulse-next/src/hooks/useMapActions.ts` — `commitUnitActivity`, the `newLogData` field-assembly block (the `logged_date` line you fix, next to the `actual_start_date` preservation you mirror).
> - `sitepulse-next/src/hooks/useFieldData.ts` — `handleLocalUpdate` / `handleTimelineUpdate` (why a planned-date edit reaches `commitUnitActivity` with no `loggedDate`).
>
> Branch off `main`. Build **only Phase 3**. Frontend only, no migration. **Start by writing a FAILING reproduction test, then make it pass.** Preserve every status-write invariant (single writes stay on `upsert_status_log` with capture-time `client_timestamp` + LWW; never `.insert()`; offline queue untouched). This phase is **independent of auto-advance** (fires even with auto-advance OFF) and does not touch Phases 1/2. Close with `verify-feature` and STOP — don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
Fixing a typo in a **planned** start/end date on an activity that's already **completed** currently, as a side effect, silently overwrites that activity's **completion date (`logged_date`) with today**. The user didn't touch the completion date — but the edit re-stamps it, corrupting the schedule-variance history. This happens **even with auto-advance turned off** — it's a separate bug from Phases 1–2.

## Root cause (read the real code fresh — do not trust these line numbers)
In `commitUnitActivity` (`useMapActions.ts`), `newLogData.logged_date` is assembled roughly like:
```ts
logged_date: extraProps.loggedDate !== undefined
  ? (extraProps.loggedDate || null)
  : (currentTemporalState === 'completed' ? new Date().toISOString().split('T')[0] : null),
```
When a planned-date edit carries **no** `loggedDate` and the slot is `completed`, the `else` branch **re-stamps today** — clobbering the real completion date. Because the single write goes through the `upsert_status_log` RPC (which **rewrites every column from its payload**), whatever this line computes is what lands.

Contrast the **`actual_start_date`** field a few lines below — it is already protected by preserving the stored value when the edit doesn't carry it:
```ts
actual_start_date: extraProps.actualStartDate !== undefined
  ? (extraProps.actualStartDate || null)
  : (oldStatus?.actual_start_date ?? null),
```
`logged_date` needs the **same discipline**.

## The fix (locked shape — do not over-engineer)
Preserve `oldStatus.logged_date` when the edit doesn't carry `loggedDate`; **only** stamp today for a **genuinely-new completion** (state becomes `completed` AND there is no prior `logged_date`):
```ts
logged_date: extraProps.loggedDate !== undefined
  ? (extraProps.loggedDate || null)
  : (currentTemporalState === 'completed'
      ? (oldStatus?.logged_date ?? new Date().toISOString().split('T')[0])
      : null),
```
- `oldStatus` is the same already-resolved prior log the function uses for undo + the auto-advance state read (it already includes the **cross-sheet all-levels fallback** from Phase 1) — reuse it, don't re-fetch.
- **Recommended home: the commit fallback** (this one spot in `commitUnitActivity`), not the edit handlers — one place protects every caller (desktop List apply, map/canvas commits, quick modals, mobile swipe, bulk-via-single-path). Confirm in-phase; if you choose the edit handlers instead, justify why.
- Leave the `currentTemporalState !== 'completed'` branch (→ `null`) as-is — moving a slot *off* completed legitimately clears its completion date; that's out of scope.

## Required reading (fresh — do not trust line numbers)
- `Status-Sequencing-Data-Integrity-Plan.md` → **Phase 3**, **Data model** (the RPC's `NULLIF(log_data->>'field','')::date` makes an **absent OR empty** key resolve to NULL, and `DO UPDATE SET` then writes that NULL — so the caller must pass the value it wants preserved; this is the caller-side fix, Phase 5 is the DB backstop), **Testing philosophy**.
- `src/hooks/useMapActions.ts` — `commitUnitActivity`: how `oldStatus` is resolved, the `newLogData` object, and the existing `actual_start_date` preservation you mirror. Note the capture-time `client_timestamp` threading — don't disturb it.
- `src/hooks/useFieldData.ts` — `handleLocalUpdate` / `handleTimelineUpdate`: confirm a planned-date-only edit builds a `PendingChange` whose `extraProps` carries `startDate`/`endDate` but **no** `loggedDate`, and that the slot's current `temporal_state` (`completed`) is what flows through as `currentTemporalState`.
- `src/app/project/[projectId]/page.tsx` — `onApplyPendingChanges` (threads `extraProps` + `capturedAt` into `commitUnitActivity`) — read for the call shape; don't move logic here.
- `src/hooks/useMapActions.test.tsx` — the existing hook harness. The Phase-1/2 repros show the seeding pattern (`activities` cache + `['statuses', sheetId]` cache + `useSettingsStore`) and how to assert on the `upsert_status_log` **RPC** `log_data` payload (this phase asserts the RPC payload, NOT the bulk `.upsert`).

## Scope (build only this)
1. **Write the failing repro test first** (`useMapActions.test.tsx`): seed a `completed` slot with a real `logged_date` (e.g. `'2026-07-01'`) and, if you like, an `actual_start_date`; call `commitUnitActivity` with `currentTemporalState='completed'` and `extraProps` carrying only a planned-date change (e.g. `startDate`), **no** `loggedDate`; assert the RPC `log_data.logged_date` is **`'2026-07-01'`** (preserved), not today. It should FAIL against current code.
2. **Apply the fix** (the `logged_date` line above).
3. **Add the counter-test:** a **genuinely-new completion** (no prior status row / no prior `logged_date`) with no `loggedDate` supplied still defaults `logged_date` to **today** — so we didn't break normal completion stamping.
4. Do NOT change auto-advance (Phases 1/2, done), the RPC/DB (Phase 5), or undo internals (Phase 4).

## Preserve (do not regress)
- **Single write mechanism unchanged:** still `upsert_status_log` with **capture-time `client_timestamp`** + LWW; never `.insert()`.
- **`actual_start_date` preservation untouched** (you're mirroring it, not replacing it).
- **Offline queue / `pendingChanges` untouched.**
- **Explicit clears still work:** an edit that carries `loggedDate: ''` (explicit clear) still resolves to `null` via the `extraProps.loggedDate !== undefined` branch — don't let the preservation swallow an intentional clear.

## Guardrails
- Frontend only; no schema/RLS/backend; no migration (that's Phase 5).
- Derive types from `database.types.ts`; no `any`; JSON-serializable through the cache.
- Vitest globals OFF: import `{ describe, it, expect, vi }` from `'vitest'`.

## Exit criteria (close with `verify-feature`, then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green — the repro now passes; the genuinely-new-completion counter-test passes; existing Phase-1/2 tests still green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Confirm in the write-up: editing a planned date on a completed activity preserves its `logged_date`; a brand-new completion still stamps today when none supplied; an explicit clear (`loggedDate: ''`) still clears; auto-advance + offline queue untouched.
- Present to the owner; do NOT commit or push until the owner says "Approved." Then draft the Phase 4 kickoff (post-approval handoff ritual).
