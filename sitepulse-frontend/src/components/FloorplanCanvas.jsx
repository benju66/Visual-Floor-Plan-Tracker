import React, { useState, useEffect, useRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle } from 'react-konva';
import useImage from 'use-image';

export default function FloorplanCanvas({ 
  imageUrl, units, activeStatuses, isDrawingMode, onPolygonComplete 
}) {
  const [image] = useImage(imageUrl, 'anonymous');
  
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [draftPoints, setDraftPoints] = useState([]);
  const [hoveredUnit, setHoveredUnit] = useState(null);

  // Tracking zoom scale and pan position
  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });

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
    const timeouts = [100, 500, 1000].map(t => setTimeout(checkSize, t));
    
    window.addEventListener('resize', checkSize);
    return () => {
      window.removeEventListener('resize', checkSize);
      timeouts.forEach(clearTimeout);
    };
  }, [imageUrl]);

  // Zoom functionality using the mouse wheel
  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const scaleBy = 1.1; // Zoom speed
    const oldScale = stage.scaleX();

    const pointer = stage.getPointerPosition();

    // Calculate where the mouse is relative to the canvas origin
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    // Determine zoom in or zoom out
    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;

    setStageScale(newScale);
    setStagePosition({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const handleStageClick = (e) => {
    if (!isDrawingMode) return;
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();

    // UPGRADED MATH: Convert screen click to logical coordinate based on zoom/pan
    const logicalX = (pointer.x - stage.x()) / stage.scaleX();
    const logicalY = (pointer.y - stage.y()) / stage.scaleY();

    const pctX = logicalX / dimensions.width;
    const pctY = logicalY / dimensions.height;
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

  // Resets the view back to default
  const resetView = () => {
    setStageScale(1);
    setStagePosition({ x: 0, y: 0 });
  };

  return (
    <div 
      ref={containerRef} 
      style={{ 
        width: '100%', 
        height: '70vh', 
        minHeight: '500px', 
        position: 'relative', 
        border: '2px solid #d1d5db', 
        backgroundColor: '#f3f4f6', 
        cursor: isDrawingMode ? 'crosshair' : 'grab',
        borderRadius: '0.5rem',
        overflow: 'hidden'
      }}
    >
      <button 
        onClick={resetView}
        style={{
          position: 'absolute', top: '10px', left: '10px', zIndex: 10,
          backgroundColor: 'white', border: '1px solid #ccc', borderRadius: '4px',
          padding: '4px 8px', fontSize: '12px', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}
      >
        Reset View
      </button>

      {dimensions.width > 0 && dimensions.height > 0 && (
        <Stage 
          width={dimensions.width} 
          height={dimensions.height} 
          onClick={handleStageClick}
          onWheel={handleWheel}
          draggable={!isDrawingMode} // Can only pan when NOT drawing
          x={stagePosition.x}
          y={stagePosition.y}
          scaleX={stageScale}
          scaleY={stageScale}
          onDragEnd={(e) => {
            setStagePosition({ x: e.target.x(), y: e.target.y() });
          }}
        >
          <Layer>
            {image && (
              <KonvaImage 
                image={image} 
                width={dimensions.width} 
                height={dimensions.height} 
              />
            )}

            {units && units.map((unit) => {
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

            {isDrawingMode && draftPoints.length > 0 && (
              <Line points={toPixels(draftPoints)} stroke="blue" strokeWidth={2 / stageScale} closed={false} />
            )}
            {isDrawingMode && draftPoints.map((pt, i) => (
              <Circle key={i} x={pt.pctX * dimensions.width} y={pt.pctY * dimensions.height} radius={4 / stageScale} fill="blue" />
            ))}
          </Layer>
        </Stage>
      )}

      {isDrawingMode && draftPoints.length > 2 && (
        <button 
          onClick={finishDrawing} 
          style={{
            position: 'absolute', top: '16px', right: '16px', backgroundColor: '#2563eb', color: 'white',
            padding: '8px 16px', borderRadius: '0.25rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            cursor: 'pointer', border: 'none', fontWeight: 'bold', zIndex: 10
          }}
        >
          Finish Shape
        </button>
      )}
    </div>
  );
}
