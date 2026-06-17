# Initiative Brief — Location Labeling Workbench & Training Flywheel

**Version:** 1.0 (Draft)
**Last updated:** 2026-06-16
**Companion document:** `docs/location-labeling-standard.md` (the *how to label* source of truth)

---

## 1. North Star (the end goal — read this first)

We are strengthening the **core of SitePulse: locations and labeling**, and laying the foundation for a **training flywheel**:

> Tracing floor plans produces clean, consistent labeled data → that data eventually trains an AI that proposes locations automatically → which makes tracing faster → which produces more data. Over time this could grow into our own takeoff-style capability.

**What we ARE building now (in order):** the *data-collection foundation* — a labeling workbench that lets us trace our backlog of thousands of historical drawings, decoupled from live projects, enforcing the labeling standard, capturing clean exportable data. In parallel, *tracing accelerators* that make labeling faster.

**What we are explicitly NOT building yet:** takeoff/quantity measurement, and a custom-trained model. AI-assisted tracing (using *existing* vision models, zero training) comes only after the workbench exists. The bespoke model is the *output* of many flywheel turns, not turn one.

**The moat is the dataset, not the model.** Every label must be stored as clean, portable, fully-owned data (drawing + polygon + role + sub-type + project type + scale + metadata). Model tech will change; clean data ports to whatever's best later.

**Source of truth for *how* to label:** `docs/location-labeling-standard.md`. The workbench must *enforce* that standard, not reinvent it.

---

## 2. How to work (guardrails — non-negotiable)

- **Read before building:** `AGENTS.md`, then `docs/location-labeling-standard.md`, then this brief.
- **Respect the architecture** (per AGENTS.md): Next.js App Router, Zustand for UI state, TanStack Query for server state, Supabase, Konva for canvas. The offline-first mutation queue and `status_logs` idempotency are load-bearing — **do not break them.**
- **Don't disturb live-project flows.** The workbench is a *separate surface*; status tracking, the offline sync queue, `pendingChanges`, and the existing canvas write paths must keep working untouched.
- **TypeScript guardrails:** new files `.ts`/`.tsx`, derive DB types from `database.types.ts`, narrow JSONB at the query boundary, no `any`.
- **Branch:** work on `claude/polygon-drawing-performance-n976r3`. Small, reviewable commits. Run `npm run typecheck` and `npm run test` before each.
- **Work phase by phase. Get plan approval before coding each phase.**

---

## 3. Phase 0 — Investigation & understanding (the agent's first deliverable)

Before any code, the agent investigates and writes up findings. Goal: prove it understands the current system and the gap to the target.

**Investigate and document:**
1. **Data model today** — `projects`, `sheets`, `units` tables (via `database.types.ts` / `domain.ts`): how a unit stores `unit_number`, `unit_type`, `polygon_coordinates`; where `unit_types` come from (project-level default list); how/whether `project_type` is represented.
2. **How units are created/named/typed today** — trace `FloorplanCanvas.tsx` → `useMapActions.ts` (`handlePolygonComplete`, `saveNewUnitFromPopover`) → `UnitNamingPopover`. Understand the full create flow.
3. **The tracing/canvas pipeline** — draw mode, snapping (`useSnappingVectors`, `geometry.ts`), PDF rendering (`usePdfRenderer`, the worker), how polygons are committed. Note the existing **box-drag** and **stamp** features as accelerator precedents.
4. **Project/sheet structure** — how a project holds sheets/levels; how PDFs are ingested (`upload-floorplan`, `attach-original` in `sitepulse-backend/main.py`); how wall vectors are extracted (`extract_vectors_from_pdf`).
5. **Reuse vs. build** — what of the existing canvas/tracing can the workbench and accelerators reuse directly vs. what must be new.

**Phase 0 output (commit as a doc, e.g. `docs/workbench-findings.md`):**
- A map of the current data model and create-unit flow.
- A **gap analysis** vs. the target model in §5.7 of the standard (`project_type`, `top_level_role`, `subtype` dictionary, migration of `unit_type`).
- A recommended **phased implementation plan** with the smallest safe first slice.
- Open questions for the product owner.

**→ Product owner reviews and approves the plan before Phase 1.**

---

## 4. Workstream A — Foundation (the blocking path; priority)

This is the queue. You cannot bank clean labels without it. Each phase = goal, deliverables, acceptance test. Keep phases shippable.

**Phase A1 — Data-model foundation**
- Add `projects.project_type` (the 8 types), `locations.top_level_role` (4 roles), and a global `subtypes` dictionary table (`name`, `top_level_role`, `status`, `aliases[]`, `default_project_types[]`).
- Seed the dictionary from §5.4 of the standard. Migrate existing `unit_type` strings → role + sub-type.
- Update Supabase types + `domain.ts`. *Accept:* existing app still runs; old data maps cleanly.

**Phase A2 — Taxonomy management (the governed dictionary)**
- Role + sub-type pickers, scoped by project type (defaults first, all allowed).
- The propose → approve → alias workflow; `Other (pending)` as non-blocking.
- *Accept:* a labeler can pick a sub-type or propose a new one without free-typing.

