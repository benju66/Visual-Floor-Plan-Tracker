import React from 'react';
import { Line, Circle } from 'react-konva';
import { usePointerSample, type PointerStore } from '@/utils/pointerStore';
import type { PercentPoint, CanvasLayout } from '@/types/domain';

export interface CaptureLineOverlayProps {
  pointerStore: PointerStore;
  /** The first dragged endpoint (percent space), or null before the drag starts. */
  lineOrigin: PercentPoint | null;
  stageScale: number;
  layout: CanvasLayout;
  toPixels: (points: PercentPoint[]) => number[];
  /**
   * Snap a percent-space point to the nearest long straight vector (the same
   * `getSnappedCoordinate` the trace tool uses). Both endpoints are snapped LIVE so
   * the preview reads as "locked to the grid line" exactly as the saved grid will.
   */
  snap: (p: PercentPoint) => PercentPoint;
}

/**
 * Capture-line drag preview (AI Tracing Assist — Phase 3b). Mounted only while
 * toolMode === 'capture_line'; draws the axis line the user is dragging across a
 * grid line, with BOTH endpoints snapped to the detected vectors. Distinct VIOLET
 * styling marks it as an "AI capture" affordance — the line-tool sibling of
 * {@link CaptureBoxOverlay}'s rubber-band box.
 *
 * Renders in the canvas's overlay Layer and follows the cursor via the pointer
 * store — the same per-frame, subtree-confined pattern as the box preview (no React
 * re-render of the canvas tree on mouse move).
 */
export default function CaptureLineOverlay({
  pointerStore,
  lineOrigin,
  stageScale,
  layout,
  toPixels,
  snap,
}: CaptureLineOverlayProps) {
  const sample = usePointerSample(pointerStore);
  if (!lineOrigin || !sample) return null;

  const a = snap(lineOrigin);
  const b = snap({ pctX: sample.pctX, pctY: sample.pctY });
  const pts = toPixels([a, b]);
  const r = 4 / stageScale;

  return (
    <>
      <Line
        points={pts}
        stroke="rgba(139, 92, 246, 0.95)"
        strokeWidth={2.5 / stageScale}
        dash={[7 / stageScale, 5 / stageScale]}
        lineCap="round"
        listening={false}
      />
      <Circle x={pts[0]} y={pts[1]} radius={r} fill="rgba(139, 92, 246, 0.95)" listening={false} />
      <Circle x={pts[2]} y={pts[3]} radius={r} fill="rgba(139, 92, 246, 0.95)" listening={false} />
    </>
  );
}
