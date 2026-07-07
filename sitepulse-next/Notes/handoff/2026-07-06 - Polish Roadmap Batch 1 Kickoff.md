# Kickoff — Polish Roadmap, Batch 1: URL views + theme unification + empty states/stalled-amber

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Batch 1 of the Polish Roadmap** — three sub-phases on ONE branch, one
> commit each, in order: (1) `?view=` URL views [Navigation plan P1], (2) theme
> unification [Polish plan P1], (3) empty states + stalled→amber [Polish plan P3].
> Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Polish Roadmap Batch 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/UI-Polish-Design-Consistency-Plan.md` (§ Roadmap, P1, P3)
> - `sitepulse-next/Notes/plans/Navigation-Per-View-Header-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Every decision is pre-locked — run the whole batch without asking me
> anything; end with ONE review summary. No DB/backend changes of any kind. Don't commit
> until each sub-phase's gates are green; don't push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Batch model (owner-locked 2026-07-06)
This is the first of **3 autonomous batches** (roadmap table in the Polish plan). Rules:
- **One branch** for the batch; **one commit per sub-phase** so regressions bisect.
- **No mid-batch owner questions** — every product decision is already locked in the two
  plans' "Locked product decisions" sections. Where a judgment call remains (empty-state
  wording), pick sensibly and flag it in the review summary.
- **One review at the end**: a plain-English summary of the three sub-phases, screenshots
  of before/after where visuals changed, and any judgment calls made. Then STOP —
  no push until "Approved."
- After approval, the closing session drafts the **Batch 2 kickoff** (Nav P2 + Nav P3 +
  Polish P4) per the standing post-approval ritual.

## Sub-phase 1 — View in the URL (Navigation plan, Phase 1)
Scope, watch-outs, and exit criteria are in `Navigation-Per-View-Header-Plan.md` Phase 1.
Highlights:
- New pure `src/utils/viewRouting.ts` + tests (`VIEW_MODES`, `isValidViewMode`,
  `MOBILE_VIEWS`, `resolveInitialView` precedence: URL param → mobile clamp →
  defaultViewMode → `'list'`).
- `navigateToView(mode)` in `project/[projectId]/page.jsx`: `router.push('?view='+mode)`
  (push → Back walks views) + `setViewMode` + `setToolMode('pan')`; wire the TopHeader
  switcher and every in-app `setViewMode` jump through it; guard against push loops.
- Relax (don't remove) the mobile force-to-list rule: a valid `?view=` param wins.
- ⚠ **Next.js is 16.2.3** and AGENTS.md warns its APIs may differ from training data; no
  bundled docs in node_modules. Probe `useSearchParams`/`router.push` semantics (Suspense
  requirement, query-only push preserving pathname) at dev:3010 before building on them.

## Sub-phase 2 — Theme unification (Polish plan, Phase 1)
- New client `src/components/ThemeApplier.tsx` (reads `colorMode` via `useHydratedStore`,
  sets/removes `data-theme` on the root element); mount in `src/app/layout.js` beside
  `DevDbBanner`; delete the equivalent effect from `project/[projectId]/page.jsx`.
- Dark-audit `/dashboard`, `/workbench`, `/workbench/<sheetId>` at dev:3010 — most
  components already carry `dark:` variants; fix stragglers; keep the workbench purple
  accent in both themes.
- `'system'` keeps its current meaning (attribute removed → light) unless real
  `prefers-color-scheme` support is trivial; otherwise note it and move on.

## Sub-phase 3 — Empty states + stalled→amber (Polish plan, Phase 3)
- Stalled red→amber in `ProjectDashboard.tsx`, `dashboard/FloorPulse.tsx`,
  `dashboard/TypeScorecard.tsx` chips/text. **Do NOT touch** `VARIANCE_COLORS`,
  `varianceFill`, `VARIANCE_LEGEND`, or the pace-decay sparkline red in
  `progressAnalytics.ts`/TypeScorecard.
- `GanttTimeline.tsx`: one banner when visible rows have zero planned dates — name the
  real buttons ("Level dates", "Import"); suppressed once any bar exists.
- Dashboard `—` suppression cells: consistent muted treatment + `title` tooltips whose
  thresholds are read from the real constants in `progressAnalytics.ts` (don't restate
  them from memory).

## Hard guardrails (both plans + AGENTS.md)
- No DB/RLS/migration/backend changes; no `status_logs` write-path changes;
  `pendingChanges` stays local; **never fork `progressAnalytics`**; don't recolor
  `mapDisplayStatuses`.
- `viewMode` never enters TanStack Query. Persisted reads via `useHydratedStore` only.
- New files typed `.ts`/`.tsx`, no `any`; tests import from `'vitest'` (globals OFF).
- The dev DB banner points at PRODUCTION data — verify with reads and UI-state probes
  only; never write-probe live rows.

## Exit criteria (whole batch)
Per sub-phase before its commit, then once more at the end:
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green
- `... run test` green (`viewRouting.test.ts` covers the precedence table)
- `... run build` green
- dev:3010 click-throughs: URL updates + Back walks views + deep links + invalid param
  fallback (sub-phase 1) · theme toggle flips home/project/workbench together (sub-phase
  2) · Orchard Path III dashboard shows amber stalled vs red variance tiers; Mill Pond's
  schedule timeline shows the banner; dashes have tooltips (sub-phase 3 — check BOTH
  projects; the empty states are half the point).
- Close with `verify-feature` across all three sub-phases → write the ONE review
  summary → STOP (no push until "Approved"), then draft the Batch 2 kickoff.
