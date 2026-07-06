# Kickoff — Stamp & Fast Markup, Phase 2: Recent-stamps drawer + persistence + "Save as stamp"

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 2 of Stamp & Fast Markup** (a drawer of recently-used + saved shapes you can
> stamp WITHOUT first selecting a room; remembered in this browser). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-04 - Stamp Fast Markup Phase 2 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Stamp-Fast-Markup-Plan.md` (Phase 2 + "Pure logic to extract" + "Data model")
> - `sitepulse-next/AGENTS.md` (esp. §2 state/persist, §6 IDB/JSON-serialization guardrails)
>
> Branch off `main` (Phase 1 shipped — d7c74b7). Build **only Phase 2**. **No migration** — persistence
> is localStorage via `useSettingsStore` (`persist`). Keep `FloorplanCanvas.tsx` edits surgical; new
> transient "armed stamp" state goes in `useMapStore`, the drawer is its own component. Reuse Phase 1's
> `stampTransform.ts` (`buildStampPolygon` / `normalizeToCentroid`) — do NOT re-implement placement math.
> Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
Right now you can only stamp a copy of the room you've *selected*. This phase adds a **drawer**: your
recently-stamped shapes collect there automatically, and you can **name + pin** the ones you reuse a lot.
Pick a shape from the drawer and stamp it anywhere — **no need to select a room first**. It's all
remembered in this browser (no database). Naming each drop as you place it is the *next* phase (3) — this
one keeps stamping instant.

## What Phase 1 already shipped (build ON this — read it fresh, don't re-do it)
- **`src/utils/stampTransform.ts`** — `buildStampPolygon(sourcePoints, transform, aspect, anchor)` builds
  the placed polygon from ANY source points (not just a unit). `normalizeToCentroid` / `placeAtAnchor`
  are exactly what a drawer stamp needs (store centroid-relative points; drop at the snapped anchor).
- **`useMapStore`** — transient `stampTransform` + `rotateStamp` / `flipStamp` / `resetStampTransform`
  (reset on tool change). The **armed stamp** you add this phase is the same kind of transient state.
- **`FloorplanCanvas`** — the stamp commit branch in `handleStageClick` (currently reads the SELECTED
  unit's polygon + calls `onInstantStamp`), and `StampPreview` (reads the selected unit) both call
  `buildStampPolygon` with a `snapPoint`-ed anchor. Phase 2 makes both prefer an armed drawer stamp.
- **`ContextActionDock`** — while `toolMode === 'stamp'` it morphs into the rotate/flip controls, BUT it
  is gated on a single selected unit (`isSingle`). ⚠️ See "Seams to mind" — an armed drawer stamp has no
  selected unit, so the transform controls must still appear.
- **`useMapActions.handleInstantStamp(sourceUnitId, points)`** — auto-names `"{base} (Stamp N)"` off the
  SOURCE UNIT's `unit_number`. A drawer stamp has no source unit → the base name must come from the
  `StampDef.name` instead. ⚠️ See "Seams to mind".

## Build-on inventory (read these fresh before using)
- `src/store/useSettingsStore.ts` — persisted Zustand slice + `useHydratedStore`. The `stampLibrary`
  lives here; mirror an existing persisted slice's `partialize` entry. Everything stored must be
  JSON-serializable plain objects (AGENTS §6 — no class instances / `Map` / `Set`).
- `src/store/useMapStore.ts` — add the transient **armed stamp** (the drawer selection being placed).
- `src/components/canvas/StampPreview.tsx` + `FloorplanCanvas.tsx` stamp commit branch — teach both to
  read the armed stamp's (centroid-normalized) points when present, else fall back to `selectedUnitId`.
- `src/components/MapHorizontalToolbar.tsx` / `ViewportControls.tsx` / `ContextActionDock.tsx` — the
  dock/toolbar glass-panel pattern to match for the drawer + a drawer toggle.
- `src/types/domain.ts` — `PercentPoint`; derive `StampDef` here or in `stampLibrary.ts` (plain object).

## Pure logic to extract + unit-test (framework-free; never call `Date.now()` inside — pass it in)
**`src/utils/stampLibrary.ts`** (NEW) — pure ops over plain arrays (the store holds state; these never
touch it):
- `shapeSignature(points) → string` — rounded-point signature for de-dup.
- `pushRecent(recents, stamp, cap) → StampDef[]` — newest-first, de-dupe by signature, cap length (≈12).
- `saveStamp(saved, stamp) → StampDef[]` / `removeStamp(saved, id) → StampDef[]` / (optional) `renameStamp`.
- Test: cap enforced, de-dup collapses same shape, save/remove/rename round-trip.

`StampDef = { id: string; name: string; points: PercentPoint[]; subtypeId?: string | null; unitType?: string | null; createdAt: string }`
— `points` stored **normalized to the shape's own centroid** (`normalizeToCentroid`) so it drops anywhere.

## Scope — build exactly this
1. `src/utils/stampLibrary.ts` (+ `stampLibrary.test.ts`).
2. Persisted **`stampLibrary: { recents: StampDef[]; saved: StampDef[] }`** slice in `useSettingsStore`
   (add to state + `partialize`; JSON-serializable; read via `useHydratedStore`). Push a recent
   (`pushRecent`) whenever a stamp is committed (and, per the plan, on a trace commit too).
3. Transient **armed stamp** in `useMapStore` (`armedStamp: StampDef | null` + setter/clear). Arming a
   drawer stamp enters `toolMode === 'stamp'`; clearing it / leaving stamp mode disarms.
4. **Drawer UI** — a glass panel (recommend a **bottom strip**) listing `recents` + `saved`, each a small
   **SVG-path thumbnail** + name. Click **arms** it. A **"Save as stamp"** action (from the armed stamp
   or a selected room) names + pins it; allow **rename / remove** on saved entries.
5. **Wire the armed stamp through placement:** `StampPreview` and the `handleStageClick` stamp branch use
   the armed stamp's points (via `buildStampPolygon`) when present, else the selected unit. Placement
   stays instant + auto-named (from `StampDef.name` for a drawer stamp; from the unit for a selected room).
6. **No naming popover / "name each stamp" toggle** — that's Phase 3. **No migration.**

## Seams to mind (where Phase 1 assumptions need widening — don't miss these)
- **Transform controls with no selection:** `ContextActionDock`'s stamp morph is gated on `isSingle`.
  With an armed drawer stamp there's no selected unit, so either (a) show the dock when `toolMode ===
  'stamp' && armedStamp` even without a selection, or (b) surface the rotate/flip controls in/next to the
  drawer. Keep the R / Shift+R / H / V keys working (they already are — they only set `stampTransform`).
- **Auto-naming source:** generalize the instant-stamp commit so the `"(Stamp N)"` base name comes from
  the armed `StampDef.name` when there's no source unit (today `handleInstantStamp` derives it from the
  unit). Keep the selected-room path byte-identical.
- **`isFinitePolygon` guard + snap** already wrap the commit — keep them; a drawer stamp flows the same way.
- **Serialization:** `StampDef` is plain JSON. Do NOT stash anything non-serializable (no Konva nodes) in
  the persisted slice or the armed-stamp state that rides through the store.

## Hard guardrails (AGENTS.md — do not violate)
- **localStorage only** (no DB, no migration); persisted values JSON-serializable; read via
  `useHydratedStore`. Do not touch `status_logs` / the offline `pendingChanges` queue — a placed stamp is
  still a normal `units` row via the existing `createUnitMutation`.
- **Reuse** `buildStampPolygon` / `normalizeToCentroid` (Phase 1) and `getSnappedCoordinate`; don't fork.
- **Surgical `FloorplanCanvas` edits**; drawer is its own component; transient state in `useMapStore`.
- **No `any`, no `@ts-nocheck`**; Vitest globals OFF — import `{ describe, it, expect, vi }` from
  `'vitest'`; co-locate `*.test.ts`; keep test files type-clean. **Lint is NOT a gate.**

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` green (commands below).
- `stampLibrary.test.ts` covers cap, de-dup, save/remove(/rename).
- **Live `dev:3010`:** stamp a few shapes → they appear in **recents**; **"Save as stamp"** + name →
  persists across a reload; **arm a drawer stamp and place it with NO room selected**; rotate/flip still
  work on the armed stamp. (A placed stamp writes a real `units` row — verify deliberately, not as a
  probe; [[no-live-write-probes]].)
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Target one file: `... run test -- src/utils/stampLibrary.test.ts`. Lint is NOT a gate. ⚠️ a `next build`
corrupts a running `dev:3010` server → restart via `scripts/restart-dev.ps1`.

## Open decisions (recommendations — confirm cheaply in-phase)
- **Drawer placement** — recommend a **bottom strip** (rail is fine too). **Thumbnails** — recommend
  **SVG path** (cheap, no Konva) over mini-Konva.
- **Recents cap + de-dup signature** — recommend **12** + a **rounded-point** signature.
- **"Save as stamp" source** — from the armed stamp OR a selected room; carry its `subtypeId`/`unitType`
  onto the `StampDef` so Phase 3 can pre-fill type.

## Next after this
Phase 3 (OPTIONAL "name each stamp" toggle, default OFF → routes a drop through the pending-polygon +
`UnitNamingPopover` and re-arms for fast repeat). After the Stamp workstream, the owner's order resumes:
**Slice 1 (type the spine) → Slice 0 P0.4 (canvas golden master) → Slice 2 (decompose FloorplanCanvas)**.
Draft the Phase 3 kickoff after Phase 2 is Approved, per the post-approval handoff ritual.
