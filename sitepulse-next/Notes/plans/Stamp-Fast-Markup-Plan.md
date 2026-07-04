# Stamp & Fast Markup — make the stamp tool a fast way to mark up repetitive places (self-contained build plan)

> Audience: a fresh Claude Code session with no memory of the chat that produced this.
> Read this top-to-bottom, then re-read the actual current files before editing.
> Sibling specs (context, not required reading): `Notes/plans/Drawing-Tool-Excellence-Plan.md`
> (shares the pending-polygon + naming flow and the canvas-interaction posture),
> `Notes/plans/Scale-Measure-Production-Rates-Plan.md` (snapping/measure utilities).

## 0. How to use this doc
1. Read `sitepulse-next/AGENTS.md` (CRITICAL invariants) first — esp. §3 (Canvas
   engine; keep `FloorplanCanvas` lean), §2 (state: Zustand for UI, never `useState`
   for global; persisted-state via `useHydratedStore`), §6 (TypeScript / JSONB /
   IDB-serialization guardrails), §9 (Vitest: globals OFF).
2. Re-read the files named in each phase **fresh** — do not trust line numbers
   here; they drift.
3. Build the sub-phases **in order** (Phase 1 → 3). Each is one fresh session.
4. Keep the owner (product owner, not a developer) in the loop: lead with a 1–2
   sentence plain-English summary; explain jargon in passing; keep it short.
5. Close each phase with the **`verify-feature`** skill (Definition of Done →
   STOP). Do not commit/push until the owner says "Approved."

## Goal
Marking up repetitive rooms becomes fast and fluid. You pick a shape from a
**stamp drawer** (your recently-used shapes plus a few you've named and saved),
and drop copies across the plan. Each drop **snaps** to walls like tracing does,
and you can **rotate / flip / mirror** the shape as you place it. By default a
drop is **instant** (auto-named, no interruption) so you can stamp quickly; when
you want to name as you go, you flip on a "name each stamp" option and the
familiar name + type box appears on each drop.

## Out of scope / deferred
- **Shared / team stamp library.** Owner chose **this-browser, persisted**
  storage (localStorage) for v1 — no database. A project-shared library (DB table
  + RLS, available on any device/teammate) is a clean later upgrade; the drawer UI
  is built so the storage backend can be swapped without reworking it.
- **Forcing a name on every drop.** Owner chose **instant by default**; the
  name/type box is **opt-in** (Phase 3). Do not make naming mandatory.
- **Touch / iPad placement.** Desktop-mouse-primary by decision (memory
  `nav-enhancement-desktop-only`).
- **Multi-stamp / array placement** (drop a grid of N copies in one gesture) — a
  later idea, not v1.
- **Cross-sheet stamps as a first-class feature.** Stamps are normalized shapes,
  so a localStorage stamp is technically usable on any sheet; v1 just doesn't add
  sheet-scoping UI around it.
- **Changing how a placed stamp persists.** A placed stamp is still a normal
  `units` row created via the existing `createUnitMutation` (Phase 1/2) or via the
  pending-polygon → save path (Phase 3). No new write path, no `status_logs`
  involvement.

## Locked product decisions (from the owner, 2026-06-30)
- **Instant by default; name/type box is optional** (a toggle, default OFF). Speed
  first.
- **Named stamps persist in localStorage (this browser)** — no DB migration in v1.
- **Drawer = auto-recents + "Save as stamp"** (both): recently-stamped shapes
  collect automatically; an explicit action names + pins one for reuse.
- **Stamps snap** to walls/grid using the same engine as tracing.
- **Flip / rotate / mirror while placing**, reusing the existing flip/rotate math.

## Data model
**No schema changes. No migrations. No DDL.** v1 persistence is **localStorage via
`useSettingsStore`** (Zustand `persist`). Everything stored must be JSON-
serializable plain objects (§6 — no class instances, no `Map`/`Set`).
- New persisted slice (suggested) `stampLibrary: { recents: StampDef[]; saved: StampDef[] }`
  where `StampDef = { id: string; name: string; points: PercentPoint[]; subtypeId?: string | null; unitType?: string | null; createdAt: string }`.
  - `points` are stored **normalized to the shape's own centroid** (so the stamp
    can be dropped anywhere); placement re-anchors them to the cursor (snapped).
  - `recents` is capped (e.g. last 12), newest-first, de-duped by shape.
  - Read persisted values through **`useHydratedStore`** to avoid hydration
    mismatches (AGENTS §2).
