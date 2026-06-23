# Kickoff — Lookahead Absorption, Phase 0b: Wire the visible Look-Ahead view

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 0b of Lookahead Absorption** (wire the absorbed Look-Ahead module — built in 0a — into a visible 5th project view with autosave). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-23 - Lookahead Absorption Phase 0b Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Lookahead-Absorption-Plan.md` (Phase 0b)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 0b**. No migration this phase. Verify with a live `dev:3010` click-through. Don't commit or push until I say "Approved."

---

## What Phase 0a already shipped (the foundation you build on)
Phase 0a is **done and verified** (migration applied to the live FP-Analytics DB; gates green). You are NOT re-doing any of it:
- **DB:** `lookahead_plans` table is live (`id`, `project_id` uuid NOT NULL **UNIQUE** → `projects(id)` ON DELETE CASCADE, `doc` jsonb NOT NULL, `created_by` uuid DEFAULT `auth.uid()`, `created_at`, `updated_at`). RLS: READ + WRITE = **any project member** (owner decision; mirrors the N/A overrides posture). Migration: `supabase/migrations/20260623_lookahead_plans.sql`. Types added to `database.types.ts` + `domain.ts` (`LookaheadPlan`).
- **Vendored module:** `src/lookahead/` — the Look-Ahead app copied verbatim except the three required edits (stripped zustand `persist`; rewrote `@/lib`/`@/store` imports to `@/lookahead/...`; ported print CSS to `src/lookahead/components/lookahead.css`). No new npm deps were needed.
- **Adapter:** `src/lookahead/persistence.ts` — `loadPlan(projectId)` (SELECT → `isProjectBlob` narrow → `useStore.getState().loadProject(doc)`; blank + no write if no row) and `savePlan(projectId)` (`projectBlob(state)` → upsert on `project_id`, stamps `updated_at`). Uses SitePulse's `@/supabaseClient`. **Lazy-create** is already honored: a row is only written on first save.
- **Session seam:** `src/lookahead/store/useSession.ts` — a thin SitePulse session store the vendored `Header.tsx` consumes (`cloud`, `currentProjectId`, `saving`, `backToDashboard`) PLUS `setProject(id)`, `openPlan(projectId)`, `saveCurrent()` for the workspace mount to drive. The autosave wiring lives HERE for you to call.
- **Guard + test:** `src/lookahead/isProjectBlob.ts` (+ `.test.ts`, 11 cases) narrows `Json → ProjectBlob` at the query boundary.

## Phase 0b scope (the user-facing slice — see plan §"Phase 0b")
1. **`src/lookahead/LookaheadWorkspace.tsx`** (`"use client"`) — the thin mount that REPLACES the standalone `App.tsx`:
   - on mount, `useSession.getState().openPlan(projectId)` (loads the saved plan, or a blank one via the adapter);
   - subscribe to the document store (`useStore.subscribe`) and **debounce-save (~800ms)** via `useSession.getState().saveCurrent()` — mirror the original `App.tsx` change-detection (compare `project`/`areas`/`areaOrder`/`currentAreaId`);
   - flush on unmount + on `visibilitychange`→hidden / `beforeunload`;
   - on unmount, `setProject(null)`; render `<LookAhead />`.
2. **`TopHeader.tsx`** — add the **5th view button** (`viewMode === 'lookahead'`, `hidden md:flex`, copy the Schedule button pattern). `useUIStore.viewMode` is a free `string`, so no union edit.
3. **`src/app/project/[projectId]/page.jsx`** — add the render branch `: viewMode === 'lookahead' ? <LookaheadWorkspace projectId={…} />` in the existing dashboard/list/schedule chain.
4. **Decide the Header's "Projects" back-button + saving indicator behaviour.** In SitePulse navigation is owned by `TopHeader`, so the vendored `Header.tsx`'s `showCloudNav = cloud && currentProjectId` would currently show a "← Projects" button that calls the seam's no-op `backToDashboard`. Decide: hide that button (preferred — keep the "Saving…/Saved" indicator), e.g. by NOT setting `currentProjectId` for the button's sake, by a small prop/flag, or by a minimal Header edit. Keep the deliberate-edit count low and call it out.

## Locked decisions (carry these in)
- **Desktop-only for v1** — match Schedule's `hidden md:flex`.
- **Lazy-create** — already implemented in the adapter; the workspace just saves on edit (first save creates the row).
- **Any member can edit** (RLS already enforces this); viewers can read.

## ⚠️ Watch-outs
- The vendored `Header.tsx` "Print / Export PDF" button calls `window.print()`; the print CSS (`lookahead.css`) is imported by `LookAhead.tsx`, so it only loads with the view. Confirm printing still produces the 11×17 landscape sheet once the view is reachable.
- `lookahead.css` is a **global** (non-module) stylesheet imported from a component. Phase 0a built/typechecked clean, but the bundler only processes it once `LookAhead` is in a route's module graph — i.e. FIRST exercised in 0b. If `next build`/`dev` rejects the component-level global-CSS import, fall back to appending the rules to `src/app/globals.css` (they're namespaced `.la-*`/`.no-print`/`#la-*`; only `@page` is document-wide and only at print time).
- Don't wire Lookahead into SitePulse's offline `pendingChanges` queue (out of scope; the module keeps its own debounced save).
- Touch no existing table/RPC/RLS.

## Verification (exit criteria for 0b — then STOP)
- `typecheck` + `test` + `build` green (absolute-prefix commands in the plan's Verification section).
- **Live `dev:3010` click-through:** open a project → switch to **Look-Ahead** → edit a cell → reload → it persisted; switch to Map/List/Dashboard/Schedule → all unaffected.
- Close with the **`verify-feature`** skill, then STOP. Don't commit/push until the owner says "Approved."
