# Annotation Spec — v1

**Status:** v1 (thin capture). This is the rulebook for *how a room/location is traced and labeled* so that every annotation is consistent enough to train a model on later. It is intentionally small; it grows by **adding** rules with a new `spec_version`, never by silently changing the meaning of an old one.

`spec_version` is stamped on every `trace_events` row and on every `units` row created under this rulebook (`units.spec_version`). When a rule below changes materially, bump the version (`v1` → `v2`) so old and new annotations stay distinguishable at training time.

---

## 1. What counts as one location (a `units` row)

- **One enclosed room = one location.** Trace the **inner face of the enclosing walls** (the usable floor boundary), not the wall centerline and not the outer face. Be consistent — the model learns the convention you pick, so a mix is worse than either choice alone.
- **Closets, alcoves, and niches** that open into a room are part of that room unless they have their own door/label — then they are their own location.
- **Corridors / circulation** are their own locations, traced as continuous polygons; do not merge a corridor into the rooms it serves.
- **Two-level / double-height spaces:** trace once on the level where it is labeled; set `spans_levels = true` and use `level_note` for the second-level note (existing Phase-7 fields).
- **Voids / donuts** (a hole in the floor plate, e.g. an atrium opening): trace the outer boundary and set `has_void = true` (existing Phase-7 field).

## 2. Geometry rules

- **Snapping is ON by default** when drawing. Corners should land on wall intersections via the snapping engine; only drop to free-hand when the vector layer is missing or wrong (scanned sheets).
- **Close the polygon** — first and last point coincide. No self-intersections.
- **Minimum fidelity:** trace the real corners. Do not approximate an L-shaped room as a rectangle. Curved walls: enough points that the polygon visually tracks the curve.
- Coordinates are stored normalized (`PercentPoint[]` = `{pctX, pctY}`), as today.

## 3. Naming & typing rules

- **`unit_number`** = the room's name/number as it reads on the sheet (e.g. `Office 214`, `Corridor C-2`). Trim and collapse whitespace (the app already normalizes).
- Prefer the **sheet's own label** (text layer) when present. When the sheet has no label, name by function (`Stair`, `Mech`, `Elec`, `Janitor`) and let the type taxonomy carry the meaning.
- **`top_level_role`** (`program` / `common` / `support` / `other`) and **`subtype_id`** follow the existing Location Taxonomy (`src/utils/locationTaxonomy.ts`). `top_level_role` is the single source of truth for role — never infer it from the subtype.
- If unsure of the subtype, leave `subtype_id = NULL` (this is the review-queue signal), not a guessed value.

## 4. Provenance rules (what makes it training data)

Every location records **where it came from** and **what was changed**, so the model can learn from your corrections rather than just your final answers:

- **`units.method`** — how the *geometry* originated: `manual`, `geometric` (vector room-detect), `sam`, `vision_llm`, `imported`.
- **`units.source`** — provenance of the *final accepted value*: `human` (drawn from scratch), `ai_suggested` (machine proposal, untouched), `ai_accepted` (proposal accepted as-is), `ai_edited` (proposal corrected by a human).
- **`units.model_version`** — identifier of the model/engine that produced a suggestion (null for pure-manual).
- **`units.suggested_polygon` / `units.suggested_label`** — the *original machine proposal*, frozen, even after a human edits the live values. This frozen-before vs. final-after pair is the correction signal; it cannot be reconstructed later, which is why it is captured now.
- **`units.review_status`** — `unreviewed` (machine proposal not yet confirmed) or `confirmed` (a human has signed off). Existing hand-traced rows are `confirmed`.

## 5. Leakage-safe grouping

- Sheets from the **same physical building** share drafting style and must never be split across train and test folds (it inflates accuracy). `workbench_sheets.source_building` is a free-text tag identifying the source building/project; set it when a building contributes more than one sheet.
- Export-time grouping (`group_key`) is derived as `source_building` when present, else the sheet id. This keeps a one-off single sheet in its own group without forcing a tag on every upload.

## 6. The event log

`trace_events` is an **append-only** log (one row per meaningful action: create, edit geometry, edit label, delete, accept/reject a suggestion). It captures before/after, method, source, `duration_ms` (time spent — the speed metric that proves whether assist actually helps), and `spec_version`. It is written best-effort from the app; the `units` provenance columns above are the durable fallback if an event write is ever missed.

---

### Changelog
- **v1** — initial thin-capture rulebook: one-room-per-location with inner-face boundary, snapping-on, taxonomy-based naming, full provenance + correction-signal capture, building-level leakage grouping.
