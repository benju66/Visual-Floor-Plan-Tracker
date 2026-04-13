import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle } from 'react-konva';
import useImage from 'use-image';
import { Hand, MousePointer2, RotateCcw, Check } from 'lucide-react';

export default function FloorplanCanvas({
  imageUrl, units, activeStatuses, isDrawingMode, onPolygonComplete, onDrawingModeChange,
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

  useEffect(() => {
    if (!isDrawingMode) setDraftPoints([]);
  }, [isDrawingMode]);

  // Fit image inside the stage like CSS object-fit: contain (no stretching)
  const layout = useMemo(() => {
    const stageW = dimensions.width;
    const stageH = dimensions.height;
    if (!stageW || !stageH) {
      return { offsetX: 0, offsetY: 0, drawW: 0, drawH: 0, stageW: 0, stageH: 0 };
    }
    if (!image) {
      return { offsetX: 0, offsetY: 0, drawW: stageW, drawH: stageH, stageW, stageH };
    }
    const nw = image.naturalWidth || image.width;
    const nh = image.naturalHeight || image.height;
    if (!nw || !nh) {
      return { offsetX: 0, offsetY: 0, drawW: stageW, drawH: stageH, stageW, stageH };
    }
    const scale = Math.min(stageW / nw, stageH / nh);
    const drawW = nw * scale;
    const drawH = nh * scale;
    const offsetX = (stageW - drawW) / 2;
    const offsetY = (stageH - drawH) / 2;
    return { offsetX, offsetY, drawW, drawH, stageW, stageH };
  }, [image, dimensions.width, dimensions.height]);

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

    const logicalX = (pointer.x - stage.x()) / stage.scaleX();
    const logicalY = (pointer.y - stage.y()) / stage.scaleY();

    const { offsetX, offsetY, drawW, drawH } = layout;
    if (drawW <= 0 || drawH <= 0) return;

    let pctX = (logicalX - offsetX) / drawW;
    let pctY = (logicalY - offsetY) / drawH;

    // Orthogonal snapping: hold Shift for horizontal or vertical segments from the last point
    if (e.evt.shiftKey && draftPoints.length > 0) {
      const lastPoint = draftPoints[draftPoints.length - 1];
      const dx = Math.abs(pctX - lastPoint.pctX);
      const dy = Math.abs(pctY - lastPoint.pctY);

      if (dx > dy) {
        pctY = lastPoint.pctY;
      } else {
        pctX = lastPoint.pctX;
      }
    }

    setDraftPoints([...draftPoints, { pctX, pctY }]);
  };

  const finishDrawing = () => {
    if (draftPoints.length > 2) {
      onPolygonComplete(draftPoints);
      setDraftPoints([]);
    }
  };

  const toPixels = (pointsArray) => {
    const { offsetX, offsetY, drawW, drawH } = layout;
    return pointsArray.flatMap(p => [
      offsetX + p.pctX * drawW,
      offsetY + p.pctY * drawH,
    ]);
  };

  // Resets the view back to default
  const resetView = () => {
    setStageScale(1);
    setStagePosition({ x: 0, y: 0 });
  };

  return (
    <div
      id="sitepulse-floorplan-container"
      ref={containerRef}
      className="relative w-full h-[70vh] min-h-[500px] border border-slate-200 rounded-xl shadow-sm bg-slate-100 overflow-hidden"
      style={{ cursor: isDrawingMode ? 'crosshair' : 'grab' }}
    >
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-white px-4 py-2 rounded-full shadow-lg border border-slate-200 flex items-center gap-4 z-10">
        <button
          type="button"
          onClick={() => resetView()}
          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-full transition-colors"
          title="Reset View"
        >
          <RotateCcw size={20} />
        </button>
        <div className="w-px h-6 bg-slate-200" />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDrawingModeChange?.(false)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-colors ${!isDrawingMode ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <Hand size={18} /> Pan
          </button>
          <button
            type="button"
            onClick={() => onDrawingModeChange?.(true)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-colors ${isDrawingMode ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            <MousePointer2 size={18} /> Draw
          </button>
        </div>
      </div>

      {isDrawingMode && draftPoints.length > 2 && (
        <button
          type="button"
          onClick={finishDrawing}
          className="absolute top-6 right-6 bg-emerald-500 text-white px-6 py-2 rounded-full shadow-lg hover:bg-emerald-600 transition-colors flex items-center gap-2 font-bold z-10"
        >
          <Check size={18} /> Finish Shape
        </button>
      )}

      {dimensions.width > 0 && dimensions.height > 0 && (
        <Stage
          width={dimensions.width}
          height={dimensions.height}
          onClick={handleStageClick}
          onWheel={handleWheel}
          draggable={!isDrawingMode}
          x={stagePosition.x}
          y={stagePosition.y}
          scaleX={stageScale}
          scaleY={stageScale}
          onDragEnd={(e) => {
            setStagePosition({ x: e.target.x(), y: e.target.y() });
          }}
        >
          <Layer>
            {image && layout.drawW > 0 && layout.drawH > 0 && (
              <KonvaImage
                image={image}
                x={layout.offsetX}
                y={layout.offsetY}
                width={layout.drawW}
                height={layout.drawH}
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
              <Circle
                key={i}
                x={layout.offsetX + pt.pctX * layout.drawW}
                y={layout.offsetY + pt.pctY * layout.drawH}
                radius={4 / stageScale}
                fill="blue"
              />
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
