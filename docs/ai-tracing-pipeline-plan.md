# AI-Assisted Location Tracing — Implementation Plan

**Goal:** Turn the manual polygon-tracing workbench into a human-in-the-loop pipeline that (a) captures every trace as clean training data starting now, (b) speeds up tracing immediately with AI assist that needs **zero** training data, and (c) compounds — the model gets better as more sheets are traced.

**Status:** Planning. No code written yet. File/symbol references below come from a codebase exploration and should be re-verified during implementation.

**Confirmed:** PyMuPDF (`fitz` 1.27.2.2) is already in `requirements.txt` and used throughout `main.py`; most PDFs carry a searchable text layer; the existing `map_point()` helper (`main.py:499`) already maps PDF coords → `{pctX, pctY}` and is directly reusable for text-word extraction. This makes the cold-start label pre-fill (Track B) near-free.

---

## Current system (what we're building on)

A finished trace already carries most of a training example:

| Asset | Where | Notes |
|---|---|---|
| Polygon | `units.polygon_coordinates` (JSONB) | `{pctX, pctY}` percent points — resolution-independent |
| Name | `units.unit_number` | printed room number/name |
| Type | `units.top_level_role` + `units.subtype_id` | program / common / support / other + subtype |
| Area | `units.computed_area` | shoelace × `sheets.scale_ratio` |
| Flags | `units.spans_levels`, `units.has_void` | |
| Wall geometry | `sheet_vectors` table + RBush index | extracted by backend `extract_vectors_from_pdf` |
| Source PDF | `sheets.base_image_url` | rasterizable for training |

**Key frontend files:** `WorkbenchTracer.tsx`, `WorkbenchLabelPopover.tsx`, `WorkbenchTracerToolbar.tsx`, `FloorplanCanvas.tsx`, `DraftPolygon.tsx`; hooks `useWorkbenchActions.ts` (`useCreateWorkbenchLabel`, `useUpdateWorkbenchLabel`), `useProjectQueries.ts` (`useCreateUnit`); stores `useMapStore`, `useWorkbenchStore`; `utils/geometry.ts` (snapping).

**Key backend:** `sitepulse-backend/main.py` (`extract_vectors_from_pdf`), Supabase/Postgres (`units`, `sheets`, `subtypes`, `sheet_vectors`).

**What's missing:** (1) provenance/correction capture — `units` stores only final state, so the AI-suggested-vs-human-corrected delta (the richest training signal) is currently discarded; (2) any AI in the loop.

---

## Milestone 0 — Annotation spec (do first, blocks mass tracing)

The one decision that's expensive to reverse. Lock the ground-truth convention before scaling up tracing.

### M0.1 — Write `ANNOTATION_SPEC.md`
- **Canonical geometry convention:** trace = polygon **snapped to extracted wall vectors** (the reproducible line), not a freehand "inside edge." Document tolerance expectations and that snapping is the enforcement mechanism.
- **Usable-area rule:** if true inside-edge floor area is needed, keep annotation on the wall line and derive area via inward offset of half wall-thickness (downstream transform; annotation geometry unchanged).
- **Semantics:** what counts as a void, when `spans_levels` applies, naming normalization (trim + collapse whitespace), within-sheet uniqueness.
- **Type taxonomy:** the canonical role/subtype list and how ambiguous spaces are classified.
- **Acceptance:** a second person can trace the same sheet and land within boundary tolerance + identical labels.

### M0.2 — Make snapping the default in draw mode
- Ensure `enableSnapping` defaults on for training traces so geometry is consistent by construction. (`FloorplanCanvas.tsx`, `geometry.ts`.)
- **Acceptance:** vertices placed near a wall consistently land on the wall vector across users.

---

## Milestone 1 — Track A: capture training data now (no-regret foundation)

Every sheet traced before this exists loses its correction signal. Smallest scope, highest urgency.

### M1.1 — `trace_events` append-only table
- Schema: `id`, `unit_id` (nullable for rejects), `sheet_id`, `event_type` (`ai_suggested` | `accepted` | `edited` | `rejected` | `manual_created`), `polygon_before` (jsonb), `polygon_after` (jsonb), `label_before` (jsonb), `label_after` (jsonb), `model_version`, `confidence`, `created_by`, `created_at`.
- Append-only; never updated. This is the canonical provenance/training log.
- **Acceptance:** every create/edit/reject in the workbench writes exactly one event row.

### M1.2 — Provenance columns on `units`
- Add `source` (`human` | `ai_accepted` | `ai_edited`), `model_version`, `suggested_polygon` (jsonb), `suggested_label` (jsonb), `review_status` (`unreviewed` | `confirmed` | `rejected`).
- Migration + backfill existing rows as `source='human'`, `review_status='confirmed'`.
- **Acceptance:** schema migrated; existing data unaffected.

