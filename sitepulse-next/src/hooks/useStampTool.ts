"use client";
/**
 * useStampTool — the floor-plan canvas's stamp tool (FloorplanCanvas
 * Decomposition — Phase 6). Extracted verbatim from FloorplanCanvas.tsx: the
 * `useMapStore` stamp slice (the transient rotate/flip `stampTransform` and the
 * armed drawer stamp), both `stamp` branches of the stage click — armed-drawer
 * source and selected-room source, each snapping the drop anchor with the same
 * engine tracing uses, building the polygon via the shared `buildStampPolygon`,
 * and routing through the naming popover (opt-in) or the instant-stamp
 * callbacks — and the leave-stamp reset (drop the orientation + disarm the
 * drawer stamp on tool change). Behavior-preserving — `onInstantStamp` /
 * `onInstantStampShape` / `onStampWithNaming` fire with exactly the same
 * arguments and wiring-guard labels as before (the golden master pins :stamp;
 * the armed instant path keeps its historical `onInstantStamp:armed` label).
 *
 * Seams: the stamp branch CONDITIONS stay in the component's handleStageClick
 * else-if chain (preserving the final-else legend-deselect fallthrough when
 * stamp mode has nothing armed/selected) and call `handleArmedStampClick` /
 * `handleUnitStampClick` with the already-computed percent-space click point.
 * The R/H/V keydown branch stays in the component's window keydown effect
 * (Phase 8 territory), consuming the returned `rotateStamp` / `flipStamp`
 * directly. StampPreview + ContextActionDock stay mounted in the component,
 * fed from the hook's returns; StampDrawer talks to the store itself.
 */
import { useEffect } from 'react';
import { buildStampPolygon } from '@/utils/stampTransform';
import { isFinitePolygon } from '@/utils/geometry';
import { warnIfUnwired } from '@/utils/wiringGuard';
import { useMapStore } from '@/store/useMapStore';
import type { ToolMode } from '@/store/useMapStore';
import type { StampDef } from '@/utils/stampLibrary';
import type { PercentPoint as Point, Unit } from '@/types/domain';

interface UseStampToolArgs {
  /** Active tool — leaving `stamp` resets the transform + disarms the drawer stamp. */
  toolMode: ToolMode;
  /** mapSettings?.nameEachStamp (Stamp & Fast Markup — Phase 3): when ON, a stamp drop
   *  routes through the naming popover (pre-filled + re-arming) instead of dropping
   *  instantly. Default OFF ⇒ Phase 1/2 behavior. */
  nameEachStamp: boolean;
  /** The sheet's units (saved rooms) — the selected-room stamp source. */
  units: Unit[];
  /** Current selection — the selected-room branch stamps `selectedUnitIds[0]`. */
  selectedUnitIds: string[];
  /** drawW/drawH — aspect-corrects the 90° rotation (from useCanvasSnapping). */
  aspect: number;
  /** The shared snap engine (from useCanvasSnapping) — snaps the drop anchor. */
  snapPoint: (p: Point) => Point;
  /** Write-callback prop: instant-stamp a copy of the selected room (signature frozen). */
  onInstantStamp?: (unitId: string, points: Point[]) => void;
  /** Write-callback prop: instant-stamp an ARMED drawer stamp (signature frozen). */
  onInstantStampShape?: (stamp: StampDef, points: Point[]) => void;
  /** Write-callback prop: opt-in "name each stamp" drop (signature frozen). */
  onStampWithNaming?: (source: { name: string; subtypeId: string | null; unitType: string | null }, points: Point[]) => void;
}

