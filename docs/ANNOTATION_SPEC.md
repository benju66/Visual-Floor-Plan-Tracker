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

**The one rule: get the Type right; name the location as it reads on the drawing.** The **Type** is the only field the model actually learns, and it disambiguates anything confusing in the name. The **name** is a human-readable label — keep it tidy, don't agonize over it.

Capture two things per location:

- **Type** — `top_level_role` (`program` / `common` / `support` / `other`) + `subtype_id`, from the Location Taxonomy (`src/utils/locationTaxonomy.ts`). **This is the training label and the must-get-right field.** `top_level_role` is the single source of truth for role — never infer it from the subtype. If unsure of the subtype, leave `subtype_id = NULL` (the review-queue signal), not a guess.
- **`unit_number`** — the location's name/number exactly as it reads on the sheet (the app trims/collapses whitespace). **Always include the unique plan number** — it is the location's unique ID. Prefer the sheet's own text-layer label; when the sheet has no label, name by function (`Stair`, `Mech`, `Elec`) and let the Type carry the meaning.

**Set the Type by what the space *is*, not by the abbreviation.** If a tag reads `ELEC` but it is an elevator, pick **Elevator** — the Type is correct even when the text is ambiguous. (Watch this collision: `ELEC` usually means Electrical.)

**Abbreviations** — spell them out consistently for a readable list (`Electrical`, not `ELEC`; `Elevator`, not `ELEV`). This is cosmetic; it changes nothing for the model. Just never mix styles within a project.

**Designation / plan-code (`B1`, stair `H`) is intentionally NOT a separate field in v1.** Plan codes like `B1` are project-specific, so they carry little cross-project training value — the Type does the work. Keep the code in the name if it reads that way, or drop it; either is fine. It can be parsed out of the retained label later if a need ever arises.

### Worked examples

| On the drawing | `unit_number` (name) | `top_level_role` | subtype |
|---|---|---|---|
| `UNIT B1 1103` | `Unit 1103` | `program` | Residential Unit |
| `STAIR H 194` | `Stair H 194` | `common` | Stair |
| `CORRIDOR 150` | `Corridor 150` | `common` | Corridor |
| `ELEC 122` | `Electrical 122` | `support` | Electrical |
| `ELEV 2` | `Elevator 2` | `common` | Elevator |
| `TRASH 118` | `Trash 118` | `support` | Trash |
| `LOBBY 100` | `Lobby 100` | `common` | Lobby |

**Role quick guide:** `program` = primary-purpose spaces (units, offices, sales/retail); `common` = circulation/shared (stairs, corridors, lobbies, elevators, amenities); `support` = back-of-house (mech, elec, trash, storage, janitor); `other` = doesn't fit → leave subtype `NULL` and flag.

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
  - *§3 expanded (clarification, not a meaning change — stays v1):* worked naming standard — Type is the training label and the must-get-right field; name as it reads incl. the unique number; set Type by what the space is (not the abbreviation); designation/plan-code (`B1`/`H`) intentionally not a separate field in v1; worked examples + role quick guide.