- A placed stamp becomes a normal `units` row: Phases 1–2 create it immediately
  via the existing `createUnitMutation` (instant, auto-named, with a `CREATE_UNIT`
  undo action — mirror `handleInstantStamp`); Phase 3's opt-in naming routes the
  drop through `pendingPolygonPoints` → `UnitNamingPopover` → `saveNewUnitFromPopover`
  instead (mirror `handleDuplicateUnit`).
- **Respect applicability / status invariants:** stamping only creates geometry;
  it writes no status. Never touch `status_logs` except via the existing path.

## Build-on inventory (read these fresh before using)
REUSE — do not reinvent or fork:
- `src/components/canvas/StampPreview.tsx` — the dashed cursor-following preview of
  the selected unit's polygon. Phase 1 extends it to apply the active transform
  (rotate/flip) and the snap offset; Phase 2 lets its source be an armed drawer
  stamp instead of `selectedUnitId`.
- `src/components/FloorplanCanvas.tsx` — `handleStageClick`'s `toolMode === 'stamp'`
  branch (translates the source polygon to the click and calls `onInstantStamp`),
  `handleFlip` (mirror H/V about centroid) and `handleRotatePolygon` (aspect-correct
  90° rotation about centroid) — the **transform math to extract + reuse**;
  `getSnappedCoordinate` inline usage; the `toolMode`-change reset effect; the
  keyboard handler (add stamp transform keys here).
- `src/hooks/useMapActions.ts` — `handleInstantStamp` (auto-name `"{base} (Stamp N)"`
  + `createUnitMutation` + `CREATE_UNIT` undo), `handleDuplicateUnit` (the
  pending-polygon + naming pattern Phase 3 mirrors), `saveNewUnitFromPopover`,
  `setPendingPolygonPoints` / `setUnitNamingOpen`.
- `src/components/UnitNamingPopover.jsx` — the name + `TaxonomyPicker` (type) box
  (Phase 3 reuses it verbatim via the pending flow).
- `src/store/useSettingsStore.ts` — persisted settings + `useHydratedStore`; the
  stamp library lives here. `src/store/useMapStore.ts` — `ToolMode`, selection, and
  the new transient "armed stamp" state.
- `src/utils/geometry.ts` — `getCentroid`, `getSnappedCoordinate`, `isFinitePolygon`
  (validate a transformed/placed stamp before create). Don't fork.
- `src/components/MapHorizontalToolbar.tsx` / `ViewportControls.tsx` — the dock/
  toolbar pattern + glass styling for the drawer toggle + the "name each stamp"
  toggle.

Do **NOT** fork: `getSnappedCoordinate`, the flip/rotate math (extract once, reuse),
the established Query hooks / `createUnitMutation`, `progressAnalytics`.

## Pure logic to extract + unit-test
Framework-free, deterministic, no I/O, **never call `Date.now()` inside** (callers
stamp `createdAt`/`id`):
- **`src/utils/stampTransform.ts`** (NEW, Phase 1):
  - `rotatePolygon(points, dir: 'left'|'right', aspect) → PercentPoint[]` — port the
    aspect-correct 90° rotation about the centroid from `handleRotatePolygon`.
  - `flipPolygon(points, axis: 'horizontal'|'vertical') → PercentPoint[]` — port the
    mirror-about-centroid from `handleFlip`.
  - `normalizeToCentroid(points) → PercentPoint[]` and
    `placeAtAnchor(points, targetPct) → PercentPoint[]` — store a stamp relative to
    its centroid, then re-anchor it to a (snapped) drop point.
  - Test: rotate 4× returns to start; flip twice is identity; aspect correctness;
    normalize→place round-trips a centroid to the target.
