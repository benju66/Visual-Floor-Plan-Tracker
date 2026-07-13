# Kickoff — List View Performance & Smoothness, Phase 1: Baseline measurement + content-visibility scroll experiment

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of List View Performance & Smoothness** (baseline measurement + a `content-visibility` scroll experiment on the desktop List table). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-10 - List View Performance Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/List-View-Performance-Plan.md` (esp. Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. This is CSS + docs only — no schema, no write-path, no queue changes. `content-visibility` on tables can break column alignment / sticky header / frozen columns — if it does, back it out and record that scroll relief depends on Phase 5. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Why this phase exists (plain English)
The desktop **List view** renders *every* row and every cell into the page at once — no virtualization. Each collapsed row has ~15 cells including 4–5 native date-picker boxes, so a few hundred locations means well over a thousand date inputs sitting in the DOM before you even scroll. This phase does two cheap things: (1) **measure** how bad it is at scale so later phases can prove they helped, and (2) try the nearly-free browser feature `content-visibility: auto`, which tells the browser to skip drawing rows that are off-screen. It might not stick (tables and `content-visibility` can fight over column widths) — that's fine; the plan doesn't depend on it.

## Required reading (fresh — do not trust line numbers)
- `sitepulse-next/AGENTS.md` — §2 (state/offline rules), §3 (Container/Presenter, `statusColors.ts` palette). Nothing in this phase should touch write paths, but know the invariants.
- `src/components/StatusTable.tsx` — the presenter you're optimizing. Note: the sticky `<thead>` (measured header height for expanded-row pinning), the frozen sticky-left columns (`FZ_CHECK` / `FZ_LOC`), the per-location `<tbody>` structure, and the optional baseline columns (`baseCols`). Your CSS must not break any of these.
- `src/components/FieldStatusTable.tsx` — the container that scrolls it (`overflow-y-auto` wrapper).
- `List-View-Performance-Plan.md` → "The four performance axes" + Phase 1.

## Scope (build only this)
1. **Measurement recipe (document + record numbers, don't ship a tool):**
   - Get a large list on screen: either point at a real large project, switch scope to **All levels** to aggregate across sheets, or temporarily inflate the `visible` array in dev to ~300–500 rows.
   - With React DevTools Profiler + manual scroll observation, record a **baseline**: collapsed row count, approx DOM node count, scroll smoothness (dropped frames / feel), and time-to-interactive after clicking **expand all**. Write these numbers into the phase's closing note in the plan file so Phases 2–5 can measure against them.
2. **The experiment:** apply `content-visibility: auto` + a `contain-intrinsic-size` estimate to the off-screen row containers. Validate the right granularity — likely each per-location `<tbody>` (test whether the browser honors it on `tbody`/`tr` without breaking table layout). Tailwind arbitrary utilities (e.g. `[content-visibility:auto] [contain-intrinsic-size:...]`) or a tiny CSS class for the Konva-style exception are both fine.

## Honest failure mode (expected, not a bug)
`content-visibility` gives off-screen rows a *placeholder* size, and the table column-sizing algorithm wants to measure all cells — so you may see **column widths jump** as rows scroll in, or the sticky header / frozen columns misbehave. If you can't get it stable in ~an hour or two: **revert the CSS**, and record in the plan's Phase 1 closing note "content-visibility not viable on this table — raw-scroll relief depends on Phase 5 (virtualization)." That is a valid, useful outcome for this phase.

## Guardrails
- CSS + docs only. **No** changes to `useFieldData`, the write path, the offline queue, or any query.
- Don't hardcode temporal-state colors; don't fork `progressAnalytics`/`scheduleBaseline` (you won't need to touch them).
- Keep the sticky header, frozen left columns, horizontal scroll, expand/collapse, and the baseline-column toggle all correct.

## Exit criteria (close with `verify-feature`, then STOP)
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck` green.
- `npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build` green.
- Live check on `dev:3010` (from `sitepulse-next/`, port 3010) with a large list: sticky header + frozen columns + baseline toggle still correct; before/after scroll measurement recorded in the plan.
- If content-visibility was backed out, the closing note says so and why.
- Do NOT commit or push until the owner says "Approved."
