import React from 'react';
import { Line, Circle } from 'react-konva';
import type { PercentPoint, CanvasLayout } from '@/types/domain';

export interface PendingPolygonProps {
  pendingPolygonPoints: PercentPoint[] | null;
  activeDragNode: { unitId: string; index: number; pctX: number; pctY: number } | null;
  activeDragPolygon: { unitId: string; dx: number; dy: number } | null;
  settings: Record<string, any>;
  stageScale: number;
  layout: CanvasLayout;
  isShiftDown: boolean;
  toPixels: (points: PercentPoint[]) => number[];
  setActiveDragPolygon: (payload: { unitId: string; dx: number; dy: number } | null) => void;
  onPendingPolygonMove?: (points: PercentPoint[]) => void;
  setActiveDragNode: (payload: { unitId: string; index: number; pctX: number; pctY: number } | null) => void;
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
  toPixels,
  setActiveDragPolygon,
  onPendingPolygonMove,
  setActiveDragNode,
  onAnchorEnter,
  onAnchorLeave,
  setHoveredPendingPolygon
}: PendingPolygonProps) {
  if (!pendingPolygonPoints || pendingPolygonPoints.length <= 2) return null;

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
        fill="rgba(139, 92, 246, 0.2)"
        stroke="#8b5cf6"
        strokeWidth={(3 * (settings?.markupThickness || 1)) / stageScale}
        globalCompositeOperation="multiply"
        dash={[10 / stageScale, 8 / stageScale]}
        closed={true}
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
          stroke="#8b5cf6"
          strokeWidth={2 / stageScale}
          draggable={true}
          dragBoundFunc={(pos) => {
            if (!isShiftDown) return pos;
            const origX = layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === 'PENDING' ? activeDragPolygon.dx : 0)) * layout.drawW;
            const origY = layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === 'PENDING' ? activeDragPolygon.dy : 0)) * layout.drawH;
            if (Math.abs(pos.x - origX) > Math.abs(pos.y - origY)) {
              return { x: pos.x, y: origY };
            } else {
              return { x: origX, y: pos.y };
            }
          }}
          onDragMove={(e) => {
            const node = e.target;
            let pctX = (node.x() - layout.offsetX) / layout.drawW;
            let pctY = (node.y() - layout.offsetY) / layout.drawH;
            setActiveDragNode({ unitId: 'PENDING', index: i, pctX, pctY });
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
    </React.Fragment>
  );
}