### M1.3 — Wire workbench save paths to emit events
- In `useCreateWorkbenchLabel` / `useUpdateWorkbenchLabel`: on save, write the `units` row **and** a `trace_events` row. When the trace originated from an AI suggestion, record both `suggested_*` and final, so the delta is recoverable.
- **Acceptance:** tracing a new location, editing one, and rejecting a suggestion each produce correct event rows with before/after.

### M1.4 — COCO export job
- Backend job: for a set of confirmed `units`, rasterize each `sheet` PDF at a **fixed DPI**, convert percent→pixel, emit COCO segmentation JSON (image entries + polygon annotations + categories = role/subtype).
- Deterministic DPI and category mapping documented alongside the export.
- **Acceptance:** export of N confirmed units round-trips: re-overlaying the COCO polygons on the rasters matches the workbench rendering.

### M1.5 — Dataset dashboard
- Counts per type/subtype, traces/sheet, and (once Track B lands) AI accept/edit/reject rates and median correction magnitude.
- **Acceptance:** a single view shows dataset size and growth.

---

## Milestone 2 — Track B: cold-start assist (zero training data, biggest speedup)

Available day one; reuses existing backend. Build in this order.

### M2.1 — PDF text-layer extraction (backend) — **confirmed feasible, near-free**
- PyMuPDF (`fitz` 1.27.2.2) is already a dependency and the majority of PDFs carry a searchable text layer (confirmed), so no OCR dependency is needed for the common case.
- Add an endpoint that runs `page.get_text("words")` and maps each word's bbox through the **existing `map_point()` transform** (`main.py:499`) — the same derotation + cropbox + percent normalization used by `extract_vectors_from_pdf`. Words land in the identical `{pctX, pctY}` space as polygons/vectors, so no new coordinate convention.
- Cache to a `sheet_text` table mirroring the `sheet_vectors` write-through pattern.
- Minority scanned sheets: detect empty text result and fall back to OCR later (not on the critical path).
- **Acceptance:** endpoint returns located words in percent coords for a sample sheet; words overlay correctly on the rendered plan; scanned-vs-vector coverage logged.

### M2.2 — Wall-vector room proposal (backend, highest leverage)
- From `sheet_vectors`: rasterize segments → morphological close (bridge doorway gaps) → flood-fill negative space → `findContours` → Douglas-Peucker simplify → percent polygons + a confidence heuristic.
- Returns candidate room polygons for an **entire sheet at once** — the core "trace thousands of sheets faster" lever.
- **Acceptance:** on a clean sheet, proposals cover the majority of rooms with reasonable boundaries; gap-bridging tunable.

### M2.3 — Label pre-fill
- For each candidate polygon, attach interior text words (M2.1) → propose `unit_number`. Send polygon crop + name + taxonomy to a vision-LLM (Claude) → propose `role`/`subtype`.
- **Acceptance:** majority of proposals arrive with a plausible pre-filled name and type.

### M2.4 — "Auto-trace sheet" in the workbench
- New toolbar action → calls M2.2/M2.3 → renders candidates as **suggested/pending** overlays (visually distinct). Human accepts / edits / rejects each; every action emits `trace_events` (M1.3) with `source` set accordingly. AI suggestions **never** auto-confirm without human review.
- **Acceptance:** a user can auto-populate a sheet and resolve each suggestion; provenance recorded.

### M2.5 — SAM click-to-segment (the irregular rooms)
- Service wrapping SAM/SAM 2: click inside a space → mask → polygon → snap to wall vectors → feed existing `onPolygonComplete` → popover flow.
- **Acceptance:** click-to-trace produces a snapped polygon for spaces flood-fill misses.

---

## Milestone 3 — Track C: the flywheel (after Track A has data)

### M3.1 — Training pipeline on the COCO export (segmentation model).
### M3.2 — Inference/pre-trace endpoint returning polygons + confidence, same overlay UX as M2.4.
### M3.3 — Active learning: confidence-based queue; route low-confidence sheets/regions to humans first.
### M3.4 — Eval harness: Boundary-IoU / mask-IoU vs held-out human traces; per-type accuracy tracked over time and tied to `model_version`.
### M3.5 — Retraining cadence + model registry; `model_version` stamped on every suggestion and event.

---

## Sequencing summary

1. **M0** — annotation spec (unblocks consistent mass tracing).
2. **M1** — provenance + COCO export (every trace becomes training data; can't be recovered retroactively).
3. **M2.1–M2.3 in parallel** — vector room proposal + text-layer labels (biggest immediate speedup, no model needed).
4. **M2.4–M2.5** — wire assist into the workbench UI.
5. **M3** — train, route, evaluate, retrain; accuracy compounds as tracing continues.

## Cross-cutting principles
- AI proposals are **suggestions**, never auto-confirmed — a human reviews every one.
- Capture the **suggested-vs-final delta**, not just the final — it's the richest signal and the active-learning input.
- Human and AI follow the **same geometry convention** (snap to wall vectors) so corrections are clean and comparable.
- `model_version` stamped everywhere for reproducibility and per-model evaluation.
