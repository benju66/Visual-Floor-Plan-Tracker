# Phase 3 kickoff prompt (paste into a fresh Claude Code window)

---

We're continuing a multi-phase build of the SitePulse desktop "Locations & Status management
workspace" (the field List view). Phases 0–2b are shipped and verified. I want to start **Phase 3:
the Gantt / timeline schedule**.

Before writing any code:
1. Read `sitepulse-next/Notes/Phase3-Gantt-Schedule-Plan.md` in full — it's a self-contained build
   plan (goal, data model, files to build on, sub-phases, guardrails, verification).
2. Read `sitepulse-next/AGENTS.md` (critical invariants) and `Notes/Locations-Status-Management-Plan.md` §8
   (status of prior phases).
3. **Re-read the actual current files fresh** before editing — don't trust line numbers in the docs.

Then propose a short plan for **Phase 3a** (read-only Gantt + level→location cascade, online date
edits) and, once I confirm, build it. Work in small slices and **verify each with typecheck + tests +
build** using an absolute prefix, e.g.
`npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` (then `test`,
then `build`). Put the load-bearing date math in a pure, unit-tested `src/utils/ganttMath.ts`. Reuse
`src/utils/progressAnalytics.ts` for behind-schedule coloring — do NOT fork it. Build the Gantt with
online date edits; offline durability is **Phase 4** (a separate, later pass — see plan §8), not Phase 3.

I'm a product owner, not a developer — lead with a plain-English summary, keep it short, and flag
trade-offs. A couple of open decisions in the plan (§11) are worth asking me about up front:
dedicated `schedule` view vs a tab, and rows-per-location vs per-location×milestone.

Recommended first step before building: a quick live click-through of the Phases 1–2 manage workspace
(search/filters, all-levels banner, bulk status, row actions, assignee) since none of it has been
verified in a browser yet — but your call.
