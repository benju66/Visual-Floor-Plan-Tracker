# SitePulse — Location Labeling Standard

**Version:** 0.2 (Draft)
**Last updated:** 2026-06-16
**Status:** In review — pending field validation against real drawings

---

## At a glance (locked decisions)

| Decision | Choice |
|---|---|
| **Granularity** | One polygon per **location** (an independently-tracked space), never per room inside it |
| **Polygon edge** | **Interior face** of the walls bounding the location |
| **Top-level roles** | **Program · Common · Support · Other** (rigid, universal) |
| **Project types** | Commercial · Educational · Government · Healthcare · Housing and Hotel · Industrial · Restaurant · Workplace |
| **Sub-types** | A single **global, governed dictionary** that grows by a controlled process — never free-typed |

---

## 0. Purpose & how to use this document

This standard governs how every location is traced and labeled in SitePulse. Its single job is **consistency**: the labels you and your team produce become the training data for the system's future AI, and an AI is only as good as the consistency of what it learns from. Two people labeling the same drawing should produce nearly identical results.

How to use it:
- When in doubt, **follow the rule.**
- When the rule doesn't cover a case, **log it** (§9) so we extend the standard rather than improvise.
- This is a **living document.** Changes are versioned (§10) so the training data stays internally consistent over time.

---

## 1. The cornerstone rule — what *is* a "location"?

A **location** is the smallest space the field team **plans, tracks, and signs off on as a single deliverable** — not a room, not a wall-bounded box. Walls don't define a location; *function and turnover* do.

> **The Turnover Test (use this for every judgment call):**
> If the field team schedules, tracks status on, and completes a space as **one thing**, it is **one location**. If two adjacent spaces are tracked and turned over separately, they are **two locations**.

Consequences:
- An **apartment unit** is **one location**, even though it contains a kitchen, living room, bedrooms, and baths — because it's turned over as a unit. **Never label the rooms inside it.**
- A **back-of-house room** (e.g. *Electrical/Data Room*) is **one location** — it's tracked on its own.
- In a **commercial fit-out**, the grain shifts to match how the work is tracked: a salon's individual **studio** is a location; a pickleball facility's **locker room, entrance, each court, gym** are each a location. Same rule, different program.

The grain changes by project type, but the principle never does: **one location = one independently-tracked space.**

**Never do:** label individual rooms *within* a single-turnover location; label the same physical space twice; or split one location across two polygons (see §3).

---

## 2. Granularity by project type (worked examples)

| Project type | One location = | Do **not** make separate locations for |
|---|---|---|
| **Multifamily / Housing** | Each dwelling unit; each BOH room; each distinct common area | Kitchen/bed/bath inside a unit; closets; the wall between units |
| **Commercial / fit-out** | Each tenant suite *or* each separately-tracked room within it (salon studio, treatment room) | Sub-areas not tracked on their own |
| **Recreational / institutional** | Each functional space (court, locker room, gym, entrance, lobby) | Circulation that isn't separately tracked |

If a project's tracking grain isn't obvious, ask: *"How does the schedule break this floor down?"* That breakdown **is** your location list.

---

## 3. Polygon geometry conventions

