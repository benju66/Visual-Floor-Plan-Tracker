import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle } from 'react-konva';
import useImage from 'use-image';

export default function FloorplanCanvas({ 
  imageUrl, units, activeStatuses, isDrawingMode, onPolygonComplete, showHistoryHover 
}) {
  const [image] = useImage(imageUrl);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [draftPoints, setDraftPoints] = useState([]);
  const [hoveredUnit, setHoveredUnit] = useState(null);

  useEffect(() => {
    const checkSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  const handleStageClick = (e) => {
    if (!isDrawingMode) return;
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    const pctX = point.x / dimensions.width;
    const pctY = point.y / dimensions.height;
    setDraftPoints([...draftPoints, { pctX, pctY }]);
  };

  const finishDrawing = () => {
    if (draftPoints.length > 2) {
      onPolygonComplete(draftPoints);
      setDraftPoints([]);
    }
  };

  const toPixels = (pointsArray) => {
    return pointsArray.flatMap(p => [p.pctX * dimensions.width, p.pctY * dimensions.height]);
  };

  return (
    <div className="relative w-full h-[70vh] border-2 border-gray-300 rounded shadow-inner bg-gray-100 cursor-crosshair">
      <div ref={containerRef} className="w-full h-full">
        <Stage width={dimensions.width} height={dimensions.height} onClick={handleStageClick}>
          <Layer>
            {image && <KonvaImage image={image} width={dimensions.width} height={dimensions.height} />}
            {units.map((unit) => {
              const status = activeStatuses.find(s => s.unit_id === unit.id);
              const fillColor = status ? status.status_color : 'rgba(0,0,0,0)';
              return (
                <Line
                  key={unit.id}
                  points={toPixels(unit.polygon_coordinates)}
                  fill={fillColor}
                  stroke={hoveredUnit === unit.id ? "black" : "#666"}
                  strokeWidth={hoveredUnit === unit.id ? 3 : 1}
                  closed={true}
                  onMouseEnter={() => setHoveredUnit(unit.id)}
                  onMouseLeave={() => setHoveredUnit(null)}
                />
              );
            })}
            {isDrawingMode && draftPoints.length > 0 && (
              <Line points={toPixels(draftPoints)} stroke="blue" strokeWidth={2} closed={false} />
            )}
            {isDrawingMode && draftPoints.map((pt, i) => (
              <Circle key={i} x={pt.pctX * dimensions.width} y={pt.pctY * dimensions.height} radius={4} fill="blue" />
            ))}
          </Layer>
        </Stage>
      </div>

      {isDrawingMode && draftPoints.length > 2 && (
        <button onClick={finishDrawing} className="absolute top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded shadow-lg">
          Finish Shape
        </button>
      )}
    </div>
  );
}