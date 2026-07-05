import React, { useMemo } from 'react';
import { Line, Circle } from 'react-konva';
import { mixAlpha } from '@/utils/geometry';
import { buildStampPolygon, type StampTransform } from '@/utils/stampTransform';
import { usePointerSample, type PointerStore } from '@/utils/pointerStore';
import type { Unit, StatusLog, PercentPoint } from '@/types/domain';

export interface StampPreviewProps {
  selectedUnitId: string | null;
  /** An armed drawer stamp's centroid-normalized points (Stamp & Fast Markup — Phase 2).
   *  When present it is the preview source and `selectedUnitId` is ignored, so a stamp can
   *  be placed with NO room selected. */
  armedPoints?: PercentPoint[] | null;
  pointerStore: PointerStore;
  stageScale: number;
  units: Unit[];
  activeStatuses: StatusLog[];
  toPixels: (points: PercentPoint[]) => number[];
  /** The transient rotate/flip the stamp will drop with (Stamp & Fast Markup — Phase 1). */
  transform: StampTransform;
  /** drawW/drawH — needed for aspect-correct rotation. */
  aspect: number;
  /** Snap the drop anchor with the same engine tracing uses (no-op when snapping is off). */
  snap: (p: PercentPoint) => PercentPoint;
}

/**
 * Stamp-mode dashed preview of the selected unit's polygon, rotated/flipped by the
 * active transform and re-anchored to the SNAPPED cursor — so the ghost shows exactly
 * where and how the stamp will land. Mounted only while toolMode === 'stamp'; follows
 * the cursor via the pointer store. A small ring marks the anchor when it snaps.
 */
export default function StampPreview({
  selectedUnitId,
  armedPoints,
  pointerStore,
  stageScale,
  units,
  activeStatuses,
  toPixels,
  transform,
  aspect,
  snap,
}: StampPreviewProps) {
  const sample = usePointerSample(pointerStore);

  const source = useMemo(() => {
    // An armed drawer stamp wins over the selected unit — it lets you stamp with nothing
    // selected. Its points are already centroid-normalized; buildStampPolygon re-normalizes
    // anyway, so passing them through is a no-op. Use the default violet stamp styling.
    if (armedPoints && armedPoints.length > 0) {
      return { polyCoords: armedPoints, fillColor: 'rgba(139, 92, 246, 0.3)', strokeColor: '#8b5cf6' };
    }
    if (!selectedUnitId) return null;
    const sourceUnit = units.find(u => u.id === selectedUnitId);
    const polyCoords = sourceUnit?.polygon_coordinates as PercentPoint[] | undefined;
    if (!polyCoords || polyCoords.length === 0) return null;

    const activeStatus = activeStatuses.find((s) => s.unit_id === selectedUnitId);
    let fillColor = 'rgba(139, 92, 246, 0.3)';
    let strokeColor = '#8b5cf6';
    if (activeStatus && activeStatus.status_color) {
      strokeColor = activeStatus.status_color;
      fillColor = mixAlpha(activeStatus.status_color, 0.3);
    }

    return { polyCoords, fillColor, strokeColor };
  }, [armedPoints, selectedUnitId, units, activeStatuses]);

  if (!source || !sample) return null;

  // Snap the anchor exactly like the commit path does, then build the transformed +
  // placed polygon — preview and drop stay in lockstep.
  const anchor = snap({ pctX: sample.pctX, pctY: sample.pctY });
  const placed = buildStampPolygon(source.polyCoords, transform, aspect, anchor);
  const didSnap = anchor.pctX !== sample.pctX || anchor.pctY !== sample.pctY;
  const anchorPx = toPixels([anchor]);

  return (
    <>
      <Line
        points={toPixels(placed)}
        stroke={source.strokeColor}
        strokeWidth={2 / stageScale}
        dash={[6 / stageScale, 6 / stageScale]}
        fill={source.fillColor}
        closed={true}
        listening={false}
      />
      {didSnap && (
        <Circle
          x={anchorPx[0]}
          y={anchorPx[1]}
          radius={5 / stageScale}
          stroke="#22c55e"
          strokeWidth={1.5 / stageScale}
          listening={false}
        />
      )}
    </>
  );
}