**Phase A3 — Workbench shell (decoupled from live projects)**
- A separate "drawing library" surface to ingest historical PDFs, trace them, and bank labels **without** creating fake projects or touching live-project data.
- Per-sheet metadata capture (standard §8: project type, level, sheet #, scale, vector quality, partial flag).
- *Accept:* an old PDF can be loaded into the library and never appears in production project flows.

**Phase A4 — Standard-enforcing labeling UX**
- Tracing that applies the standard: interior-face guidance, one-polygon-per-location, naming rules with trim/uniqueness validation, role+sub-type required, definition-of-done checks (§9), second-person review state.
- **Includes auto-increment naming** (was a standalone accelerator) — it is a naming-convention feature (standard §4), so it lives here with naming validation: when naming a new location, suggest the next number in sequence following the established designator pattern.
- *Accept:* a sheet can be traced end-to-end and flagged "done" only when it passes the §9 checklist.

**Phase A5 — Clean export (the moat)**
- Export the labeled corpus in a portable, model-ready form (drawing reference + polygons + role + sub-type + project type + scale + metadata), versioned against the standard's version.
- *Accept:* a full sheet round-trips out as clean, self-describing data.

---

## 5. Workstream B — Tracing accelerators (parallel; do not block Workstream A)

Independent canvas/tracing-engine features that make labeling faster. They benefit **both the workbench and the live app**, so they are not gated on the workbench data model. **They must not jump ahead of Workstream A** — the foundation is what's blocking; these are optimizers whose payoff peaks once volume tracing begins. Run in parallel or right after Phase A3. Build against the **same canvas/vector pipeline** the workbench uses.

**Phase B1 — Fill room from walls** *(highest ROI; build first)*
- Click inside a room → derive a polygon from the wall vectors already extracted (`extract_vectors_from_pdf` / `useSnappingVectors`) by detecting the enclosing closed region.
- Deterministic (no model). This is the **geometry precursor to AI-assisted tracing** (Phase 6) — the same "propose a polygon" idea without a model.
- *Accept:* on a clean CAD sheet, one click inside a room yields a snapped, standard-compliant polygon the user can accept or adjust.

**Phase B2 — Grid stamp**
- Stamp a repeating location across a row/grid in one gesture (extends the existing stamp/box-drag features). Kills repetitive tracing on towers and repeated units.
- *Accept:* a repeated unit can be stamped across a row/grid in one action, each instance independently named/typed.

> **Note:** these also improve the live app today, independent of the flywheel — so the work isn't wasted even if the workbench slips.

---

## 6. Later phases (out of scope until earlier work lands)

**Phase 6 — AI-assisted tracing (proof-of-concept):** use an existing vision model to *propose* locations/names on a sheet; human accepts/corrects; corrections feed the corpus. Measure accuracy against already-labeled sheets. Builds directly on Phase B1's region-proposal idea.

**Phase 7 — Train our own model:** only with corpus volume. Listed so the sequencing is explicit; not to be started early.

---

## 7. Success criteria for the initiative
- A labeler can trace a historical sheet end-to-end, with the standard enforced, decoupled from live projects.
- Data model cleanly supports project type + role + sub-type + metadata, with the governed dictionary.
- The corpus exports as clean, portable, versioned data.
- Tracing accelerators (fill-from-walls, grid stamp, auto-increment naming) measurably reduce time-per-sheet.
- Zero regressions in live status-tracking / offline-sync flows.

---

## 8. Kick-off prompt (paste into Claude Code)

> Read `AGENTS.md`, `docs/location-labeling-standard.md`, and `docs/initiative-brief.md` in full. Your task is the **Location Labeling Workbench & Training Flywheel** described in the brief.
>
> **Do not write any code yet.** First complete **Phase 0**: investigate the current data model and the create-unit/tracing flow (start at the `projects`/`sheets`/`units` schema, `FloorplanCanvas.tsx`, `useMapActions.ts`, `UnitNamingPopover`, and the PDF/snapping/vector pipeline). Then write `docs/workbench-findings.md` containing: (1) a map of the current model and create flow, (2) a gap analysis vs. §5.7 of the labeling standard, (3) a recommended phased implementation plan starting with the smallest safe slice of **Workstream A**, and (4) open questions for me.
>
> Present that plan and **wait for my approval before building Phase A1.** Respect every guardrail in §2 of the brief — especially: do not break offline sync, `status_logs`, or the existing live-project flows; the workbench is a separate surface. Treat **Workstream A (foundation)** as the priority queue and **Workstream B (accelerators)** as parallel work that must not block it. Work on branch `claude/polygon-drawing-performance-n976r3` in small commits, running typecheck and tests.

---

## 9. Open items (still the product owner's call)

From the labeling standard's Appendix B — the agent should treat these as open, not settled:
- Restaurant **Kitchen = Program** — confirm against real restaurant jobs.
- **"Housing and Hotel"** as a single project type spanning dwelling units + guestrooms — confirm, or split.
- **Holes/donuts** and **two-level locations** — simplified for now; sanity-check against real building types.

---

## 10. Document references
- `docs/location-labeling-standard.md` — how to label (the standard).
- `AGENTS.md` — architecture, state-management, and TypeScript guardrails.
- `docs/workbench-findings.md` — to be produced by the agent in Phase 0.
