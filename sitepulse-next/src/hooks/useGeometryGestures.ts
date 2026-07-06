"use client";
/**
 * useGeometryGestures — the floor-plan canvas's geometry-edit gesture engine
 * (FloorplanCanvas Decomposition — Phase 4). Extracted verbatim from
 * FloorplanCanvas.tsx: flip / rotate, whole-polygon drag-end, node drag-end,
 * delete-node click, the add_node segment insert, pending + saved vertex
 * insert/delete, the pending-edit undo history (seed + record + undo/redo
 * application), and the arrow-nudge write. Behavior-preserving — the geometry
 * math itself still lives in src/utils (`geometry.ts`, `stampTransform.ts`,
 * `editHistory.ts`, `polygonValidity.ts`); this hook owns the gesture handlers
 * around it and CALLS that math, never re-implements it (AGENTS.md §3).
 *
 * Seams: the window keydown EFFECT stays in FloorplanCanvas (Phase 8 territory)
 * and invokes `nudgeSelected` / `undoRedoPendingEdit` through the component's
 * callback-ref pattern (the same one handleZoomRef uses); the select/route
 * branches of handlePolygonClick stay in the component, which calls
 * `handleAddNodeToPolygon` for the add_node branch. Every other consumer
 * (MappedUnit, PendingPolygon, ContextActionDock, CanvasContextMenu) receives
 * the returned handlers unchanged. The refs passed in (`unitsRef`,
 * `selectedUnitIdsRef`, `onUpdateUnitPolygonRef`, `pendingPolygonPointsRef`)
 * stay owned + synced by the component — they also feed the keydown handler,
 * and the ref-sync pattern is load-bearing (AGENTS.md §3).
 */
import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type Konva from 'konva';
import type RBush from 'rbush';
import type { RBushItem } from '@/services/api';
import { distToSegment, getSnappedCoordinate, isFinitePolygon } from '@/utils/geometry';
import { flipPolygon, rotatePolygon } from '@/utils/stampTransform';
import { pushSnapshot, undo as undoEditHistory, redo as redoEditHistory, seedEditHistory, emptyEditHistory, type EditHistory } from '@/utils/editHistory';
import { warnIfUnwired } from '@/utils/wiringGuard';
import type { CanvasLayout } from '@/utils/canvasLayout';
import type { ToolMode } from '@/store/useMapStore';
import type { Unit, PercentPoint as Point } from '@/types/domain';

interface UseGeometryGesturesArgs {
  /** Active tool — gates which gestures are live (select / add_node / delete_node). */
  toolMode: ToolMode;
  /** The throttle-committed fit-and-center layout (owned by the component). */
  layout: CanvasLayout;
  /** Throttle-committed stage scale — pointer→percent conversion + snap radius. */
  stageScale: number;
  /** The sheet's units (saved rooms) — gesture targets. */
  units: Unit[];
  /** Current selection — flip/rotate target resolution. */
  selectedUnitIds: string[];
  /** The not-yet-saved polygon open for naming (null/undefined when none). */
  pendingPolygonPoints?: Point[] | null;
  /** Derived `!!pendingPolygonPoints` gate (owned by the component) — keys the history seed. */
  isEditingPending: boolean;
  /** The RBush snap index from useCanvasSnapping (hook state, never the Query cache). */
  vectorTree: RBush<RBushItem> | null;
  /** drawW / drawH from the live layout ref (useCanvasSnapping's render-time read). */
  aspect: number;
  /** enableSnapping AND the magnifier is off — from useCanvasSnapping. */
  effectiveSnapping: boolean;
  /** mapSettings?.snappingStrength — snap radius in px (default 15). */
  snappingStrength: number | undefined;
  /** Write-callback prop: persist a saved unit's new polygon (signature frozen). */
  onUpdateUnitPolygon?: (unitId: string, points: Point[]) => void;
  /** Write-callback prop: apply an edit to the pending polygon (signature frozen). */
  onPendingPolygonMove?: (points: Point[]) => void;
  /** Live mirror of `units` — fresh reads for stable callbacks + arrow-nudge. */
  unitsRef: RefObject<Unit[]>;
  /** Live mirror of the selection — fresh reads for arrow-nudge. */
  selectedUnitIdsRef: RefObject<string[]>;
  /** Live mirror of onUpdateUnitPolygon — fresh reads for stable callbacks + arrow-nudge. */
  onUpdateUnitPolygonRef: RefObject<((unitId: string, points: Point[]) => void) | undefined>;
  /** Live mirror of pendingPolygonPoints — fresh reads for the history seed + stable callbacks. */
  pendingPolygonPointsRef: RefObject<Point[] | null | undefined>;
}

