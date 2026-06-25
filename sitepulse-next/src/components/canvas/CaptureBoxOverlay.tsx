import React from 'react';
import { Line } from 'react-konva';
import { usePointerSample, type PointerStore } from '@/utils/pointerStore';
import type { PercentPoint, CanvasLayout } from '@/types/domain';

export interface CaptureBoxOverlayProps {
  pointerStore: PointerStore;
  /** The first dragged corner (percent space), or null before the drag starts. */
  boxOrigin: PercentPoint | null;
  stageScale: number;
  layout: CanvasLayout;
  toPixels: (points: PercentPoint[]) => number[];
}

/**
 * Capture-box drag preview (AI Tracing Assist — Phase 3a). Mounted only while
 * toolMode === 'capture_box'; draws the rubber-band rectangle the user is
 * dragging over a region to read (e.g. the title block). Distinct VIOLET styling
 * marks it as an "AI capture" affordance, separate from the blue draw-tool box.
 *
 * Renders in the canvas's overlay Layer and follows the cursor via the pointer
 * store — the same per-frame, subtree-confined pattern as {@link DraftPolygon}'s
 * box preview (no React re-render of the canvas tree on mouse move).
 */
export default function CaptureBoxOverlay({
  pointerStore,
  boxOrigin,
  stageScale,
  layout,
  toPixels,
}: CaptureBoxOverlayProps) {
  const sample = usePointerSample(pointerStore);
  if (!boxOrigin || !sample) return null;

  return (
    <Line
      points={toPixels([
        { pctX: boxOrigin.pctX, pctY: boxOrigin.pctY },
        { pctX: sample.pctX, pctY: boxOrigin.pctY },
        { pctX: sample.pctX, pctY: sample.pctY },
        { pctX: boxOrigin.pctX, pctY: sample.pctY },
      ])}
      stroke="rgba(139, 92, 246, 0.9)"
      fill="rgba(139, 92, 246, 0.15)"
      strokeWidth={2 / stageScale}
      dash={[6 / stageScale, 6 / stageScale]}
      closed={true}
      listening={false}
    />
  );
}
