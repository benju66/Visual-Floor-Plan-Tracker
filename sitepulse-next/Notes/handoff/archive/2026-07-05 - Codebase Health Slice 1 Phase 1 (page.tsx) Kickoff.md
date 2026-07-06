# Kickoff — Codebase Health, Slice 1 Phase 1: type the spine (`page.jsx → page.tsx`)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Codebase Health Slice 1** (convert `src/app/project/[projectId]/page.jsx`
> → `page.tsx`, **behavior-preserving** — no runtime change). It's the wiring hub that passes props
> *into* `FloorplanCanvas`, so typing it first stops the later canvas decomposition from silently
> mis-wiring a prop. Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-05 - Codebase Health Slice 1 Phase 1 (page.tsx) Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Codebase-Health-Slice-1-Type-Spine-Plan.md` (Phase 1 + guardrails)
> - `sitepulse-next/AGENTS.md` (esp. §6 TypeScript guardrails, §2 state/data-fetching)
>
> Branch off `main`. Build **only Phase 1**. Rename + fix all type errors; derive table shapes from
> `database.types.ts` (never hand-write), narrow JSONB at the boundary, **no `any`, no `@ts-nocheck`**.
> The Slice 0 test net + a `dev:3010` click-through are the proof it still behaves. Don't commit or
> push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
The map page is one of the last big untyped (`.jsx`) files, and it's the **hub that wires
everything into the floor-plan canvas**. Converting it to TypeScript turns the compiler back on for
that wiring, so a future refactor can't quietly hand the canvas the wrong prop. Nothing the user
sees should change — this is a safety/maintainability move, not a feature.

## Where this sits
Codebase Health → **Slice 1 (type the spine)**, **Phase 1 of 3**: `page.jsx → page.tsx` (this) →
`StatusTable.jsx` → `GlobalSettingsModal.jsx`. The plan-of-record is
`Notes/plans/Codebase-Health-Slice-1-Type-Spine-Plan.md` — read it. The **C1 types-drift audit is
already done** (2026-07-05): `database.types.ts` was reconciled to live, so trust it.

## The safety net you're standing on (Slice 0 — already on main)
- `src/test/renderWithQuery.tsx` (fresh QueryClient + Supabase-mock recipe) is the harness.
- `page.jsx`'s data flow is pinned by `useMapActions.test.tsx` + `UnitNamingPopover.test.tsx`
  (the map draw→name→save seam drives the same `useMapActions` return this page wires). Keep them
  green — they're your regression proof that the conversion changed nothing.
- Dev guards `warnIfUnwired` / `DevDbBanner` are already in place; don't touch them.

## Scope — build exactly this
1. **Rename** `src/app/project/[projectId]/page.jsx` → `page.tsx`; fix **all** type errors.
2. Type the hazards (in rough order of effort):
   - **Prop-threading into children** (`FloorplanCanvas`, `FieldStatusTable`, `SettingsMenu`,
     `MapHorizontalToolbar`, the modals) — mismatches vs. their prop interfaces surface here.
     **This is the whole point; if a prop the child expects is never passed, surface it — don't
     cast it away.**
   - **Sidebar-resize DOM handlers** (`isResizingRef` + mouse `move`/`up` events) — type the events.
   - Local `useState`/`useRef` (mostly primitives) and `.map(...)` callbacks — no implicit `any`.
   - Store selectors + hook returns are **already typed** — lean on them, don't re-declare shapes.
3. Derive any table/row shapes from `database.types.ts` / `domain.ts`; **narrow JSONB at the
   boundary** (`polygon_coordinates` via `isPercentPointArray`, etc.). **No `any`, no `@ts-nocheck`.**
4. **Behavior unchanged** — type-only. No logic, prop, or data-flow edits (that's Slice 2).

## Seams to mind
- The page destructures large hook returns (`useMapActions`, `useProjectActions`, the query hooks)
  and threads them into `FloorplanCanvas`. Type the **hook returns** first (source of truth); the
  props then line up. If a hook return is loosely typed, tighten it **at the hook**, not with a cast.
- If typing surfaces a genuine latent bug (a prop the canvas expects but the page never passes, or a
  possibly-null value used as non-null), **surface it** — that's exactly what this catches. Fix a
  small one inline; flag a behavior-affecting one to the owner.
- **C2 (invite-by-email) is NOT this phase** — its premise is stale (see the plan). Ignore it here.

## Hard guardrails (AGENTS.md — do not violate)
- **No DB/RLS/schema/queue change; no migration.** One file rename + types only.
- Derive types from `database.types.ts`; narrow JSONB at the query boundary (§6); no `any`/`@ts-nocheck`.
- Status writes stay on `upsert_status_log`/bulk `.upsert`; `pendingChanges` stays local; never
  recolor `mapDisplayStatuses`; keep `RBush`/`Map`/`Set` out of Query/IDB state (§2/§5/§6).
- **Vitest globals OFF**; **Lint is NOT a gate** — verify with typecheck + test + build.

## Exit criteria (Definition of Done → then STOP)
- `page.tsx` compiles with **zero** errors; no `@ts-nocheck`, no new `any`.
- `typecheck` + `test` + `build` all green (commands below).
- **Live `dev:3010`:** the map page loads and behaves identically — units render; draw/stamp/select
  tools work; naming popover saves; sidebar resize; view switching; settings/legend unchanged.
  (Read-through smoke; if you must write a row, use the "Test" project and clean up — [[no-live-write-probes]].)
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
Phase 2 (`StatusTable.jsx → StatusTable.tsx`) → Phase 3 (`GlobalSettingsModal.jsx →
GlobalSettingsModal.tsx`, where the C2 decision surfaces) → then Slice 0 P0.4. Draft the Phase 2
kickoff after this is Approved, per the post-approval handoff ritual.
