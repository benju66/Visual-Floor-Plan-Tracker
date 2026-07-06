# Kickoff — Codebase Health, Slice 1 Phase 2: type the field table (`StatusTable.jsx → StatusTable.tsx`)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Codebase Health Slice 1** (convert
> `src/components/StatusTable.jsx → StatusTable.tsx`, **behavior-preserving** — no runtime change).
> It's the desktop field-status table (the list where each location's progress is set), the core
> field UI. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-05 - Codebase Health Slice 1 Phase 2 (StatusTable) Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Codebase-Health-Slice-1-Type-Spine-Plan.md` (Phase 2 + guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §6 TypeScript guardrails, §2 state/data-fetching, §3 Container/Presenter)
>
> Branch off `main`. Build **only Phase 2**. Rename + fix all type errors; define a `StatusTableProps`
> interface derived from `useFieldData`'s return + `Unit`/`StatusLog` (the file's JSDoc header already
> documents every prop — start there); no hand-written table shapes, no `any`, no `@ts-nocheck`. The
> Slice 0 test net + a `dev:3010` click-through are the proof it still behaves. Don't commit or push
> until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
`StatusTable` is the desktop list where the field team sets each location's status. It's still untyped
JavaScript. Converting it to TypeScript turns the compiler on for the field-editing surface, so a
future change can't silently feed it the wrong data or drop a handler. Nothing the user sees changes —
same table, same sorting, same Shift-click multi-select, same save-and-sync.

## Where this sits
Codebase Health → **Slice 1 (type the spine)**, **Phase 2 of 3**: `page.jsx → page.tsx` (**DONE**) →
`StatusTable.jsx` (this) → `GlobalSettingsModal.jsx`. Plan-of-record:
`Notes/plans/Codebase-Health-Slice-1-Type-Spine-Plan.md`. The **C1 types-drift audit is already
committed** (reconciled `database.types.ts` to live), so trust the types.

## What Phase 1 already settled (build on it, don't re-litigate)
- **`page.tsx` is typed and on this branch's lineage** — the map page now hands `StatusTable`'s
  container (`FieldStatusTable`) a fully-typed prop set.
- **`onChooseStatus` is settled as the desktop contract `(unit: Unit, onSelect: (m: Partial<Activity>) => void) => void`.**
  Phase 1 reconciled it across `FieldStatusTable` + `MobileSwipeDeck` (it used to be mis-typed with the
  mobile arg-shape). `StatusTable` forwards `onChooseStatus` straight to `StatusTrigger` (which already
  declares that exact shape) — so type `StatusTableProps.onChooseStatus` to match `StatusTrigger`, and
  it lines up with no cast. **Do not reintroduce the old `(unitId, activityName, state, track)` shape.**
- `useUIStore.activityMenu` is now a discriminated union `ActivityMenuState`; `MapSidebar.temporalFilters`
  is `TemporalState[]`. Lean on these — don't re-declare.

## Scope — build exactly this
1. **Rename** `src/components/StatusTable.jsx → StatusTable.tsx`; fix **all** type errors.
2. Define a **`StatusTableProps`** interface. The file's **JSDoc header already documents every prop** —
   start there. Derive the shapes from `useFieldData`'s return (`src/hooks/useFieldData.ts`) +
   `Unit`/`StatusLog` from `domain.ts`; never hand-write a table/row shape.
   - Known props (from the JSDoc): `visible: { unit, log }[]`, `pendingChanges`, `handleLocalUpdate`,
     the **sort state** (column + direction + `handleSort`), the **selection setters** + `lastClickedIndex`
     (the Shift-click range-select context), and `onChooseStatus` (desktop shape above).
3. Type the hazards: `lastClickedIndex` (Shift+Click range math), the sort/select derivations, and any
   implicit `any` on `.map(...)` / event handlers (row clicks, checkbox change, sort-header click).
4. **Narrow JSONB at the boundary** if any leaks in (unlikely here — it consumes already-typed hook
   output); no `any`, no `@ts-nocheck`.
5. **Behavior unchanged** — type-only. No logic, prop, or data-flow edits (that's Slice 2).

## Seams to mind
- **Container/Presenter (AGENTS §3):** `FieldStatusTable` (container) calls `useFieldData` and renders
  `StatusTable` (desktop) or `MobileSwipeDeck` (mobile). `useFieldData`'s **return is the source of
  truth** — derive prop types from it; if it's loosely typed, tighten it **at the hook**, not with a cast.
- The `visible` array elements (`{ unit, log }`) come straight from `useFieldData`. Type them off its
  return so a shape drift can't slip through.
- Shared UI atoms live in `src/components/ui/FieldStatusAtoms.tsx` and `StatusTrigger.tsx` (already typed) —
  reuse their types; don't fork.
- If typing surfaces a genuine latent bug, **surface it** — fix a small one inline; flag a
  behavior-affecting one to the owner. (Observation from Phase 1: `SwipeCard` receives an `onChooseStatus`
  callback it never calls — the mobile popup path is currently unused. Not this phase; noted so it isn't
  rediscovered as a bug.)

## Hard guardrails (AGENTS.md — do not violate)
- **No DB/RLS/schema/queue change; no migration.** One file rename + types only.
- Derive types from `database.types.ts` / `domain.ts`; narrow JSONB at the boundary (§6); no
  `any`/`@ts-nocheck`.
- Status writes stay on `upsert_status_log` / bulk `.upsert`; `pendingChanges` stays local `useState`
  in `useFieldData`; never recolor `mapDisplayStatuses` (§2/§3).
- **Vitest globals OFF**; **Lint is NOT a gate** — verify with typecheck + test + build.

## Exit criteria (Definition of Done → then STOP)
- `StatusTable.tsx` compiles with **zero** errors; no `@ts-nocheck`, no new `any`.
- `typecheck` + `test` + `build` all green (commands below).
- **Live `dev:3010`:** the field table renders, **sorts** (click headers), **multi-selects (Shift+Click
  range)**, and status edits **save + sync** exactly as before; N/A toggle + row locate unchanged.
  (Read-through smoke; if you must write a row, use the "Test" project and clean up — [[no-live-write-probes]].
  ⚠️ dev build points at the PROD database.)
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Lint is NOT a gate. ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1`.

## Next after this
Phase 3 (`GlobalSettingsModal.jsx → GlobalSettingsModal.tsx`, least test-covered — the C2 invite
decision surfaces there but its premise is stale; type as-is) → then Slice 0 P0.4 (canvas golden
master). Draft the Phase 3 kickoff after this is Approved, per the post-approval handoff ritual.
