"use client";
import React, { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Group, Circle, Path } from 'react-konva';
import useImage from 'use-image';
import { Hand, MousePointer2, RotateCcw, Check, Pointer, PlusCircle, MinusCircle, Copy, ZoomIn, ZoomOut, FlipHorizontal, FlipVertical, Pencil, Trash2, Stamp } from 'lucide-react';

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

const getCentroid = (points) => {
  if (!points || points.length === 0) return { pctX: 0, pctY: 0 };
  let sumX = 0, sumY = 0;
  points.forEach(p => { sumX += p.pctX; sumY += p.pctY; });
  return { 
    pctX: sumX / points.length, 
    pctY: sumY / points.length 
  };
};

const ICON_PATHS = {
  planned: "M8 2v4M16 2v4M3 8h18M4 4h16c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z", // Calendar
  ongoing: "M5 3l14 9-14 9V3z", // Play
  completed: "M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" // CheckSquare
};

const FloorplanCanvas = forwardRef(({
  imageUrl,
  units,
  activeStatuses,
  toolMode,
  onToolModeChange,
  onUpdateUnitPolygon,
  onUpdateUnitIconOffset,
  onDuplicateUnit,
  onPolygonComplete,
  legendFilter,
  selectedUnitId,
  onSelectUnit,
  onRenameUnit,
  onDeleteUnit,
  onInstantStamp,
  pendingPolygonPoints,
  onPendingPolygonMove,
  onAddNodeToSegment,
  onPendingPolygonComplete,
  showTooltip,
  settings,
  temporalFilters,
}, ref) => {
  const [image] = useImage(imageUrl, 'anonymous');

  const stageRef = useRef(null);

  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [draftPoints, setDraftPoints] = useState([]);
  const draftPointsRef = useRef(draftPoints);
  useEffect(() => { draftPointsRef.current = draftPoints; }, [draftPoints]);
  
  const [hoveredUnit, setHoveredUnit] = useState(null);
  const [isHoveringAnchor, setIsHoveringAnchor] = useState(false);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [activeDragNode, setActiveDragNode] = useState(null);
  const [activeDragPolygon, setActiveDragPolygon] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [pointerPos, setPointerPos] = useState(null);

  const [isShiftDown, setIsShiftDown] = useState(false);
  const [boxOrigin, setBoxOrigin] = useState(null);
  const lastBoxEndRef = useRef(0);

  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Shift') setIsShiftDown(true);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (toolMode === 'draw' && draftPointsRef.current.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setDraftPoints(prev => prev.slice(0, -1));
        }
      }
      if (toolMode === 'draw') {
        if (e.key === 'Escape') {
          if (draftPointsRef.current.length > 0) {
            e.stopImmediatePropagation();
            setDraftPoints([]);
          }
        }
        if (e.key === 'Enter') {
          if (draftPointsRef.current.length > 2) {
            e.stopImmediatePropagation();
            onPolygonComplete(draftPointsRef.current);
            setDraftPoints([]);
          }
        }
      }
    };
    const handleKeyUp = (e) => {
      if (e.key === 'Shift') setIsShiftDown(false);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);

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
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('resize', checkSize);
      timeouts.forEach(clearTimeout);
    };
  }, [imageUrl, toolMode, onPolygonComplete]);

  useEffect(() => {
    if (toolMode !== 'draw') setDraftPoints([]);
    if (!['select', 'add_node', 'delete_node', 'stamp'].includes(toolMode)) {
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
    setContextMenu(null);
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

  const mixAlpha = (colorStr, alpha) => {
    if (!colorStr) return colorStr;
    const cacheKey = colorStr + alpha;
    if (colorStr.startsWith('rgba')) {
      return colorStr.replace(/[\d.]+\)$/g, `${alpha})`);
    } else if (colorStr.startsWith('#')) {
      let c = colorStr.substring(1).split('');
      if(c.length === 3){
          c= [c[0], c[0], c[1], c[1], c[2], c[2]];
      }
      c= '0x'+c.join('');
      return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
    }
    return colorStr;
  };

  const handleStageClick = (e) => {
    setContextMenu(null);
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    const logicalX = (pointer.x - stage.x()) / stageScale;
    const logicalY = (pointer.y - stage.y()) / stageScale;

    const { offsetX, offsetY, drawW, drawH } = layout;
    if (drawW <= 0 || drawH <= 0) return;

    let pctX = (logicalX - offsetX) / drawW;
    let pctY = (logicalY - offsetY) / drawH;

    if (toolMode === 'stamp' && selectedUnitId) {
      const sourceUnit = units.find(u => u.id === selectedUnitId);
      if (sourceUnit && sourceUnit.polygon_coordinates && sourceUnit.polygon_coordinates.length > 0) {
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
        
        onInstantStamp?.(selectedUnitId, translatedPoints);
      }
    } else if (toolMode === 'draw') {
      if (Date.now() - lastBoxEndRef.current < 200) return;
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

  useEffect(() => {
    setContextMenu(null);
  }, [toolMode]);

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
    if (pendingPolygonPoints && pendingPolygonPoints.length > 0) {
      const newPoints = pendingPolygonPoints.map(p => ({ ...p }));
      if (direction === 'horizontal') {
        const xs = newPoints.map(p => p.pctX);
        const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
        newPoints.forEach(p => p.pctX = centerX - (p.pctX - centerX));
      } else {
        const ys = newPoints.map(p => p.pctY);
        const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
        newPoints.forEach(p => p.pctY = centerY - (p.pctY - centerY));
      }
      onPendingPolygonMove?.(newPoints);
      return;
    }

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

  const addNodeCursor = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><path d='M2,2 L10,24 L14,15 L24,10 Z' fill='black' stroke='white' stroke-width='1.5'/><circle cx='20' cy='20' r='6' fill='%2310b981' stroke='white' stroke-width='1'/><path d='M20,16.5 v7 M16.5,20 h7' stroke='white' stroke-width='2' stroke-linecap='round'/></svg>") 2 2, crosshair`;
  const deleteNodeCursor = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><path d='M2,2 L10,24 L14,15 L24,10 Z' fill='black' stroke='white' stroke-width='1.5'/><circle cx='20' cy='20' r='6' fill='%23ef4444' stroke='white' stroke-width='1'/><path d='M16.5,20 h7' stroke='white' stroke-width='2' stroke-linecap='round'/></svg>") 2 2, pointer`;

  let computedCursor = 'grab';
  if (isDraggingCanvas) {
    computedCursor = 'grabbing';
  } else if (activeDragPolygon || activeDragNode) {
    computedCursor = 'grabbing';
  } else if (toolMode === 'draw') {
    computedCursor = 'crosshair';
  } else if (toolMode === 'stamp') {
    computedCursor = 'copy';
  } else if (toolMode === 'add_node') {
    computedCursor = addNodeCursor;
  } else if (toolMode === 'select') {
    if (isHoveringAnchor) computedCursor = 'pointer';
    else if (hoveredUnit) computedCursor = hoveredUnit === selectedUnitId ? 'grab' : 'pointer';
    else computedCursor = 'default';
  } else if (toolMode === 'delete_node') {
    computedCursor = isHoveringAnchor ? deleteNodeCursor : 'default';
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
              icon={Stamp}
              label="Stamp Trace"
              currentMode={toolMode}
              activeMode="stamp"
              onClick={() => onToolModeChange?.('stamp')}
              colorClass="fuchsia"
            />
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
            <div className="h-px bg-slate-200/80 dark:bg-white/10 mx-1 my-1" />
            <ActionButton 
              icon={Trash2} 
              label="Delete" 
              currentMode={null} 
              activeMode={null} 
              onClick={() => onDeleteUnit?.(selectedUnitId)} 
              colorClass="red" 
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
            } else if (toolMode === 'draw' && (!e.evt || e.evt.button === 0) && draftPoints.length === 0) {
              const stage = e.target.getStage();
              const pointer = stage.getPointerPosition();
              const logicalX = (pointer.x - stage.x()) / stageScale;
              const logicalY = (pointer.y - stage.y()) / stageScale;
              const pctX = (logicalX - layout.offsetX) / layout.drawW;
              const pctY = (logicalY - layout.offsetY) / layout.drawH;
              setBoxOrigin({ pctX, pctY });
            }
          }}
          onPointerUp={(e) => {
            setIsDraggingCanvas(false);
            if (toolMode === 'draw' && boxOrigin) {
              const stage = e.target.getStage();
              const pointer = stage.getPointerPosition();
              const logicalX = (pointer.x - stage.x()) / stageScale;
              const logicalY = (pointer.y - stage.y()) / stageScale;
              const pctX = (logicalX - layout.offsetX) / layout.drawW;
              const pctY = (logicalY - layout.offsetY) / layout.drawH;
              const dx = Math.abs(pctX - boxOrigin.pctX);
              const dy = Math.abs(pctY - boxOrigin.pctY);
              
              const startX = boxOrigin.pctX;
              const startY = boxOrigin.pctY;
              setBoxOrigin(null);
              
              if ((dx > 0.02 && dy > 0.02) && draftPoints.length === 0) {
                lastBoxEndRef.current = Date.now();
                onPolygonComplete([
                  { pctX: startX, pctY: startY },
                  { pctX: pctX, pctY: startY },
                  { pctX: pctX, pctY: pctY },
                  { pctX: startX, pctY: pctY }
                ]);
                setDraftPoints([]);
              }
            }
          }}
          onMouseMove={(e) => {
            const stage = e.target.getStage();
            if (stage) setPointerPos(stage.getPointerPosition());
          }}
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
                const tState = activeStatus?.temporal_state || 'completed';
                const fillColor = activeStatus ? activeStatus.status_color : 'rgba(0,0,0,0)';
                const matchesLegend =
                  !legendFilter || (activeStatus && activeStatus.milestone === legendFilter);
                const isSelected = selectedUnitId === unit.id;
                const dim = legendFilter && !matchesLegend;
                const isHover = hoveredUnit === unit.id;
                
                const highlight = isSelected || isHover;
                const isFilteredOut = activeStatus && temporalFilters && !temporalFilters.includes(tState);

                let strokeDash = [];
                let currentFill = fillColor;
                // Use the milestone color for the border. Fallback to grey if no status.
                let currentStroke = activeStatus ? activeStatus.status_color : (dim ? '#94a3b8' : '#475569');

                if (activeStatus && !highlight && !dim) {
                  if (tState === 'none') {
                    currentFill = mixAlpha(activeStatus.status_color, 0.05); // Super faint hint
                  } else if (tState === 'planned') {
                    currentFill = mixAlpha(activeStatus.status_color, 0.3); // Faint
                    strokeDash = [10, 6]
                  } else if (tState === 'ongoing') {
                    currentFill = mixAlpha(activeStatus.status_color, 0.65); // Med
                  }
                }
                
                if (dim && activeStatus) {
                  currentFill = mixAlpha(activeStatus.status_color, 0.1);
                  currentStroke = mixAlpha(activeStatus.status_color, 0.3);
                }

                const currentPoints = toPixels(
                  activeDragNode?.unitId === unit.id
                    ? unit.polygon_coordinates.map((p, i) =>
                        i === activeDragNode.index ? { pctX: activeDragNode.pctX, pctY: activeDragNode.pctY } : p
                      )
                    : unit.polygon_coordinates
                );

                return (
                  <React.Fragment key={unit.id}>
                    {/* The Separated Layer Pattern for Markup Borders */}
                    <Group
                      visible={!isFilteredOut}
                      draggable={isSelected && toolMode === 'select'}
                      onDragMove={(e) => {
                        const dx = e.target.x() / layout.drawW;
                        const dy = e.target.y() / layout.drawH;
                        setActiveDragPolygon({ unitId: unit.id, dx, dy });
                      }}
                      onDragEnd={(e) => {
                        setActiveDragPolygon(null);
                        handlePolygonDragEnd(e, unit);
                      }}
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
                      onContextMenu={(e) => {
                        e.cancelBubble = true;
                        e.evt.preventDefault();
                        onSelectUnit?.(unit.id);
                        onToolModeChange?.('select');
                        const stage = e.target.getStage();
                        const pointer = stage.getPointerPosition();
                        setTimeout(() => {
                           setContextMenu({ x: pointer.x, y: pointer.y, unitId: unit.id });
                        }, 10);
                      }}
                    >
                      {/* LAYER 1: Fill Only (Multiplied to reveal architectural text) */}
                      <Line
                        points={currentPoints}
                        fill={currentFill}
                        closed={true}
                        globalCompositeOperation="multiply"
                        listening={false}
                      />

                      {/* LAYER 2: Stroke Only (Standard rendering, sharp, vibrant) */}
                      <Line
                        points={currentPoints}
                        stroke={highlight ? (isSelected ? '#8b5cf6' : '#0ea5e9') : currentStroke}
                        strokeWidth={(dim ? 1.0 : (highlight ? 4.0 : 2.5)) * (settings?.markupThickness || 1)}
                        dash={strokeDash}
                        closed={true}
                        shadowColor={highlight ? (isSelected ? 'rgba(139, 92, 246, 0.85)' : 'rgba(14, 165, 233, 0.85)') : 'transparent'}
                        shadowBlur={highlight ? 18 : 0}
                        shadowOpacity={highlight ? 0.9 : 0}
                        listening={!isFilteredOut}
                      />
                    </Group>
                    
                    {/* The Status Icon */}
                    {(activeStatus && tState !== 'none' && !isFilteredOut) && (() => {
                      // 1. Statically defined colors for the temporal states
                      const TEMPORAL_COLORS = {
                        planned: '#94a3b8',   // Slate Gray
                        ongoing: '#f59e0b',   // Amber
                        completed: '#10b981', // Emerald
                      };
                      const iconColor = TEMPORAL_COLORS[tState] || '#cbd5e1';

                      let previewPolygon = unit.polygon_coordinates;
                      if (activeDragNode?.unitId === unit.id) {
                          previewPolygon = unit.polygon_coordinates.map((p, i) =>
                              i === activeDragNode.index ? { pctX: activeDragNode.pctX, pctY: activeDragNode.pctY } : p
                          );
                      }
                      const centroid = getCentroid(previewPolygon);
                      const draggedOffsetX = activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dx : 0;
                      const draggedOffsetY = activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dy : 0;
                      
                      const offsetX = unit.icon_offset_x || 0;
                      const offsetY = unit.icon_offset_y || 0;
                      
                      const iconAbsX = layout.offsetX + (centroid.pctX + draggedOffsetX + offsetX) * layout.drawW;
                      const iconAbsY = layout.offsetY + (centroid.pctY + draggedOffsetY + offsetY) * layout.drawH;

                      const isDimmed = dim || isFilteredOut;

                      return (
                        <Group
                          x={iconAbsX}
                          y={iconAbsY}
                          scale={{ x: 1 / stageScale, y: 1 / stageScale }}
                          draggable={toolMode === 'select' && isShiftDown}
                          opacity={dim ? 0.3 : 1}
                          onDragStart={(e) => {
                            e.cancelBubble = true;
                          }}
                          onDragEnd={(e) => {
                            e.cancelBubble = true;
                            
                            // Capture the visual dropped position
                            const newAbsX = e.target.x();
                            const newAbsY = e.target.y();
                            
                            // Konva Uncontrolled Fix: Instantly snap the internal node back to origin 
                            // so React state takes full declarative control of the new layout on re-render.
                            e.target.x(layout.offsetX + centroid.pctX * layout.drawW);
                            e.target.y(layout.offsetY + centroid.pctY * layout.drawH);
                            
                            // Calculate percentages
                            const newPctX = (newAbsX - layout.offsetX) / layout.drawW;
                            const newPctY = (newAbsY - layout.offsetY) / layout.drawH;
                            
                            const baseCentroid = getCentroid(unit.polygon_coordinates);
                            const newOffsetX = newPctX - baseCentroid.pctX;
                            const newOffsetY = newPctY - baseCentroid.pctY;
                            
                            onUpdateUnitIconOffset?.(unit.id, newOffsetX, newOffsetY);
                          }}
                          onMouseEnter={(e) => {
                            if (toolMode === 'select' && isShiftDown) {
                              e.target.getStage().container().style.cursor = 'grab';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.target.getStage().container().style.cursor = computedCursor;
                          }}
                          onClick={(e) => { e.cancelBubble = true; handlePolygonClick(e, unit); }}
                          onTap={(e) => { e.cancelBubble = true; handlePolygonClick(e, unit); }}
                        >
                          {/* The visual icon background */}
                          <Circle
                            radius={12}
                            fill="#ffffff"
                            stroke={iconColor}
                            strokeWidth={2.5}
                            shadowColor="rgba(0,0,0,0.4)"
                            shadowBlur={4}
                            shadowOffset={{ x: 0, y: 2 }}
                          />
                          {/* The SVG Path */}
                          <Path
                            x={-8}
                            y={-8}
                            data={ICON_PATHS[tState] || ICON_PATHS.completed}
                            fill="transparent"
                            stroke={iconColor}
                            strokeWidth={2}
                            strokeLineCap="round"
                            strokeLineJoin="round"
                            scale={{ x: 0.65, y: 0.65 }}
                            listening={false}
                          />
                        </Group>
                      );
                    })()}
                    
                    {isSelected && unit.polygon_coordinates.map((pt, i) => (
                       <Circle
                         key={`anchor-${i}`}
                         x={layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dx : 0)) * layout.drawW}
                         y={layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dy : 0)) * layout.drawH}
                         radius={(toolMode === 'delete_node' ? 6 : 5) / stageScale}
                         fill={toolMode === 'delete_node' ? '#ef4444' : '#fff'}
                         stroke={toolMode === 'delete_node' ? '#fff' : '#8b5cf6'}
                         strokeWidth={2 / stageScale}
                         draggable={toolMode === 'select'}
                         dragBoundFunc={(pos) => {
                           if (!isShiftDown) return pos;
                           const origX = layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dx : 0)) * layout.drawW;
                           const origY = layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dy : 0)) * layout.drawH;
                           if (Math.abs(pos.x - origX) > Math.abs(pos.y - origY)) {
                             return { x: pos.x, y: origY };
                           } else {
                             return { x: origX, y: pos.y };
                           }
                         }}
                         onDragMove={(e) => {
                           const node = e.target;
                           let pctX = (node.x() - layout.offsetX) / layout.drawW;
                           let pctY = (node.y() - layout.offsetY) / layout.drawH;
                           setActiveDragNode({ unitId: unit.id, index: i, pctX, pctY });
                         }}
                         onDragEnd={(e) => {
                           setActiveDragNode(null);
                           handleAnchorDragEnd(e, unit.id, i);
                         }}
                         onClick={(e) => handleAnchorClick(e, unit.id, i)}
                         onTap={(e) => handleAnchorClick(e, unit.id, i)}
                         onMouseEnter={() => setIsHoveringAnchor(true)}
                         onMouseLeave={() => setIsHoveringAnchor(false)}
                       />
                    ))}
                  </React.Fragment>
                );
              })}

            {toolMode === 'draw' && draftPoints.length > 0 && pointerPos && !boxOrigin && (
              (() => {
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
              })()
            )}

            {toolMode === 'stamp' && selectedUnitId && pointerPos && (
              (() => {
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
              })()
            )}

            {toolMode === 'draw' && boxOrigin && pointerPos && (
              (() => {
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
              })()
            )}

            {toolMode === 'draw' && draftPoints.length > 0 && (
              <Line
                points={toPixels(draftPoints)}
                stroke="blue"
                strokeWidth={2 / stageScale}
                closed={false}
                listening={false}
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
                  listening={false}
                />
              ))}

            {pendingPolygonPoints && pendingPolygonPoints.length > 2 && (
              <React.Fragment>
                <Line
                  points={toPixels(
                    activeDragNode?.unitId === 'PENDING'
                      ? pendingPolygonPoints.map((p, i) =>
                          i === activeDragNode.index ? { pctX: activeDragNode.pctX, pctY: activeDragNode.pctY } : p
                        )
                      : pendingPolygonPoints
                  )}
                  fill="rgba(139, 92, 246, 0.2)"
                  stroke="#8b5cf6"
                  strokeWidth={(3 * (settings?.markupThickness || 1)) / stageScale}
                  globalCompositeOperation="multiply"
                  dash={[10 / stageScale, 8 / stageScale]}
                  closed={true}
                  draggable={true}
                  onDragMove={(e) => {
                    const dx = e.target.x() / layout.drawW;
                    const dy = e.target.y() / layout.drawH;
                    setActiveDragPolygon({ unitId: 'PENDING', dx, dy });
                  }}
                  onDragEnd={(e) => {
                    setActiveDragPolygon(null);
                    const dx = e.target.x() / layout.drawW;
                    const dy = e.target.y() / layout.drawH;
                    e.target.x(0);
                    e.target.y(0);
                    onPendingPolygonMove?.(
                      pendingPolygonPoints.map(p => ({ pctX: p.pctX + dx, pctY: p.pctY + dy }))
                    );
                  }}
                  onMouseEnter={(e) => {
                    e.target.getStage().container().style.cursor = 'grab';
                  }}
                  onMouseLeave={(e) => {
                    e.target.getStage().container().style.cursor = '';
                  }}
                />
                {pendingPolygonPoints.map((pt, i) => (
                  <Circle
                    key={`pending-anchor-${i}`}
                    x={layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === 'PENDING' ? activeDragPolygon.dx : 0)) * layout.drawW}
                    y={layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === 'PENDING' ? activeDragPolygon.dy : 0)) * layout.drawH}
                    radius={5 / stageScale}
                    fill="#fff"
                    stroke="#8b5cf6"
                    strokeWidth={2 / stageScale}
                    draggable={true}
                    dragBoundFunc={(pos) => {
                      if (!isShiftDown) return pos;
                      const origX = layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === 'PENDING' ? activeDragPolygon.dx : 0)) * layout.drawW;
                      const origY = layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === 'PENDING' ? activeDragPolygon.dy : 0)) * layout.drawH;
                      if (Math.abs(pos.x - origX) > Math.abs(pos.y - origY)) {
                        return { x: pos.x, y: origY };
                      } else {
                        return { x: origX, y: pos.y };
                      }
                    }}
                    onDragMove={(e) => {
                      const node = e.target;
                      let pctX = (node.x() - layout.offsetX) / layout.drawW;
                      let pctY = (node.y() - layout.offsetY) / layout.drawH;
                      setActiveDragNode({ unitId: 'PENDING', index: i, pctX, pctY });
                    }}
                    onDragEnd={(e) => {
                      setActiveDragNode(null);
                      const node = e.target;
                      let pctX = (node.x() - layout.offsetX) / layout.drawW;
                      let pctY = (node.y() - layout.offsetY) / layout.drawH;
                      const newPoints = [...pendingPolygonPoints];
                      newPoints[i] = { pctX, pctY };
                      onPendingPolygonMove?.(newPoints);
                    }}
                    onMouseEnter={() => setIsHoveringAnchor(true)}
                    onMouseLeave={() => setIsHoveringAnchor(false)}
                  />
                ))}
              </React.Fragment>
            )}
          </Layer>
        </Stage>
      )}

      {showTooltip && hoveredUnit && pointerPos && !contextMenu && toolMode !== 'draw' && toolMode !== 'add_node' && (
        <div
          className="absolute z-40 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 px-3 py-1.5 rounded-lg text-sm font-bold shadow-xl pointer-events-none transition-opacity animate-in fade-in duration-150"
          style={{
            left: pointerPos.x + 15,
            top: pointerPos.y + 15,
          }}
        >
          {units.find(u => u.id === hoveredUnit)?.unit_number || ''}
        </div>
      )}

      {contextMenu && (
        <div 
          className="absolute z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 p-2 flex flex-col gap-1 min-w-[200px]"
          style={{ 
            left: Math.min(contextMenu.x, dimensions.width - 200),
            top: Math.min(contextMenu.y, dimensions.height - 260)
          }}
        >
          <div className="px-2 py-1 mb-1 border-b border-slate-200/50 dark:border-slate-700/50">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Options</span>
          </div>
          <button type="button" onClick={() => { onRenameUnit?.(contextMenu.unitId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors text-left">
            <Pencil size={16} className="text-sky-500" /> Rename Location
          </button>
          <button type="button" onClick={() => { onDuplicateUnit?.(contextMenu.unitId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors text-left">
            <Copy size={16} className="text-purple-500" /> Duplicate
          </button>
          <button type="button" onClick={() => { handleFlip('horizontal'); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors text-left">
            <FlipHorizontal size={16} className="text-emerald-500" /> Flip Horizontal
          </button>
          <button type="button" onClick={() => { handleFlip('vertical'); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors text-left">
            <FlipVertical size={16} className="text-rose-500" /> Flip Vertical
          </button>
          <div className="h-px bg-slate-200/50 dark:bg-slate-700/50 mx-1 my-1" />
          <button type="button" onClick={() => { onDeleteUnit?.(contextMenu.unitId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 text-sm font-bold text-red-600 transition-colors text-left">
            <Trash2 size={16} className="text-red-500" /> Delete Location
          </button>
        </div>
      )}
    </div>
  );
});

FloorplanCanvas.displayName = 'FloorplanCanvas';

export default FloorplanCanvas;
