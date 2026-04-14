"use client";
import React, { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle } from 'react-konva';
import useImage from 'use-image';
import { Hand, MousePointer2, RotateCcw, Check, Pointer, PlusCircle, MinusCircle, Copy, ZoomIn, ZoomOut, FlipHorizontal, FlipVertical, Pencil } from 'lucide-react';

const sqr = (x) => x * x;
const dist2 = (v, w) => sqr(v.pctX - w.pctX) + sqr(v.pctY - w.pctY);
const distToSegmentSquared = (p, v, w) => {
  const l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  let t = ((p.pctX - v.pctX) * (w.pctX - v.pctX) + (p.pctY - v.pctY) * (w.pctY - v.pctY)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, { pctX: v.pctX + t * (w.pctX - v.pctX), pctY: v.pctY + t * (w.pctY - v.pctY) });
};
const distToSegment = (p, v, w) => Math.sqrt(distToSegmentSquared(p, v, w));

const FloorplanCanvas = forwardRef(({
  imageUrl,
  units,
  activeStatuses,
  toolMode,
  onToolModeChange,
  onUpdateUnitPolygon,
  onDuplicateUnit,
  onPolygonComplete,
  legendFilter,
  selectedUnitId,
  onSelectUnit,
  onRenameUnit,
}, ref) => {
  const [image] = useImage(imageUrl, 'anonymous');

  const stageRef = useRef(null);

  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [draftPoints, setDraftPoints] = useState([]);
  const [hoveredUnit, setHoveredUnit] = useState(null);
  const [isHoveringAnchor, setIsHoveringAnchor] = useState(false);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);

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
    if (toolMode !== 'draw') setDraftPoints([]);
    if (!['select', 'add_node', 'delete_node'].includes(toolMode)) {
      onSelectUnit(null);
    }
  }, [toolMode]);

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

  useImperativeHandle(ref, () => ({
    exportFullImage: () => {
      if (!stageRef.current || !image) return null;
      
      const stage = stageRef.current;
      
      const oldScale = stage.scaleX();
      const oldPosition = stage.position();
      const oldWidth = stage.width();
      const oldHeight = stage.height();

      const nw = image.naturalWidth || image.width;
      const nh = image.naturalHeight || image.height;

      const exportScale = nw / layout.drawW;

      stage.width(nw);
      stage.height(nh);
      stage.scale({ x: exportScale, y: exportScale });
      stage.position({ x: -layout.offsetX * exportScale, y: -layout.offsetY * exportScale });
      
      const dataUrl = stage.toDataURL({ pixelRatio: 1 });

      stage.width(oldWidth);
      stage.height(oldHeight);
      stage.scale({ x: oldScale, y: oldScale });
      stage.position(oldPosition);

      return { dataUrl, width: nw, height: nh };
    }
  }));

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

  const handleZoom = (direction) => {
    if (!stageRef.current) return;
    const stage = stageRef.current;
    const oldScale = stageScale;
    const scaleBy = 1.2;
    const newScale = direction === 1 ? oldScale * scaleBy : oldScale / scaleBy;
    
    const centerPoint = {
      x: dimensions.width / 2,
      y: dimensions.height / 2
    };
    
    const mousePointTo = {
      x: (centerPoint.x - stage.x()) / oldScale,
      y: (centerPoint.y - stage.y()) / oldScale,
    };
    
    setStageScale(newScale);
    setStagePosition({
      x: centerPoint.x - mousePointTo.x * newScale,
      y: centerPoint.y - mousePointTo.y * newScale,
    });
  };

  const handleStageClick = (e) => {
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    const logicalX = (pointer.x - stage.x()) / stageScale;
    const logicalY = (pointer.y - stage.y()) / stageScale;

    const { offsetX, offsetY, drawW, drawH } = layout;
    if (drawW <= 0 || drawH <= 0) return;

    let pctX = (logicalX - offsetX) / drawW;
    let pctY = (logicalY - offsetY) / drawH;

    if (toolMode === 'draw') {
      if (e.evt.shiftKey && draftPoints.length > 0) {
        const lastPoint = draftPoints[draftPoints.length - 1];
        const dx = Math.abs(pctX - lastPoint.pctX);
        const dy = Math.abs(pctY - lastPoint.pctY);
        if (dx > dy) pctY = lastPoint.pctY;
        else pctX = lastPoint.pctX;
      }
      setDraftPoints([...draftPoints, { pctX, pctY }]);
    } else if (['select', 'add_node', 'delete_node'].includes(toolMode)) {
      if (e.target === stage || e.target.nodeType === 'Image' || e.target.attrs?.id === 'bg-rect') {
        onSelectUnit(null);
      }
    }
  };

  const finishDrawing = () => {
    if (draftPoints.length > 2) {
      onPolygonComplete(draftPoints);
      setDraftPoints([]);
    }
  };

  const handlePolygonClick = (e, unit) => {
    if (!['select', 'add_node', 'delete_node'].includes(toolMode)) return;
    e.cancelBubble = true;
    
    if (selectedUnitId !== unit.id) {
       onSelectUnit(unit.id);
       return;
    }

    if (toolMode === 'add_node') {
      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      const logicalX = (pointer.x - stage.x()) / stageScale;
      const logicalY = (pointer.y - stage.y()) / stageScale;
      const pctX = (logicalX - layout.offsetX) / layout.drawW;
      const pctY = (logicalY - layout.offsetY) / layout.drawH;
      
      let bestIdx = -1;
      let minDistance = Infinity;
      const pts = unit.polygon_coordinates;
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i+1) % pts.length];
        const d = distToSegment({pctX, pctY}, p1, p2);
        if (d < minDistance) {
          minDistance = d;
          bestIdx = i;
        }
      }
      if (bestIdx !== -1) {
        const newPoints = [...pts];
        newPoints.splice(bestIdx + 1, 0, {pctX, pctY});
        onUpdateUnitPolygon?.(unit.id, newPoints);
      }
    }
  };

  const handleFlip = (direction) => {
    if (!selectedUnitId) return;
    const unit = units.find(u => u.id === selectedUnitId);
    if (!unit || unit.polygon_coordinates.length === 0) return;
    
    const pts = unit.polygon_coordinates;
    const newPoints = pts.map(p => ({ ...p }));
    
    if (direction === 'horizontal') {
      const xs = pts.map(p => p.pctX);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      newPoints.forEach(p => p.pctX = centerX - (p.pctX - centerX));
    } else {
      const ys = pts.map(p => p.pctY);
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
      newPoints.forEach(p => p.pctY = centerY - (p.pctY - centerY));
    }
    
    onUpdateUnitPolygon?.(unit.id, newPoints);
  };

  const handlePolygonDragEnd = (e, unit) => {
    if (toolMode !== 'select') return;
    const dx = e.target.x() / layout.drawW;
    const dy = e.target.y() / layout.drawH;
    
    e.target.x(0);
    e.target.y(0);
    
    if (dx === 0 && dy === 0) return;

    const newPoints = unit.polygon_coordinates.map(p => ({
      pctX: p.pctX + dx,
      pctY: p.pctY + dy
    }));
    
    onUpdateUnitPolygon?.(unit.id, newPoints);
  };

  const handleAnchorDragEnd = (e, unitId, index) => {
    if (toolMode !== 'select') return;
    const node = e.target;
    
    let pctX = (node.x() - layout.offsetX) / layout.drawW;
    let pctY = (node.y() - layout.offsetY) / layout.drawH;
    
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;
    
    const newPoints = [...unit.polygon_coordinates];
    newPoints[index] = { pctX, pctY };
    onUpdateUnitPolygon?.(unitId, newPoints);
  };

  const handleAnchorClick = (e, unitId, index) => {
    if (toolMode !== 'delete_node') return;
    e.cancelBubble = true;
    const unit = units.find(u => u.id === unitId);
    if (!unit || unit.polygon_coordinates.length <= 3) return;
    
    const newPoints = [...unit.polygon_coordinates];
    newPoints.splice(index, 1);
    onUpdateUnitPolygon?.(unitId, newPoints);
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

  let computedCursor = 'grab';
  if (isDraggingCanvas) {
    computedCursor = 'grabbing';
  } else if (toolMode === 'draw' || toolMode === 'add_node') {
    computedCursor = 'crosshair';
  } else if (toolMode === 'select') {
    if (isHoveringAnchor) computedCursor = 'move';
    else if (hoveredUnit) computedCursor = hoveredUnit === selectedUnitId ? 'move' : 'pointer';
    else computedCursor = 'default';
  } else if (toolMode === 'delete_node') {
    computedCursor = isHoveringAnchor ? 'pointer' : 'default';
  }

  const ActionButton = ({ icon: Icon, label, currentMode, activeMode, onClick, colorClass = "blue" }) => {
    const isActive = currentMode === activeMode;
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
          isActive
            ? `bg-${colorClass}-500/20 text-${colorClass}-800 dark:text-${colorClass}-300 shadow-sm scale-[1.02]`
            : 'text-slate-600 hover:bg-white/40 dark:text-slate-300 dark:hover:bg-white/10'
        }`}
      >
        <Icon size={18} /> <span className="hidden lg:inline">{label}</span>
      </button>
    );
  };

  return (
    <div
      id="sitepulse-floorplan-container"
      ref={containerRef}
      className="relative w-full h-full flex-1 border rounded-xl overflow-hidden"
      style={{
        cursor: computedCursor,
        background: 'var(--glass-bg)',
        borderColor: 'var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
      }}
    >
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
          className="p-2.5 text-slate-600 hover:text-slate-900 hover:bg-white/50 rounded-xl transition-colors flex items-center justify-center dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/10"
          title="Reset view"
        >
          <RotateCcw size={20} />
        </button>
        <div className="flex bg-white/30 dark:bg-black/20 rounded-xl overflow-hidden border border-slate-200/50 dark:border-white/10 mb-1 mt-0.5">
           <button type="button" onClick={() => handleZoom(-1)} className="flex-1 p-2 flex items-center justify-center text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-white/10 transition-colors" title="Zoom Out">
             <ZoomOut size={16} />
           </button>
           <div className="w-px bg-slate-200/80 dark:bg-white/10" />
           <button type="button" onClick={() => handleZoom(1)} className="flex-1 p-2 flex items-center justify-center text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-white/10 transition-colors" title="Zoom In">
             <ZoomIn size={16} />
           </button>
        </div>
        <div className="h-px bg-slate-200/80 dark:bg-white/10 mx-1 my-1" />
        
        <ActionButton icon={Pointer} label="Select" currentMode={toolMode} activeMode="select" onClick={() => onToolModeChange?.('select')} />
        <ActionButton icon={Hand} label="Pan" currentMode={toolMode} activeMode="pan" onClick={() => onToolModeChange?.('pan')} />
        <ActionButton icon={MousePointer2} label="Draw" currentMode={toolMode} activeMode="draw" onClick={() => onToolModeChange?.('draw')} />
        
        <div className="h-px bg-slate-200/80 dark:bg-white/10 mx-1 my-1" />
        <ActionButton icon={PlusCircle} label="Add Node" currentMode={toolMode} activeMode="add_node" onClick={() => onToolModeChange?.('add_node')} colorClass="emerald" />
        <ActionButton icon={MinusCircle} label="Delete Node" currentMode={toolMode} activeMode="delete_node" onClick={() => onToolModeChange?.('delete_node')} colorClass="red" />

        {selectedUnitId && (
          <>
            <div className="h-px bg-slate-200/80 dark:bg-white/10 mx-1 my-1" />
            <ActionButton 
              icon={Pencil} 
              label="Rename" 
              currentMode={null} 
              activeMode={null} 
              onClick={() => onRenameUnit?.(selectedUnitId)} 
              colorClass="purple" 
            />
            <ActionButton 
              icon={Copy} 
              label="Duplicate" 
              currentMode={null} 
              activeMode={null} 
              onClick={() => onDuplicateUnit?.(selectedUnitId)} 
              colorClass="purple" 
            />
            <ActionButton 
              icon={FlipHorizontal} 
              label="Flip H" 
              currentMode={null} 
              activeMode={null} 
              onClick={() => handleFlip('horizontal')} 
              colorClass="purple" 
            />
            <ActionButton 
              icon={FlipVertical} 
              label="Flip V" 
              currentMode={null} 
              activeMode={null} 
              onClick={() => handleFlip('vertical')} 
              colorClass="purple" 
            />
          </>
        )}
      </div>

      {toolMode === 'draw' && draftPoints.length > 2 && (
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
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          onClick={handleStageClick}
          onWheel={handleWheel}
          draggable={true}
          onPointerDown={(e) => {
            if (toolMode === 'pan' || (e.evt && e.evt.button === 1)) {
              setIsDraggingCanvas(true);
            }
          }}
          onPointerUp={() => setIsDraggingCanvas(false)}
          x={stagePosition.x}
          y={stagePosition.y}
          scaleX={stageScale}
          scaleY={stageScale}
          onDragStart={(e) => {
            if (e.target === stageRef.current) {
              const evt = e.evt;
              if (toolMode !== 'pan' && (!evt || evt.button !== 1)) {
                 e.target.stopDrag();
              }
            }
          }}
          onDragEnd={(e) => {
            if (e.target === stageRef.current) {
               setIsDraggingCanvas(false);
               setStagePosition({ x: e.target.x(), y: e.target.y() });
            }
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
                const isSelected = selectedUnitId === unit.id;
                const dim = legendFilter && !matchesLegend;
                const isHover = hoveredUnit === unit.id;
                
                const highlight = isSelected || isHover;

                return (
                  <React.Fragment key={unit.id}>
                    <Line
                      points={toPixels(unit.polygon_coordinates)}
                      fill={fillColor}
                      stroke={isSelected ? '#8b5cf6' : isHover ? '#0ea5e9' : dim ? '#94a3b8' : '#666'}
                      strokeWidth={isSelected ? 3.5 : isHover ? 3.5 : dim ? 0.6 : 1}
                      closed={true}
                      opacity={dim ? 0.2 : highlight ? 1 : 0.95}
                      shadowBlur={highlight ? 18 : 0}
                      shadowColor={isSelected ? 'rgba(139, 92, 246, 0.85)' : isHover ? 'rgba(14, 165, 233, 0.85)' : 'transparent'}
                      shadowOpacity={highlight ? 0.9 : 0}
                      draggable={isSelected && toolMode === 'select'}
                      onDragEnd={(e) => handlePolygonDragEnd(e, unit)}
                      onMouseEnter={() => setHoveredUnit(unit.id)}
                      onMouseLeave={() => setHoveredUnit(null)}
                      onClick={(e) => handlePolygonClick(e, unit)}
                      onTap={(e) => handlePolygonClick(e, unit)}
                      onDblClick={(e) => {
                        e.cancelBubble = true;
                        onSelectUnit?.(unit.id);
                        onToolModeChange?.('select');
                      }}
                      onDblTap={(e) => {
                        e.cancelBubble = true;
                        onSelectUnit?.(unit.id);
                        onToolModeChange?.('select');
                      }}
                    />
                    
                    {isSelected && unit.polygon_coordinates.map((pt, i) => (
                       <Circle
                         key={`anchor-${i}`}
                         x={layout.offsetX + pt.pctX * layout.drawW}
                         y={layout.offsetY + pt.pctY * layout.drawH}
                         radius={(toolMode === 'delete_node' ? 6 : 5) / stageScale}
                         fill={toolMode === 'delete_node' ? '#ef4444' : '#fff'}
                         stroke={toolMode === 'delete_node' ? '#fff' : '#8b5cf6'}
                         strokeWidth={2 / stageScale}
                         draggable={toolMode === 'select'}
                         onDragEnd={(e) => handleAnchorDragEnd(e, unit.id, i)}
                         onClick={(e) => handleAnchorClick(e, unit.id, i)}
                         onTap={(e) => handleAnchorClick(e, unit.id, i)}
                         onMouseEnter={() => setIsHoveringAnchor(true)}
                         onMouseLeave={() => setIsHoveringAnchor(false)}
                       />
                    ))}
                  </React.Fragment>
                );
              })}

            {toolMode === 'draw' && draftPoints.length > 0 && (
              <Line
                points={toPixels(draftPoints)}
                stroke="blue"
                strokeWidth={2 / stageScale}
                closed={false}
              />
            )}
            {toolMode === 'draw' &&
              draftPoints.map((pt, i) => (
                <Circle
                  key={`draft-${i}`}
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
});

export default FloorplanCanvas;
