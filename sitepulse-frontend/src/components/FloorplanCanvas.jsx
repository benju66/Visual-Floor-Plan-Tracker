import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from 'react-konva';
import useImage from 'use-image';

export default function FloorplanCanvas({ 
  imageUrl, units, activeStatuses, isDrawingMode, onPolygonComplete, showHistoryHover 
}) {
  // THE FIX: Added 'anonymous' to prevent the HTML5 Canvas from blocking the Supabase image
  const [image, status] = useImage(imageUrl, 'anonymous');
  
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [draftPoints, setDraftPoints] = useState([]);
  const [hoveredUnit, setHoveredUnit] = useState(null);

  // FORCE the resize checker to run even if the image delays
  useEffect(() => {
    const checkSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    
    // Check size immediately, and check again in 500ms just in case the UI expanded late
    checkSize();
    setTimeout(checkSize, 500); 
    
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, [imageUrl]); // Re-run this if the image URL changes

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
    // Added explicit min-height to prevent the 0-pixel bug
    <div className="relative w-full h-[70vh] min-h-[500px] border-2 border-gray-300 rounded shadow-inner bg-gray-100 cursor-crosshair">
      <div ref={containerRef} className="w-full h-full">
        {dimensions.width > 0 && (
          <Stage width={dimensions.width} height={dimensions.height} onClick={handleStageClick}>
            <Layer>
              
              {/* DEBUGGING TEXT: Tells us exactly what the image is doing */}
              {!image && (
                <Text 
                  text={`Status: ${status}... (If this says 'failed', it's a Supabase block)`} 
                  x={20} y={20} fontSize={16} fill="red" 
                />
              )}

              {/* Base Floorplan Image */}
              {image && (
                <KonvaImage 
                  image={image} 
                  width={dimensions.width} 
                  height={dimensions.height} 
                />
              )}

              {/* Render Saved Units */}
              {units.map((unit) => {
                const activeStatus = activeStatuses.find(s => s.unit_id === unit.id);
                const fillColor = activeStatus ? activeStatus.status_color : 'rgba(0,0,0,0)';
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

              {/* Render Draft Polygon */}
              {isDrawingMode && draftPoints.length > 0 && (
                <Line points={toPixels(draftPoints)} stroke="blue" strokeWidth={2} closed={false} />
              )}
              {isDrawingMode && draftPoints.map((pt, i) => (
                <Circle key={i} x={pt.pctX * dimensions.width} y={pt.pctY * dimensions.height} radius={4} fill="blue" />
              ))}
            </Layer>
          </Stage>
        )}
      </div>

      {isDrawingMode && draftPoints.length > 2 && (
        <button onClick={finishDrawing} className="absolute top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded shadow-lg hover:bg-blue-700 z-10">
          Finish Shape
        </button>
      )}
    </div>
  );
}