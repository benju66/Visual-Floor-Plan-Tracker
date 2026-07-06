# Codebase Health — Slice 1: Type the Spine (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: `Notes/plans/Codebase-Health-Refactor-Master-Plan.md` (§Slice 1 + §Cross-cutting).
> This is the detailed plan the master plan defers to ("Open with /plan-phases").

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) — esp. §6 (TypeScript / JSONB /
   IDB-serialization guardrails), §2 (state: Zustand for UI, TanStack Query for server state;
   `pendingChanges` stays local), §4 (best practices; derive table types from `database.types.ts`).
2. Re-read the file named in the phase **fresh** — do not trust line numbers here; they drift.
3. Build the phases **in order** (1 → 3). Each is one fresh session.
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.
5. Close each phase with the **`verify-feature`** skill (Definition of Done → STOP). Do not
   commit/push until the owner says "Approved."

## Goal
The app's three biggest still-untyped "spine" files become fully typed TypeScript, with **zero
change to how anything behaves**. The point is to turn the compiler back on for the files that
wire the app together — starting with the project map page, which hands dozens of props into the
floor-plan canvas — so that the later canvas decomposition (Slice 2) can't silently mis-wire a
prop, and everyday edits get caught by the type-checker instead of at runtime.

When done: `page.jsx`, `StatusTable.jsx`, and `GlobalSettingsModal.jsx` are `.tsx`, compile with
zero errors and no `@ts-nocheck`/`any`, and the app looks and works exactly as before.

## Out of scope / deferred
- **Decomposing / refactoring these files.** This is a type-only conversion — no splitting,
  no logic edits, no prop-shape changes. Breaking up god files is **Slice 2** (and needs Slice 0
  Phase 0.4 first for `FloorplanCanvas`).
- **C2 — the invite-by-email consolidation.** The master plan flagged it to fold in here, but the
  **C1 audit (2026-07-05) found its premise is stale**: `project_members.user_email` now EXISTS in
  prod (invites were resolved 2026-06-19), so the "silent failure on a missing column" bug is gone.
  Slice 1 does NOT refactor invites. See §Open decisions.
- **C3 — polygon holes.** Deferred (a feature, not debt); listed only so it isn't rediscovered.
- **Adding "use client" where a file works without it.** Preserve the current boundary; only add
  a directive if the conversion genuinely needs it (see Phase 3).

## Locked decisions (from the master plan + the owner)
- **Order, one file per phase:** `page.jsx` **first** (it wires props into `FloorplanCanvas`, so
  typing it protects Slice 2) → `StatusTable.jsx` (core field UI) → `GlobalSettingsModal.jsx`.
- **Method:** rename `.jsx`→`.tsx`, fix ALL type errors, **derive table/row shapes from
  `database.types.ts`** (never hand-write a shape that duplicates a Supabase table — AGENTS §4/§6),
  **narrow JSONB at the boundary** (don't let `Json` leak into props), **no `any`** (prefer
  `unknown` + narrowing), **no `@ts-nocheck` on merge**.
- **Behavior-preserving:** the Slice 0 test net + a `dev:3010` click-through are the proof nothing
  changed. No prop renames, no data-flow edits, no logic changes.
