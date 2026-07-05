import React, { useState } from 'react';
import { Group, Line, Circle, Path } from 'react-konva';
import { getCentroid, getSnappedCoordinate } from '@/utils/geometry';
import { ICON_PATHS } from '@/utils/constants';
import type RBush from 'rbush';
import type { Unit, StatusLog, PercentPoint, CanvasLayout } from '@/types/domain';
import type { ToolMode } from '@/store/useMapStore';

const stripeCache: Record<string, HTMLCanvasElement> = {};

const createStripePattern = (color: string) => {
  if (typeof document === 'undefined') return null;
  if (stripeCache[color]) return stripeCache[color];
  const canvas = document.createElement('canvas');
  canvas.width = 20;
  canvas.height = 20;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(20, 0);
    ctx.stroke();
  }
  stripeCache[color] = canvas;
  return canvas;
};

export interface MappedUnitProps {
  unit: Unit;
  isRouteDropTarget?: boolean;
  activeStatuses: StatusLog[];
  /** Lag Mode: status_color already encodes schedule variance — render fills at full strength. */
  lagMode?: boolean;
  legendFilter: string | null;
  isSelected: boolean;
  isHovered: boolean;
  temporalFilters: string[] | null;
  toolMode: ToolMode;
  /** "Shade locations" map toggle: keep the faint un-statused fill on in EVERY mode (not
   *  just draw/stamp), so locations are visible during setup before statuses exist. */
  shadeUnstatused?: boolean;
  layout: CanvasLayout;
  stageScale: number;
  vectorTree: RBush<any> | null;
  aspect: number;
  enableSnapping: boolean;
  snappingStrength: number;
  settings: Record<string, any>;
  activeDragNode: { unitId: string; index: number; pctX: number; pctY: number; isSnapped?: boolean } | null;
  activeDragPolygon: { unitId: string; dx: number; dy: number } | null;
  isShiftDown: boolean;
  isZoomedOut: boolean;
  mixAlpha: (color: string, alpha: number) => string;
  toPixels: (points: PercentPoint[]) => number[];
  setHoveredUnit: (id: string | null) => void;
  setActiveDragPolygon: (payload: { unitId: string; dx: number; dy: number } | null) => void;
  handlePolygonDragEnd: (e: any, unit: Unit) => void;
  handlePolygonClick: (e: any, unit: Unit) => void;
  onSelectUnit?: (id: string) => void;
  onToolModeChange?: (mode: ToolMode) => void;
  setContextMenu: (payload: { x: number; y: number; unitId: string }) => void;
  onUpdateUnitIconOffset?: (id: string, offsetX: number, offsetY: number) => void;
  onAnchorEnter: (id: string) => void;
  onAnchorLeave: (id: string) => void;
  setHoveredIcon: (hovered: boolean) => void;
  setActiveDragNode: (payload: { unitId: string; index: number; pctX: number; pctY: number; isSnapped?: boolean } | null) => void;
  handleAnchorDragEnd: (e: any, unitId: string, index: number, overridePct?: PercentPoint) => void;
  handleAnchorClick: (e: any, unitId: string, index: number) => void;
  /** Insert a corner at the midpoint of edge `edgeIndex` (point i → i+1, wrapping the
   *  closing edge) on this saved unit. Mirrors the pending polygon's "+" affordance. */
  onInsertVertex?: (unitId: string, edgeIndex: number) => void;
}