export function useGeometryGestures({
  toolMode,
  layout,
  stageScale,
  units,
  selectedUnitIds,
  pendingPolygonPoints,
  isEditingPending,
  vectorTree,
  aspect,
  effectiveSnapping,
  snappingStrength,
  onUpdateUnitPolygon,
  onPendingPolygonMove,
  unitsRef,
  selectedUnitIdsRef,
  onUpdateUnitPolygonRef,
  pendingPolygonPointsRef,
}: UseGeometryGesturesArgs) {
  // Fresh read for the undo/redo application (a stable callback; not a dep of it).
  const onPendingPolygonMoveRef = useRef(onPendingPolygonMove);
  useEffect(() => { onPendingPolygonMoveRef.current = onPendingPolygonMove; }, [onPendingPolygonMove]);

  // Drawing Tool Excellence — Phase 3 (undo/redo for the NOT-YET-SAVED polygon). A
  // local, in-memory history of `pendingPolygonPoints` snapshots, kept fully isolated
  // from the DB-backed saved-unit `useUndoRedo` (no DB writes; nothing enters the
  // offline IDB mutation queue, `status_logs`, or the `pendingChanges` buffer). It is
  // SEEDED with the freshly-traced shape the instant a pending polygon opens (so the
  // first Ctrl+Z returns to the original trace) and CLEARED when the polygon is saved
  // or cancelled (pending → null), so the next trace starts with a clean stack. Held in
  // a ref — the keydown handler mutates it without re-binding, and the React tree never
  // needs to re-render off it. The effect keys ONLY on the open/close transition (never
  // on `pendingPolygonPoints`), so an edit mid-session can't wipe the history; it reads
  // the opening points from a ref for the same reason.
  const editHistoryRef = useRef<EditHistory>(emptyEditHistory());
  useEffect(() => {
    editHistoryRef.current = isEditingPending
      ? seedEditHistory(pendingPolygonPointsRef.current ?? [])
      : emptyEditHistory();
  // pendingPolygonPointsRef is a ref — read on the open transition by design (see above).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditingPending]);

  // Wrap `onPendingPolygonMove`: record each committed pending edit (node move,
  // whole-shape move, flip) into the history, then apply it. Undo/redo replay snapshots
  // back through the RAW `onPendingPolygonMove` (via its ref) so they don't re-enter the
  // history here. Stable identity (depends only on the prop) so PendingPolygon's props
  // stay referentially steady.
  const handlePendingPolygonEdit = useCallback((newPoints: Point[]) => {
    editHistoryRef.current = pushSnapshot(editHistoryRef.current, newPoints);
    onPendingPolygonMove?.(newPoints);
  }, [onPendingPolygonMove]);

  // Apply one step of the pending-edit history — the body of the keydown handler's
  // Ctrl/Cmd+Z branch (the key matching, input gating and stopImmediatePropagation
  // stay with the effect in the component). Stable identity: reads only refs.
  const undoRedoPendingEdit = useCallback((isRedo: boolean) => {
    const result = isRedo
      ? redoEditHistory(editHistoryRef.current)
      : undoEditHistory(editHistoryRef.current);
    editHistoryRef.current = result.history;
    if (result.current) onPendingPolygonMoveRef.current?.(result.current);
  }, []);

  // Arrow-key nudge write: shift every selected unit's polygon by the given
  // percent-space delta. The keydown effect keeps the key→delta math (it owns
  // layoutRef); this owns the per-unit map + persist. Stable identity: refs only.
  const nudgeSelected = useCallback((dx: number, dy: number) => {
    const activeIds = selectedUnitIdsRef.current;
    const currentUnits = unitsRef.current;
    activeIds.forEach(id => {
      const unit = currentUnits.find(u => u.id === id);
      if (unit && unit.polygon_coordinates) {
        const newPoints = unit.polygon_coordinates.map(p => ({
          pctX: p.pctX + dx,
          pctY: p.pctY + dy
        }));
        if (warnIfUnwired(onUpdateUnitPolygonRef.current, 'onUpdateUnitPolygon:arrow-nudge')) {
          onUpdateUnitPolygonRef.current?.(unit.id, newPoints);
        }
      }
    });
  // The three sources are refs — always-fresh reads, never deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFlip = (direction: 'horizontal' | 'vertical') => {
    // Flip math lives in stampTransform.flipPolygon (single source of truth, shared
    // with the stamp tool). Behavior unchanged: mirror about the bounding-box center.
    if (pendingPolygonPoints && pendingPolygonPoints.length > 0) {
      // Phase 3: route through the history-recording wrapper so a flip is one undo step.
      handlePendingPolygonEdit(flipPolygon(pendingPolygonPoints, direction));
      return;
    }

    if (selectedUnitIds?.length !== 1) return;
    const unit = units.find(u => u.id === selectedUnitIds[0]);
    if (!unit || !unit.polygon_coordinates || unit.polygon_coordinates.length === 0) return;

    const newPoints = flipPolygon(unit.polygon_coordinates, direction);
    if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:flip')) {
      onUpdateUnitPolygon?.(unit.id, newPoints);
    }
  };

  const handleRotatePolygon = (direction: 'left' | 'right', overrideId: string | null = null) => {
    const targetId = overrideId || (selectedUnitIds?.length === 1 ? selectedUnitIds[0] : null);
    if (!targetId) return;
    const unit = units.find(u => u.id === targetId);
    if (!unit || !unit.polygon_coordinates || unit.polygon_coordinates.length === 0) return;

    const { drawW, drawH } = layout;
    if (drawW <= 0 || drawH <= 0) return;

    // Rotation math lives in stampTransform.rotatePolygon (single source of truth,
    // shared with the stamp tool). Behavior unchanged: aspect-correct 90° about the centroid.
    const newPoints = rotatePolygon(unit.polygon_coordinates, direction, drawW / drawH);
    if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:rotate')) {
      onUpdateUnitPolygon?.(unit.id, newPoints);
    }
  };

  const handlePolygonDragEnd = (e: Konva.KonvaEventObject<DragEvent>, unit: Unit) => {
    if (toolMode !== 'select') return;
    const dx = e.target.x() / layout.drawW;
    const dy = e.target.y() / layout.drawH;

    e.target.x(0);
    e.target.y(0);

    if (dx === 0 && dy === 0) return;

    if (unit.polygon_coordinates) {
      const newPoints = unit.polygon_coordinates.map(p => ({
        pctX: p.pctX + dx,
        pctY: p.pctY + dy
      }));
      if (!isFinitePolygon(newPoints)) {
        console.warn('[geometry] polygon move produced an invalid shape — not saving', unit.id);
        return;
      }
      if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:polygon-drag')) {
        onUpdateUnitPolygon?.(unit.id, newPoints);
      }
    }
  };

  const handleAnchorDragEnd = (e: Konva.KonvaEventObject<DragEvent>, unitId: string, index: number, overridePct?: Point) => {
    if (!['select', 'add_node'].includes(toolMode)) return;
    const node = e.target;

    // MappedUnit computes the snapped position synchronously and passes it as
    // overridePct; fall back to the raw node position otherwise.
    let pctX = overridePct ? overridePct.pctX : (node.x() - layout.offsetX) / layout.drawW;
    let pctY = overridePct ? overridePct.pctY : (node.y() - layout.offsetY) / layout.drawH;

    if (!overridePct && effectiveSnapping) {
      const snap = getSnappedCoordinate(pctX, pctY, vectorTree, aspect, layout.drawW, stageScale, snappingStrength || 15);
      if (snap.snapped) {
        pctX = snap.pctX;
        pctY = snap.pctY;
      }
    }

    const unit = units.find(u => u.id === unitId);
    if (!unit || !unit.polygon_coordinates) return;

    const newPoints = [...unit.polygon_coordinates];
    newPoints[index] = { pctX, pctY };
    // Never persist a corrupt shape (NaN/off-canvas from a bad drag). Better to
    // leave the saved geometry untouched than to write a degenerate polygon.
    if (!isFinitePolygon(newPoints)) {
      console.warn('[geometry] node move produced an invalid polygon — not saving', unitId);
      return;
    }
    if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:node-move')) {
      onUpdateUnitPolygon?.(unitId, newPoints);
    }
  };

  const handleAnchorClick = (e: Konva.KonvaEventObject<MouseEvent>, unitId: string, index: number) => {
    e.cancelBubble = true;
    if (toolMode !== 'delete_node') return;
    const unit = units.find(u => u.id === unitId);
    if (!unit || !unit.polygon_coordinates || unit.polygon_coordinates.length <= 3) return;

    const newPoints = [...unit.polygon_coordinates];
    newPoints.splice(index, 1);
    if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:delete-node')) {
      onUpdateUnitPolygon?.(unitId, newPoints);
    }
  };

  // The add_node branch of handlePolygonClick: insert a vertex on the clicked
  // unit's nearest segment at the pointer. The component's click handler keeps
  // the tool routing (route/select/multi_select + selection sync) and calls this
  // only in add_node mode.
  const handleAddNodeToPolygon = (e: Konva.KonvaEventObject<MouseEvent>, unit: Unit) => {
    const stage = e.target.getStage()!;
    const pointer = stage.getPointerPosition()!;
    const logicalX = (pointer.x - stage.x()) / stageScale;
    const logicalY = (pointer.y - stage.y()) / stageScale;
    const pctX = (logicalX - layout.offsetX) / layout.drawW;
    const pctY = (logicalY - layout.offsetY) / layout.drawH;

    let bestIdx = -1;
    let minDistance = Infinity;
    const pts = unit.polygon_coordinates || [];
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i+1) % pts.length];
      const d = distToSegment({pctX, pctY}, p1, p2);
      if (d < minDistance) {
        minDistance = d;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) {
      const newPoints = [...pts];
      newPoints.splice(bestIdx + 1, 0, {pctX, pctY});
      if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:add-node')) {
        onUpdateUnitPolygon?.(unit.id, newPoints);
      }
    }
  };

  // Drawing Tool Excellence — Phase 4. Pending-polygon vertex insert/delete: the
  // not-yet-saved twins of handleAddNodeToPolygon / handleAnchorClick above. Both
  // write through handlePendingPolygonEdit (NOT the raw onPendingPolygonMove) so the
  // edit lands in the Phase 3 in-memory undo history and Ctrl+Z works on it. They
  // read the live points from a ref, so the callbacks stay referentially stable and
  // PendingPolygon's props don't churn.
  const handleInsertPendingVertex = useCallback((edgeIndex: number) => {
    const pts = pendingPolygonPointsRef.current;
    if (!pts || pts.length < 3) return;
    const p1 = pts[edgeIndex];
    const p2 = pts[(edgeIndex + 1) % pts.length];
    if (!p1 || !p2) return;
    // Insert at the edge midpoint the "+" marks (predictable; no pointer math).
    const midpoint = { pctX: (p1.pctX + p2.pctX) / 2, pctY: (p1.pctY + p2.pctY) / 2 };
    const newPoints = [...pts];
    newPoints.splice(edgeIndex + 1, 0, midpoint);
    // Guard like handleAnchorDragEnd — never apply a degenerate/off-canvas shape.
    if (!isFinitePolygon(newPoints)) return;
    handlePendingPolygonEdit(newPoints);
  // pendingPolygonPointsRef is a ref — always-fresh read, never a dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlePendingPolygonEdit]);

  const handleDeletePendingVertex = useCallback((index: number) => {
    const pts = pendingPolygonPointsRef.current;
    // Mirror handleAnchorClick's <= 3 guard — never drop below a triangle.
    if (!pts || pts.length <= 3) return;
    const newPoints = [...pts];
    newPoints.splice(index, 1);
    if (!isFinitePolygon(newPoints)) return;
    handlePendingPolygonEdit(newPoints);
  // pendingPolygonPointsRef is a ref — always-fresh read, never a dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlePendingPolygonEdit]);

  // Saved-unit midpoint "+" insert — the same affordance as the pending one, brought
  // to selected saved rooms so adding a corner is consistent across both (no need to
  // switch into the add_node tool). Persists via onUpdateUnitPolygon (which already
  // pushes a DB undo action). Reads units/callback from refs so the callback stays
  // referentially stable and MappedUnit's memo doesn't churn.
  const handleInsertSavedVertex = useCallback((unitId: string, edgeIndex: number) => {
    const unit = unitsRef.current.find(u => u.id === unitId);
    if (!unit || !unit.polygon_coordinates) return;
    const pts = unit.polygon_coordinates;
    const p1 = pts[edgeIndex];
    const p2 = pts[(edgeIndex + 1) % pts.length];
    if (!p1 || !p2) return;
    const midpoint = { pctX: (p1.pctX + p2.pctX) / 2, pctY: (p1.pctY + p2.pctY) / 2 };
    const newPoints = [...pts];
    newPoints.splice(edgeIndex + 1, 0, midpoint);
    if (!isFinitePolygon(newPoints)) return;
    if (warnIfUnwired(onUpdateUnitPolygonRef.current, 'onUpdateUnitPolygon:insert-vertex')) {
      onUpdateUnitPolygonRef.current?.(unitId, newPoints);
    }
  // Both sources are refs — always-fresh reads, never deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    /** Mirror the pending polygon or the single selected unit about its bbox center. */
    handleFlip,
    /** Aspect-corrected 90° rotation of a saved unit about its centroid. */
    handleRotatePolygon,
    /** Whole-shape drag commit (select tool) — non-finite → no save. */
    handlePolygonDragEnd,
    /** Node drag commit (select/add_node) — snap-aware; non-finite → no save. */
    handleAnchorDragEnd,
    /** Delete-node tool click — floor-of-3 guard. */
    handleAnchorClick,
    /** add_node branch of the polygon click — nearest-segment vertex insert. */
    handleAddNodeToPolygon,
    /** Pending-polygon edge-midpoint "+" insert (undoable). */
    handleInsertPendingVertex,
    /** Pending-polygon Alt-click vertex delete (undoable; floor-of-3). */
    handleDeletePendingVertex,
    /** Saved-unit edge-midpoint "+" insert (DB-undoable). */
    handleInsertSavedVertex,
    /** History-recording wrapper around onPendingPolygonMove — feeds PendingPolygon. */
    handlePendingPolygonEdit,
    /** Arrow-nudge write (percent-space delta) — called by the keydown effect via ref. */
    nudgeSelected,
    /** Apply one pending-edit undo/redo step — called by the keydown effect via ref. */
    undoRedoPendingEdit,
  };
}
