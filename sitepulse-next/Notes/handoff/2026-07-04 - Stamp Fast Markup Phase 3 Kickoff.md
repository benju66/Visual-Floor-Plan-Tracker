# Kickoff — Stamp & Fast Markup, Phase 3: Optional "name each stamp" box on placement

## ▶ Launch prompt (paste this to start a fresh session)
> Implement **Phase 3 of Stamp & Fast Markup** (a toggle — default OFF — that pops the
> name + type box on every stamp drop so you can label as you go, then re-arms for fast
> repeat). Read these in full, then follow them:
> - `sitepulse-next/Notes/handoff/2026-07-04 - Stamp Fast Markup Phase 3 Kickoff.md` (this file)
> - `sitepulse-next/Notes/plans/Stamp-Fast-Markup-Plan.md` (Phase 3 + "Data model")
> - `sitepulse-next/AGENTS.md` (esp. §2 state/persist, §3 canvas engine — keep FloorplanCanvas lean)
>
> Branch off `main` (Phase 2 shipped — 405ea84). Build **only Phase 3**. **No migration.**
> When the toggle is OFF (default) behavior is byte-identical to Phase 1/2 (instant,
> auto-named). When ON, a drop routes through the EXISTING pending-polygon + naming popover
> (mirror `handleDuplicateUnit` / `saveNewUnitFromPopover`) instead of instant-create,
> pre-filling the stamp's saved name/type, then **re-arms the same stamp**. Reuse
> `UnitNamingPopover` verbatim; do NOT fork the naming flow. Keep `FloorplanCanvas` edits
> surgical. Don't commit or push until I say "Approved."

---

> Context for the session (the detail the launch prompt points at).

## Plain-English goal
Today every stamp drops **instantly** with an auto-name (`"{base} (Stamp N)"`). This phase
adds a small **"Name each stamp"** switch in the drawer. Flip it **on** and each drop opens
the familiar name + type box pre-filled from the stamp — type/adjust, hit Enter, and the
**same stamp re-arms** so you can place → name → place → name without re-picking it. Flip it
**off** (the default) and stamping stays instant, exactly like Phase 1/2. Speed stays the
default; labeling-as-you-go is opt-in.

## What Phases 1 & 2 already shipped (build ON this — read it fresh, don't re-do it)
- **Phase 1** (`d7c74b7`) — `src/utils/stampTransform.ts` (`buildStampPolygon` etc.), the
  transient `stampTransform` in `useMapStore`, snap + R/⇧R/H/V while placing.
- **Phase 2** (`405ea84`) — the **drawer** + persistence:
  - `src/utils/stampLibrary.ts` — `StampDef = { id, name, points, subtypeId?, unitType?, createdAt }`
    (points **centroid-normalized**), `pushRecent`/`saveStamp`/`removeStamp`/`renameStamp`.
  - `useSettingsStore.stampLibrary { recents, saved }` (persisted; read via `useHydratedStore`)
    + actions `pushRecentStamp` / `saveStampToLibrary` / `removeSavedStamp` / `renameSavedStamp`.
  - `useMapStore` — transient **`armedStamp`** + `armStamp(stamp)` (atomic: arm + enter stamp
    mode + clear selection + reset transform + open drawer) + `clearArmedStamp`; `stampDrawerOpen`.
    ⚠️ Armed stamp is **cleared on tool change** (the `toolMode !== 'stamp'` effect in
    `FloorplanCanvas`) — the re-arm in this phase must survive the naming round-trip (see Seams).
  - `src/components/canvas/StampDrawer.tsx` — the bottom glass strip (thumbnails, click-to-arm,
    Save/rename/remove). **This is where the toggle goes.**
  - `FloorplanCanvas.handleStageClick` stamp branch — **the fork point.** Currently:
    - armed drawer stamp → `onInstantStampShape?.(armedStamp, stampedPoints)`
    - else single selected unit → `onInstantStamp?.(selectedUnitIds[0], stampedPoints)`
  - `useMapActions` — `handleInstantStampShape(stamp, points)` (auto-names from `StampDef.name`)
    and `handleInstantStamp(sourceUnitId, points)` (auto-names from the unit). Both create via
    `createUnitMutation` + `CREATE_UNIT` undo and `pushRecentStamp(...)`.

