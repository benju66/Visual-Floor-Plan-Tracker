"use client";
import React, { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Group, Circle, Path } from 'react-konva';
import useImage from 'use-image';
import { Check } from 'lucide-react';
import ViewportControls from '@/components/canvas/ViewportControls';
import ContextActionDock from '@/components/canvas/ContextActionDock';
import CanvasContextMenu from '@/components/CanvasContextMenu';
import MappedUnit from '@/components/canvas/MappedUnit';
import DraftPolygon from '@/components/canvas/DraftPolygon';
import StampPreview from '@/components/canvas/StampPreview';
import PendingPolygon from '@/components/canvas/PendingPolygon';
import MapLegend from '@/components/canvas/MapLegend';
import { distToSegment, getCentroid } from '@/utils/geometry';
import { ICON_PATHS } from '@/utils/constants';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore, useHydratedStore } from '@/store/useSettingsStore';
import { useProject, useUnits, useStatuses, useMilestones } from '@/hooks/useProjectQueries';
import { useParams } from 'next/navigation';

const FloorplanCanvas = forwardRef(({
  activeStatuses,
  imageUrl,
  onUpdateUnitPolygon,
  onUpdateUnitIconOffset,
  onDuplicateUnit,
  onPolygonComplete,
  onRenameUnit,
  onDeleteUnit,
  onInstantStamp,
  pendingPolygonPoints,
  onPendingPolygonMove,
  onAddNodeToSegment,
  onPendingPolygonComplete,
  onOpenMilestoneModal,
  onOpenStatusModal,
}, ref) => {
  const activeSheetId = useMapStore(s => s.activeSheetId);
  const toolMode = useMapStore(s => s.toolMode);
  const onToolModeChange = useMapStore(s => s.setToolMode);
  const selectedUnitIds = useMapStore(s => s.selectedUnitIds);
  const onSelectUnit = useMapStore(s => s.toggleSelectedUnitId);
  const onClearSelection = useMapStore(s => s.clearSelectedUnits);
  const onSetSelectedUnitIds = useMapStore(s => s.setSelectedUnitIds);
  const trackingMode = useMapStore(s => s.trackingMode);

  const temporalFilters = useSettingsStore(s => s.temporalFilters);
  const legendFilter = useSettingsStore(s => s.filterMilestone);
  
  const setHistoryModalUnitId = useUIStore(s => s.setHistoryModalUnitId);
  
  const settings = useHydratedStore(s => s.settings, { showHistoryHover: false });
  const mapSettings = useHydratedStore(s => s.mapSettings, { showCrosshair: false });
  const legendPosition = useHydratedStore(s => s.legendPosition, { isVisible: false });
  const onLegendDragEnd = useSettingsStore(s => s.setLegendPosition);

  const params = useParams();
  const projectId = params?.projectId;

  const { data: project } = useProject(projectId);
  const { data: allMilestones = [] } = useMilestones(projectId);
  const milestones = allMilestones.filter(m => m.track === trackingMode);
  const { data: units = [], isLoading: isLoadingUnits } = useUnits(activeSheetId);
  const unitIds = units.map(u => u.id);
  
  // activeStatuses is now provided by props and bottleneck resolution
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
  const [isLegendSelected, setIsLegendSelected] = useState(false);

  const [isShiftDown, setIsShiftDown] = useState(false);
  const [boxOrigin, setBoxOrigin] = useState(null);
  const lastBoxEndRef = useRef(0);

  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Shift') setIsShiftDown(true);
      if (e.key === 'Escape') {
        setIsLegendSelected(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (toolMode === 'draw' && draftPointsRef.current.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setDraftPoints(prev => prev.slice(0, -1));
        }
      }
      if (toolMode === 'draw') {
        const isInputActive = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
        if (e.key === 'Escape') {
          if (!isInputActive && draftPointsRef.current.length > 0) {
            e.stopImmediatePropagation();
            setDraftPoints([]);
          }
        }
        if (e.key === 'Enter') {
          if (!isInputActive && draftPointsRef.current.length > 2) {
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
    if (!['select', 'multi_select', 'add_node', 'delete_node', 'stamp'].includes(toolMode)) {
      onClearSelection();
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

  const visibleBoundingBox = useMemo(() => {
    if (!layout.drawW || !layout.drawH || !dimensions.width || !dimensions.height) return null;
    const minX = ((-stagePosition.x / stageScale) - layout.offsetX) / layout.drawW;
    const minY = ((-stagePosition.y / stageScale) - layout.offsetY) / layout.drawH;
    const maxX = (((dimensions.width - stagePosition.x) / stageScale) - layout.offsetX) / layout.drawW;
    const maxY = (((dimensions.height - stagePosition.y) / stageScale) - layout.offsetY) / layout.drawH;
    return {
      minPctX: minX - 0.05,
      maxPctX: maxX + 0.05,
      minPctY: minY - 0.05,
      maxPctY: maxY + 0.05,
    };
  }, [stagePosition, stageScale, dimensions, layout]);

  const visibleUnits = useMemo(() => {
    if (!visibleBoundingBox || !layout.drawW) return units;
    const { minPctX, maxPctX, minPctY, maxPctY } = visibleBoundingBox;

    return units.filter(unit => {
      if (!unit.polygon_coordinates || unit.polygon_coordinates.length === 0) return true;
      
      return unit.polygon_coordinates.some(pt => 
        pt.pctX >= minPctX && 
        pt.pctX <= maxPctX && 
        pt.pctY >= minPctY && 
        pt.pctY <= maxPctY
      );
    });
  }, [units, visibleBoundingBox, layout.drawW]);

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
    
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    let newScale;
    if (e.evt.ctrlKey) {
      // Trackpad native pinch
      newScale = e.evt.deltaY > 0 ? oldScale / 1.05 : oldScale * 1.05;
    } else {
      // Fluid inertial friction for continuous slides and wheels
      const delta = Math.abs(e.evt.deltaY);
      const stretch = Math.pow(1.08, Math.min(delta, 100) / 50);
      newScale = e.evt.deltaY > 0 ? oldScale / stretch : oldScale * stretch;
    }

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

    if (toolMode === 'stamp' && selectedUnitIds?.length === 1) {
      const sourceUnit = units.find(u => u.id === selectedUnitIds[0]);
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
        
        onInstantStamp?.(selectedUnitIds[0], translatedPoints);
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
    } else if (['select', 'multi_select', 'add_node', 'delete_node'].includes(toolMode)) {
      if (e.target === stage || e.target.nodeType === 'Image' || e.target.attrs?.id === 'bg-rect') {
        onClearSelection();
        setIsLegendSelected(false);
      }
    } else {
      if (e.target === stage || e.target.nodeType === 'Image' || e.target.attrs?.id === 'bg-rect') {
        setIsLegendSelected(false);
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
    if (!['select', 'multi_select', 'add_node', 'delete_node'].includes(toolMode)) return;
    e.cancelBubble = true;
    
    if (toolMode === 'multi_select') {
       onSelectUnit(unit.id); // It's actually toggleSelectedUnitId
       return;
    }

    if (toolMode === 'select') {
      if (!selectedUnitIds.includes(unit.id)) {
        onSetSelectedUnitIds([unit.id]);
        return;
      }
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

    if (selectedUnitIds?.length !== 1) return;
    const unit = units.find(u => u.id === selectedUnitIds[0]);
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

  const handleRotatePolygon = (direction, overrideId = null) => {
    const targetId = overrideId || (selectedUnitIds?.length === 1 ? selectedUnitIds[0] : null);
    if (!targetId) return;
    const unit = units.find(u => u.id === targetId);
    if (!unit || !unit.polygon_coordinates || unit.polygon_coordinates.length === 0) return;

    const pts = unit.polygon_coordinates;
    const centroid = getCentroid(pts);
    const cx = centroid.pctX || 0;
    const cy = centroid.pctY || 0;

    const newPoints = pts.map(p => {
      let newX, newY;
      if (direction === 'left') {
        newX = cx + (p.pctY - cy);
        newY = cy - (p.pctX - cx);
      } else {
        newX = cx - (p.pctY - cy);
        newY = cy + (p.pctX - cx);
      }
      return { pctX: newX, pctY: newY };
    });

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
  } else if (['select', 'multi_select'].includes(toolMode)) {
    if (isHoveringAnchor) computedCursor = 'pointer';
    else if (hoveredUnit) computedCursor = selectedUnitIds?.includes(hoveredUnit) ? 'grab' : 'pointer';
    else computedCursor = 'default';
  } else if (toolMode === 'delete_node') {
    computedCursor = isHoveringAnchor ? deleteNodeCursor : 'default';
  }

  const isZoomedOut = stageScale < 1.5;

  if (isLoadingUnits) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 dark:bg-[#0f172a] rounded-xl border border-slate-200/60 dark:border-white/10">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4 shadow-sm"></div>
        <p className="text-slate-500 font-medium text-sm animate-pulse">Loading floor plan...</p>
      </div>
    );
  }

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
      <ViewportControls 
        resetView={resetView} 
        handleZoom={handleZoom} 
      />

      <ContextActionDock
        selectedUnitIds={selectedUnitIds}
        isLegendSelected={isLegendSelected}
        toolMode={toolMode}
        onToolModeChange={onToolModeChange}
        onRenameUnit={onRenameUnit}
        onDuplicateUnit={onDuplicateUnit}
        handleFlip={handleFlip}
        handleRotatePolygon={handleRotatePolygon}
        onDeleteUnit={onDeleteUnit}
        onOpenMilestoneModal={onOpenMilestoneModal}
        onOpenStatusModal={onOpenStatusModal}
        onOpenHistoryModal={(id) => setHistoryModalUnitId(id)}
        onHideLegend={() => onLegendDragEnd?.({ isVisible: false })}
        onRotateLegend={(dir) => {
          const rotDelta = dir === 'left' ? -90 : 90;
          onLegendDragEnd?.({ rotation: (legendPosition?.rotation || 0) + rotDelta });
        }}
      />

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
              const pointer = stage.getPointerPosition() || pointerPos;
              if (!pointer) {
                setBoxOrigin(null);
                return;
              }
              const logicalX = (pointer.x - stage.x()) / stageScale;
              const logicalY = (pointer.y - stage.y()) / stageScale;
              const pctX = (logicalX - layout.offsetX) / layout.drawW;
              const pctY = (logicalY - layout.offsetY) / layout.drawH;
              const dx = Math.abs(pctX - boxOrigin.pctX);
              const dy = Math.abs(pctY - boxOrigin.pctY);
              
              const startX = boxOrigin.pctX;
              const startY = boxOrigin.pctY;
              setBoxOrigin(null);
              
              if ((dx > 0.005 && dy > 0.005) && draftPoints.length === 0) {
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

            {visibleUnits &&
              visibleUnits.map((unit) => (
                <MappedUnit
                  key={unit.id}
                  unit={unit}
                  activeStatuses={activeStatuses}
                  legendFilter={legendFilter}
                  selectedUnitIds={selectedUnitIds}
                  hoveredUnit={hoveredUnit}
                  temporalFilters={temporalFilters}
                  toolMode={toolMode}
                  layout={layout}
                  stageScale={stageScale}
                  isZoomedOut={isZoomedOut}
                  settings={settings}
                  activeDragNode={activeDragNode}
                  activeDragPolygon={activeDragPolygon}
                  isShiftDown={isShiftDown}
                  computedCursor={computedCursor}
                  mixAlpha={mixAlpha}
                  toPixels={toPixels}
                  setHoveredUnit={setHoveredUnit}
                  setActiveDragPolygon={setActiveDragPolygon}
                  handlePolygonDragEnd={handlePolygonDragEnd}
                  handlePolygonClick={handlePolygonClick}
                  onSelectUnit={onSelectUnit}
                  onToolModeChange={onToolModeChange}
                  setContextMenu={setContextMenu}
                  onUpdateUnitIconOffset={onUpdateUnitIconOffset}
                  setIsHoveringAnchor={setIsHoveringAnchor}
                  setActiveDragNode={setActiveDragNode}
                  handleAnchorDragEnd={handleAnchorDragEnd}
                  handleAnchorClick={handleAnchorClick}
                />
              ))}

            <DraftPolygon
              toolMode={toolMode}
              draftPoints={draftPoints}
              pointerPos={pointerPos}
              boxOrigin={boxOrigin}
              stagePosition={stagePosition}
              stageScale={stageScale}
              layout={layout}
              isShiftDown={isShiftDown}
              toPixels={toPixels}
            />

            <StampPreview
              toolMode={toolMode}
              selectedUnitId={selectedUnitIds?.length === 1 ? selectedUnitIds[0] : null}
              pointerPos={pointerPos}
              stagePosition={stagePosition}
              stageScale={stageScale}
              layout={layout}
              units={units}
              activeStatuses={activeStatuses}
              toPixels={toPixels}
            />

            <PendingPolygon
              pendingPolygonPoints={pendingPolygonPoints}
              activeDragNode={activeDragNode}
              activeDragPolygon={activeDragPolygon}
              settings={settings}
              stageScale={stageScale}
              layout={layout}
              isShiftDown={isShiftDown}
              toPixels={toPixels}
              setActiveDragPolygon={setActiveDragPolygon}
              onPendingPolygonMove={onPendingPolygonMove}
              setActiveDragNode={setActiveDragNode}
              setIsHoveringAnchor={setIsHoveringAnchor}
            />

            <MapLegend
              isVisible={legendPosition?.isVisible}
              pctX={legendPosition?.pctX}
              pctY={legendPosition?.pctY}
              scaleX={legendPosition?.scaleX}
              scaleY={legendPosition?.scaleY}
              rotation={legendPosition?.rotation}
              layout={layout}
              units={units}
              milestones={milestones}
              activeStatuses={activeStatuses}
              isSelected={isLegendSelected}
              onSelect={() => setIsLegendSelected(true)}
              onUpdate={(payload) => {
                onLegendDragEnd?.(payload);
              }}
            />
          </Layer>
        </Stage>
      )}

      {mapSettings?.showCrosshair && pointerPos && (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden mix-blend-difference opacity-40">
          <div className="absolute top-0 bottom-0 border-l border-dashed border-white" style={{ left: pointerPos.x }} />
          <div className="absolute left-0 right-0 border-t border-dashed border-white" style={{ top: pointerPos.y }} />
        </div>
      )}

      {settings?.showHistoryHover && hoveredUnit && pointerPos && !contextMenu && toolMode !== 'draw' && toolMode !== 'add_node' && (
        (() => {
          const u = units.find(x => x.id === hoveredUnit);
          const s = activeStatuses.find(status => status.unit_id === hoveredUnit);

          return (
            <div
              className="absolute z-40 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 px-4 py-3 rounded-xl text-sm shadow-2xl pointer-events-none transition-opacity animate-in fade-in duration-150 border border-slate-700 dark:border-white/20 min-w-[180px]"
              style={{
                left: pointerPos.x + 20,
                top: pointerPos.y + 20,
              }}
            >
              <div className="font-bold text-base mb-1">{u?.unit_number || 'Unknown Location'}</div>
              {s ? (
                <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-slate-700/50 dark:border-black/10">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.status_color }} />
                    <span className="font-semibold">{s.milestone}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    <span className="capitalize">{s.temporal_state || 'Completed'}</span>
                    <span>{new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-2 pt-2 border-t border-slate-700/50 dark:border-black/10 text-xs text-slate-400 dark:text-slate-500 italic">
                  Not Started
                </div>
              )}
            </div>
          );
        })()
      )}

      <CanvasContextMenu
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        dimensions={dimensions}
        onRenameUnit={onRenameUnit}
        onDuplicateUnit={onDuplicateUnit}
        handleFlip={handleFlip}
        handleRotatePolygon={handleRotatePolygon}
        onDeleteUnit={onDeleteUnit}
        onOpenMilestoneModal={onOpenMilestoneModal}
        onOpenStatusModal={onOpenStatusModal}
        onOpenHistoryModal={(id) => setHistoryModalUnitId(id)}
      />
    </div>
  );
});

FloorplanCanvas.displayName = 'FloorplanCanvas';

export default FloorplanCanvas;
