# Codebase Health & Refactor — restore feature velocity by making change safe (master plan / roadmap)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: none. Absorbs the safety pieces of `Notes/plans/Robustness-Trust-Hardening-Plan.md`
> (wiring guard, wiring tests, dev-DB guard) into Slice 0; leaves that plan's save-status
> **badge** (its one product feature) as an independent nicety.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) in full.
2. This is a **master roadmap**, like `Notes/plans/Scheduling-Activities-Master-Plan.md`. It
   sequences three slices + cross-cutting cleanups. **Slice 0 is spec'd in build-ready detail
   here.** Slices 1–2 are roadmap-level; open each with `/plan-phases` for its own detailed
   plan when it comes up (don't pre-write them — the code will have moved).
3. Re-read every file named below **fresh** — do not trust line numbers; they drift.
4. Build in order. Verify after each phase (§ Verification commands). Close each phase with the
   `verify-feature` skill (Definition of Done → stop; don't commit/push until the owner says
   "Approved").
5. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence
   plain-English summary; explain jargon in passing; keep it short.

## Goal
When this workstream is done, **changing the app is fast and safe again.** Today feature work is
slowing because three things compound: a few oversized "god files," an almost-untested
integration layer (so every change is hand-verified in the browser), and a half-finished
JavaScript→TypeScript migration that left the app's most central files with **no compiler
checking at all**. This plan fixes the *ability to change safely* first (an automated test net),
then turns the compiler back on for the spine (finish the migration on the central files), then
breaks up the god files — each step **behavior-preserving and verified by the net built in
Slice 0**. No user-visible feature changes; the payoff is that the *next* features ship faster
and with fewer silent regressions.

## Why now (the measured diagnosis — 2026-07-03 survey)
- **God files:** `FloorplanCanvas.tsx` 2,704 · `useProjectQueries.ts` 1,503 · `SettingsMenu.tsx`
  1,230 · `LookAhead.tsx` 1,092 · `useWorkbenchActions.ts` 941 · `page.jsx` 807.
- **Integration layer ~untested:** 70 test files, but **58 are on pure-logic utils**; only
  **6 of 88 components** and **1 of ~40 hooks** have any test. The data-layer spine
  (`useProjectQueries`/`useMapActions`/`useWorkbenchActions`/`useFieldData`) is unverified.
- **Migration stalled on the worst files:** 21 files / 4,053 lines are still `.jsx`/`.js`, and
  because `tsconfig` sets `checkJs:false`, **none are typechecked.** The central ones are exactly
  the stragglers: `page.jsx` (807 — the wiring hub that passes props *into* FloorplanCanvas),
  `StatusTable.jsx` (626 — core field UI), `GlobalSettingsModal.jsx` (719).
- **Debt is structural, not rot:** 0 `@ts-nocheck`, 0 TODO/FIXME, 9 eslint-disables. The code is
  clean; it's just big, under-tested at the seams, and half-typed.

## Out of scope / deferred
- **No new user-facing features.** Every change here is behavior-preserving.
- **No DB migrations / RLS / auth changes.** This is presentation-, type-, and test-layer only.
  (The one exception — an *optional* additive column for the invite-by-email backlog bug — is
  gated and may be skipped in favour of the code-only fix; see Cross-cutting.)
- **The save-status badge** (Robustness plan Phase 2) — a real trust nicety, but it's a *feature*,
  not refactor safety. Ship it independently whenever; not sequenced here.
- **Polygon-holes geometry** (`Backlog.md` #2) — a deferred *feature*, not debt. Stays deferred.
- **`LookAhead.tsx` / `useWorkbenchActions.ts` decomposition** — real but lower urgency; revisit
  after Slice 2's first three targets land.
- **Full browser E2E coverage** — Slice 0 plans at most a *thin smoke* layer (owner-gated),
  never a full E2E suite.
- **Backend (`sitepulse-backend`) test expansion** — separate track; auth path already seeded.

## Locked product decisions (from the owner)
- **Testing is its own foundation (Slice 0), done first.** It is the prerequisite that makes the
  migration and decomposition safe. Confirmed in the 2026-07-03 planning chat.
- **Refactors are behavior-preserving**, proven by the Slice 0 net — not "improve while you're in
  there." Behavior changes are separate, later, deliberate work.
- **Sequence:** Slice 0 (test net) → Slice 1 (type the spine) → Slice 2 (decompose god files),
  with cross-cutting cleanups folded in early where cheap.

## Data model
**No schema changes in Slices 0–2.** The test net only READS React Query mutation state
(`isPending`/`isError`/`isSuccess`) and the offline-queue signals it already exposes; it writes
nothing new and must not touch the `status_logs` `UNIQUE(unit_id, activity_id)` path, the
`upsert_status_log` RPC, `pendingChanges`, or the IDB mutation queue. The only *possible* DDL in
the whole workstream is the optional, gated `project_members.user_email` column for the
invite-by-email backlog bug (Cross-cutting C2) — and the code-only alternative avoids even that.

## Build-on inventory (read these fresh before using)
Test harness (exists, minimal — extend, don't replace):
- `vitest.config.ts` / `vitest.setup.ts` — jsdom env, `@/*` alias, **globals OFF**,
  `@testing-library/jest-dom/vitest` loaded. Installed: `vitest ^4`, `@testing-library/react ^16`,
  `@testing-library/user-event ^14`, `jsdom`. **NOT installed:** `msw`, `@playwright/test`.
- `src/hooks/useSnappingVectors.test.tsx` — the ONE existing hook test; mirror its mocking style
  (`vi.mock('@/supabaseClient')`, stub `RBush` as `{ search: () => items } as never`).
- `src/components/dashboard/*.test.tsx`, `TaxonomyPicker.test.tsx`, `UnitHistoryModal.test.tsx`
  — the existing component-test patterns to mirror (do not invent a new one).

Files under test / refactor (REUSE, do not fork their logic):
- `src/components/FloorplanCanvas.tsx` — the shared canvas (map + workbench). Single geometry
  persist callback `onUpdateUnitPolygon` (node move / whole-drag / arrow-nudge / flip / rotate),
  plus `onPolygonComplete`, `onPendingPolygonMove`, `onInstantStamp`. Characterize these before
  touching them.
- `src/hooks/useProjectQueries.ts`, `useMapActions.ts`, `useWorkbenchActions.ts`,
  `useFieldData.ts` — the data-layer spine.
- `src/app/project/[projectId]/page.jsx`, `src/components/StatusTable.jsx`,
  `src/components/GlobalSettingsModal.jsx` — the JS stragglers to type.
- `src/utils/progressAnalytics.ts`, the bottleneck math, `mixAlpha`/geometry utils — **NEVER
  fork** (AGENTS.md §3). Refactors move code, never re-implement this math.

## Pure logic to extract + unit-test
Framework-free helpers already named by the absorbed Robustness plan (build in Slice 0):
- `src/utils/wiringGuard.ts` — `warnIfUnwired(cb, actionName) → boolean` (dev-only loud console
  error when an interactive write fires with a null handler; no-op in prod).
- `src/utils/devDbGuard.ts` — `isLocalDevOnProdDb({ nodeEnv, supabaseUrl, prodRef }) → boolean`
  (pass env IN; no global reads inside).
- As Slice 2 decomposes the god files, **extract pure geometry/derivation helpers into
  `src/utils/*` with co-located tests** — that's the durable win of the refactor (testable logic
  out of the giant components), and it must not call `Date.now()` inside (pass timestamps IN).

---

## SLICE 0 — Test & Safety Foundation (build-ready)
> The net that makes Slices 1–2 safe. No product behavior changes. Absorbs Robustness P1/P3/P4.

### Phase 0.1 — Test harness + dev guards
- **Scope:** Add the reusable integration-test infrastructure every later test leans on:
  a `renderWithQuery(ui)` helper (wraps a fresh `QueryClient` + provider) and a documented
  Supabase-mock recipe (mirror `useSnappingVectors.test.tsx` — `vi.mock('@/supabaseClient')`;
  do NOT add `msw`). Add `src/utils/wiringGuard.ts` + `devDbGuard.ts` (+ tests), wire the dev
  wiring-guard at the `FloorplanCanvas` write-callback call sites (wrap existing calls only —
  no restructuring), and render the dev-only "you're on PRODUCTION data" banner. Document the
  harness in AGENTS.md §9.
- **Approval gates:** none (no DB/RLS/queue change). Standard: no commit/push until "Approved".
- **Exit criteria:** typecheck + test + build green · `wiringGuard`/`devDbGuard` unit-tested
  (warn in dev, silent/absent in prod) · `dev:3010`: normal edits do NOT warn; the prod-DB
  banner shows against prod and not in a production build · `verify-feature` → stop.

### Phase 0.2 — Hook contract tests (the data-layer spine)
- **Scope:** Contract tests for `useProjectQueries`, `useMapActions`, `useWorkbenchActions`,
  `useFieldData` using the Phase 0.1 harness. Assert the *contract*, not implementation: queries
  return the narrowed shapes callers expect; mutations fire the right Supabase call with the
  right payload (e.g. status writes go through the `upsert`/`upsert_status_log` path, never
  `.insert()`; `client_timestamp` is capture-time); `useFieldData` stages `pendingChanges`
  locally and feeds `handleApplyAll` in order. These pin AGENTS.md §2 invariants as executable
  tests.
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · each spine hook has a contract test ·
  reverting a §2 invariant (e.g. swapping upsert→insert) makes a test fail · `verify-feature`.

### Phase 0.3 — Wiring / regression tests (pin the known bugs + save seams)
- **Scope:** The absorbed Robustness P3 content: regression tests pinning the two 2026-06-29
  polygon bugs (`useMapActions` returns `pendingPolygonPoints`/setter and
  `handlePolygonComplete` sets them; `WorkbenchTracer` passes a defined `onUpdateUnitPolygon`
  and a simulated node move calls `useUpdateWorkbenchGeometry` with the new points) + seam
  coverage for draw→name→save on both surfaces.
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · the new tests FAIL if either fix is
  reverted (prove they're real guards) · `verify-feature`.

### Phase 0.4 — FloorplanCanvas characterization tests ("golden master")
- **Scope:** Before Slice 2 touches the canvas, capture its **current behavioral contract** as
  tests: for each interactive gesture (node move, whole-polygon drag, arrow-nudge, flip, rotate,
  polygon-complete, stamp), assert *which* callback fires and *with what arguments* against the
  code as it is today. These aren't "correct behavior" claims — they're a tripwire so the
  decomposition can't silently change behavior. Note in the test file that jsdom has no real
  canvas, so these assert handler wiring/args, not pixel output (that gap is what an optional
  Playwright smoke would cover — Phase 0.5).
- **Approval gates:** none.
- **Exit criteria:** typecheck + test + build green · every FloorplanCanvas write gesture has a
  characterization test · `verify-feature`. **This phase is the gate for starting Slice 2.**

### Phase 0.5 — (OPTIONAL, ⛔ owner-gated) Playwright smoke on 3 critical flows
- **Plain-English:** jsdom can't drive the real drawing canvas, so RTL can't prove a *visual*
  canvas regression didn't happen. A tiny real-browser smoke test on the 2–3 flows that matter
  most would catch what RTL can't — at the cost of a new tool + occasional flakiness.
- **Scope (only if the owner says go):** add `@playwright/test`; smoke-cover exactly three happy
  paths — open project → trace a location → it persists after refresh; set a status → it
  persists; open the workbench → move a node → it saves. No broad E2E suite.
- **Approval gates:** ⛔ **explicit owner go before adding the dependency** (the owner previously
  deferred Playwright — do not add it unprompted).
- **Exit criteria:** if built — the 3 smokes pass locally and fail if the underlying save path is
  broken · `verify-feature`. If skipped — record the decision and move on.

---

## SLICE 1 — Type the spine (finish JS→TS on the central files)
> Turn the compiler back on for the app's most load-bearing untyped files. One file per phase,
> behavior-preserving, guarded by the Slice 0 net. Open with `/plan-phases` for the detailed plan.
- **Order (each its own phase):**
  1. `page.jsx → page.tsx` — **first**, because it wires props *into* FloorplanCanvas; typing it
     means the Slice 2 canvas refactor can't silently mis-wire a prop.
  2. `StatusTable.jsx → StatusTable.tsx` — core field UI.
  3. `GlobalSettingsModal.jsx → GlobalSettingsModal.tsx`.
- **Method:** rename, fix all type errors, derive any table shapes from `database.types.ts` (never
  hand-write), narrow JSONB at the boundary, no `@ts-nocheck` on merge (AGENTS.md §6). Behavior
  unchanged; the Slice 0 tests + a `dev:3010` click-through are the proof.
- **Approval gates:** none (no DB/queue). Each phase closes with `verify-feature`.

## SLICE 2 — Decompose the god files
> Break the oversized files into focused pieces + extracted, tested pure helpers. Behavior-
> preserving, proven by Slice 0 (esp. 0.4). Open each target with `/plan-phases`; each target is
> itself several phases.
- **Order:** `FloorplanCanvas.tsx` (2,704 — biggest, most central; **requires Phase 0.4 done
  first**) → `useProjectQueries.ts` (1,503 — every view depends on it) → `SettingsMenu.tsx`
  (1,230). **Re-evaluate after FloorplanCanvas** — decomposition is high-effort and can hit
  diminishing returns; the master plan does not commit to all three blindly.
- **Method:** extract cohesive sub-components / sub-hooks and **pure logic into `src/utils/*`
  with co-located tests**; keep the public prop/return surface identical; never fork
  `progressAnalytics` or the bottleneck math; keep `RBush`/`Map`/`Set` out of Query/IDB state.
- **Approval gates:** none DB-wise; the gate is that Slice 0's net (esp. characterization tests)
  is green before and after each extraction.

## Cross-cutting cleanups (fold in early where cheap)
- **C1 — `database.types.ts` drift audit.** The file is hand-maintained and has drifted from the
  live schema before (caused real prod bugs; see `Backlog.md` #1 and memory). Regenerate/diff it
  against live and reconcile **before Slice 1** (typing the spine trusts these types). Read-only
  audit + type edits; no DDL.
- **C2 — Invite-by-email prod bug (`Backlog.md` #1).** `SettingsMenu` invite writes
  `project_members.user_email`, a column that doesn't exist in prod → silent runtime failure.
  This is a *user-facing bug*, not debt. Natural to fix during Slice 1's `StatusTable`/settings
  work or standalone. **Open decision (resolve in-phase):** (a) code-only — consolidate on the
  working `user_id` invite path (no migration; recommended, keeps one mechanism) vs. (b) add the
  column (⛔ additive migration + link-on-signup logic). Recommend (a).
- **C3 — Polygon-holes (`Backlog.md` #2).** Stays deferred (a feature, not debt). Listed only so
  it isn't rediscovered as "debt."

## Hard guardrails (AGENTS.md — do not violate)
- **Read-only w.r.t. the sync engine:** never change the offline mutation queue, `pendingChanges`
  (stays local `useState` in `useFieldData.ts`), the `upsert_status_log`/upsert-only status
  writes (never `.insert()`), or capture-time `client_timestamp`. Tests READ this state; refactors
  MOVE code without altering these paths.
- **Do not recolor `mapDisplayStatuses`** or write to `status_logs.status_color`.
- **Never fork `progressAnalytics` / bottleneck math** — respect applicability (N/A slots).
- **No class instances in Query/IDB state** (`RBush`/`Map`/`Set`) — keeps IDB serialization safe.
- **Derive types from `database.types.ts`; narrow JSONB at the boundary; no `any`, no `@ts-nocheck`
  on merge** (AGENTS.md §6).
- **RLS/auth untouched** — no `SECURITY DEFINER` flips, no `anon` grants.
- **Behavior-preserving:** if a refactor would change what the user sees, stop — that's a separate,
  deliberate change, not part of this workstream.

## Verification commands (the exit-criteria gate)
Run npm with an absolute prefix (Bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Target one file: `... run test -- src/utils/wiringGuard.test.ts`. **Lint is NOT a gate** (~1850
pre-existing problems). No E2E framework yet (unless Phase 0.5 adds the smoke) — UI/canvas is
verified by a live click-through via `npm run dev:3010` (port 3010, not 3000). Vitest globals are
OFF: import `{ describe, it, expect, vi }` from `'vitest'`; co-locate `foo.test.ts`.

## Open decisions
- **Phase 0.5 Playwright smoke** — build the thin 3-flow smoke, or stay RTL-only + manual?
  Recommend: default deferred; add it only if Slice 2's canvas refactor feels risky. ⛔ owner go.
- **Slice 2 breadth** — commit to all three god files, or re-evaluate after FloorplanCanvas?
  Recommend: re-evaluate after the first target.
- **C2 invite fix** — code-only consolidation (recommended) vs. additive column. Resolve in the
  phase that picks it up.