1. **Edge = interior face.** Trace the inside face of the walls that bound the **whole location** — its demising and exterior walls. **Ignore interior partitions** (the partitions between an apartment's own rooms are inside the location, not boundaries of it).
   *Rationale:* the interior face is anchored to a line actually drawn in the PDF, so it's the most consistently reproducible convention — which is what training data needs. Small gaps at shared walls are acceptable (the wall genuinely belongs to neither location and reads as a clean boundary to an AI).
2. **One polygon per location.** Never two. If a location reads as two disconnected blobs, re-check the Turnover Test — it's usually two locations.
3. **Use snapping + corner gravity** for every vertex. Vertices land on wall-line corners, not free-floating points.
4. **Follow the real shape, minimally.** One vertex per actual corner. Don't add vertices the wall doesn't have; don't smooth away corners it does have. No self-intersecting outlines.
5. **Curved walls:** approximate with short straight segments — enough to follow the curve, no more (rule of thumb: a new vertex roughly every 15° of arc).
6. **Open / implied boundaries** (a lobby flowing into a corridor, an open court edge): trace to the **functional boundary** — a painted line, a floor-material change, a column line, or the implied division shown on the drawing. Pick the most defensible drawn feature and apply it consistently across similar cases.
7. **No donuts/holes** in this version. If a location wraps an excluded core (e.g. a unit around a shaft), label the core as its own location — it usually is one.

---

## 4. Naming conventions (the location's name)

1. **Dwelling units / suites:** use the official designator exactly as printed on the drawings — `301`, `PH-2`, `A-104`. Don't reformat it.
2. **BOH / common / named rooms:** `<room number if shown> - <Name>` — e.g. `1042 - Electrical/Data Room`, `B12 - Trash`. If there's no room number, use the name alone — `Lobby`, `Court 1`, `Men's Locker Room`.
3. **Casing:** preserve official designators verbatim; use Title Case for descriptive names.
4. **No leading/trailing spaces and no double spaces** — these silently break status matching downstream. Trim everything.
5. **Uniqueness:** unique within a **sheet/level** is mandatory; unique within the **project** is strongly preferred. Where floor isn't already encoded in the designator, prefix the level (`L3 - Corridor`, not two bare `Corridor`s).
6. **Repeated/stacked units:** the floor-encoded number already differentiates them (`301`, `401`). Don't add suffixes like "(Copy)".

---

## 5. Type taxonomy

Three independent axes carry all the meaning. Don't collapse them.

### 5.1 The three axes

| Axis | Lives on | Stability | Answers |
|---|---|---|---|
| **Project type** | the **project** | fixed list (8) | *What kind of job is this?* |
| **Top-level role** | the **location** | **rigid** (4) | *What does this space do in any building?* |
| **Sub-type** | the **location** | **governed, growing** | *Specifically what is it?* |

### 5.2 Top-level roles (the rigid layer — what the AI learns first)

| Role | Definition | Assignment test |
|---|---|---|
| **Program** | The spaces that *are the building's purpose* | "Is this what the building exists to do?" → apartment, patient room, classroom, dining area |
| **Common** | Shared use & circulation | "Do occupants pass through or share it?" → lobby, corridor, stair, public restroom, waiting |
| **Support** | Back-of-house; makes the building run | "Does it serve the building, not the occupant directly?" → mechanical, electrical, storage, staff-only areas |
| **Other** | Uncategorized / pending a sub-type | Use sparingly; always flagged for review |

These four hold for **every** vertical — that is the point. All vertical-specific detail moves down into project type + sub-type, so adding Healthcare or Industrial never disturbs this layer.

### 5.3 Project types (8)

Commercial · Educational · Government · Healthcare · Housing and Hotel · Industrial · Restaurant · Workplace.

Set once **per project**. It scopes which sub-types appear first in the pick-list — it does **not** restrict them (see 5.4).

### 5.4 Seed sub-type dictionary

**Common and Support sub-types are universal** — defined once, used in every vertical. Only **Program** sub-types are vertical-specific. This is the seed; the dictionary grows from here via §5.5 governance.

**Universal — Common:** Lobby/Entry · Vestibule · Corridor · Stair · Elevator/Elevator Lobby · Public Restroom · Reception/Waiting · Amenity/Lounge

**Universal — Support:** Mechanical · Electrical · Data/IT/Telecom · Plumbing/Riser · Storage · Janitor/Custodial · Trash/Refuse · Loading/Receiving · Staff-Only (break/locker)

**Program — by project type (seed; grows per governance):**

| Project type | Seed Program sub-types |
|---|---|
| **Commercial** | Retail Sales Floor · Tenant Suite (shell) · Showroom · Salon Studio · Fitness Studio · Service Counter |
| **Educational** | Classroom · Lecture Hall · Teaching Lab · Library/Media Center · Gymnasium · Cafeteria/Dining · Art/Music Studio |
| **Government** | Office · Courtroom · Hearing/Council Chamber · Public Service Counter · Records · Holding/Detention |
| **Healthcare** | Patient Room · Exam Room · Operating Room · Procedure Room · Dental Operatory · Imaging/Radiology · Treatment Bay · Nurses' Station · Lab · Pharmacy |
| **Housing and Hotel** | Dwelling Unit · Guestroom · Suite · Live/Work Unit · Event/Ballroom · Meeting Room |
| **Industrial** | Manufacturing Floor · Assembly Area · Warehouse Bay · Clean Room · Process Area · Lab · Cold Storage |
| **Restaurant** | Dining Area · Bar/Lounge · Private Dining · Kitchen · Prep · Outdoor/Patio Dining |
| **Workplace** | Open Workstation Area · Private Office · Conference Room · Huddle/Phone Room · Training Room · Collaboration Area |

**Cross-cutting rules:**
- **Sub-types are global, not locked to a project type.** A café inside a hospital uses Restaurant's `Dining Area`; project type only orders the pick-list. This prevents duplicate entries across verticals.
- **Restrooms:** public → Common (`Public Restroom`); staff-only → Support (`Staff-Only`).
- **"Kitchen" disambiguation:** a restaurant's production kitchen → **Program** (`Kitchen`); an office pantry/kitchenette → **Common** (`Amenity/Lounge`). The Turnover Test decides: is it the building's purpose, or a shared convenience?

### 5.5 Governance — how the dictionary grows (the flexible layer)

The rigidity is in the **process**, not the list:
1. **Pick from the dictionary** — never free-type a sub-type.
2. **No fit?** Tag `Other (pending)` + the correct top-level role, and **propose** the new sub-type. Work is never blocked.
3. **One owner approves** the proposal — either adding it (mapped to one top-level role) or **aliasing** it to an existing entry (`Salon Suite` → `Salon Studio`).
4. **A pile of `Other`s is the trigger** to add a real sub-type, not a place to park ambiguity.

### 5.6 Why this also serves the AI

- The **top-level role classifier** trains on a small, stable, mutually-exclusive set — reliable from day one.
- **Sub-types become model classes as the data accumulates.** A brand-new sub-type with only a few examples can't be learned yet, but it still rolls up correctly to its top-level role, so nothing is lost. Once enough examples exist, it can become its own predicted class — no rework.

### 5.7 Data-model implications (for the workbench build)

- `projects.project_type` — one of the 8 (confirm/add).
- `locations.top_level_role` — enum of the 4 (new).
- `locations.subtype_id` → **`subtypes` dictionary table** (new): `name`, `top_level_role`, `status` (active/pending/deprecated), `aliases[]`, `default_project_types[]` (pick-list scoping).
- One-time **migration** of the current `unit_type` string → role + sub-type (e.g. `Apartment Unit` → Program/`Dwelling Unit`; `Back of House` → Support/specific; `Other` → `Other (pending)`).

---

## 6. Coverage & completeness (per sheet)

1. **Trace from the architectural floor plan** (the dimensioned plan sheet), not from MEP/structural/landscape sheets, unless told otherwise. One canonical sheet per level.
2. **Label every trackable location** on the sheet — don't cherry-pick.
3. **Skip:** wall thicknesses, chases/shafts that aren't tracked, purely graphical content, anything outside the building footprint.
4. **Overlapping sheets / enlarged plans:** label a location on its **primary** sheet only; never label the same physical space on two sheets.
5. **Partial / cut-off drawings:** label only locations fully shown. Flag partials in metadata (§8) rather than guessing missing geometry.

---

## 7. Edge-case catalog (grows over time)

- **Stacked identical units across floors:** label each floor's instance; the floor-encoded name differentiates them.
- **Two-level locations** (mezzanine, loft, double-height): label on the floor where it's tracked/turned over; note the second level in metadata.
- **Ambiguous shared boundary between two locations:** split along the demising wall's interior faces — each location to its own inner face (the wall between is intentionally unlabeled).
- **Tiny spaces** (a single janitor closet): still a location if tracked separately; otherwise fold into the parent per the Turnover Test.
- **Demo vs. new** (renovation): label per the **final** condition unless the project explicitly tracks demo separately.

---

## 8. Drawing metadata to capture (makes the training set filterable later)

For each traced sheet, record:
- **Project type** — one of the 8 (§5.3)
- **Level**
- **Source sheet number**
- **Drawing scale**
- **Vector quality** — clean CAD vs. scanned/raster
- **Partial?** flag

This lets us later train or evaluate the AI on, say, "clean Healthcare plans" vs. "scanned Commercial," instead of one undifferentiated pile.

---

## 9. Definition of done & review

A sheet is "done" when:
1. Every trackable location is labeled, named, typed (role + sub-type).
2. No two polygons cover the same physical space; no location is split.
3. All names are trimmed and unique within the level.
4. A **second person** spot-reviews against the Turnover Test (§1) and naming rules (§4).
5. Any case the standard didn't cover is **logged** (a running "labeling questions" list) so we extend the standard.

---

## 10. Change control

This standard is versioned. When a rule changes, bump the version and note what changed — the AI's training data must stay internally consistent, and a silent rule change mid-corpus quietly degrades a model. Old labels stay valid under the version they were made; major changes may warrant a re-review pass.

---

## Appendix A — Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-16 | Granularity = **location level** (one polygon per independently-tracked space; never per interior room) | Matches the app's core; settled by the Turnover Test |
| 2026-06-16 | Polygon edge = **interior face** | Anchored to a drawn line → most reproducible; clean boundaries for AI; takeoff deprioritized |
| 2026-06-16 | Top-level roles = **Program / Common / Support / Other** (replaces the earlier program-flavored 5) | Universal across all verticals; vertical detail moves to project type + sub-type |
| 2026-06-16 | Project types = **8** (Commercial, Educational, Government, Healthcare, Housing and Hotel, Industrial, Restaurant, Workplace) | Provided by product owner |
| 2026-06-16 | Sub-types = **single global governed dictionary** (propose → approve → alias; `Other (pending)` is non-blocking) | "Rigid but flexible" — rigidity in the process, flexibility in a growing controlled list |

## Appendix B — Open items to validate

- Restaurant **Kitchen = Program** (§5.4) — confirm against real restaurant jobs.
- **"Housing and Hotel"** as a single project type spanning dwelling units + guestrooms — confirm, or split.
- **Holes/donuts** (§3.7) and **two-level locations** (§7) simplified for v0.2 — sanity-check against real building types.
