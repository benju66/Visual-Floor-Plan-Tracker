import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle } from 'react-konva';
import useImage from 'use-image';
import { Hand, MousePointer2, RotateCcw, Check } from 'lucide-react';

export default function FloorplanCanvas({
  imageUrl,
  units,
  activeStatuses,
  isDrawingMode,
  onPolygonComplete,
  onDrawingModeChange,
  legendFilter,
}) {
  const [image] = useImage(imageUrl, 'anonymous');

  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [draftPoints, setDraftPoints] = useState([]);
  const [hoveredUnit, setHoveredUnit] = useState(null);

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
    const timeouts = [100, 500, 1000].map((t) => setTimeout(checkSize, t));

    window.addEventListener('resize', checkSize);
    return () => {
      window.removeEventListener('resize', checkSize);
      timeouts.forEach(clearTimeout);
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!isDrawingMode) setDraftPoints([]);
  }, [isDrawingMode]);

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

  const handleWheel = (e) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const scaleBy = 1.1;
    const oldScale = stage.scaleX();

    const pointer = stage.getPointerPosition();

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

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
    return pointsArray.flatMap((p) => [
      offsetX + p.pctX * drawW,
      offsetY + p.pctY * drawH,
    ]);
  };

  const resetView = () => {
    setStageScale(1);
    setStagePosition({ x: 0, y: 0 });
  };

  const dockClass =
    'pointer-events-auto flex flex-col gap-1 p-2 rounded-2xl border shadow-xl backdrop-blur-md z-20';

  return (
    <div
      id="sitepulse-floorplan-container"
      ref={containerRef}
      className="relative w-full h-full flex-1 border rounded-xl overflow-hidden"
      style={{
        cursor: isDrawingMode ? 'crosshair' : 'grab',
        background: 'var(--glass-bg)',
        borderColor: 'var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
      }}
    >
      {/* Vertical floating dock */}
      <div
        className={`${dockClass} absolute left-3 top-1/2 -translate-y-1/2`}
        style={{
          background: 'var(--glass-bg)',
          borderColor: 'var(--glass-border)',
        }}
      >
        <button
          type="button"
          onClick={() => resetView()}
          className="p-2.5 text-slate-600 hover:text-slate-900 hover:bg-white/50 rounded-xl transition-colors"
          title="Reset view"
        >
          <RotateCcw size={20} />
        </button>
        <div className="h-px bg-slate-200/80 mx-1" />
        <button
          type="button"
          onClick={() => onDrawingModeChange?.(false)}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
            !isDrawingMode ? 'bg-blue-500/20 text-blue-800 shadow-sm scale-[1.02]' : 'text-slate-600 hover:bg-white/40'
          }`}
        >
          <Hand size={18} /> Pan
        </button>
        <button
          type="button"
          onClick={() => onDrawingModeChange?.(true)}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
            isDrawingMode ? 'bg-blue-500/20 text-blue-800 shadow-sm scale-[1.02]' : 'text-slate-600 hover:bg-white/40'
          }`}
        >
          <MousePointer2 size={18} /> Draw
        </button>
      </div>

      {isDrawingMode && draftPoints.length > 2 && (
        <button
          type="button"
          onClick={finishDrawing}
          className="absolute top-6 right-6 z-20 bg-emerald-500/95 backdrop-blur-sm text-white px-6 py-2 rounded-full shadow-lg hover:bg-emerald-600 transition-all flex items-center gap-2 font-bold border border-white/20"
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

            {units &&
              units.map((unit) => {
                const activeStatus = activeStatuses.find((s) => s.unit_id === unit.id);
                const fillColor = activeStatus ? activeStatus.status_color : 'rgba(0,0,0,0)';
                const matchesLegend =
                  !legendFilter || (activeStatus && activeStatus.milestone === legendFilter);
                const dim = legendFilter && !matchesLegend;
                const isHover = hoveredUnit === unit.id;
                return (
                  <Line
                    key={unit.id}
                    points={toPixels(unit.polygon_coordinates)}
                    fill={fillColor}
                    stroke={isHover ? '#0ea5e9' : dim ? '#94a3b8' : '#666'}
                    strokeWidth={isHover ? 3.5 : dim ? 0.6 : 1}
                    closed={true}
                    opacity={dim ? 0.2 : isHover ? 1 : 0.95}
                    shadowBlur={isHover ? 18 : 0}
                    shadowColor={isHover ? 'rgba(14, 165, 233, 0.85)' : 'transparent'}
                    shadowOpacity={isHover ? 0.9 : 0}
                    onMouseEnter={() => setHoveredUnit(unit.id)}
                    onMouseLeave={() => setHoveredUnit(null)}
                  />
                );
              })}

            {isDrawingMode && draftPoints.length > 0 && (
              <Line
                points={toPixels(draftPoints)}
                stroke="blue"
                strokeWidth={2 / stageScale}
                closed={false}
              />
            )}
            {isDrawingMode &&
              draftPoints.map((pt, i) => (
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
