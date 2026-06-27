# Kickoff — Navigation & Per-View Header Redesign, Phase 1: View in the URL + clean view-resolution precedence

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of the Navigation & Per-View Header Redesign** (make `?view=<mode>` the
> source of truth for the active view, so views are shareable and the browser Back button walks
> through views). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-26 - Navigation Per-View Header Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Navigation-Per-View-Header-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. No DB/RLS/queue changes — this is UI/state only.
> Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What this phase delivers (plain English)
Right now the active view (Dashboard / List / Schedule / Map / Look-Ahead) lives only in
in-memory session storage, so you can't share a link to a specific view and the browser Back
button doesn't step between views. This phase makes the **URL** (`?view=map`) the source of
truth: switching views updates the URL and pushes a history entry (Back returns to the prior
view), and a pasted/shared `?view=…` link opens straight to that view — even on a phone.

No visible redesign yet (labels, mobile bar, per-view header cleanup come in later phases) —
this is the foundation everything else builds on.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — §0 (how to talk to the owner: lead with plain-English summary,
   keep it short), §2 (state: `viewMode` is Zustand/URL, never server state), §6 (TS/Zustand
   guardrails; new files `.ts`, no `any`, typed setters).
2. `sitepulse-next/Notes/plans/Navigation-Per-View-Header-Plan.md` — read the whole plan, then
   focus on **Phase 1** and the **Pure logic to extract + unit-test** section.

## Files to re-read fresh before editing (line numbers WILL have drifted — re-grep)
- `src/app/project/[projectId]/page.jsx` — `"use client"`. The mount effect (~line 67) that
  **forces `viewMode='list'` when `window.innerWidth < 768`** and otherwise applies
  `settings.defaultViewMode`; the `setViewMode('map')` jumps (e.g. `onLocateUnit` ~line 527);
  it already imports from `next/navigation` (`useParams`).
- `src/store/useUIStore.ts` — `viewMode` default `'list'`, persisted to sessionStorage
  (`sitepulse-ui-session`, partialized). Keep as the in-memory mirror.
- `src/components/TopHeader.tsx` — the 5 switcher buttons call `setViewMode(...) + setToolMode('pan')`.
- `src/store/useSettingsStore.ts` — `settings.defaultViewMode` (read via `useHydratedStore`).
- `src/components/ProjectDashboard.tsx` (~line 254) — an in-app `setViewMode('map')` jump that
  must also route through the new helper.

## Scope (build ONLY this)
1. **New `src/utils/viewRouting.ts` (+ `viewRouting.test.ts`)** — pure, framework-free:
   - `VIEW_MODES` (canonical list + order) and `isValidViewMode(s): boolean`.
   - `MOBILE_VIEWS = ['list','map','lookahead','dashboard']` + `isMobileView(mode)`.
   - `resolveInitialView({ urlParam, isMobile, defaultViewMode })` with precedence:
     **valid URL param → (mobile: clamp to a mobile-allowed view) → defaultViewMode → 'list'**.
     Pass `isMobile` IN; never read `window` inside the pure function.
   - Unit tests assert the full precedence table.
2. **Wire the URL in `page.jsx`:**
   - Read `useSearchParams()`. On mount, compute the initial view via `resolveInitialView(...)`
     and reconcile it into `useUIStore.viewMode`.
   - Add a `navigateToView(mode)` helper that does `router.push(\`?view=${mode}\`)` (push so Back
     walks views) **and** `setViewMode(mode)` + `setToolMode('pan')`. Route the `TopHeader`
     switcher and the in-app `setViewMode('map')` jumps through it.
   - **Guard against update loops:** only `router.push` when the target differs from the current
     param; keep the URL→store reconciliation idempotent.
   - **Relax the mobile force-to-list:** apply it only when there's no valid `?view=` param, so a
     shared `?view=map` link still deep-links on a phone. (Full mobile reachability = Phase 4.)
   - `TopHeader` keeps reading `viewMode` for its active-state styling — no visual change here.

## Hard guardrails
- View/nav state stays **Zustand + URL** — never TanStack Query / server state.
- Read persisted settings (`defaultViewMode`) via **`useHydratedStore`** (hydration safety).
- **Do not touch** the offline mutation queue, `pendingChanges`, `status_logs`, or
  `progressAnalytics`. This is navigation/state only — no DB, RLS, or migration.
- New util is `.ts`, typed, no `any`; Vitest globals are OFF (import `{ describe, it, expect }`
  from `'vitest'`); keep the test type-clean (it's in `npm run typecheck`).
- App Router note: `page.jsx` is already `"use client"` and mount-gated, so `useSearchParams`
  is fine; still verify no SSR/Suspense warning appears in the build.

## Exit criteria (Definition of Done — then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test` green
  (incl. new `viewRouting.test.ts`)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green
- Live `npm run dev:3010` click-through: switching views updates `?view=`; Back steps through
  previous views then exits the project; a pasted `?view=map` deep-links (desktop AND phone width).
- Close the phase with the **`verify-feature`** skill (run its Definition of Done / merge gate),
  then **STOP** — do not commit or push until the owner says "Approved." After approval +
  commit, draft the Phase 2 kickoff and paste its launch prompt into chat (standing handoff ritual).
