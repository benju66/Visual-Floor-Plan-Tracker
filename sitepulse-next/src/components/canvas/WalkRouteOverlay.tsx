"use client";
import React, { useMemo } from 'react';
import { Group, Line, Circle, Text } from 'react-konva';
import RouteGhostNode from '@/components/canvas/RouteGhostNode';
import { getCentroid, nearestCentroidWithin } from '@/utils/geometry';
import type { PointerStore } from '@/utils/pointerStore';
import type { Unit, CanvasLayout } from '@/types/domain';
import type { ToolMode, RouteSubMode } from '@/store/useMapStore';

export interface WalkRouteOverlayProps {
  units: Unit[];
  pendingRoute: string[];
  setPendingRoute: (val: string[] | ((prev: string[]) => string[])) => void;
  toolMode: ToolMode;
  routeSubMode: RouteSubMode;
  showWalkSequence: boolean;
  layout: CanvasLayout;
  stageScale: number;
  hoveredRouteNode: string | null;
  setHoveredRouteNode: (id: string | null) => void;
  setHoveredRouteSegment: React.Dispatch<React.SetStateAction<number | null>>;
  setIsDraggingRouteNode: (dragging: boolean) => void;
  activeRouteDrag: { type: string; sourceIndex: number } | null;
  setActiveRouteDrag: (payload: { type: string; sourceIndex: number } | null) => void;
  routeDropTarget: string | null;
  setRouteDropTarget: (id: string | null) => void;
  pointerStore: PointerStore;
}

/**
 * Walk-route editing/display overlay: segmented dashed lines, numbered draggable
 * nodes, and the midpoint-insertion ghost. Extracted from FloorplanCanvas (it was
 * a ~285-line inline IIFE re-created every parent render) and memoized so it only
 * re-renders when route-relevant props change.
 */