- **Latent bugs found while typing:** fix a *small* one inline (that's the payoff of typing — e.g.
  the C1 audit's `<select value={role ?? ''}>` fix); **flag** a larger/behavior-affecting one to the
  owner rather than papering over it with a cast or silently changing behavior.
- **C1 types-drift audit is DONE (2026-07-05):** `database.types.ts` was reconciled to live
  (added `units.standard_version`; widened `profiles.email` + `project_members.role` to nullable).
  These conversions can trust the types.

## Data model
**No schema change, no migration, no new reads/writes.** These files already read/write through the
established typed hooks; the conversion only adds types over the existing data flow. The types the
conversions lean on are now accurate to live (C1). Respect the standing invariants unchanged:
status writes go only through `upsert_status_log` / the bulk `.upsert` (never `.insert()`);
`pendingChanges` stays local `useState` in `useFieldData`; never recolor `mapDisplayStatuses`.

## Build-on inventory (read these fresh before using)
REUSE — do not fork or reshape:
- **The conversion pattern:** `src/app/workbench/[sheetId]/page.tsx` + `src/app/workbench/page.tsx`
  are the already-typed App-Router pages to model `page.tsx` on.
- **The typed hooks each file consumes** (their returns are the source of truth for prop types —
  derive from them, don't re-declare):
  - `page.jsx`: `useMapActions`, `useProjectActions`, `useProject`/`useSheets`/`useActivities`/
    `useUnits`/`useStatuses`/`useCurrentUserRole`/`useSnappingVectors`/`useActivityOverrides`,
    `useSubtypes`, plus the typed Zustand stores (`useMapStore`/`useUIStore`/`useSettingsStore`).
  - `StatusTable.jsx`: `useFieldData`'s return (the `visible: { unit, log }[]`, `pendingChanges`,
    sort state, and handler signatures are all documented in the file's own JSDoc header — start
    there) + `Unit`/`StatusLog` from `src/types/domain.ts`.
  - `GlobalSettingsModal.jsx`: `useProjectQueries` member/role hooks + `MemberWithProfile`,
    `Profile`/`ProjectMember` from `domain.ts`, `useAuth`.
- **The Slice 0 safety net (your regression proof):** `src/test/renderWithQuery.tsx` harness +
  the seam tests that already cover these files indirectly —
  - `page.jsx` → `useMapActions.test.tsx` + `UnitNamingPopover.test.tsx` (map draw→name→save).
  - `StatusTable.jsx` → `useFieldData.test.tsx` + `useProjectQueries.test.tsx`.
  - `GlobalSettingsModal.jsx` → `useProjectQueries.test.tsx` (member/role hooks). **Least-covered
    directly → its check leans hardest on the live `dev:3010` smoke.**
- `src/types/domain.ts` (derive `Unit`, `StatusLog`, `Profile`, `ProjectMember`, …) + the JSONB
  guards (`isPercentPointArray`, etc.) for boundary narrowing.

Do **NOT** fork: `progressAnalytics`/`bottleneck` math, the established Query hooks, the stores.

## Pure logic to extract + unit-test
These are UI files, so extraction is **opportunistic, not forced** (AGENTS §9 — don't manufacture a
module). If a conversion surfaces a chunk of genuinely framework-free logic (e.g. a sort
comparator, a filter/derive, a label-formatter currently inlined in the component), lift it to
`src/utils/<name>.ts` + co-located `.test.ts` and import it back — but only if it's non-trivial and
load-bearing. Never call `Date.now()` inside such a fn (pass timestamps in). Do not gold-plate.

## Sub-phasing (ship + verify each)

> No migrations anywhere. Each phase is one fresh session, one file. No approval gates beyond the
> standard commit/push gate (nothing here touches DB/RLS/the offline queue).

### Phase 1 — `page.jsx → page.tsx` (the wiring hub)
- **Plain-English:** type the project map page — the hub that passes everything into the floor-plan
  canvas — so a mis-wired prop becomes a compile error. Nothing the user sees changes.
- **Scope:** rename `src/app/project/[projectId]/page.jsx` → `page.tsx`; fix all type errors. Main
  hazards: local `useState`/`useRef` (mostly primitives), the **sidebar-resize DOM handlers**
  (`isResizingRef` + mouse events — type the events, no `any`), and the **large prop-threading into
  `FloorplanCanvas`/`FieldStatusTable`/`SettingsMenu`/modals** (this is the payoff — mismatches vs.
  those components' prop interfaces surface here). Store selectors + hook returns are already typed.
- **Precursor:** C1 done — trust `database.types.ts`.
- **Exit criteria:** typecheck + test + build green · `dev:3010`: the map page loads and behaves
  identically (units render; draw/stamp/select tools; naming popover saves; sidebar resize; view
  switching; settings/legend) · close with `verify-feature`.

### Phase 2 — `StatusTable.jsx → StatusTable.tsx` (core field UI)
- **Plain-English:** type the desktop field-status table (the list where you set each location's
  progress). Behavior identical.
- **Scope:** rename → fix errors. Define a `StatusTableProps` interface — **the file's JSDoc header
  already documents every prop** (`visible: { unit, log }[]`, `pendingChanges`, `handleLocalUpdate`,
  sort state, selection setters, `onChooseStatus`); derive the shapes from `useFieldData`'s return +
  `Unit`/`StatusLog` rather than re-inventing them. Type `lastClickedIndex` (Shift+Click context)
  and the sort/select derivations. Watch for implicit `any` on `.map(...)`/event handlers.
- **Exit criteria:** typecheck + test + build green · `dev:3010`: the field table renders, sorts,
  multi-selects (Shift+Click), and status edits save + sync exactly as before · `verify-feature`.

### Phase 3 — `GlobalSettingsModal.jsx → GlobalSettingsModal.tsx` (least test-covered)
- **Plain-English:** type the global settings modal (cross-project team management, Location/Activity/
  Cost-Code libraries, admin project delete, AI-training toggle). Behavior identical.
- **Scope:** rename → fix errors. Main hazard: **loosely-initialised `useState`** that infers
  `null`/`{}` and needs explicit type params — `targetUser` (`{ id, display_name, email } | null`),
  `assignments` (`Record<string, …>`), `saveStatus`/`projectStatus` (`{ type, message }`),
  `confirmProject` (a project shape), `trainingOverrides` (`Record<string, boolean>`). Derive the
  member/profile shapes from `MemberWithProfile`/`Profile`. Because there's **no direct test**, the
  live `dev:3010` smoke is the primary proof — exercise: open the modal, each tab, member search +
  role change, and the project-delete type-to-confirm guard (⚠️ do NOT actually delete a real
  project — verify the guard arms, then cancel).
- **`use client`:** the file currently has no directive and works via its client parent — **preserve
  that**; only add `"use client"` if the conversion/runtime actually requires it.
- **C2 note:** this is the invite/team surface. Do **not** refactor invites here (premise stale —
  §Open decisions); type it as-is.
- **Exit criteria:** typecheck + test + build green · `dev:3010` smoke (above) · `verify-feature`.

## Hard guardrails (AGENTS.md — do not violate)
- **No schema/RLS/queue change; no migration.** Type-layer + file renames only.
- **Behavior-preserving:** no prop renames, no logic edits, no data-flow changes. If typing tempts a
  refactor, resist — that's Slice 2.
- **Derive types from `database.types.ts`**; **narrow JSONB at the boundary**; **no `any`**, **no
  `@ts-nocheck`** on merge (AGENTS §6). New `.tsx`; fix all errors before committing.
- Status writes stay on `upsert_status_log` / bulk `.upsert` (never `.insert()`); `pendingChanges`
  stays local `useState`; never recolor `mapDisplayStatuses`; keep `RBush`/`Map`/`Set`/class
  instances out of Query/IDB state.
- **Vitest globals OFF** — import `{ describe, it, expect, vi }` from `'vitest'`; co-locate any new
  `*.test.ts`; keep test files type-clean. **Lint is NOT a gate.**

## Verification commands (exit-criteria gate)
Run npm with an absolute prefix (Bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- **Lint is NOT a gate** (~1850 pre-existing problems); verify with typecheck + test + build.
- **No E2E** — UI verified via `npm run dev:3010` (port 3010). ⚠️ a `next build` corrupts a running
  `dev:3010` → restart via `scripts/restart-dev.ps1`.

## Open decisions
- **C2 — invite-by-email (resolve when Phase 3 lands, or sooner if you like).** The C1 audit showed
  `project_members.user_email` now exists in prod, so C2's "silent failure" premise is **stale** and
  invites were resolved 2026-06-19. **Recommendation:** keep Slice 1 to pure type conversions and do
  NOT fold an invite refactor in. If you want certainty, I'll **verify the invite flow end-to-end**
  as a small separate check; only if it's actually broken do we consider the code-only consolidation
  onto the `user_id` path (no migration) as its own task. Default = leave invites untouched.
- **Post-Slice-1 sequencing:** per the owner's 2026-07-04 resequencing, after Slice 1 comes **Slice 0
  Phase 0.4** (FloorplanCanvas characterization "golden master") → **Slice 2** (decompose
  FloorplanCanvas). 0.4 gates only Slice 2, so Slice 1 → 0.4 → Slice 2 is valid.
