# JS→TS Migration — convert the 16 remaining untyped files, zero behavior change (self-contained build plan)
> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Parent spec: W2 of the 2026-07-15 code review backlog. Companion skill: `.agent/skills/js-to-ts-conversion/SKILL.md` — READ IT before converting anything; it is the per-file procedure this plan sequences.

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (§6 TypeScript Guardrails is the load-bearing section) + the js-to-ts-conversion skill.
2. Re-read the files named below fresh — do not trust line numbers; they drift.
3. Build the sub-phases in order. Verify after each slice (§ verify).
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2 sentence plain-English summary; explain jargon in passing; keep it short.

## Goal
Every remaining JavaScript file in the frontend (except one, deliberately deferred — see below) becomes strict TypeScript, so the compiler checks the seams that today are unchecked: the login/session context, the quick-edit popups, the naming popover, the dashboard, and two server routes. For the owner nothing looks or behaves differently; the payoff is that a whole class of "silently passed the wrong thing" bugs becomes impossible, and seven explicit type-system escape hatches (casts) in already-typed code get deleted.

## Out of scope / deferred
- **`src/providers/QueryProvider.jsx` — deliberately NOT in W2.** It surgically rewrites the offline cache and needs the cache-shape types that W3's `useProjectQueries` domain split will give a clean home. It converts at the END of W3. Do not touch it here.
- Any behavior change. Conversions only. A bug or smell discovered mid-conversion gets FLAGGED in the phase report, not silently fixed (skill Step 4). The two known compile-forced edits (listed per-phase) are the only sanctioned code changes.
- Renaming misnomers (e.g. QuickActivityModal's `selectedActivityId` actually holds a NAME) — type them honestly (`string`), flag the naming for W3.
- W3 refactors (queryKeys sweep, file splits) — nothing moves between files here.

## Locked product decisions (from the owner)
- Grouping approved 2026-07-15/17: original batches 1+2 merge into Phase 1; batch 3 splits into Phases 2–3; batch 4 = the two small API routes fold into Phase 3, QueryProvider defers to W3.
- Zero behavior change; flag-don't-fix; no `@ts-nocheck` reaches main (skill gate).

## Data model
No schema changes. Conversions must DERIVE all Supabase row shapes from `src/types/database.types.ts` via `src/types/domain.ts` — never hand-written (AGENTS §6). The one query-shape typing job: `dashboard/page.jsx`'s embedded select `project_members.select('role, projects(*)')` (Phase 3) — derive `{ role: string; projects: ProjectRow | null }[]` and narrow with a type guard after the workbench-contamination filter so downstream code sees non-null `projects`.

## Build-on inventory (verified 2026-07-18 — re-check before each phase)
**The 16 in-scope files** (17 remain; QueryProvider deferred):
- Providers: `providers/AuthProvider.jsx` (81 lines).
- App: `app/page.jsx` (7), `app/layout.js` (45), `app/login/page.jsx` (~153), `app/dashboard/page.jsx` (~340).
- Components: `ConfirmModal.jsx` (29), `AddLevelModal.jsx` (73), `QuickActivityModal.jsx` (61), `QuickStatusModal.jsx` (~90, post-W1 resync effect), `UnitNamingPopover.jsx` (112), `ActivityCommandMenu.jsx` (97), `WalkSequenceModal.jsx` (219), `HoverHistoryTooltip.jsx` (178), `VelocityChart.jsx` (155).
- API routes: `app/api/projects/route.js` (~70, post-Security-P1: uses `src/utils/serverAuth.ts`), `app/api/auth/procore/launch/route.js` (34).

**Cast seams the conversions DELETE (all verified live):**
- `useAuth()` casts ×4: `SettingsMenu.tsx:412` (**`as any`** — the standing §6 violation), `GlobalSettingsModal.tsx:65`, `app/workbench/page.tsx:67`, `app/workbench/[sheetId]/page.tsx:24` → all fall to the typed context from AuthProvider (Phase 1). Grep `useAuth() as` for the current set.
- `as unknown as React.FC<...>` ×2 in `app/project/[projectId]/page.tsx` (~:65 UnitNamingPopover, ~:75 ActivityCommandMenu) — the page already DEFINES both prop interfaces (`UnitNamingPopoverProps` ~:50–63, `ActivityCommandMenuProps` ~:66–74) with a comment saying a later phase converts properly. That phase is Phase 1: MOVE the interfaces into the components, import them back, delete both casts.

**Types/contracts that already exist — reuse, never re-invent:**
- `Session` from `@supabase/supabase-js` (the pattern: `GlobalSettingsModal.tsx:65`).
- `ConfirmModal` interface + setter typing in `src/store/useUIStore.ts` (ConfirmModal.jsx just imports them).
- `TemporalState`, `Activity`, `Unit`, `Project` + JSONB guards in `src/types/domain.ts`; `TaxonomyResult` for UnitNamingPopover (TaxonomyPicker.tsx is already TS).
- `CommitStatusExtraProps` in `src/types/mutations` — page.tsx's `onCommit` annotations for the two Quick modals.
- `useUpdateWalkSequence` (`useProjectQueries.ts`, typed `{ id, walk_sequence }[]`) — WalkSequenceModal's mutation; dnd-kit exports `DragEndEvent`.
- `progressAnalytics` + `applicability` utils (already TS) — pin HoverHistoryTooltip's prop types from their signatures.
- `getUserFromRequest` in `src/utils/serverAuth.ts` (typed, tested) — api/projects conversion leans on it.
- Existing tests that pin behavior through conversion: `UnitNamingPopover.test.tsx`, `FloorplanCanvas.test.tsx` (mocks HoverHistoryTooltip), plus the full 1,3xx-test suite. `next/dynamic` consumer of VelocityChart: `ProjectDashboard.tsx` (~:606 chartData prop becomes checked).

**Known design wrinkles (implementer-level, decided here so the sessions don't re-litigate):**
- **ActivityCommandMenu clear action:** `onSelect` receives either an `Activity` or `{ isClearAction: true; name: string; color: string }` — type it as that discriminated union (the page's current `(m: Activity) => void` annotation is a lie the compiler will surface; update the page handler's narrowing accordingly — runtime behavior identical).
- **QuickActivityModal:** `activity.color || activity.status_color` — type against the real `Activity` shape; if one branch is dead per the type, KEEP the runtime fallback and flag it (zero behavior change).
- **`layout.js`:** `Metadata`/`Viewport` types from `next`; `children: React.ReactNode`. App Router boundary → build check mandatory.
- **Env vars in routes are `string | undefined` under strict TS:** follow the existing converted routes' pattern (`app/api/auth/procore/callback/route.ts`, `start/route.ts` — Security P3 set the house style). Match it; don't invent a new one.

## Pure logic to extract + unit-test
None — this workstream adds no logic. Where a conversion touches a file with an existing test, the test keeps passing UNMODIFIED (except type annotations inside the test itself if the compiler requires them). New tests are optional and only for previously-untestable prop contracts if trivially cheap.

## Sub-phasing (ship + verify each)

### Phase 1 — AuthProvider + trivial pages + cast-removal components (10 files, ~750 lines)
- **Scope:** Convert, in this order (blast-radius first): `AuthProvider.jsx→tsx` (typed context `{ session: Session | null }`; then delete all four `useAuth() as ...` casts in typed consumers — grep for them), `app/page.jsx→tsx` (rename only), `app/layout.js→tsx`, `app/login/page.jsx→tsx`, `ConfirmModal`, `AddLevelModal` (`e.target.files` is `FileList | null`), `QuickActivityModal`, `QuickStatusModal` (keep the W1 resync effect byte-identical), `UnitNamingPopover` + `ActivityCommandMenu` (move the page.tsx prop interfaces into the components; delete both `as unknown as React.FC` casts; implement the clear-action union above).
- **Approval gates:** ⛔ none beyond standing rules (branch off main, PR through CI, no merge until "Approved"). Zero behavior change — if the compiler forces a runtime edit anywhere in this phase, STOP and flag it.
- **Exit criteria:** typecheck + test + build green (build mandatory — layout.js is an App Router boundary) · zero `@ts-nocheck`, zero new `any` · grep proof: no `useAuth() as` and no `as unknown as React.FC` remain · live dev:3010 click-through: log in, open a project, trace/name a location (popover), open the activity command menu, both quick modals · close with verify-feature.

### Phase 2 — Data-shaped components (3 files, ~550 lines)
- **Scope:** `WalkSequenceModal.jsx→tsx` (Unit picks + `DragEndEvent`; mutation hook already typed; its save-failure `console.error`-only path = FLAG, don't fix), `HoverHistoryTooltip.jsx→tsx` (the 10-prop seam into FloorplanCanvas — types pinned from `progressAnalytics`/`applicability` signatures; native `WheelEvent` listener + `ReturnType<typeof setTimeout>` refs; FloorplanCanvas.test.tsx mock must stay valid), `VelocityChart.jsx→tsx` (Recharts `TooltipProps` generics — the fiddly one; the JSDoc'd chartData row becomes an exported interface that `ProjectDashboard.tsx` imports for its ~:606 prop).
- **Approval gates:** ⛔ none beyond standing rules; zero behavior change.
- **Exit criteria:** triple green · live dev:3010: open Route Sort (walk-sequence modal) + drag a row, hover a mapped location (tooltip renders states + variance), dashboard velocity chart renders with tooltip · close with verify-feature.

### Phase 3 — Dashboard page + the two API routes (3 files, ~450 lines)
- **Scope:** `app/dashboard/page.jsx→tsx` — the one phase with sanctioned compile-forced edits: (a) the date sort `new Date(b) - new Date(a)` MUST become `.getTime()` arithmetic (behavior-identical; call it out in the PR), (b) the embedded-select row type + post-filter type guard (§ Data model), (c) `handleProjectUpdated(projectId, patch)` gets a `Partial<ProjectRow>` contract shared with `GlobalSettingsModal`'s existing prop types. Preserve the Security-P1 bearer-token create flow byte-identical. Then `app/api/projects/route.js→ts` (lean on `serverAuth.ts`; narrow the JSON body with a guard — `unknown` in, validated shape out) and `app/api/auth/procore/launch/route.js→ts` (trivial; `.maybeSingle()` row typing; match the callback/start route house style).
- **Approval gates:** ⛔ none beyond standing rules. The API-route conversions must not alter auth semantics (Security Hardening owns those — byte-identical checks).
- **Exit criteria:** triple green · live dev:3010: dashboard lists projects, create-project round-trips (POST /api/projects with token), Global Settings project toggle still patches the dashboard card · Procore launch route can't be exercised locally — typecheck/tests/build + code review are the gate; note it in the report · after this phase, grep confirms `QueryProvider.jsx` is the ONLY `.js/.jsx` left under `src/` · close with verify-feature.

## Hard guardrails (AGENTS.md §6 + skill — do not violate)
- Derive every Supabase shape from `database.types.ts`/`domain.ts`; narrow `Json` at the query boundary; no `any` as an end state; no `@ts-ignore`; no `@ts-nocheck` on main.
- Keep `"use client"` directives; keep file paths identical (rename in place — imports must resolve unchanged).
- ZERO behavior change beyond the Phase-3 sanctioned edits. If the compiler pushes toward a runtime edit — stop, flag, ask.
- Do not touch `QueryProvider.jsx`, `pendingChanges` typing rules, or anything in the offline queue (§2/§6 deliberate exceptions).
- Existing tests pass unmodified (annotations excepted). Lint is NOT a gate (~1850 pre-existing problems — the skill's lint step means "don't add new noise", not "clean the repo").
- ⚠️ dev:3010 points at PROD Supabase — click-throughs use throwaway data only; delete what you create (no-live-write-probes rule).

## Verification commands (the exit-criteria gate)
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Live click-throughs via `npm run dev:3010` (port 3010, not 3000). Vitest imports from `'vitest'` (globals OFF).

## Open decisions
- None blocking. Anything a conversion surfaces (dead fallback branches, misnomers, unchecked error paths) goes in the phase report as a FLAG for W3 — never fixed silently here.