export const MappedUnitComponent = ({
  unit,
  isRouteDropTarget,
  activeStatuses,
  lagMode,
  legendFilter,
  isSelected,
  isHovered,
  temporalFilters,
  toolMode,
  shadeUnstatused,
  layout,
  stageScale,
  vectorTree,
  aspect,
  enableSnapping,
  snappingStrength,
  settings,
  activeDragNode,
  activeDragPolygon,
  isShiftDown,
  mixAlpha,
  toPixels,
  setHoveredUnit,
  setActiveDragPolygon,
  handlePolygonDragEnd,
  handlePolygonClick,
  onSelectUnit,
  onToolModeChange,
  setContextMenu,
  onUpdateUnitIconOffset,
  onAnchorEnter,
  onAnchorLeave,
  setHoveredIcon,
  setActiveDragNode,
  handleAnchorDragEnd,
  handleAnchorClick,
  onInsertVertex
}: MappedUnitProps) => {
  const [prevCoordinates, setPrevCoordinates] = useState(unit.polygon_coordinates);
  const [optimisticCoords, setOptimisticCoords] = useState<PercentPoint[] | null>(null);

  if (unit.polygon_coordinates !== prevCoordinates) {
    setPrevCoordinates(unit.polygon_coordinates);
    setOptimisticCoords(null);
  }

  const activeStatus = activeStatuses.find((s) => s.unit_id === unit.id);
  const tState = activeStatus?.temporal_state || 'completed';
  const fillColor = activeStatus ? activeStatus.status_color : 'rgba(0,0,0,0)';
  const matchesLegend =
    !legendFilter || (activeStatus && activeStatus.activityName === legendFilter);
  const dim = legendFilter && !matchesLegend;
  
  const highlight = (isSelected || isHovered) && toolMode !== 'route';
  const isFilteredOut = activeStatus && temporalFilters && !temporalFilters.includes(tState);

  // While a corner on THIS unit is being dragged, thin the outline and drop its glow
  // so the node stays clearly visible during precise placement (the bold 4px highlight
  // + 18px shadow otherwise swallows the dot, worse the further you zoom in). The
  // resting selected look is unchanged.
  const draggingThisNode = activeDragNode?.unitId === unit.id;
  const showGlow = highlight && !draggingThisNode;

  let strokeDash: number[] = [];
  let currentFill = fillColor;
  let currentStroke = activeStatus ? activeStatus.status_color : (dim ? '#94a3b8' : '#475569');

  if (activeStatus && !highlight && !dim) {
    if (lagMode) {
      // Variance IS the encoding — temporal-state alpha fades would hide exactly
      // the units that are most behind. Uniform strength; planned keeps its dash.
      currentFill = mixAlpha(activeStatus.status_color, 0.7);
      if (tState === 'planned') strokeDash = [10, 6];
    } else if (tState === 'none') {
      currentFill = mixAlpha(activeStatus.status_color, 0.05); // Super faint hint
    } else if (tState === 'planned') {
      currentFill = mixAlpha(activeStatus.status_color, 0.3); // Faint
      strokeDash = [10, 6]
    } else if (tState === 'ongoing') {
      currentFill = mixAlpha(activeStatus.status_color, 0.65); // Med
    }
  }
  
  if (dim && activeStatus) {
    currentFill = mixAlpha(activeStatus.status_color, 0.1);
    currentStroke = mixAlpha(activeStatus.status_color, 0.3);
  }

  // Final visual override for routing drop targeting
  if (isRouteDropTarget) {
     currentFill = 'rgba(16, 185, 129, 0.4)';
     currentStroke = '#10b981';
  }

  // Lightly shade already-traced polygons that carry no status fill of their own so you
  // can see what's already there. On automatically while drawing or stamping new ones,
  // and always-on when the "Shade locations" map toggle is set (handy for setting up
  // locations before statuses exist). Faint and under the multiply fill, so the drawing
  // underneath stays readable; the fill Line is listening={false}, so it never intercepts
  // a click. Live-map units keep their status color (guarded by !activeStatus).
  if ((toolMode === 'draw' || toolMode === 'stamp' || shadeUnstatused) && !activeStatus) {
    currentFill = mixAlpha('#60a5fa', 0.12);
  }

  const basePolygon = optimisticCoords || (unit.polygon_coordinates as PercentPoint[]);
  const currentPoints = toPixels(
    activeDragNode?.unitId === unit.id
      ? basePolygon.map((p, i) =>
          i === activeDragNode.index ? { pctX: activeDragNode.pctX, pctY: activeDragNode.pctY } : p
        )
      : basePolygon
  );

  return (
    <React.Fragment>
      {/* The Separated Layer Pattern for Markup Borders */}
      <Group
        visible={!isFilteredOut}
        draggable={isSelected && toolMode === 'select'}
        onDragMove={(e) => {
          const dx = e.target.x() / layout.drawW;
          const dy = e.target.y() / layout.drawH;
          setActiveDragPolygon({ unitId: unit.id, dx, dy });
        }}
        onDragEnd={(e) => {
          const dx = e.target.x() / layout.drawW;
          const dy = e.target.y() / layout.drawH;
          if (dx !== 0 || dy !== 0) {
            setOptimisticCoords(basePolygon.map(p => ({
               pctX: p.pctX + dx,
               pctY: p.pctY + dy
            })));
          }
          setActiveDragPolygon(null);
          handlePolygonDragEnd(e, unit);
        }}
        onMouseEnter={() => setHoveredUnit(unit.id)}
        onMouseLeave={() => setHoveredUnit(null)}
        onClick={(e) => handlePolygonClick(e, unit)}
        onTap={(e) => handlePolygonClick(e, unit)}
        onDblClick={(e) => {
          if (['draw', 'stamp', 'route'].includes(toolMode)) return;
          e.cancelBubble = true;
          onSelectUnit?.(unit.id);
          onToolModeChange?.('select');
        }}
        onDblTap={(e) => {
          if (['draw', 'stamp', 'route'].includes(toolMode)) return;
          e.cancelBubble = true;
          onSelectUnit?.(unit.id);
          onToolModeChange?.('select');
        }}
        onContextMenu={(e) => {
          if (['draw', 'route'].includes(toolMode)) return;
          e.cancelBubble = true;
          e.evt.preventDefault();
          onSelectUnit?.(unit.id);
          onToolModeChange?.('select');
          const stage = e.target.getStage();
          const pointer = stage?.getPointerPosition();
          if (pointer) {
            setTimeout(() => {
                setContextMenu({ x: pointer.x, y: pointer.y, unitId: unit.id });
            }, 10);
          }
        }}
      >
        {/* LAYER 1: Fill Only (Multiplied to reveal architectural text) */}
        <Line
          points={currentPoints}
          fill={currentFill}
          closed={true}
          globalCompositeOperation="multiply"
          listening={false}
          perfectDrawEnabled={false}
        />

        {/* LAYER 2: Stroke Only (Standard rendering, sharp, vibrant) */}
        <Line
          points={currentPoints}
          stroke={isRouteDropTarget ? '#10b981' : highlight ? (isSelected ? '#8b5cf6' : '#0ea5e9') : currentStroke}
          strokeWidth={
            draggingThisNode
              ? 1.5 / stageScale // thin + zoom-stable so the dragged corner stays visible
              : (isRouteDropTarget ? 4.0 : dim ? 1.0 : (highlight ? 4.0 : 2.5)) * (settings?.markupThickness || 1)
          }
          dash={strokeDash}
          closed={true}
          shadowColor={isRouteDropTarget ? 'rgba(16, 185, 129, 0.85)' : showGlow ? (isSelected ? 'rgba(139, 92, 246, 0.85)' : 'rgba(14, 165, 233, 0.85)') : 'transparent'}
          shadowBlur={isRouteDropTarget ? 18 : showGlow ? 18 : 0}
          shadowOpacity={isRouteDropTarget ? 0.9 : showGlow ? 0.9 : 0}
          listening={!isFilteredOut}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />

        {/* Out of Sequence Hatching Overlay */}
        {(() => {
          if (!(activeStatus as any)?.outOfSequence?.length || isFilteredOut || dim) return null;
          const furthestStatus = (activeStatus as any).outOfSequence[(activeStatus as any).outOfSequence.length - 1];
          const pattern = createStripePattern(furthestStatus.status_color);
          if (!pattern) return null;
          return (
            <Line
              points={currentPoints}
              fillPatternImage={pattern as any}
              closed={true}
              opacity={0.6}
              listening={false}
              perfectDrawEnabled={false}
            />
          );
        })()}
      </Group>
      
      {/* The Status Icon — hidden below 0.7x scale for cleaner zoomed-out view */}
      {(activeStatus && tState !== 'none' && !isFilteredOut && stageScale > 0.7) && (() => {
        const TEMPORAL_COLORS: Record<string, string> = {
          planned: '#94a3b8',   // Slate Gray
          ongoing: '#f59e0b',   // Amber
          completed: '#10b981', // Emerald
        };
        const iconColor = TEMPORAL_COLORS[tState as string] || '#cbd5e1';

        let previewPolygon = basePolygon;
        if (activeDragNode?.unitId === unit.id) {
            previewPolygon = basePolygon.map((p, i) =>
                i === activeDragNode.index ? { pctX: activeDragNode.pctX, pctY: activeDragNode.pctY } : p
            );
        }
        const centroid = getCentroid(previewPolygon);
        const draggedOffsetX = activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dx : 0;
        const draggedOffsetY = activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dy : 0;
        
        const offsetX = unit.icon_offset_x || 0;
        const offsetY = unit.icon_offset_y || 0;
        
        const iconAbsX = layout.offsetX + (centroid.pctX + draggedOffsetX + offsetX) * layout.drawW;
        const iconAbsY = layout.offsetY + (centroid.pctY + draggedOffsetY + offsetY) * layout.drawH;

        const isDelayed = 
          settings?.show_delay_indicators !== false &&
          tState !== 'completed' &&
          activeStatus.planned_end_date &&
          new Date(activeStatus.planned_end_date) < new Date(new Date().setHours(0,0,0,0));

        return (
          <Group
            x={iconAbsX}
            y={iconAbsY}
            scale={{ x: 1 / stageScale, y: 1 / stageScale }}
            draggable={toolMode === 'select' && isShiftDown}
            opacity={dim ? 0.3 : 1}
            onDragStart={(e) => {
              e.cancelBubble = true;
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              
              const newAbsX = e.target.x();
              const newAbsY = e.target.y();
              
              const newPctX = (newAbsX - layout.offsetX) / layout.drawW;
              const newPctY = (newAbsY - layout.offsetY) / layout.drawH;
              
              const baseCentroid = getCentroid(basePolygon);
              const newOffsetX = newPctX - baseCentroid.pctX;
              const newOffsetY = newPctY - baseCentroid.pctY;
              
              onUpdateUnitIconOffset?.(unit.id, newOffsetX, newOffsetY);
            }}
            onMouseEnter={() => setHoveredIcon(true)}
            onMouseLeave={() => setHoveredIcon(false)}
            onClick={(e) => handlePolygonClick(e, unit)}
            onTap={(e) => handlePolygonClick(e, unit)}
          >
            {isDelayed && (
              <Circle
                radius={16}
                fill="transparent"
                stroke="#ef4444"
                strokeWidth={3}
                shadowColor="#ef4444"
                shadowBlur={8}
                opacity={0.8}
                listening={false}
                perfectDrawEnabled={false}
                shadowForStrokeEnabled={false}
              />
            )}
            <Circle
              radius={12}
              fill="#ffffff"
              stroke={isDelayed ? '#ef4444' : iconColor}
              strokeWidth={2.5}
              shadowColor={isDelayed ? "rgba(239, 68, 68, 0.4)" : "rgba(0,0,0,0.4)"}
              shadowBlur={isDelayed ? 8 : 4}
              shadowOffset={{ x: 0, y: 2 }}
              perfectDrawEnabled={false}
              shadowForStrokeEnabled={false}
            />
            <Path
              x={-8}
              y={-8}
              data={ICON_PATHS[tState as 'planned' | 'ongoing' | 'completed'] || ICON_PATHS.completed}
              fill="transparent"
              stroke={isDelayed ? '#ef4444' : iconColor}
              strokeWidth={2}
              strokeLineCap="round"
              strokeLineJoin="round"
              scale={{ x: 0.65, y: 0.65 }}
              listening={false}
              perfectDrawEnabled={false}
            />
          </Group>
        );
      })()}
      
      {isSelected && basePolygon.map((pt, i) => (
         <Circle
           key={`anchor-${i}`}
           x={layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dx : 0)) * layout.drawW}
           y={layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dy : 0)) * layout.drawH}
           radius={(toolMode === 'delete_node' ? 6 : 5) / stageScale}
           fill={toolMode === 'delete_node' ? '#ef4444' : '#fff'}
           stroke={toolMode === 'delete_node' ? '#fff' : '#8b5cf6'}
           strokeWidth={2 / stageScale}
           perfectDrawEnabled={false}
           draggable={['select', 'add_node'].includes(toolMode)}
           dragBoundFunc={(pos) => {
             if (isShiftDown) {
               const origX = layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dx : 0)) * layout.drawW;
               const origY = layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dy : 0)) * layout.drawH;
               if (Math.abs(pos.x - origX) > Math.abs(pos.y - origY)) {
                 return { x: pos.x, y: origY };
               } else {
                 return { x: origX, y: pos.y };
               }
             }
             // Synchronous snap: dragBoundFunc is the ONLY place that can constrain
             // the node's visual position in real time during the drag. getSnappedCoordinate
             // must be synchronous for this — which is why snapping lives on the main thread.
             if (enableSnapping) {
               const pctX = (pos.x - layout.offsetX) / layout.drawW;
               const pctY = (pos.y - layout.offsetY) / layout.drawH;
               const snap = getSnappedCoordinate(pctX, pctY, vectorTree, aspect, layout.drawW, stageScale, snappingStrength || 15);
               if (snap.snapped) {
                 return {
                   x: layout.offsetX + snap.pctX * layout.drawW,
                   y: layout.offsetY + snap.pctY * layout.drawH
                 };
               }
             }
             return pos;
           }}
           onDragMove={(e) => {
             // node.x()/y() already reflect the snapped position applied by dragBoundFunc,
             // so the indicator ring tracks the locked point with no extra computation.
             const node = e.target;
             const pctX = (node.x() - layout.offsetX) / layout.drawW;
             const pctY = (node.y() - layout.offsetY) / layout.drawH;
             let isSnapped = false;
             if (enableSnapping && !isShiftDown) {
               const snap = getSnappedCoordinate(pctX, pctY, vectorTree, aspect, layout.drawW, stageScale, snappingStrength || 15);
               isSnapped = snap.snapped;
             }
             setActiveDragNode({ unitId: unit.id, index: i, pctX, pctY, isSnapped });
           }}
           onDragEnd={(e) => {
             const node = e.target;
             const pctX = (node.x() - layout.offsetX) / layout.drawW;
             const pctY = (node.y() - layout.offsetY) / layout.drawH;
             const newPoints = [...basePolygon];
             newPoints[i] = { pctX, pctY };
             setOptimisticCoords(newPoints);

             setActiveDragNode(null);
             // Persist the EXACT point just drawn (overridePct) so the saved vertex
             // equals what the user saw on release — never re-derived/re-snapped from
             // a different basis (which could desync the shape).
             handleAnchorDragEnd(e, unit.id, i, { pctX, pctY });
           }}
           onClick={(e) => handleAnchorClick(e, unit.id, i)}
           onTap={(e) => handleAnchorClick(e, unit.id, i)}
           onMouseEnter={() => onAnchorEnter(`${unit.id}:${i}`)}
           onMouseLeave={() => onAnchorLeave(`${unit.id}:${i}`)}
         />
      ))}

      {/* Edge-midpoint "+" to add a corner — the saved-unit twin of the pending
          polygon's affordance. Shown on a selected room while editing (select/add_node),
          hidden mid-drag so it doesn't clutter or sit on stale midpoints. Clicking
          inserts a corner at that edge's midpoint (persisted, DB-undoable). */}
      {isSelected && onInsertVertex && ['select', 'add_node'].includes(toolMode) &&
        !draggingThisNode && activeDragPolygon?.unitId !== unit.id &&
        basePolygon.length >= 3 && basePolygon.map((pt, i) => {
          const next = basePolygon[(i + 1) % basePolygon.length];
          const mx = layout.offsetX + ((pt.pctX + next.pctX) / 2) * layout.drawW;
          const my = layout.offsetY + ((pt.pctY + next.pctY) / 2) * layout.drawH;
          const r = 6 / stageScale;
          const arm = 3 / stageScale;
          return (
            <React.Fragment key={`insert-${i}`}>
              <Circle
                x={mx}
                y={my}
                radius={r}
                fill="#8b5cf6"
                stroke="#fff"
                strokeWidth={1 / stageScale}
                opacity={0.85}
                perfectDrawEnabled={false}
                onMouseDown={(e) => { e.cancelBubble = true; }}
                onClick={(e) => { e.cancelBubble = true; onInsertVertex(unit.id, i); }}
                onTap={(e) => { e.cancelBubble = true; onInsertVertex(unit.id, i); }}
              />
              <Line points={[mx - arm, my, mx + arm, my]} stroke="#fff" strokeWidth={1.5 / stageScale} listening={false} perfectDrawEnabled={false} />
              <Line points={[mx, my - arm, mx, my + arm]} stroke="#fff" strokeWidth={1.5 / stageScale} listening={false} perfectDrawEnabled={false} />
            </React.Fragment>
          );
        })}

      {isSelected && activeDragNode?.unitId === unit.id && activeDragNode?.isSnapped && (
         <Circle
           x={layout.offsetX + activeDragNode.pctX * layout.drawW}
           y={layout.offsetY + activeDragNode.pctY * layout.drawH}
           radius={8 / stageScale}
           stroke="#ec4899"
           strokeWidth={2 / stageScale}
           fill="transparent"
           listening={false}
           perfectDrawEnabled={false}
         />
      )}
    </React.Fragment>
  );
};