- **`src/utils/stampLibrary.ts`** (NEW, Phase 2) — pure ops over plain arrays
  (the store holds the state; these never touch the store):
  - `pushRecent(recents, stamp, cap) → StampDef[]` (newest-first, de-dupe by shape
    signature, cap length).
  - `saveStamp(saved, stamp) → StampDef[]` / `removeStamp(saved, id) → StampDef[]`.
  - `shapeSignature(points) → string` for de-dup. Test cap, de-dup, save/remove.

## Sub-phasing (ship + verify each)

> No migrations anywhere. Each phase is one fresh session. Order is 1→3, but Phase 1
> and Phase 2 are largely independent — Phase 2 (the drawer) is the headline if you
> want to pull it first.

### Phase 1 — Snap + rotate/flip/mirror while placing
- **Plain-English:** stamping a copy now snaps to walls like tracing does, and you
  can spin or flip the shape before you drop it. Still uses the currently-selected
  room as the source and still drops instantly (auto-named) — this phase is about
  placement *quality*, not the drawer yet.
- **Scope:**
  - Add `src/utils/stampTransform.ts` (+ test); refactor `handleFlip` /
    `handleRotatePolygon` to call the shared pure fns (no behavior change to
    existing flip/rotate).
  - Hold a transient **stamp transform** (rotation steps + flipX/flipY) in
    `useMapStore`; apply it in `StampPreview` and at commit. Bind keys **only while
    `toolMode === 'stamp'`**: **R** rotate CW · **Shift+R** rotate CCW · **H** flip
    horizontal · **V** flip vertical (RESOLVED 2026-07-04 — NOT `F`, which is already
    "fit selection to screen"; ignore keys while typing in an input; show a tiny hint).
    Reset the transform on tool change.
  - **Snap** the drop: run the cursor anchor through `getSnappedCoordinate`
    (honor the snapping on/off + strength settings) and show the snap ring; commit
    the snapped, transformed polygon via the existing `onInstantStamp` path.
    Validate with `isFinitePolygon` before create.
- **Approval gates:** none (no migration/RLS/queue). Standard commit/push gate.
- **Exit criteria:** typecheck + test + build green · `stampTransform.test.ts`
  passes (rotate-4×-identity, flip-twice-identity, aspect) · `dev:3010`: select a
  room, stamp mode, rotate/flip the ghost, drop near a wall → it snaps and lands
  rotated/flipped · close with `verify-feature`.

### Phase 2 — Recent-stamps drawer + persistence + "Save as stamp"
- **Plain-English:** a drawer of shapes you can stamp without first selecting a
  room — your recently-stamped shapes show up automatically, and you can name +
  pin the ones you reuse a lot. They're remembered in this browser.
- **Scope:**
  - Add `src/utils/stampLibrary.ts` (+ test) and a persisted `stampLibrary`
    (`{ recents, saved }`) slice in `useSettingsStore` (JSON-serializable; read via
    `useHydratedStore`). Push a recent whenever a stamp/trace is committed.
  - New **drawer UI** (a glass panel matching the toolbar/dock; e.g. bottom or
    side) listing `recents` + `saved`, each a small shape thumbnail + name.
    Selecting one **arms it** for placement (new transient "armed stamp" in
    `useMapStore`) — so stamping no longer requires a selected source unit
    (`StampPreview` + the stamp click path read the armed stamp when present, else
    fall back to `selectedUnitId`). A **"Save as stamp"** action (from the armed
    stamp or a selected room) names + pins it; allow rename/remove.
  - Persist normalized (`normalizeToCentroid`) points so a stamp drops anywhere.
- **Approval gates:** none (localStorage only; no DB). Standard commit/push gate.
- **Exit criteria:** typecheck + test + build green · `stampLibrary.test.ts` (cap,
  de-dup, save/remove) · `dev:3010`: stamp a few shapes → they appear in recents;
  "Save as stamp" + name → persists across reload; arm a drawer stamp and place it
  with NO room selected · close with `verify-feature`.

