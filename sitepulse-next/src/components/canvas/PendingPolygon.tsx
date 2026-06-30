import React from 'react';
import { Line, Circle } from 'react-konva';
import { getSnappedCoordinate } from '@/utils/geometry';
import type RBush from 'rbush';
import type { PercentPoint, CanvasLayout } from '@/types/domain';

export interface PendingPolygonProps {
  pendingPolygonPoints: PercentPoint[] | null;
  activeDragNode: { unitId: string; index: number; pctX: number; pctY: number; isSnapped?: boolean } | null;
  activeDragPolygon: { unitId: string; dx: number; dy: number } | null;
  settings: Record<string, any>;
  stageScale: number;
  layout: CanvasLayout;
  isShiftDown: boolean;
  /** Wall-snapping inputs — same set MappedUnit gets so pending node drags snap
   *  identically to saved-unit node drags. `enableSnapping` is the effective flag
   *  (suspended while the magnifier is active), not the raw setting. */
  vectorTree: RBush<any> | null;
  aspect: number;
  enableSnapping: boolean;
  snappingStrength: number;
  /** True when the current (live) pending shape overlaps itself — drives a
   *  non-blocking amber warning tint. Never blocks saving (owner decision). */
  isSelfIntersecting?: boolean;
  toPixels: (points: PercentPoint[]) => number[];
  setActiveDragPolygon: (payload: { unitId: string; dx: number; dy: number } | null) => void;
  onPendingPolygonMove?: (points: PercentPoint[]) => void;
  setActiveDragNode: (payload: { unitId: string; index: number; pctX: number; pctY: number; isSnapped?: boolean } | null) => void;
  onAnchorEnter: (id: string) => void;
  onAnchorLeave: (id: string) => void;
  setHoveredPendingPolygon: (hovered: boolean) => void;
}

export default function PendingPolygon({
  pendingPolygonPoints,
  activeDragNode,
  activeDragPolygon,
  settings,
  stageScale,
  layout,
  isShiftDown,
  vectorTree,
  aspect,
  enableSnapping,
  snappingStrength,
  isSelfIntersecting,
  toPixels,
  setActiveDragPolygon,
  onPendingPolygonMove,
  setActiveDragNode,
  onAnchorEnter,
  onAnchorLeave,
  setHoveredPendingPolygon
}: PendingPolygonProps) {
  if (!pendingPolygonPoints || pendingPolygonPoints.length <= 2) return null;

  // Amber warning palette for a self-overlapping ("bow-tie") shape; violet otherwise.
  const fillColor = isSelfIntersecting ? 'rgba(245, 158, 11, 0.25)' : 'rgba(139, 92, 246, 0.2)';
  const strokeColor = isSelfIntersecting ? '#f59e0b' : '#8b5cf6';

  return (
    <React.Fragment>
      <Line
        points={toPixels(
          activeDragNode?.unitId === 'PENDING'
            ? pendingPolygonPoints.map((p, i) =>
                i === activeDragNode.index ? { pctX: activeDragNode.pctX, pctY: activeDragNode.pctY } : p
              )
            : pendingPolygonPoints
        )}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={(3 * (settings?.markupThickness || 1)) / stageScale}
        globalCompositeOperation="multiply"
        dash={[10 / stageScale, 8 / stageScale]}
        closed={true}
        perfectDrawEnabled={false}
        draggable={true}
        onDragMove={(e) => {
          const dx = e.target.x() / layout.drawW;
          const dy = e.target.y() / layout.drawH;
          setActiveDragPolygon({ unitId: 'PENDING', dx, dy });
        }}
        onDragEnd={(e) => {
          setActiveDragPolygon(null);
          const dx = e.target.x() / layout.drawW;
          const dy = e.target.y() / layout.drawH;
          e.target.x(0);
          e.target.y(0);
          onPendingPolygonMove?.(
            pendingPolygonPoints.map(p => ({ pctX: p.pctX + dx, pctY: p.pctY + dy }))
          );
        }}
        onMouseEnter={() => setHoveredPendingPolygon(true)}
        onMouseLeave={() => setHoveredPendingPolygon(false)}
      />
      {pendingPolygonPoints.map((pt, i) => (
        <Circle
          key={`pending-anchor-${i}`}
          x={layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === 'PENDING' ? activeDragPolygon.dx : 0)) * layout.drawW}
          y={layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === 'PENDING' ? activeDragPolygon.dy : 0)) * layout.drawH}
          radius={5 / stageScale}
          fill="#fff"
          stroke={strokeColor}
          strokeWidth={2 / stageScale}
          perfectDrawEnabled={false}
          draggable={true}
          dragBoundFunc={(pos) => {
            if (isShiftDown) {
              const origX = layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === 'PENDING' ? activeDragPolygon.dx : 0)) * layout.drawW;
              const origY = layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === 'PENDING' ? activeDragPolygon.dy : 0)) * layout.drawH;
              if (Math.abs(pos.x - origX) > Math.abs(pos.y - origY)) {
                return { x: pos.x, y: origY };
              } else {
                return { x: origX, y: pos.y };
              }
            }
            // Synchronous wall snap — identical to MappedUnit's saved-unit anchor:
            // dragBoundFunc is the only place that can constrain the node's visual
            // position in real time, so the released node.x()/y() is already snapped.
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
            // node.x()/y() already reflect the snapped position from dragBoundFunc;
            // recompute isSnapped only to drive the snap-ring indicator.
            const node = e.target;
            const pctX = (node.x() - layout.offsetX) / layout.drawW;
            const pctY = (node.y() - layout.offsetY) / layout.drawH;
            let isSnapped = false;
            if (enableSnapping && !isShiftDown) {
              const snap = getSnappedCoordinate(pctX, pctY, vectorTree, aspect, layout.drawW, stageScale, snappingStrength || 15);
              isSnapped = snap.snapped;
            }
            setActiveDragNode({ unitId: 'PENDING', index: i, pctX, pctY, isSnapped });
          }}
          onDragEnd={(e) => {
            setActiveDragNode(null);
            const node = e.target;
            let pctX = (node.x() - layout.offsetX) / layout.drawW;
            let pctY = (node.y() - layout.offsetY) / layout.drawH;
            const newPoints = [...pendingPolygonPoints];
            newPoints[i] = { pctX, pctY };
            onPendingPolygonMove?.(newPoints);
          }}
          onMouseEnter={() => onAnchorEnter(`PENDING:${i}`)}
          onMouseLeave={() => onAnchorLeave(`PENDING:${i}`)}
        />
      ))}

      {/* Snap ring — mirrors MappedUnit/DraftPolygon's visual language so pending
          editing reads identically to saved-unit editing. */}
      {activeDragNode?.unitId === 'PENDING' && activeDragNode?.isSnapped && (
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
}
