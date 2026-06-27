import React from 'react';
import { Line, Circle } from 'react-konva';
import { usePointerSample, type PointerStore } from '@/utils/pointerStore';
import { OPENING_TYPE_RGB } from '@/utils/openingEdges';
import type { OpeningEdge, PercentPoint, CanvasLayout } from '@/types/domain';

export interface DraftPolygonProps {
  draftPoints: PercentPoint[];
  pointerStore: PointerStore;
  boxOrigin: PercentPoint | null;
  stageScale: number;
  layout: CanvasLayout;
  enableSnapping: boolean;
  isShiftDown: boolean;
  toPixels: (points: PercentPoint[]) => number[];
  /**
   * Opening edges tagged so far on the in-progress trace (AI Tracing Assist —
   * Phase 4a). Edge `i` spans `draftPoints[i] → draftPoints[i+1]`, so a tag is drawn
   * as a colored overlay on that placed segment. Empty/omitted on the live map.
   */
  openingEdges?: OpeningEdge[];
  /** True while the opening hold-key is down — tint the cursor ghost so it's obvious. */
  openingArmed?: boolean;
  /** The active opening type's color (rgb triplet), used to tint the armed ghost line. */
  activeOpeningRGB?: string;
}

/**
 * Draw-mode preview: cursor ghost line, snap ring, box-drag preview, and the
 * confirmed draft outline. Mounted only while toolMode === 'draw'; follows the
 * cursor via the pointer store (per-frame re-renders confined to this subtree).
 * The sample's pct coords and snap result are computed upstream in onMouseMove
 * against the live stage transform — the same values handleStageClick commits.
 */
export default function DraftPolygon({
  draftPoints,
  pointerStore,
  boxOrigin,
  stageScale,
  layout,
  enableSnapping,
  isShiftDown,
  toPixels,
  openingEdges,
  openingArmed,
  activeOpeningRGB,
}: DraftPolygonProps) {
  const sample = usePointerSample(pointerStore);

  return (
    <React.Fragment>
      {/* Snap Preview & Ghost Node (Active even before first point is placed) */}
      {sample && !boxOrigin && (() => {
        let pctX = sample.pctX;
        let pctY = sample.pctY;
        let isSnapped = false;

        if (isShiftDown && draftPoints.length > 0) {
          const last = draftPoints[draftPoints.length - 1];
          const dx = Math.abs(pctX - last.pctX);
          const dy = Math.abs(pctY - last.pctY);
          if (dx > dy) pctY = last.pctY;
          else pctX = last.pctX;
        } else if (enableSnapping && sample.snap?.snapped) {
          pctX = sample.snap.pctX;
          pctY = sample.snap.pctY;
          isSnapped = true;
        }

        // While the opening key is held, the next placed edge becomes an opening — tint
        // the cursor ghost in the active type's color so it's unmistakable.
        const armed = openingArmed && draftPoints.length > 0;
        const ghostStroke = armed && activeOpeningRGB ? `rgb(${activeOpeningRGB})` : 'rgba(59, 130, 246, 0.4)';

        return (
          <React.Fragment>
            {draftPoints.length > 0 && (
              <Line
                points={toPixels([...draftPoints, {pctX, pctY}])}
                stroke={ghostStroke}
                strokeWidth={(armed ? 3 : 2) / stageScale}
                dash={[6 / stageScale, 6 / stageScale]}
                closed={false}
                listening={false}
              />
            )}
            {isSnapped && (
              <React.Fragment>
                {/* Snap ring — filled + slightly larger so it's unmistakable on a
                    busy plan, with a solid centre dot marking the exact point. */}
                <Circle
                  x={layout.offsetX + pctX * layout.drawW}
                  y={layout.offsetY + pctY * layout.drawH}
                  radius={8 / stageScale}
                  stroke="#ec4899"
                  strokeWidth={2.5 / stageScale}
                  fill="rgba(236, 72, 153, 0.2)"
                  listening={false}
                />
                <Circle
                  x={layout.offsetX + pctX * layout.drawW}
                  y={layout.offsetY + pctY * layout.drawH}
                  radius={2 / stageScale}
                  fill="#ec4899"
                  listening={false}
                />
              </React.Fragment>
            )}
          </React.Fragment>
        );
      })()}

      {/* Box drag preview */}
      {boxOrigin && sample && (
        <Line
          points={toPixels([
            { pctX: boxOrigin.pctX, pctY: boxOrigin.pctY },
            { pctX: sample.pctX, pctY: boxOrigin.pctY },
            { pctX: sample.pctX, pctY: sample.pctY },
            { pctX: boxOrigin.pctX, pctY: sample.pctY }
          ])}
          stroke="rgba(59, 130, 246, 0.8)"
          fill="rgba(59, 130, 246, 0.15)"
          strokeWidth={2 / stageScale}
          dash={[6 / stageScale, 6 / stageScale]}
          closed={true}
          listening={false}
        />
      )}

      {/* Confirmed draft lines */}
      {draftPoints.length > 0 && (
        <React.Fragment>
          <Line
            points={toPixels(draftPoints)}
            stroke="blue"
            strokeWidth={2 / stageScale}
            closed={false}
            listening={false}
          />
          {/* Opening edges tagged so far, colored over the placed segment they sit on. */}
          {(openingEdges ?? []).map((oe) => {
            const a = draftPoints[oe.edgeIndex];
            const b = draftPoints[oe.edgeIndex + 1];
            if (!a || !b) return null; // closing edge isn't placed yet during draw
            return (
              <Line
                key={`draft-opening-${oe.edgeIndex}`}
                points={toPixels([a, b])}
                stroke={`rgb(${OPENING_TYPE_RGB[oe.type]})`}
                strokeWidth={4 / stageScale}
                lineCap="round"
                listening={false}
              />
            );
          })}
          {/* Confirmed draft circles */}
          {draftPoints.map((pt, i) => (
            <Circle
              key={`draft-${i}`}
              x={layout.offsetX + pt.pctX * layout.drawW}
              y={layout.offsetY + pt.pctY * layout.drawH}
              radius={4 / stageScale}
              fill="blue"
              listening={false}
            />
          ))}
        </React.Fragment>
      )}
    </React.Fragment>
  );
}