function WalkRouteOverlayInner({
  units,
  pendingRoute,
  setPendingRoute,
  toolMode,
  routeSubMode,
  showWalkSequence,
  layout,
  stageScale,
  hoveredRouteNode,
  setHoveredRouteNode,
  setHoveredRouteSegment,
  setIsDraggingRouteNode,
  activeRouteDrag,
  setActiveRouteDrag,
  routeDropTarget,
  setRouteDropTarget,
  pointerStore,
}: WalkRouteOverlayProps) {
  const routePoints = useMemo(() => {
    let orderedIds: string[] = [];
    if (toolMode === 'route') {
      orderedIds = pendingRoute;
    } else if (showWalkSequence) {
      orderedIds = [...units]
        .filter(u => typeof (u as any).walk_sequence === 'number')
        .sort((a, b) => ((a as any).walk_sequence as number) - ((b as any).walk_sequence as number))
        .map(u => u.id);
    }
    return orderedIds
      .map(id => units.find(u => u.id === id))
      .filter(u => u && u.polygon_coordinates && u.polygon_coordinates.length > 0)
      .map(u => {
        const c = getCentroid(u!.polygon_coordinates!);
        return { id: u!.id, pctX: c.pctX, pctY: c.pctY };
      });
  }, [toolMode, showWalkSequence, pendingRoute, units]);

  if (routePoints.length === 0) return null;

  const lineOpacity = toolMode === 'route' ? 0.8 : 0.4;
  const dotOpacity = toolMode === 'route' ? 1 : 0.6;

  return (
    <Group>
      {/* Render segmented lines to allow individual midpoint insertion */}
      {routePoints.slice(0, -1).map((p1, i) => {
        const p2 = routePoints[i + 1];
        const startX = layout.offsetX + p1.pctX * layout.drawW;
        const startY = layout.offsetY + p1.pctY * layout.drawH;
        const endX = layout.offsetX + p2.pctX * layout.drawW;
        const endY = layout.offsetY + p2.pctY * layout.drawH;

        return (
          <Line
            key={`route-segment-${i}`}
            points={[startX, startY, endX, endY]}
            stroke="#3b82f6"
            strokeWidth={4 / stageScale}
            dash={[10 / stageScale, 10 / stageScale]}
            lineCap="round"
            lineJoin="round"
            opacity={lineOpacity}
            perfectDrawEnabled={false}
            // FIX: Listen for both add and remove modes
            listening={toolMode === 'route' && (routeSubMode === 'add' || routeSubMode === 'remove')}
            onMouseEnter={(e) => {
              // Visual emphasis only — the cursor is derived from
              // hoveredRouteSegment via computedCursor.
              if (routeSubMode === 'add') {
                (e.target as any).stroke("#10b981"); // Emerald
              } else if (routeSubMode === 'remove') {
                (e.target as any).stroke("#ef4444"); // Red
              }
              (e.target as any).strokeWidth(6 / stageScale);
              e.target.getLayer()!.batchDraw();
              setHoveredRouteSegment(i);
            }}
            onMouseLeave={(e) => {
              (e.target as any).stroke("#3b82f6");
              (e.target as any).strokeWidth(4 / stageScale);
              e.target.getLayer()!.batchDraw();
              setHoveredRouteSegment(prev => (prev === i ? null : prev));
            }}
            onMouseDown={(e) => {
              e.cancelBubble = true;
              // FIX: Only trigger midpoint drag in add mode
              if (routeSubMode === 'add') {
                setActiveRouteDrag({ type: 'midpoint', sourceIndex: i });
              }
            }}
          />
        );
      })}

      {/* Ghost Node for Midpoint Insertion */}
      {activeRouteDrag && activeRouteDrag.type === 'midpoint' && (() => {
        const p1 = routePoints[activeRouteDrag.sourceIndex];
        const p2 = routePoints[activeRouteDrag.sourceIndex + 1];
        if (!p1 || !p2) return null;

        return (
          <RouteGhostNode
            pointerStore={pointerStore}
            layout={layout}
            stageScale={stageScale}
            start={{ pctX: p1.pctX, pctY: p1.pctY }}
            end={{ pctX: p2.pctX, pctY: p2.pctY }}
          />
        );
      })()}

      {routePoints.map((p, idx) => {
        const x = layout.offsetX + p.pctX * layout.drawW;
        const y = layout.offsetY + p.pctY * layout.drawH;
        const isHoveredNode = hoveredRouteNode === p.id;
        return (
          <Group
            key={`route-${p.id}`}
            x={x}
            y={y}
            opacity={dotOpacity}
            draggable={toolMode === 'route' && routeSubMode === 'move'}
            listening={toolMode === 'route'}
            onClick={(e) => {
              e.cancelBubble = true;
              if (toolMode === 'route' && routeSubMode === 'remove') {
                // Clearing hover state recomputes the cursor; no manual
                // reset needed even though this node is about to unmount.
                setHoveredRouteNode(null);
                setPendingRoute(pendingRoute.filter(id => id !== p.id));
              }
            }}
            onTap={(e) => {
              if (toolMode === 'route' && routeSubMode === 'remove') {
                e.cancelBubble = true;
                setHoveredRouteNode(null);
                setPendingRoute(prev => prev.filter(id => id !== p.id));
              }
            }}
            onMouseEnter={() => {
              // Cursor follows from hoveredRouteNode via computedCursor.
              setHoveredRouteNode(p.id);
            }}
            onMouseLeave={() => {
              setHoveredRouteNode(null);
            }}
            onDragStart={(e) => {
              e.cancelBubble = true;
              setIsDraggingRouteNode(true);
              e.target.scale({ x: 1.2, y: 1.2 });
              const circle = (e.target as any).findOne('Circle');
              if (circle) {
                circle.shadowOpacity(0.6);
                circle.shadowBlur(8 / stageScale);
              }
            }}
            onDragMove={(e) => {
              const closestId = nearestCentroidWithin(
                units, e.target.x(), e.target.y(), 40 / stageScale, layout,
              );
              if (closestId !== routeDropTarget) {
                setRouteDropTarget(closestId);
              }
            }}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              setIsDraggingRouteNode(false);
              e.target.scale({ x: 1, y: 1 });
              const circle = (e.target as any).findOne?.('Circle');
              if (circle) {
                circle.shadowOpacity(0.3);
                circle.shadowBlur(4 / stageScale);
              }

              const dropX = e.target.x();
              const dropY = e.target.y();

              setRouteDropTarget(null);

              // 1. Check for Node Replacement (Dropping on a unit)
              const closestId = nearestCentroidWithin(units, dropX, dropY, 40 / stageScale, layout);

              // 2. Check for Line Segment Insertion (Dropping on the dotted line)
              let insertIndex = -1;
              if (!closestId) {
                let minLineDist = Infinity;
                for (let i = 0; i < routePoints.length - 1; i++) {
                  const p1 = { x: layout.offsetX + routePoints[i].pctX * layout.drawW, y: layout.offsetY + routePoints[i].pctY * layout.drawH };
                  const p2 = { x: layout.offsetX + routePoints[i + 1].pctX * layout.drawW, y: layout.offsetY + routePoints[i + 1].pctY * layout.drawH };

                  const l2 = Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
                  let t = l2 === 0 ? 0 : ((dropX - p1.x) * (p2.x - p1.x) + (dropY - p1.y) * (p2.y - p1.y)) / l2;
                  t = Math.max(0, Math.min(1, t));

                  const proj = { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
                  const d = Math.sqrt(Math.pow(dropX - proj.x, 2) + Math.pow(dropY - proj.y, 2));

                  // 30 pixel snap radius to the line
                  if (d < (30 / stageScale) && d < minLineDist) {
                    minLineDist = d;
                    insertIndex = i + 1; // Insert after the first node of the segment
                  }
                }
              }

              // 3. Apply Array Mutations
              if (closestId && closestId !== p.id) {
                const newRoute = [...pendingRoute];
                const dragIndex = newRoute.indexOf(p.id);

                if (pendingRoute.includes(closestId)) {
                  // NODE SHIFT LOGIC (Swap/Shift)
                  const dropIndex = newRoute.indexOf(closestId);
                  const [draggedItem] = newRoute.splice(dragIndex, 1);
                  newRoute.splice(dropIndex, 0, draggedItem);
                } else {
                  // NODE REPLACEMENT LOGIC (Assignment Change)
                  newRoute[dragIndex] = closestId;
                }

                setPendingRoute(newRoute);
              } else if (insertIndex !== -1) {
                // LINE INSERTION LOGIC (New)
                const newRoute = [...pendingRoute];
                const dragIndex = newRoute.indexOf(p.id);

                const [draggedItem] = newRoute.splice(dragIndex, 1);
                // Adjust insertion index if we removed an item from earlier in the array
                const adjustedInsertIndex = dragIndex < insertIndex ? insertIndex - 1 : insertIndex;
                newRoute.splice(adjustedInsertIndex, 0, draggedItem);

                setPendingRoute(newRoute);
              }

              e.target.x(x);
              e.target.y(y);
            }}
          >
            <Circle
              radius={12 / stageScale}
              fill={isHoveredNode ? "#2563eb" : "#3b82f6"}
              stroke={isHoveredNode ? "#ffffff" : "transparent"}
              strokeWidth={2 / stageScale}
              shadowColor="black"
              shadowBlur={(isHoveredNode ? 8 : 4) / stageScale}
              shadowOpacity={isHoveredNode ? 0.5 : 0.3}
              shadowOffset={{x: 0, y: 2/stageScale}}
              perfectDrawEnabled={false}
              shadowForStrokeEnabled={false}
            />
            <Text text={(idx + 1).toString()} fontSize={14 / stageScale} fill="white" fontStyle="bold" align="center" verticalAlign="middle" width={24 / stageScale} height={24 / stageScale} offsetX={12 / stageScale} offsetY={12 / stageScale} listening={false} perfectDrawEnabled={false} />
          </Group>
        );
      })}
    </Group>
  );
}

export default React.memo(WalkRouteOverlayInner);
