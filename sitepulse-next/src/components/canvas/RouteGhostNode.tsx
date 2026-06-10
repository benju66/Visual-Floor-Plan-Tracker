"use client";
import { Group, Line, Circle } from 'react-konva';
import { usePointerSample, type PointerStore } from '@/utils/pointerStore';
import type { CanvasLayout, PercentPoint } from '@/types/domain';

export interface RouteGhostNodeProps {
  pointerStore: PointerStore;
  layout: CanvasLayout;
  stageScale: number;
  /** Endpoints (pct coords) of the route segment being split by the midpoint drag. */
  start: PercentPoint;
  end: PercentPoint;
}

/**
 * Ghost preview while dragging a new midpoint onto a walk-route segment.
 * Mounted only during the drag, so its per-frame pointer subscription
 * re-renders just this tiny subtree.
 */
export default function RouteGhostNode({ pointerStore, layout, stageScale, start, end }: RouteGhostNodeProps) {
  const sample = usePointerSample(pointerStore);
  if (!sample) return null;

  const ghostX = layout.offsetX + sample.pctX * layout.drawW;
  const ghostY = layout.offsetY + sample.pctY * layout.drawH;
  const startX = layout.offsetX + start.pctX * layout.drawW;
  const startY = layout.offsetY + start.pctY * layout.drawH;
  const endX = layout.offsetX + end.pctX * layout.drawW;
  const endY = layout.offsetY + end.pctY * layout.drawH;

  return (
    <Group listening={false}>
      <Line
        points={[startX, startY, ghostX, ghostY, endX, endY]}
        stroke="#10b981"
        strokeWidth={4 / stageScale}
        dash={[10 / stageScale, 10 / stageScale]}
        opacity={0.8}
        perfectDrawEnabled={false}
      />
      <Circle
        x={ghostX}
        y={ghostY}
        radius={12 / stageScale}
        fill="#10b981"
        opacity={0.5}
        perfectDrawEnabled={false}
      />
    </Group>
  );
}