export function useStampTool({
  toolMode,
  nameEachStamp,
  units,
  selectedUnitIds,
  aspect,
  snapPoint,
  onInstantStamp,
  onInstantStampShape,
  onStampWithNaming,
}: UseStampToolArgs) {
  // Stamp & Fast Markup — Phase 1: transient rotate/flip the next stamp drops with.
  const stampTransform = useMapStore(s => s.stampTransform);
  const rotateStamp = useMapStore(s => s.rotateStamp);
  const flipStamp = useMapStore(s => s.flipStamp);
  const resetStampTransform = useMapStore(s => s.resetStampTransform);
  // Stamp & Fast Markup — Phase 2: the armed drawer stamp (source when nothing selected).
  const armedStamp = useMapStore(s => s.armedStamp);
  const clearArmedStamp = useMapStore(s => s.clearArmedStamp);

  // Drop the transient stamp orientation whenever we leave the stamp tool so a stale
  // rotate/flip never bleeds into the next stamp session (Stamp & Fast Markup — Phase 1).
  // Phase 2: also disarm the drawer stamp so it never lingers outside stamp mode.
  // (The stamp line of the component's tool-change reset effect, moved here with the
  // store slice it clears — the actions are stable Zustand references.)
  useEffect(() => {
    if (toolMode !== 'stamp') { resetStampTransform(); clearArmedStamp(); }
  }, [toolMode, resetStampTransform, clearArmedStamp]);

  // The armed-drawer `stamp` branch of handleStageClick. The component's chain keeps
  // the routing gate (`toolMode === 'stamp' && !isEditingPending && armedStamp &&
  // armedStamp.points.length > 0`) and calls this with the percent-space click point.
  const handleArmedStampClick = (pctX: number, pctY: number) => {
    // TS narrowing only — the component's branch condition guarantees an armed stamp.
    if (!armedStamp || armedStamp.points.length === 0) return;
    // Phase 2: an armed drawer stamp is the source (no room selected). Its points are
    // centroid-normalized; snap the anchor + apply the transform exactly like the
    // selected-room path so StampPreview and this commit build the identical polygon.
    // `!isEditingPending` (Phase 3, gated in the component's chain): while a named
    // stamp's pending polygon awaits Enter, a stray canvas click must not drop a
    // SECOND stamp on top of it.
    const anchor = snapPoint({ pctX, pctY });
    const stampedPoints = buildStampPolygon(armedStamp.points, stampTransform, aspect, anchor);
    if (isFinitePolygon(stampedPoints)) {
      if (nameEachStamp) {
        // Phase 3 (opt-in): route through the naming popover, pre-filled from the stamp,
        // then re-arm. The armed stamp is left set so the next click drops it again.
        if (warnIfUnwired(onStampWithNaming, 'onStampWithNaming:armed')) {
          onStampWithNaming?.({ name: armedStamp.name, subtypeId: armedStamp.subtypeId ?? null, unitType: armedStamp.unitType ?? null }, stampedPoints);
        }
      } else if (warnIfUnwired(onInstantStampShape, 'onInstantStamp:armed')) {
        onInstantStampShape?.(armedStamp, stampedPoints);
      }
    }
  };

  // The selected-room `stamp` branch of handleStageClick. The component's chain keeps
  // the routing gate (`toolMode === 'stamp' && !isEditingPending &&
  // selectedUnitIds?.length === 1`) and calls this with the percent-space click point.
  const handleUnitStampClick = (pctX: number, pctY: number) => {
    const sourceUnit = units.find(u => u.id === selectedUnitIds[0]);
    if (sourceUnit && sourceUnit.polygon_coordinates && sourceUnit.polygon_coordinates.length > 0) {
      // Snap the drop anchor with the same engine tracing uses, then apply the active
      // rotate/flip — StampPreview and this commit build the identical polygon.
      const anchor = snapPoint({ pctX, pctY });
      const stampedPoints = buildStampPolygon(sourceUnit.polygon_coordinates, stampTransform, aspect, anchor);

      // Never persist a corrupt shape from a bad transform/snap.
      if (isFinitePolygon(stampedPoints)) {
        if (nameEachStamp) {
          // Phase 3 (opt-in): pre-fill the popover from the source room; selection
          // persists so the next click stamps it again.
          if (warnIfUnwired(onStampWithNaming, 'onStampWithNaming:unit')) {
            onStampWithNaming?.({ name: sourceUnit.unit_number, subtypeId: sourceUnit.subtype_id ?? null, unitType: sourceUnit.unit_type ?? null }, stampedPoints);
          }
        } else if (warnIfUnwired(onInstantStamp, 'onInstantStamp:stamp')) {
          onInstantStamp?.(selectedUnitIds[0], stampedPoints);
        }
      }
    }
  };

  return {
    /** The transient rotate/flip — feeds StampPreview, ContextActionDock + both commits. */
    stampTransform,
    /** Rotate the ghost (R / Shift+R) — the keydown effect + dock buttons call it. */
    rotateStamp,
    /** Flip the ghost (H / V) — the keydown effect + dock buttons call it. */
    flipStamp,
    /** The armed drawer stamp — feeds the click-chain gate, StampPreview + the dock. */
    armedStamp,
    /** armed-drawer stamp branch of the stage click — snap, transform, drop/name. */
    handleArmedStampClick,
    /** selected-room stamp branch of the stage click — snap, transform, drop/name. */
    handleUnitStampClick,
  };
}