export default React.memo(MappedUnitComponent, (prevProps, nextProps) => {
  // Guard: reference-check unit geometry and icon offset for immediate bail-out
  const prevUnit = prevProps.unit;
  const nextUnit = nextProps.unit;
  if (prevUnit.polygon_coordinates !== nextUnit.polygon_coordinates) return false;
  if (prevUnit.icon_offset_x !== nextUnit.icon_offset_x) return false;
  if (prevUnit.icon_offset_y !== nextUnit.icon_offset_y) return false;

  // Cache find() once — reused for status_color, temporal_state, and activity checks.
  // Avoids 6 repeated O(n) scans per comparator invocation per unit.
  const prevStatus = prevProps.activeStatuses.find(s => s.unit_id === prevProps.unit.id);
  const nextStatus = nextProps.activeStatuses.find(s => s.unit_id === nextProps.unit.id);
  if (prevStatus?.status_color !== nextStatus?.status_color) return false;

  return (
    prevProps.lagMode === nextProps.lagMode &&
    prevProps.isRouteDropTarget === nextProps.isRouteDropTarget &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isHovered === nextProps.isHovered &&
    prevProps.stageScale === nextProps.stageScale &&
    prevProps.toolMode === nextProps.toolMode &&
    prevProps.shadeUnstatused === nextProps.shadeUnstatused &&
    prevProps.legendFilter === nextProps.legendFilter &&
    prevProps.activeDragNode?.unitId === nextProps.activeDragNode?.unitId &&
    (prevProps.activeDragNode?.unitId !== prevProps.unit.id ? true :
      prevProps.activeDragNode?.index === nextProps.activeDragNode?.index &&
      prevProps.activeDragNode?.pctX === nextProps.activeDragNode?.pctX &&
      prevProps.activeDragNode?.pctY === nextProps.activeDragNode?.pctY &&
      prevProps.activeDragNode?.isSnapped === nextProps.activeDragNode?.isSnapped) &&
    prevProps.activeDragPolygon?.unitId === nextProps.activeDragPolygon?.unitId &&
    (prevProps.activeDragPolygon?.unitId !== prevProps.unit.id ? true :
      prevProps.activeDragPolygon?.dx === nextProps.activeDragPolygon?.dx &&
      prevProps.activeDragPolygon?.dy === nextProps.activeDragPolygon?.dy) &&
    // Compare ALL four layout fields, not just drawW: if drawH/offsetX/offsetY
    // change without drawW (e.g. the PDF's real aspect settles in after first
    // render), a stale closure here would let a node drag compute coordinates
    // against the old draw rect — saving a distorted/compressed polygon.
    prevProps.layout.drawW === nextProps.layout.drawW &&
    prevProps.layout.drawH === nextProps.layout.drawH &&
    prevProps.layout.offsetX === nextProps.layout.offsetX &&
    prevProps.layout.offsetY === nextProps.layout.offsetY &&
    prevStatus?.temporal_state === nextStatus?.temporal_state &&
    prevStatus?.activityName === nextStatus?.activityName
  );
});
