"use client";
/**
 * useCanvasSnapping — the floor-plan canvas's magnetic snapping engine
 * (FloorplanCanvas Decomposition — Phase 3). Extracted verbatim from
 * FloorplanCanvas.tsx: the raw-vector fetch (`useSnappingVectors`), the deferred
 * RBush spatial-index build (with grid-aware vector tagging), the derived
 * `effectiveSnapping` / `gridAwareSnapping` flags, the render-time `aspect`
 * ratio, and the `snapPoint` lookup. Behavior-preserving — the snap math itself
 * still lives in `src/utils/geometry.ts` (`getSnappedCoordinate`) and
 * `src/utils/gridAwareSnap.ts` (`tagVectorsWithGrid`); this hook owns the tree
 * state and the derived flags around it. Everything that CONSUMES the returns
 * (the onMouseMove snap + snap ring, stamp anchors, the draw/calibrate/measure
 * click branches, the overlay props) stays in FloorplanCanvas.
 *
 * Synchronous main-thread snapping engine: `useSnappingVectors` returns raw JSON
 * vectors; we instantiate the RBush spatial index here in a deferred effect
 * (never in the Query cache — see AGENTS.md §5). getSnappedCoordinate() is then
 * called inline, synchronously, which is required by Konva's dragBoundFunc and
 * guarantees the committed point matches the visual snap ring.
 */
import { useState, useEffect, useCallback } from 'react';
import type { RefObject } from 'react';
import RBush from 'rbush';
import { getSnappedCoordinate } from '@/utils/geometry';
import { tagVectorsWithGrid } from '@/utils/gridAwareSnap';
import { useSnappingVectors } from '@/hooks/useSnappingVectors';
import type { CanvasLayout } from '@/utils/canvasLayout';
import type { Gridline, PercentPoint } from '@/types/domain';

interface UseCanvasSnappingArgs {
  /** Active sheet — the vector fetch is keyed on it (null → no vectors). */
  activeSheetId: string | null;
  /**
   * The sheet's CONFIRMED gridlines (workbench-only) — used to tag the snapping
   * vectors that ARE grid lines so tracing de-prioritizes them. Omitted on the
   * live map → nothing is tagged and snapping is unchanged.
   */
  confirmedGridlines?: Gridline[];
  /** Live mirror of `layout` (owned by the component) — read at render time for `aspect`. */
  layoutRef: RefObject<CanvasLayout>;
  /** Current fit-and-center draw width (stage pixels at scale 1) — `layout.drawW`. */
  layoutDrawW: number;
  /** Throttle-committed stage scale — snap radius shrinks as you zoom in. */
  stageScale: number;
  /** mapSettings?.enableSnapping — the user's toolbar snap toggle. */
  enableSnapping: boolean | undefined;
  /** mapSettings?.snappingStrength — snap radius in px (default 15). */
  snappingStrength: number | undefined;
  /** mapSettings?.gridAwareSnapping — default on; only an explicit false is off. */
  gridAwareSnappingSetting: boolean | undefined;
  /** Magnifier loupe state (owned by the component) — while on, snapping is suspended. */
  magnifierActive: boolean;
}

export function useCanvasSnapping({
  activeSheetId,
  confirmedGridlines,
  layoutRef,
  layoutDrawW,
  stageScale,
  enableSnapping,
  snappingStrength,
  gridAwareSnappingSetting,
  magnifierActive,
}: UseCanvasSnappingArgs) {
  const { vectors: rawVectors } = useSnappingVectors(activeSheetId);

  const [vectorTree, setVectorTree] = useState<RBush<any> | null>(null);
  useEffect(() => {
    if (!rawVectors || rawVectors.length === 0) {
      setVectorTree(null);
      return;
    }
    // Defer the heavy spatial-index build off the render path.
    const timeoutId = setTimeout(() => {
      const tree = new RBush();
      // Grid-aware snapping (Phase 3c): tag the vectors that ARE confirmed grid lines
      // so the snap engine can de-prioritize them. The aspect is read from the live
      // layout ref (not a dep) so we tag with the freshest sheet proportions without
      // forcing a rebuild on every resize. No confirmed grids → passthrough untagged
      // (live map / un-gridded sheets are unchanged). The tagged TREE stays in
      // hook state; only the raw JSON lives in the Query cache (AGENTS.md §5).
      const classifyAspect = layoutRef.current.drawH > 0
        ? layoutRef.current.drawW / layoutRef.current.drawH
        : 1;
      tree.load(tagVectorsWithGrid(rawVectors, confirmedGridlines, classifyAspect));
      setVectorTree(tree);
    }, 10);
    return () => clearTimeout(timeoutId);
  // layoutRef is a ref — reading it inside the deferred build is intentional (see above).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawVectors, confirmedGridlines]);

  // Grid-aware snapping is live only when this sheet HAS confirmed grids (so some
  // vectors are tagged) AND the toggle is on (default on; only an explicit false is
  // off). False on the live map (no confirmedGridlines) → snapping is untouched.
  const gridAwareSnapping =
    !!confirmedGridlines?.length && gridAwareSnappingSetting !== false;

  // While the magnifier loupe is on, magnetic snapping is suspended so node
  // placement follows the cursor exactly; the user's toolbar snap preference is
  // untouched and resumes when it's off.
  const effectiveSnapping = !!enableSnapping && !magnifierActive;

  // NOT a memo on purpose: a render-time read of the live layout ref, refreshing
  // every render — preserved verbatim from the pre-extraction component.
  const aspect = layoutRef.current.drawW / Math.max(1, layoutRef.current.drawH);

  // Snap a percent-space point to the nearest detected vector — the same
  // getSnappedCoordinate the trace tool uses. Drives the capture-line endpoints
  // (AI Tracing Assist — Phase 3b): both the live overlay preview and the emitted
  // grid axis. A no-op when snapping is off or the vector tree isn't built yet.
  const snapPoint = useCallback((p: PercentPoint): PercentPoint => {
    if (!enableSnapping || !vectorTree) return p;
    const s = getSnappedCoordinate(
      p.pctX, p.pctY, vectorTree, aspect, layoutDrawW, stageScale, snappingStrength || 15,
    );
    return { pctX: s.pctX, pctY: s.pctY };
  }, [enableSnapping, snappingStrength, vectorTree, aspect, layoutDrawW, stageScale]);

  return {
    /** The RBush spatial index (hook state, never the Query cache — AGENTS §5). */
    vectorTree,
    /** Percent-space snap lookup — capture-line endpoints + stamp anchors. */
    snapPoint,
    /** enableSnapping AND the magnifier is off — feeds every snap consumer. */
    effectiveSnapping,
    /** Confirmed grids exist AND the toggle is on — de-prioritizes grid vectors. */
    gridAwareSnapping,
    /** drawW / drawH from the live layout ref, re-read every render (not a memo). */
    aspect,
  };
}