## Build-on inventory (read these fresh before using)
- `src/hooks/useMapActions.ts` — **`handleDuplicateUnit`** is the exact pattern to mirror for
  the ON path: `setMapLabelSuggestion(null)` (a stamp is not an AI trace) → `setPendingPolygonPoints(points)`
  → `setNewUnitName(...)` → `setUnitNamingOpen(true)`. **`saveNewUnitFromPopover`** already
  creates the unit AND `pushRecentStamp`s the shape + clears `pendingPolygonPoints`/naming — it
  does NOT touch `armedStamp`, so re-arm is automatic (just don't clear it). `suggestedPick` /
  `isSuggested` gate the popover's pre-selected type.
- `src/components/UnitNamingPopover.jsx` + its wiring in `src/app/project/[projectId]/page.jsx`
  (the `{unitNamingOpen && <UnitNamingPopover .../>}` block) — reuse verbatim. It already accepts
  `initialSubtypeId` / `initialUnitType` / `initialPick` — the seam for pre-filling the stamp's type.
- `src/store/useSettingsStore.ts` — `mapSettings` is where the persisted **`nameEachStamp`** bool
  lives (mirror an existing `mapSettings` bool like `enableSnapping`; default OFF → only an
  explicit `true` enables). Read via `useHydratedStore`.
- `src/components/canvas/StampDrawer.tsx` — add the toggle to the drawer header (small switch/
  checkbox next to "Stamp Drawer").

## Pure logic to extract + unit-test
Phase 3 is mostly **wiring** — likely no new pure module. If anything, a tiny helper to derive
the pre-fill name from a `StampDef` (+ the sheet's existing units, for the next `(Stamp N)` index)
could be extracted and tested — but only if it's non-trivial. Don't manufacture a module for its
own sake; the existing `commitStampedUnit` index logic in `useMapActions` already computes the
next index and can be reused/extracted if you want the pre-filled name to match.

## Scope — build exactly this
1. Persisted **`mapSettings.nameEachStamp`** (default OFF) + a toggle in the `StampDrawer` header.
2. In `FloorplanCanvas.handleStageClick`'s stamp branch: when `nameEachStamp` is **ON**, DON'T call
   the instant handler — instead route the snapped/transformed polygon through the pending-polygon
   + naming popover (a new `onStampWithNaming?(stamp | sourceUnit, points)` prop wired to a new
   `useMapActions` handler that mirrors `handleDuplicateUnit`). When **OFF**, unchanged Phase 1/2.
3. **Pre-fill** the popover from the stamp: name from `StampDef.name` (optionally with the next
   `(Stamp N)` index), and type from `StampDef.subtypeId`/`unitType` (thread through as the
   popover's initial pick — see Seams). For a selected-room stamp with naming ON, pre-fill from the unit.
4. **Re-arm**: after `saveNewUnitFromPopover` (Enter), the same stamp stays armed and the drawer
   stays open so the next click places again. Verify the tool-change effect doesn't disarm it.
5. **No new write path.** ON routes through `saveNewUnitFromPopover` → `createUnitMutation`
   (mirror `handleDuplicateUnit`); OFF stays on `handleInstantStamp*`. No migration, no `status_logs`.

## Seams to mind (where Phases 1/2 assumptions need widening — don't miss these)
- **Re-arm survives the naming round-trip.** `armedStamp` is cleared by the `toolMode !== 'stamp'`
  effect. Opening the naming popover must NOT leave stamp mode (Phase 2 stays in `toolMode==='stamp'`
  while `pendingPolygonPoints` is set). Confirm the popover flow keeps `toolMode === 'stamp'` so the
  stamp stays armed; if the pending-polygon draw gate (`isEditingPending`) interferes, gate around it.
- **Type pre-fill needs a channel.** `page.jsx` passes `initialSubtypeId` only for `editingUnitId`.
  For a stamp create you need to pass the armed stamp's `subtypeId`/`unitType` as the popover's
  initial type. Add a small transient "the stamp being named" carrier (e.g. reuse `armedStamp`, or a
  dedicated `pendingStampType`) and thread it into the `UnitNamingPopover` props in `page.jsx`.
- **Auto-name vs. typed name.** Decide whether the pre-filled name includes the running `(Stamp N)`
  index (matches instant naming) or is just the base name for the user to complete. Recommend
  pre-fill WITH the next index so Enter-through matches instant behavior.
- **Don't double-push a recent.** `saveNewUnitFromPopover` already `pushRecentStamp`s. The ON path
  must not also push (it flows through the popover, not `handleInstantStampShape`) — verify no dupe.
- **The pending polygon from a stamp is editable/snappable** like a traced one (Drawing Tool
  Excellence editing already applies to `pendingPolygonPoints`) — that's a feature, verify it works.

## Hard guardrails (AGENTS.md — do not violate)
- **localStorage only** (no DB, no migration); `nameEachStamp` is a plain `mapSettings` bool; read
  via `useHydratedStore`. A placed stamp is still a normal `units` row via `createUnitMutation` /
  `saveNewUnitFromPopover`. Never touch `status_logs` / the offline `pendingChanges` queue.
- **Reuse `UnitNamingPopover` + the pending flow** (mirror `handleDuplicateUnit`) — do NOT fork.
- **Surgical `FloorplanCanvas` edits**; new state in `useMapStore`; toggle in the drawer.
- **No `any`, no `@ts-nocheck`**; Vitest globals OFF — import `{ describe, it, expect, vi }` from
  `'vitest'`; co-locate `*.test.ts`; keep test files type-clean. **Lint is NOT a gate.**

## Exit criteria (Definition of Done → then STOP)
- `typecheck` + `test` + `build` green (commands below).
- **Live `dev:3010`:** toggle **ON** → each drop opens the name/type box **pre-filled** (name +
  type), Enter saves **and re-arms** (place → name → Enter → place again stays fast); toggle **OFF**
  → instant drops, unchanged; the pending polygon from a stamp is adjustable/snappable like a traced
  one. (Placement writes a real `units` row — verify deliberately, not as a probe; [[no-live-write-probes]].)
- Close with the `verify-feature` skill. **Do not commit or push until the owner says "Approved."**

## Verification commands
```
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run typecheck
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run test
npm --prefix "C:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next" run build
```
Lint is NOT a gate. ⚠️ a `next build` corrupts a running `dev:3010` server → restart via
`scripts/restart-dev.ps1`.

## Open decisions (recommendations — confirm cheaply in-phase)
- **Toggle placement/label** — recommend a compact switch in the drawer header labeled "Name each
  stamp".
- **Pre-filled name** — recommend name = the next `"{base} (Stamp N)"` (matches instant naming) so
  Enter-through is identical; the user can overwrite.
- **Type pre-fill channel** — recommend reusing `armedStamp.subtypeId`/`unitType` threaded into the
  popover rather than a new store field, if the wiring stays clean.

## Next after this
Phase 3 is the LAST phase of Stamp & Fast Markup. After it's Approved, the owner's order resumes:
**Slice 1 (type the spine) → Slice 0 P0.4 (canvas golden master) → Slice 2 (decompose
FloorplanCanvas)** — see [[codebase-health-refactor]]. Draft the Slice 1 kickoff after Phase 3 is
Approved, per the post-approval handoff ritual.
