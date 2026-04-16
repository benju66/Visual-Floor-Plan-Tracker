import React from 'react';
import { Line, Circle } from 'react-konva';

export default function DraftPolygon({
  toolMode,
  draftPoints,
  pointerPos,
  boxOrigin,
  stagePosition,
  stageScale,
  layout,
  isShiftDown,
  toPixels
}) {
  if (toolMode !== 'draw') return null;

  return (
    <React.Fragment>
      {/* Dashed line following the cursor */}
      {draftPoints.length > 0 && pointerPos && !boxOrigin && (() => {
        let logicalX = (pointerPos.x - stagePosition.x) / stageScale;
        let logicalY = (pointerPos.y - stagePosition.y) / stageScale;
        let pctX = (logicalX - layout.offsetX) / layout.drawW;
        let pctY = (logicalY - layout.offsetY) / layout.drawH;
        
        if (isShiftDown) {
          const last = draftPoints[draftPoints.length - 1];
          const dx = Math.abs(pctX - last.pctX);
          const dy = Math.abs(pctY - last.pctY);
          if (dx > dy) pctY = last.pctY;
          else pctX = last.pctX;
        }
        
        return (
          <Line
            points={toPixels([...draftPoints, {pctX, pctY}])}
            stroke="rgba(59, 130, 246, 0.4)"
            strokeWidth={2 / stageScale}
            dash={[6 / stageScale, 6 / stageScale]}
            closed={false}
            listening={false}
          />
        );
      })()}

      {/* Box drag preview */}
      {boxOrigin && pointerPos && (() => {
        let logicalX = (pointerPos.x - stagePosition.x) / stageScale;
        let logicalY = (pointerPos.y - stagePosition.y) / stageScale;
        let pctX = (logicalX - layout.offsetX) / layout.drawW;
        let pctY = (logicalY - layout.offsetY) / layout.drawH;
        
        return (
          <Line
            points={toPixels([
              { pctX: boxOrigin.pctX, pctY: boxOrigin.pctY },
              { pctX: pctX, pctY: boxOrigin.pctY },
              { pctX: pctX, pctY: pctY },
              { pctX: boxOrigin.pctX, pctY: pctY }
            ])}
            stroke="rgba(59, 130, 246, 0.8)"
            fill="rgba(59, 130, 246, 0.15)"
            strokeWidth={2 / stageScale}
            dash={[6 / stageScale, 6 / stageScale]}
            closed={true}
            listening={false}
          />
        );
      })()}

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