### Phase 3 — Optional "name each stamp" box on placement
- **Plain-English:** a toggle that, when on, pops the name + type box on every drop
  so you can label as you go; off (the default) keeps stamping instant.
- **Scope:**
  - Add a persisted **"Name each stamp"** toggle (default OFF) in the drawer /
    stamp toolbar.
  - When ON, a stamp drop routes through the **pending-polygon + naming popover**
    instead of instant-create: set `pendingPolygonPoints` to the snapped/transformed
    polygon and open `UnitNamingPopover` (mirror `handleDuplicateUnit`), pre-filling
    the stamp's saved name/type. After save, **re-arm the same stamp** so repeated
    placement stays fast (place → name → Enter → place again).
  - When OFF, behavior is exactly Phase 1/2 (instant, auto-named).
- **Approval gates:** none. Standard commit/push gate.
- **Exit criteria:** typecheck + test + build green · `dev:3010`: toggle ON → each
  drop opens the name/type box pre-filled, Enter saves and re-arms; toggle OFF →
  instant drops; the pending polygon from a stamp is adjustable/snappable like a
  traced one (Drawing Tool Excellence editing applies) · close with `verify-feature`.

## Hard guardrails (AGENTS.md — do not violate)
- **localStorage values must be JSON-serializable** (plain `StampDef` objects); no
  class instances / `Map` / `Set` in the persisted store (§6). Read persisted state
  via `useHydratedStore` (§2).
- **A placed stamp is a normal `units` row** via the existing `createUnitMutation`
  (instant path) or the pending → `saveNewUnitFromPopover` path (Phase 3). Stamping
  writes **no status**; never touch `status_logs` / the `upsert_status_log` path /
  the offline `pendingChanges` buffer.
- **Reuse the flip/rotate math** (extract to `stampTransform.ts`, have the existing
  `handleFlip`/`handleRotatePolygon` call it) — do not maintain two copies.
- **Reuse `getSnappedCoordinate`** for stamp snapping — same call the trace tool
  makes; respect the snapping settings + magnifier-suspends-snapping behavior.
- **Touch `FloorplanCanvas.tsx` minimally** — decomposition is a separate track.
  New transient tool state goes in `useMapStore`; the drawer is its own component.
- **Validate before create** with `isFinitePolygon` (a bad transform/snap must
  never write a degenerate polygon).
- **Vitest globals OFF** — import `{ describe, it, expect, vi }` from `'vitest'`;
  co-locate `*.test.ts`; keep test files type-clean.
- **Lint is NOT a gate** — verify with typecheck + test + build.

## Verification commands (exit-criteria gate)
Run npm with an absolute prefix (Bash cwd persists; a stray `cd` prompts):
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
- **No E2E** — UI/canvas verified via `npm run dev:3010` (port 3010). The canvas
  resists scripted gestures; verify by hand, reading state from
  `window.Konva.stages[0]` where useful.

## Open decisions
- **Transform key bindings** — RESOLVED 2026-07-04: **R** rotate CW / **Shift+R** rotate
  CCW / **H** flip horizontal / **V** flip vertical, gated to `toolMode === 'stamp'`.
  Dropped the original `F` (flip): `F` is already "fit selection to screen" in the map
  canvas (`FloorplanCanvas` keydown, active whenever a unit is selected = the stamp
  source case). `R`/`H`/`V` are free in the always-on handler; `H` is only otherwise used
  by the workbench openings-capture (`openingTypeForKey`, gated behind
  `openingCaptureEnabled`, which is inert in stamp mode), so gating on `toolMode ===
  'stamp'` keeps them fully separate.
- **Drawer placement** (bottom strip vs left/right rail) + thumbnail rendering
  (mini Konva vs SVG path) — decide in Phase 2 (recommend a bottom strip with SVG
  thumbnails).
- **"Mirror" vs "flip"** — treat as horizontal + vertical flips (handled by
  `flipPolygon`); if the owner means a diagonal mirror, add in Phase 1.
- **Recents cap + de-dup signature** — recommend 12 + rounded-points signature;
  finalize in Phase 2.
