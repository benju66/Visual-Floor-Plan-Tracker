# SitePulse Master Plan — Scheduling, Activities & Production Analytics

**Version:** 1.0
**Last updated:** 2026-07-01
**Status:** Approved roadmap (outline altitude — per-phase detail follows via the `plan-phases` skill)

---

## North Star (the why)

SitePulse is a **scheduling-analytics tool with visual representation.** The job: make schedule
updates frictionless, make progress visible on the floor plan, and forecast slips *early* — so a team
catches "the drywaller's pace will cost three weeks" before the month-end phone call between a
superintendent in the field and a PM at the office.

The tracing/geometry data is a **byproduct** of using the app, not the product. The long-term
differentiator is **private, per-GC** productivity and reliability benchmarking that accrues as a
byproduct of the weekly ritual (the foreman's meeting / look-ahead). Benchmarking is **never shared
across clients** — it is a per-tenant asset.

## Scope of this plan

The **scheduling/activity foundation and the analytics it powers.** Explicitly *not* the AI-tracing
flywheel (a separate workstream), and not the deferred items at the end of this document.

## What this supersedes

This document is the master roadmap for scheduling. It **supersedes the later phases
("cost codes → milestones → production rates") of `Scale-Measure-Production-Rates-Plan.md`** and
**folds in `Cost-Code-Catalog-Plan.md`**, so we no longer carry overlapping roadmaps.

## Already done — feeds this plan, do not re-open

- **Scale & calibration (Scale/Measure Phases 1–4, merged).** `units_per_px` + corrected area math
  (`computed_area` in SF) is live. This is the **quantity denominator** for production rates — the
  Phase 6 productivity math stands directly on it.

## Cross-cutting guardrails (apply to every phase)

- **Don't rebuild P6** — Finish-to-Start + lag only; coarse networks; defer critical-path/float.
- **Consolidate, don't add** — kill scattered scheduling surfaces rather than grow a new one.
- **Governance is non-blocking** — the `Other (pending)` model; a user is never stuck mid-onboarding.
- **Correct core, deferred speculation** — free implementation ≠ free maintenance; build the right
  core fully, refuse speculative scope until a real workflow demands it.
- **Space-bound authoring is the moat** — keep the floor plan present; this is not a P6 clone.
- **Suppress, don't fake** — analytics stay honest (and blank) on thin data.
- **Migrations additive + idempotent** (`IF NOT EXISTS`, safe to re-run).

---

## SLICE A — Scheduling Foundation *(first coordinated build: Phases 0–3)*

### Phase 0 — Housekeeping & reconciliation *(no behavior change)*
- Backfill the **scale-columns migration** (idempotent, no-op against the live DB) so the schema is
  reproducible from the repo. Verify exact column types/defaults against the live schema first.
- Record the supersession of the two prior plans.

### Phase 1 — Activity model (the keystone)
- **Rename milestones → activities** across schema, types, and UI (safe now — negligible real data).
- **Template/instance split with stable IDs:** an activity **catalog** (definitions) vs **instances**
  (progress rows keyed to an activity **id**, not the mutable name string — fixes the fragile
  name-key in `status_logs`).
- **`type` flag:** task (durational) vs milestone (zero-duration marker).
- **Governed activity dictionary** (mirrors `subtypes`): id + **aliases** (kills naming variance) +
  status + add-custom/propose + `Other (pending)`; **`default_project_types[]`** scoping; reserved
  (empty) **`cost_code_id`** slot.
- **Playbooks** — reusable, project-type-scoped activity *sets with sequence* (the friction-killer:
  start a job from "Multifamily Wood Frame," not a blank list).
- **Project-level overrides** (mirrors the applicability-overrides pattern).
- **No durations on templates** — timing lives on instances (imported → measured rate × quantity →
  manual).
- *Done when:* existing status tracking works unchanged behind the new model; a project starts from a
  playbook; renaming an activity no longer orphans history. Absorbs the Settings milestone manager.

### Phase 2 — The consolidated "Schedule" view
- New **first-class toggled view**, peer to the others — not a settings panel.
- **Absorbs** activity/playbook management **and the scattered Gantt authoring pieces**
  (`GanttBar`/`GanttTimeline`/`ScheduleWorkspace`/`CascadePanel`) into one workspace — the de-sprawl.
  **Does not** absorb the Look-Ahead (it stays a standalone weekly tool).
- **Floor plan present** for space-bound authoring; light dependency authoring (ordering + a few
  edges); first-run **wizard mode** for onboarding.
- *Done when:* a user builds/edits their whole activity set + sequence from one view; the Look-Ahead
  is untouched.

### Phase 3 — MS Project import → planned dates
- Parse **MSPDI `.xml`** (mirror the `procoreDirectoryCsv` parser pattern). *(P6 `.xer` / `.mpp`
  deferred.)*
- **Two-pane reconciliation UI:** master schedule ↔ activities/locations; alias-assisted
  auto-matching that improves as the dictionary grows.
- **Generate planned dates** on instances — a coarse master task becomes a date **envelope**,
  subdivided across finer locations by area/quantity, via the existing sheet-schedule cascade.
- *Done when:* a real `.xml` imports, maps, and populates planned dates across locations with no
  hand-entry. **This is the data-quality unlock that makes every Slice-B analytic real.**

---

## SLICE B — Dependencies, Cost Codes & Analytics *(Phases 4–6)*

### Phase 4 — Light dependency *behavior* (only what earns its place)
- Turn the modeled dependencies into value: **make-ready** ("what's ready to work"), precise
  out-of-sequence detection, and **date-ripple** (a slip pushes downstream planned dates).
- Stays coarse (FS + lag); **no CPM/float engine yet.**
- *Done when:* the schedule/floor plan shows ready-vs-blocked, and a slip ripples forward.

### Phase 5 — Global cost codes → assigned to activities
- **Global cost-code dictionary** (seed CSI MasterFormat), governed like `subtypes`; fills the
  `cost_code_id` slot from Phase 1; adds **subcontractor/company** assignment.
- Folds in `Cost-Code-Catalog-Plan.md`.
- *Done when:* activities carry cost code + sub, and clean productivity data begins accruing.

### Phase 6 — Production rates & forward-looking analytics
- **Production rates** (SF/week by activity / cost code / sub) from `computed_area` × actual dates.
- High-value views: **required-rate-vs-actual → staffing/date action**, **forecast-trend line**,
  make-ready surfaced, **bottleneck-that-costs-the-end-date**.
- **Private per-GC benchmarking** across the tenant's own jobs.
- *Done when:* "at this pace, ~3 weeks late; needs +1 crew" is a screen, and sub productivity is
  comparable across the GC's projects.

---

## Deferred / Future *(named for sequencing; not in scope now)*

- **Look-Ahead ↔ activity integration + PPC / reason-for-variance** — the weekly ritual feeds the
  data; Look-Ahead stays standalone until then.
- **Systems + cross-scope dependencies** (roof → rough-in) — added when a real schedule-driver clears
  the "Tracking Test" (its own scope of work + something waits on it + tracked separately).
- **Areas / zones** — attach building-scale work to a sheet/level until sub-level zones are truly
  needed.
- **Critical path / float.**
- **Subcontractor self-report + superintendent verification** — requires the external-user
  access-model hardening (the multi-tenancy moment).
- **AI-tracing flywheel** — separate workstream.

---

## Still to confirm before detailed planning

1. **Phase 1 identity migration approach** — given negligible real data, the simplest path (rename
   in place + key instances to the activity id directly) is likely preferable to an `activity_id` FK
   with a dual-read transition. Lean simplest.
2. Confirm **Slice A (Phases 0–3) ships as one coordinated milestone.**

## How we execute

Work the slices **in order**, one phase at a time, each planned in detail via the **`plan-phases`
skill** (which writes the per-phase plan + a fresh-session kickoff prompt) and closed via
`verify-feature`. This master plan is the durable roadmap those per-phase plans hang off.
