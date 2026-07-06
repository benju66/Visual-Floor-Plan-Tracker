"use client";
/**
 * useTraceTool — the floor-plan canvas's click-trace + box-draw tool
 * (FloorplanCanvas Decomposition — Phase 5). Extracted verbatim from
 * FloorplanCanvas.tsx: the draft polygon state (`draftPoints` + the opening
 * tags placed while tracing) with its load-bearing sync refs, the `draw`
 * branch of the stage click (box-debounce, Shift-ortho, snap-consume, the
 * opening-tag mark), both finish paths (the Finish button's `finishDrawing`
 * and the Enter-to-finish body), the box-drag arm/complete pointer handlers,
 * and the workbench hold-D/C/H/P opening hold-key effect. Behavior-preserving
 * — `onPolygonComplete(points, openingEdges?)` fires with exactly the same
 * arguments as before (the golden master pins :finish / :draw-enter / :box,
 * including the box path's single-argument call).
 *
 * Seams: the window keydown EFFECT stays in FloorplanCanvas (Phase 8
 * territory) — it sits after this hook's call site and consumes
 * `draftPointsRef` (its Escape/undo/Enter gating reads the live draft length)
 * plus the stable `clearDraft` / `undoLastDraftVertex` /
 * `finishDrawingViaEnter` callbacks. The Stage's onClick/onPointerDown/
 * onPointerUp and the tool routing around them stay in the component, which
 * calls `handleDrawClick` / `handleBoxPointerDown` / `handleBoxPointerUp` for
 * the draw branches (each handler keeps its own draw gate, so it no-ops
 * elsewhere). `boxOrigin`, `lastBoxEndRef`, and `lastSnapRef` stay owned by
 * the component — they're shared with the capture_box / capture_line /
 * calibrate / measure tools, which are not this phase's to move.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type Konva from 'konva';
import { openingTypeForKey } from '@/utils/openingEdges';
import { warnIfUnwired } from '@/utils/wiringGuard';
import type { CanvasLayout } from '@/utils/canvasLayout';
import type { PointerStore } from '@/utils/pointerStore';
import type { ToolMode } from '@/store/useMapStore';
import type { OpeningEdge, OpeningType, PercentPoint as Point } from '@/types/domain';

interface UseTraceToolArgs {
  /** Active tool — each handler keeps its own `draw` gate and no-ops elsewhere. */
  toolMode: ToolMode;
  /** The throttle-committed fit-and-center layout (owned by the component). */
  layout: CanvasLayout;
  /** Throttle-committed stage scale — pointer→percent conversion for the box. */
  stageScale: number;
  /** A freshly-traced polygon is open for naming — every draw gesture goes inert. */
  isEditingPending: boolean;
  /** enableSnapping AND the magnifier is off — from useCanvasSnapping. */
  effectiveSnapping: boolean;
  /** Workbench openings session — arms the hold-key capture (inert on the live map). */
  openingCaptureEnabled?: boolean;
  /** Write-callback prop: a finished trace/box (signature frozen). */
  onPolygonComplete: (points: Point[], openingEdges?: OpeningEdge[]) => void;
  /** The component's pointer store — the box pointer-up falls back to its last sample. */
  pointerStore: PointerStore;
  /** The rubber-band origin — owned by the component (shared with capture_box/capture_line). */
  boxOrigin: Point | null;
  setBoxOrigin: Dispatch<SetStateAction<Point | null>>;
  /** Timestamp of the last completed box/capture — debounces the next draw click. */
  lastBoxEndRef: RefObject<number>;
  /** The last onMouseMove snap — consumed so the committed vertex matches the visual ring. */
  lastSnapRef: RefObject<{ pctX: number; pctY: number; snapped: boolean } | null>;
}

