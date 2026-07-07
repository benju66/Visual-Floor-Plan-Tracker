# Kickoff — Unified Schedule Engine, Phase 1: stagger the cascade (crew-flow dates for one level)

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of the Unified Schedule Engine** (give the level date panel a
> "spread across locations in crew-flow order" mode so a level window staggers across its
> locations instead of giving them all the same dates). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-06 - Unified Schedule Engine Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Unified-Schedule-Engine-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1** — no DB migration, no offline-queue writes.
> Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## What & why (plain English)
The level schedule panel (`CascadePanel`) today gives **every location on a level the same
planned dates** ("envelope"). The owner wants it to instead **spread that window across the
level's locations in crew-flow order** (walk sequence) — so if Level 3 Drywall is planned
May 1–20 across 20 units, each unit gets its own ~1-day slice in order, not all May 1–20.
The crew-flow math **already exists** (`subdivideTaskWindow`, used by the MS Project
importer); this phase wires it into the level panel and derives/show the duration from the
dates. No new database columns — the owner chose "duration is derived from the planned
start/finish dates," so everything reads from data that already exists.

## Required reading (fresh — line numbers in docs drift)
- `sitepulse-next/AGENTS.md` — esp. §2 (status_logs `.upsert` only, never `.insert()`;
  strip synthesized `activityName`; online-first, never the offline queue) and §3
  (don't fork `progressAnalytics`; respect applicability / N/A slots).
- `sitepulse-next/Notes/plans/Unified-Schedule-Engine-Plan.md` — the whole plan; you are
  building **Phase 1** only.
- `src/utils/scheduleReconcile.ts` — read `subdivideTaskWindow(start, end, units, mode)`
  fully: its ordering (walk_sequence, then numeric unit_number), area-vs-even weighting,
  and `LocationWindow` return shape. **This is the engine you reuse.**
- `src/utils/ganttMath.ts` — read `cascadeLevelToLocations({...})` fully: it is the current
  **envelope-only** level→location writer, already non-destructive + N/A-aware +
  progress-preserving. You generalize it to also stagger.
- `src/components/schedule/CascadePanel.tsx` — the panel you extend (per-activity start/end
  inputs, override checkbox, live count, two-step confirm).
- The co-located tests for `ganttMath` / `scheduleReconcile` — mirror their style.

## Scope (build ONLY this)
1. **Generalize the writer.** In `ganttMath.ts`, give the level→location cascade a
   `flowMode: 'subdivide' | 'envelope'` (default keeps today's envelope behaviour). For
   `'subdivide'`, delegate per activity to `subdivideTaskWindow` to produce staggered
   per-location windows; keep every existing invariant (skip N/A slots, skip hand-dated
   slots unless `overrideExisting`, preserve `status_color`/`temporal_state`/`logged_date`).
   Pure + unit-tested (timestamps in, no `Date.now()`).
2. **Derived-duration helper.** Small null-safe `deriveDuration(start, end)` (inclusive
   days) + test; use it to show duration per activity row.
3. **CascadePanel UI.** Add a "Spread across locations (crew flow)" vs "Same window
   everywhere" toggle (mirror the importer's `DistributionMode` control). Show the derived
   duration next to each activity's dates. The live count + two-step confirm + override
   checkbox already exist — reuse them; they should reflect the staggered write.

## Guardrails specific to this phase
- **No migration, no schema change.** If you reach for one, stop — the design deliberately
  derives duration from existing dates.
- Writes stay on `useBulkInsertStatusLogs` (chunked `.upsert` on `unit_id,activity_id`) —
  never `.insert()`, never the offline queue.
- Don't fork `progressAnalytics`; keep applicability handling intact.
- Don't reset progress — only planned dates change.

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` all green (absolute-prefix commands below).
- New/extended pure-logic unit tests for the staggered writer + `deriveDuration`.
- Live dev:3010 desktop click-through: set a level×activity window, pick "spread", confirm
  the two-step dialog → per-location dates are **staggered** (contiguous slices in walk
  order), a location that already had its own dates is skipped unless override is checked,
  and completed locations keep their progress.
- Close with the `verify-feature` skill (DoD → stop). **Do not commit or push until the
  owner says "Approved."**

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
⚠ Don't run `build` while `npm run dev:3010` is live (shared `.next` corrupts the dev
server; recover via `scripts/restart-dev.ps1`). Gate mid-session with typecheck + test;
run `build` at the end.
