import React, { useMemo } from 'react';
import { Line } from 'react-konva';
import { mixAlpha } from '@/utils/geometry';
import { usePointerSample, type PointerStore } from '@/utils/pointerStore';
import type { Unit, StatusLog, PercentPoint } from '@/types/domain';

export interface StampPreviewProps {
  selectedUnitId: string | null;
  pointerStore: PointerStore;
  stageScale: number;
  units: Unit[];
  activeStatuses: StatusLog[];
  toPixels: (points: PercentPoint[]) => number[];
}

/**
 * Stamp-mode dashed preview of the selected unit's polygon translated to the
 * cursor. Mounted only while toolMode === 'stamp'; follows the cursor via the
 * pointer store. Source-unit centroid and colors are memoized so the per-frame
 * work is just the translate + render.
 */
export default function StampPreview({
  selectedUnitId,
  pointerStore,
  stageScale,
  units,
  activeStatuses,
  toPixels
}: StampPreviewProps) {
  const sample = usePointerSample(pointerStore);

  const source = useMemo(() => {
    if (!selectedUnitId) return null;
    const sourceUnit = units.find(u => u.id === selectedUnitId);
    const polyCoords = sourceUnit?.polygon_coordinates as PercentPoint[] | undefined;
    if (!polyCoords || polyCoords.length === 0) return null;

    let sumX = 0, sumY = 0;
    polyCoords.forEach(pt => { sumX += pt.pctX; sumY += pt.pctY; });

    const activeStatus = activeStatuses.find((s) => s.unit_id === selectedUnitId);
    let fillColor = 'rgba(139, 92, 246, 0.3)';
    let strokeColor = '#8b5cf6';
    if (activeStatus && activeStatus.status_color) {
      strokeColor = activeStatus.status_color;
      fillColor = mixAlpha(activeStatus.status_color, 0.3);
    }

    return {
      polyCoords,
      cx: sumX / polyCoords.length,
      cy: sumY / polyCoords.length,
      fillColor,
      strokeColor,
    };
  }, [selectedUnitId, units, activeStatuses]);

  if (!source || !sample) return null;

  const dx = sample.pctX - source.cx;
  const dy = sample.pctY - source.cy;
  const translatedPoints = source.polyCoords.map(pt => ({
    pctX: pt.pctX + dx,
    pctY: pt.pctY + dy
  }));

  return (
    <Line
      points={toPixels(translatedPoints)}
      stroke={source.strokeColor}
      strokeWidth={2 / stageScale}
      dash={[6 / stageScale, 6 / stageScale]}
      fill={source.fillColor}
      closed={true}
      listening={false}
    />
  );
}
