# Kickoff — Stamp & Fast Markup, Phase 1: Snap + rotate/flip/mirror while placing

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 1 of Stamp & Fast Markup** (stamp placement now snaps to walls and can be rotated/flipped/mirrored before dropping; still uses the selected room as source and still drops instantly). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-06-30 - Stamp Fast Markup Phase 1 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Stamp-Fast-Markup-Plan.md` (Phase 1)
> - `sitepulse-next/AGENTS.md`
>
> Branch off `main`. Build **only Phase 1**. No migration. Keep `FloorplanCanvas.tsx` edits surgical; extract the flip/rotate math to a shared util rather than duplicating it. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English summary
Today, "stamping" drops a copy of a selected room at your cursor — but it doesn't
snap to walls and you can't turn or flip it first. This phase fixes both: the
dropped copy snaps like tracing does, and you can rotate / flip / mirror the shape
as you place it. It still uses the currently-selected room as the source and still
drops instantly with an auto-name — the drawer and optional naming come in
Phases 2 and 3. Small, self-contained placement-quality upgrade.

## Why this phase exists / what's true right now
- The stamp tool (`toolMode === 'stamp'`) shows a dashed preview of the **selected
  unit's** polygon following the cursor (`StampPreview.tsx`) and, on click, the
  `handleStageClick` stamp branch translates that polygon to the click point and
  calls `onInstantStamp` → `useMapActions.handleInstantStamp` (auto-names
  `"{base} (Stamp N)"`, creates the unit via `createUnitMutation`, pushes a
  `CREATE_UNIT` undo). **No snapping. No transform.**
- The flip/rotate math already exists in `FloorplanCanvas`: `handleFlip` (mirror
  H/V about the centroid) and `handleRotatePolygon` (aspect-correct 90° rotation
  about the centroid). **Extract these to a pure util and reuse** — do not write a
  second copy.
- Tracing already snaps via `getSnappedCoordinate` (respecting the snapping on/off
  + strength settings, and suspending while the magnifier is up). Stamp placement
  should make the same call.

## Required reading (in order)
1. `sitepulse-next/AGENTS.md` — esp. §3 (Canvas engine; keep `FloorplanCanvas`
   lean), §2 (Zustand for transient UI state), §6 (TS/JSONB/IDB guardrails),
   §9 (Vitest globals OFF).
2. `sitepulse-next/Notes/plans/Stamp-Fast-Markup-Plan.md` — whole thing, then
   **Phase 1** + "Pure logic to extract + unit-test" + "Hard guardrails".
3. Current source, read FRESH (line numbers drift):
   - `src/components/canvas/StampPreview.tsx` — the preview to extend with the
     transform + snap.
   - `src/components/FloorplanCanvas.tsx` — `handleStageClick` stamp branch,
     `handleFlip`, `handleRotatePolygon`, the `getSnappedCoordinate` inline call,
     the `toolMode`-change reset effect, the keyboard handler.
   - `src/hooks/useMapActions.ts` — `handleInstantStamp` (the commit path).
   - `src/store/useMapStore.ts` — `ToolMode` + where transient stamp-transform state
     goes. `src/utils/geometry.ts` — `getCentroid`, `getSnappedCoordinate`,
     `isFinitePolygon`.

## Scope (build ONLY this)
1. Add `src/utils/stampTransform.ts` (+ `stampTransform.test.ts`): `rotatePolygon`
   (aspect-correct 90° about centroid), `flipPolygon` (mirror H/V about centroid),
   `normalizeToCentroid` + `placeAtAnchor`. Port the math from `handleRotatePolygon`
   / `handleFlip`, then **refactor those two handlers to call the shared fns** (no
   behavior change to existing flip/rotate on saved/pending shapes).
2. Hold a transient **stamp transform** (rotation steps + flipX/flipY) in
   `useMapStore`; apply it in `StampPreview` (so the ghost shows the rotated/flipped
   shape) and at commit. Bind keys while `toolMode === 'stamp'`: **R / Shift+R**
   rotate right/left, **F** flip horizontal, **V** flip vertical (confirm keys;
   show a small hint). **Reset the transform on tool change** (extend the existing
   reset effect).
3. **Snap** the drop point with `getSnappedCoordinate` (honor snapping settings +
   magnifier-suspends-snapping), show the snap ring, and commit the snapped +
   transformed polygon via the existing `onInstantStamp` path. **Validate with
   `isFinitePolygon` before create.**
4. **No drawer, no persistence, no naming popover** (Phases 2–3). No migration.

## Approval gates
- **No hard ⛔ gate** (no migration, no RLS/auth, no queue change).
- Standard rule: **do not commit or push until the owner says "Approved."**

## Exit criteria (Definition of Done)
- `typecheck` (primary gate) + `test` + `build` green:
  ```
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
  npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
  ```
- `stampTransform.test.ts` covers: rotate 4× = identity, flip twice = identity,
  aspect correctness, normalize→place round-trip.
- **Live `dev:3010`:** select a room → stamp mode → rotate/flip the ghost with the
  keys → drop near a wall: it **snaps** and lands **rotated/flipped**; existing
  flip/rotate on a selected/pending shape is unchanged. The magnifier still
  suspends snapping while up.
- Close with the **`verify-feature`** skill (Definition of Done → STOP). Then draft
  the Phase 2 kickoff per the post-approval ritual.

## Guardrails specific to this phase
- **Extract, don't duplicate** the flip/rotate math (one source of truth in
  `stampTransform.ts`).
- **Reuse `getSnappedCoordinate`** — same call the trace tool makes; respect the
  snapping settings and the magnifier-suspends-snapping rule.
- **Surgical edits** to `FloorplanCanvas.tsx`; new transient state in `useMapStore`,
  not `useState`. Decomposition is a separate track.
- **Validate before create** with `isFinitePolygon`; a placed stamp stays a normal
  `units` row via `createUnitMutation` — no `status_logs`, no `pendingChanges`.
- **Vitest globals OFF** — import `{ describe, it, expect, vi }` from `'vitest'`;
  keep test files type-clean.
- **Lint is NOT a gate** — verify with typecheck + test + build.
