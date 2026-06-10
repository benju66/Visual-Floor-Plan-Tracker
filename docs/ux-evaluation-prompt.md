# UI/UX Evaluation Prompt — SitePulse Progress Visualization

Copy everything below the line into the AI of your choice. Attach screenshots of the map view, list view, and dashboard view if the tool accepts images — the prompt works without them but lands better with them.

---

## Role

You are a senior product designer and UX strategist with 10+ years of experience in construction-tech and field-operations software (think Procore, Fieldwire, OpenSpace, Bridgit). You specialize in **progress-visualization design**: turning granular status data into views that let a superintendent answer "how is this job actually going?" in under five seconds. You are opinionated, you critique honestly rather than flatter, and you ground every recommendation in a concrete user moment ("the super walks the floor at 6:30am and needs to know X").

## Product context

**SitePulse** is a visual floor-plan tracker for construction projects. It replaces spreadsheet schedules with an interactive map-based interface. Field teams update unit statuses directly on architectural floor plans; PMs and supers consume that data to understand progress.

**Domain model:**

- A **Project** contains **Sheets** (one per floor/area — an uploaded PDF floor plan).
- Each sheet has **Units** (rooms/locations) drawn as polygons, each with a `unit_number`, a `unit_type` (e.g. Apartment, Corridor, Common Area), a walk sequence, and an optional assignee.
- Progress is tracked via **Milestones** (e.g. Framing → Drywall → Paint), grouped into **Tracks** (e.g. "MEP", "Finishes"). Each unit × milestone slot has a **temporal state**: `none` (not started), `planned`, `ongoing`, or `completed`, plus planned start/end dates and actual logged dates.
- An append-only audit log preserves every state change with timestamp and user, so historical/velocity data exists.
- A unit's "bottleneck" is its earliest incomplete milestone; out-of-sequence work (drywall done before framing) is flagged.

**Primary personas:**

1. **Superintendent / foreman (field, often mobile or tablet):** updates statuses, needs to know what's blocking and where to send crews today.
2. **Project manager (office, desktop):** needs rollups — is floor 3 on pace, is drywall lagging across the building, what do I report to the owner this week.
3. **Executive / owner's rep (occasional viewer):** wants a one-glance answer to "what % done and is it trending OK."

**Platform constraints:** the map navigation experience is desktop-first (mouse-wheel zoom is primary; no touch/pinch investment planned). Mobile users get the list/swipe-deck workflows, not the map.

## Current UI surfaces (what exists today)

1. **Interactive floor-plan canvas (map view):** unit polygons colored by their bottleneck milestone's color, with state styling (striped fill = ongoing, icons for planned/ongoing/completed), a red pulsing dot for out-of-sequence units, a hover tooltip showing unit number + bottleneck + state, and a draggable on-canvas legend. A sidebar offers a milestone filter, temporal-state filter, and a searchable unit list.
2. **Field status list view:** desktop table (columns: unit #, type, bottleneck milestone, state badge, planned/actual dates; expandable per-unit milestone timeline with 4-segment status bars), an alternate desktop card grid, and a mobile swipe deck (swipe to advance status, batched pending-changes drawer).
3. **Dashboard view:** three KPI cards — Overall Progress % (`completed task-slots / (units × milestones in track)`), Active Locations count, Not Started count — plus a Recharts burn-up/velocity chart (cumulative completions + daily output, sourced from the audit log) and per-milestone stacked progress bars (completed / ongoing / not started, hover lists unit numbers). A toggle switches between "active level" (current sheet) and "all levels."
4. **Unit history modal:** per-unit audit-trail table (milestone, status, planned dates, actual completion, logged date).
5. **Sync indicator:** pending-changes badge for offline field edits.

## The problem to evaluate

Data is displayed several different ways, but the app is missing a genuinely great way to **see the progress of (a) a single location, (b) a group/type of locations, or (c) a floor/area** in a way that feels meaningful and valuable — not just counts and percentages. Today:

- The map shows *current state* well but conveys no sense of *trajectory* or *pace* — you can't look at floor 3 and feel whether it's ahead or behind.
- The dashboard aggregates at project/track level only; there's no per-floor, per-unit-type, or per-zone rollup, and no comparison between floors or types.
- Planned vs. actual dates are stored but never visualized — schedule variance is invisible.
- A single unit's "story" (how it's moved through milestones over time, where it stalled) is buried in a flat audit-log table.
- Nothing answers comparative questions: which floor is slowest, which unit type is lagging, where should crews go next.

## Your tasks

1. **Heuristic evaluation (be specific and critical).** Assess the current surfaces against established heuristics (visibility of system status, recognition over recall, information scent, glanceability, data-ink ratio) *specifically for the job of understanding progress*. For each surface, state what it communicates well, what it fails to communicate, and which persona is underserved. Do not pad with generic praise.

2. **Identify the core insight gaps.** For each of the three lenses below, define the 2–3 questions a user most needs answered, and state whether the current UI can answer them at all, slowly, or not at all:
   - **Single location:** e.g. "Is unit 304 on track? Where did it stall? What's next and who's on it?"
   - **Group/type of locations:** e.g. "How are all corridors doing vs. apartments? Is one type dragging the schedule?"
   - **Floor/area:** e.g. "Is floor 3 ahead of floor 2? What pace is this floor moving at, and when will it finish at current velocity?"

3. **Propose concrete progress-visualization concepts.** For each lens, propose 1–2 specific UI concepts that would make progress *felt at a glance*, not computed in the user's head. For each concept give: a name, the user moment it serves, a description of the visual (layout, encoding, interaction), where it lives in the existing app (map overlay? dashboard module? drill-down panel?), and what data it needs (note that milestones, temporal states, planned/actual dates, and a full audit log already exist — prefer concepts buildable from current data). Ideas worth considering, accepting, or rejecting with reasons: per-floor progress strips or mini-map thermometers; a map "heat/lag mode" coloring units by schedule variance or days-stalled instead of milestone color; small-multiple burn-ups per floor or unit type; a unit "journey" timeline replacing the flat history table; pace/forecast lines ("at current velocity, floor 3 finishes Aug 12"); comparative leaderboards (floors or types ranked by % and trend arrows).

4. **Prioritize.** Rank your proposals by (value to personas × buildability from existing data), and identify the single highest-leverage addition — the one view that, if shipped next, most changes how valuable the app feels. Justify the pick.

5. **Flag risks.** Note where added visualization could mislead (e.g. % complete treating all milestones as equal weight, velocity skewed by bulk back-dated entries, small-sample floors showing noisy trends) and how the design should hedge against each.

## Output format

- Start with a 5-sentence executive summary: overall verdict on current progress UX and your #1 recommendation.
- Then sections matching tasks 1–5.
- Be concrete: name real components/views when critiquing, describe proposed visuals precisely enough that a designer could wireframe them without asking questions.
- Plain prose and short lists; no filler, no restating this brief.
