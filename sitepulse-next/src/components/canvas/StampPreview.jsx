import React from 'react';
import { Line } from 'react-konva';

export default function StampPreview({
  toolMode,
  selectedUnitId,
  pointerPos,
  stagePosition,
  stageScale,
  layout,
  units,
  activeStatuses,
  toPixels
}) {
  if (toolMode !== 'stamp' || !selectedUnitId || !pointerPos) return null;

  const sourceUnit = units.find(u => u.id === selectedUnitId);
  if (!sourceUnit || !sourceUnit.polygon_coordinates || sourceUnit.polygon_coordinates.length === 0) return null;
  
  let logicalX = (pointerPos.x - stagePosition.x) / stageScale;
  let logicalY = (pointerPos.y - stagePosition.y) / stageScale;
  let pctX = (logicalX - layout.offsetX) / layout.drawW;
  let pctY = (logicalY - layout.offsetY) / layout.drawH;

  let sumX = 0, sumY = 0;
  sourceUnit.polygon_coordinates.forEach(pt => { sumX += pt.pctX; sumY += pt.pctY; });
  const cx = sumX / sourceUnit.polygon_coordinates.length;
  const cy = sumY / sourceUnit.polygon_coordinates.length;
  const dx = pctX - cx;
  const dy = pctY - cy;

  const translatedPoints = sourceUnit.polygon_coordinates.map(pt => ({
    pctX: pt.pctX + dx,
    pctY: pt.pctY + dy
  }));

  const activeStatus = activeStatuses.find((s) => s.unit_id === selectedUnitId);
  let fillColor = 'rgba(139, 92, 246, 0.3)';
  let strokeColor = '#8b5cf6';
  if (activeStatus) {
    strokeColor = activeStatus.status_color;
    fillColor = activeStatus.status_color.replace('rgb', 'rgba').replace(')', ', 0.3)');
  }

  return (
    <Line
      points={toPixels(translatedPoints)}
      stroke={strokeColor}
      strokeWidth={2 / stageScale}
      dash={[6 / stageScale, 6 / stageScale]}
      fill={fillColor}
      closed={true}
      listening={false}
    />
  );
}