export function useTraceTool({
  toolMode,
  layout,
  stageScale,
  isEditingPending,
  effectiveSnapping,
  openingCaptureEnabled,
  onPolygonComplete,
  pointerStore,
  boxOrigin,
  setBoxOrigin,
  lastBoxEndRef,
  lastSnapRef,
}: UseTraceToolArgs) {
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const draftPointsRef = useRef(draftPoints);
  useEffect(() => { draftPointsRef.current = draftPoints; }, [draftPoints]);

  // Opening-edge capture (AI Tracing Assist — Phase 4a). The in-progress opening tags
  // of a half-drawn trace are an ephemeral DRAW buffer co-located with `draftPoints`
  // (the same category of canvas-local draw state, never persisted), handed up to
  // `onPolygonComplete` when the polygon closes. The session/active-type tool settings
  // live in `useWorkbenchStore` (passed in as props) per AGENTS.md §2.
  const [draftOpeningEdges, setDraftOpeningEdges] = useState<OpeningEdge[]>([]);
  const draftOpeningEdgesRef = useRef(draftOpeningEdges);
  useEffect(() => { draftOpeningEdgesRef.current = draftOpeningEdges; }, [draftOpeningEdges]);
  // Which opening TYPE key (D/C/H/P) is currently held — while one is down, the next
  // placed edge becomes an opening of that type. The ref drives the commit (read
  // synchronously on click); the state drives the armed cursor tint. Only wired when
  // openingCaptureEnabled (workbench); the live map never subscribes.
  const heldOpeningTypeRef = useRef<OpeningType | null>(null);
  const [armedOpeningType, setArmedOpeningType] = useState<OpeningType | null>(null);

  // Fresh read for the Enter-to-finish body (a stable callback; not a dep of it).
  const onPolygonCompleteRef = useRef(onPolygonComplete);
  useEffect(() => { onPolygonCompleteRef.current = onPolygonComplete; }, [onPolygonComplete]);

  // Opening hold-keys (Phase 4a): track which TYPE key (D/C/H/P) is held, only while
  // opening capture is enabled (workbench), so the live map never even subscribes.
  // While one is down, the next edge placed during a trace is tagged an opening of
  // that type (committed in handleDrawClick). Tapping a key to SET the active type
  // (for edit-after click-to-tag) is handled by the tracer, not here.
  useEffect(() => {
    if (!openingCaptureEnabled) {
      heldOpeningTypeRef.current = null;
      setArmedOpeningType(null);
      return;
    }
    const isTypingTarget = () =>
      document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget() || e.metaKey || e.ctrlKey || e.altKey) return;
      const type = openingTypeForKey(e.key);
      if (!type) return;
      heldOpeningTypeRef.current = type;
      setArmedOpeningType(type);
    };
    const up = (e: KeyboardEvent) => {
      const type = openingTypeForKey(e.key);
      if (!type || heldOpeningTypeRef.current !== type) return;
      heldOpeningTypeRef.current = null;
      setArmedOpeningType(null);
    };
    const clear = () => { heldOpeningTypeRef.current = null; setArmedOpeningType(null); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [openingCaptureEnabled]);

  // Leaving the draw tool always drops the in-progress draft — the draw line of
  // the component's tool-change reset effect, moved here with the state it clears.
  useEffect(() => {
    if (toolMode !== 'draw') { setDraftPoints([]); setDraftOpeningEdges([]); }
  }, [toolMode]);

  // The Escape backout body: drop the in-progress draft (points + opening tags).
  // The keydown effect keeps the key matching + the backout-ladder ordering.
  // Stable identity: setters only.
  const clearDraft = useCallback(() => {
    setDraftPoints([]);
    setDraftOpeningEdges([]);
  }, []);

  // The Ctrl/Cmd+Z draft branch body: undo the last vertex; drop any opening tag
  // whose edge no longer exists (the removed vertex was the end of edge newLen-1).
  // The keydown effect keeps the key matching + input gating. Stable identity:
  // reads only refs.
  const undoLastDraftVertex = useCallback(() => {
    const newLen = draftPointsRef.current.length - 1;
    setDraftPoints(prev => prev.slice(0, -1));
    setDraftOpeningEdges(prev => prev.filter(o => o.edgeIndex <= newLen - 2));
  }, []);

  // The draw-Enter body: complete the draft through the wiring guard (the
  // :draw-enter label the golden master pins) and clear it. The keydown effect
  // keeps the key matching, input gating, length check and
  // stopImmediatePropagation. Stable identity: reads only refs.
  const finishDrawingViaEnter = useCallback(() => {
    if (warnIfUnwired(onPolygonCompleteRef.current, 'onPolygonComplete:draw-enter')) {
      onPolygonCompleteRef.current(draftPointsRef.current, draftOpeningEdgesRef.current);
    }
    setDraftPoints([]);
    setDraftOpeningEdges([]);
  }, []);

  const finishDrawing = () => {
    if (draftPoints.length > 2) {
      if (warnIfUnwired(onPolygonComplete, 'onPolygonComplete:finish')) {
        onPolygonComplete(draftPoints, draftOpeningEdges);
      }
      setDraftPoints([]);
      setDraftOpeningEdges([]);
    }
  };

  // The `draw` branch of handleStageClick: place one snapped vertex. The
  // component's click handler keeps the tool routing (stamp/calibrate/measure/
  // select…) + the `!isEditingPending` gate and calls this only in draw mode,
  // passing the already-computed percent-space click point.
  const handleDrawClick = (e: Konva.KonvaEventObject<MouseEvent>, clickPctX: number, clickPctY: number) => {
    if (Date.now() - lastBoxEndRef.current < 200) return;
    let pctX = clickPctX;
    let pctY = clickPctY;
    if (e.evt.shiftKey && draftPoints.length > 0) {
      const lastPoint = draftPoints[draftPoints.length - 1];
      const dx = Math.abs(pctX - lastPoint.pctX);
      const dy = Math.abs(pctY - lastPoint.pctY);
      if (dx > dy) pctY = lastPoint.pctY;
      else pctX = lastPoint.pctX;
    } else if (effectiveSnapping && lastSnapRef.current?.snapped) {
      // Consume the last snap computed by onMouseMove — avoids double-computation
      // and guarantees the committed point matches the visual snap ring.
      pctX = lastSnapRef.current.pctX;
      pctY = lastSnapRef.current.pctY;
    }
    // Opening capture (Phase 4a): if a type key (D/C/H/P) is held and this isn't the
    // first vertex, the edge from the previous vertex to this new one is an opening
    // of the held type. The new edge's start vertex is the current last index.
    const heldType = heldOpeningTypeRef.current;
    if (openingCaptureEnabled && heldType && draftPoints.length > 0) {
      const edgeIndex = draftPoints.length - 1;
      setDraftOpeningEdges(prev => [...prev.filter(o => o.edgeIndex !== edgeIndex), { edgeIndex, type: heldType }]);
    }
    setDraftPoints([...draftPoints, { pctX, pctY }]);
  };

  const handleBoxPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (toolMode === 'draw' && (!e.evt || e.evt.button === 0) && draftPoints.length === 0 && !isEditingPending) {
      // The box-drag shortcut (press-drag-release → rectangle room) stays live in
      // draw mode. But after a trace completes we remain in draw mode with the
      // naming popover open over an editable pending polygon. Pressing one of that
      // polygon's anchor nodes bubbles pointerdown up to the stage; without the
      // `!isEditingPending` guard it would arm a box here, and a node drag past
      // the box threshold would commit it — replacing the traced shape with a 4-pt
      // bounding rectangle (and the node-drag ↔ box-complete race could collapse it
      // to a triangle). Suppress box-arming while a pending polygon is being named.
      const stage = e.target.getStage();
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const logicalX = (pointer.x - stage.x()) / stageScale;
      const logicalY = (pointer.y - stage.y()) / stageScale;
      const pctX = (logicalX - layout.offsetX) / layout.drawW;
      const pctY = (logicalY - layout.offsetY) / layout.drawH;
      setBoxOrigin({ pctX, pctY });
    }
  };

  const handleBoxPointerUp = (e: Konva.KonvaEventObject<PointerEvent>) => {
    // `!isEditingPending` (Phase 1): never complete a box over a polygon that's
    // already pending/being named — the shared gate that also blocks box-arming.
    if (toolMode === 'draw' && boxOrigin && !isEditingPending) {
      const stage = e.target.getStage();
      if (!stage) return;
      const lastSample = pointerStore.get();
      const pointer = stage.getPointerPosition()
        || (lastSample ? { x: lastSample.screenX, y: lastSample.screenY } : null);
      if (!pointer) {
        setBoxOrigin(null);
        return;
      }
      const logicalX = (pointer.x - stage.x()) / stageScale;
      const logicalY = (pointer.y - stage.y()) / stageScale;
      const pctX = (logicalX - layout.offsetX) / layout.drawW;
      const pctY = (logicalY - layout.offsetY) / layout.drawH;
      const dx = Math.abs(pctX - boxOrigin.pctX);
      const dy = Math.abs(pctY - boxOrigin.pctY);

      const startX = boxOrigin.pctX;
      const startY = boxOrigin.pctY;
      setBoxOrigin(null);

      if ((dx > 0.005 && dy > 0.005) && draftPoints.length === 0) {
        lastBoxEndRef.current = Date.now();
        if (warnIfUnwired(onPolygonComplete, 'onPolygonComplete:box')) {
          onPolygonComplete([
            { pctX: startX, pctY: startY },
            { pctX: pctX, pctY: startY },
            { pctX: pctX, pctY: pctY },
            { pctX: startX, pctY: pctY }
          ]);
        }
        setDraftPoints([]);
      }
    }
  };

  return {
    /** The in-progress trace vertices — feeds DraftPolygon + the Finish button gate. */
    draftPoints,
    /** The in-progress opening tags (workbench) — feeds DraftPolygon. */
    draftOpeningEdges,
    /** Live mirror of draftPoints — the keydown gating + the mousemove interior hint read it. */
    draftPointsRef,
    /** The held opening type (D/C/H/P) — drives DraftPolygon's armed cursor tint. */
    armedOpeningType,
    /** Finish-button path — completes the draft with its opening tags (:finish guard). */
    finishDrawing,
    /** Enter-to-finish body (:draw-enter guard) — called by the keydown effect. */
    finishDrawingViaEnter,
    /** Escape backout body — drops the draft; called by the keydown effect. */
    clearDraft,
    /** Ctrl/Cmd+Z draft body — pops a vertex + prunes stale tags; called by the keydown effect. */
    undoLastDraftVertex,
    /** draw branch of the stage click — snapped/ortho vertex placement + opening tag. */
    handleDrawClick,
    /** draw branch of the Stage pointer-down — arms the box rubber-band. */
    handleBoxPointerDown,
    /** draw branch of the Stage pointer-up — completes the box as a 4-point room. */
    handleBoxPointerUp,
  };
}
