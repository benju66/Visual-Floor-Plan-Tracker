import React, { useState, useEffect } from 'react';
import { Group, Line, Circle, Path } from 'react-konva';
import { getCentroid, getSnappedCoordinate } from '@/utils/geometry';
import { ICON_PATHS } from '@/utils/constants';

const stripeCache = {};

const createStripePattern = (color) => {
  if (typeof document === 'undefined') return null;
  if (stripeCache[color]) return stripeCache[color];
  const canvas = document.createElement('canvas');
  canvas.width = 20;
  canvas.height = 20;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 20);
  ctx.lineTo(20, 0);
  ctx.stroke();
  stripeCache[color] = canvas;
  return canvas;
};

export const MappedUnitComponent = ({
  unit,
  isRouteDropTarget,
  activeStatuses,
  legendFilter,
  isSelected,
  isHovered,
  temporalFilters,
  toolMode,
  layout,
  stageScale,
  vectorTree,
  aspect,
  enableSnapping,
  snappingStrength,
  settings,
  activeDragNode,
  activeDragPolygon,
  isShiftDown,
  isZoomedOut,
  computedCursor,
  mixAlpha,
  toPixels,
  setHoveredUnit,
  setActiveDragPolygon,
  handlePolygonDragEnd,
  handlePolygonClick,
  onSelectUnit,
  onToolModeChange,
  setContextMenu,
  onUpdateUnitIconOffset,
  setIsHoveringAnchor,
  setActiveDragNode,
  handleAnchorDragEnd,
  handleAnchorClick
}) => {
  const [optimisticCoords, setOptimisticCoords] = useState(null);

  useEffect(() => {
    setOptimisticCoords(null);
  }, [unit.polygon_coordinates]);

  const activeStatus = activeStatuses.find((s) => s.unit_id === unit.id);
  const tState = activeStatus?.temporal_state || 'completed';
  const fillColor = activeStatus ? activeStatus.status_color : 'rgba(0,0,0,0)';
  const matchesLegend =
    !legendFilter || (activeStatus && activeStatus.milestone === legendFilter);
  const dim = legendFilter && !matchesLegend;
  
  const highlight = (isSelected || isHovered) && toolMode !== 'route';
  const isFilteredOut = activeStatus && temporalFilters && !temporalFilters.includes(tState);

  let strokeDash = [];
  let currentFill = fillColor;
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

  // Final visual override for routing drop targeting
  if (isRouteDropTarget) {
     currentFill = 'rgba(16, 185, 129, 0.4)';
     currentStroke = '#10b981';
  }

  const basePolygon = optimisticCoords || unit.polygon_coordinates;
  const currentPoints = toPixels(
    activeDragNode?.unitId === unit.id
      ? basePolygon.map((p, i) =>
          i === activeDragNode.index ? { pctX: activeDragNode.pctX, pctY: activeDragNode.pctY } : p
        )
      : basePolygon
  );

  return (
    <React.Fragment>
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
          const dx = e.target.x() / layout.drawW;
          const dy = e.target.y() / layout.drawH;
          if (dx !== 0 || dy !== 0) {
            setOptimisticCoords(basePolygon.map(p => ({
               pctX: p.pctX + dx,
               pctY: p.pctY + dy
            })));
          }
          setActiveDragPolygon(null);
          handlePolygonDragEnd(e, unit);
        }}
        onMouseEnter={() => setHoveredUnit(unit.id)}
        onMouseLeave={() => setHoveredUnit(null)}
        onClick={(e) => handlePolygonClick(e, unit)}
        onTap={(e) => handlePolygonClick(e, unit)}
        onDblClick={(e) => {
          if (['draw', 'stamp', 'route'].includes(toolMode)) return;
          e.cancelBubble = true;
          onSelectUnit?.(unit.id);
          onToolModeChange?.('select');
        }}
        onDblTap={(e) => {
          if (['draw', 'stamp', 'route'].includes(toolMode)) return;
          e.cancelBubble = true;
          onSelectUnit?.(unit.id);
          onToolModeChange?.('select');
        }}
        onContextMenu={(e) => {
          if (['draw', 'route'].includes(toolMode)) return;
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
          stroke={isRouteDropTarget ? '#10b981' : highlight ? (isSelected ? '#8b5cf6' : '#0ea5e9') : currentStroke}
          strokeWidth={(isRouteDropTarget ? 4.0 : dim ? 1.0 : (highlight ? 4.0 : 2.5)) * (settings?.markupThickness || 1)}
          dash={strokeDash}
          closed={true}
          shadowColor={isRouteDropTarget ? 'rgba(16, 185, 129, 0.85)' : highlight ? (isSelected ? 'rgba(139, 92, 246, 0.85)' : 'rgba(14, 165, 233, 0.85)') : 'transparent'}
          shadowBlur={isRouteDropTarget ? 18 : highlight ? 18 : 0}
          shadowOpacity={isRouteDropTarget ? 0.9 : highlight ? 0.9 : 0}
          listening={!isFilteredOut}
        />

        {/* Out of Sequence Hatching Overlay */}
        {(() => {
          if (!activeStatus?.outOfSequence?.length || isFilteredOut || dim) return null;
          const furthestStatus = activeStatus.outOfSequence[activeStatus.outOfSequence.length - 1];
          return (
            <Line
              points={currentPoints}
              fillPatternImage={createStripePattern(furthestStatus.status_color)}
              closed={true}
              opacity={0.6}
              listening={false}
            />
          );
        })()}
      </Group>
      
      {/* The Status Icon */}
      {(activeStatus && tState !== 'none' && !isFilteredOut && !isZoomedOut) && (() => {
        const TEMPORAL_COLORS = {
          planned: '#94a3b8',   // Slate Gray
          ongoing: '#f59e0b',   // Amber
          completed: '#10b981', // Emerald
        };
        const iconColor = TEMPORAL_COLORS[tState] || '#cbd5e1';

        let previewPolygon = basePolygon;
        if (activeDragNode?.unitId === unit.id) {
            previewPolygon = basePolygon.map((p, i) =>
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

        const isDelayed = 
          settings?.show_delay_indicators !== false &&
          tState !== 'completed' &&
          activeStatus.planned_end_date &&
          new Date(activeStatus.planned_end_date) < new Date(new Date().setHours(0,0,0,0));

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
              
              const newAbsX = e.target.x();
              const newAbsY = e.target.y();
              
              const newPctX = (newAbsX - layout.offsetX) / layout.drawW;
              const newPctY = (newAbsY - layout.offsetY) / layout.drawH;
              
              const baseCentroid = getCentroid(basePolygon);
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
            onClick={(e) => handlePolygonClick(e, unit)}
            onTap={(e) => handlePolygonClick(e, unit)}
          >
            {isDelayed && (
              <Circle
                radius={16}
                fill="transparent"
                stroke="#ef4444"
                strokeWidth={3}
                shadowColor="#ef4444"
                shadowBlur={8}
                opacity={0.8}
              />
            )}
            <Circle
              radius={12}
              fill="#ffffff"
              stroke={isDelayed ? '#ef4444' : iconColor}
              strokeWidth={2.5}
              shadowColor={isDelayed ? "rgba(239, 68, 68, 0.4)" : "rgba(0,0,0,0.4)"}
              shadowBlur={isDelayed ? 8 : 4}
              shadowOffset={{ x: 0, y: 2 }}
            />
            <Path
              x={-8}
              y={-8}
              data={ICON_PATHS[tState] || ICON_PATHS.completed}
              fill="transparent"
              stroke={isDelayed ? '#ef4444' : iconColor}
              strokeWidth={2}
              strokeLineCap="round"
              strokeLineJoin="round"
              scale={{ x: 0.65, y: 0.65 }}
              listening={false}
            />
          </Group>
        );
      })()}
      
      {isSelected && basePolygon.map((pt, i) => (
         <Circle
           key={`anchor-${i}`}
           x={layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dx : 0)) * layout.drawW}
           y={layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dy : 0)) * layout.drawH}
           radius={(toolMode === 'delete_node' ? 6 : 5) / stageScale}
           fill={toolMode === 'delete_node' ? '#ef4444' : '#fff'}
           stroke={toolMode === 'delete_node' ? '#fff' : '#8b5cf6'}
           strokeWidth={2 / stageScale}
           draggable={['select', 'add_node'].includes(toolMode)}
           dragBoundFunc={(pos) => {
             if (isShiftDown) {
               const origX = layout.offsetX + (pt.pctX + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dx : 0)) * layout.drawW;
               const origY = layout.offsetY + (pt.pctY + (activeDragPolygon?.unitId === unit.id ? activeDragPolygon.dy : 0)) * layout.drawH;
               if (Math.abs(pos.x - origX) > Math.abs(pos.y - origY)) {
                 return { x: pos.x, y: origY };
               } else {
                 return { x: origX, y: pos.y };
               }
             }
             if (enableSnapping) {
               let pctX = (pos.x - layout.offsetX) / layout.drawW;
               let pctY = (pos.y - layout.offsetY) / layout.drawH;
               const snap = getSnappedCoordinate(pctX, pctY, vectorTree, aspect, layout.drawW, stageScale, snappingStrength || 15);
               if (snap.snapped) {
                 return {
                   x: layout.offsetX + snap.pctX * layout.drawW,
                   y: layout.offsetY + snap.pctY * layout.drawH
                 };
               }
             }
             return pos;
           }}
           onDragMove={(e) => {
             const node = e.target;
             let pctX = (node.x() - layout.offsetX) / layout.drawW;
             let pctY = (node.y() - layout.offsetY) / layout.drawH;
             let isSnapped = false;
             if (enableSnapping && !isShiftDown) {
               const snap = getSnappedCoordinate(pctX, pctY, vectorTree, aspect, layout.drawW, stageScale, snappingStrength || 15);
               isSnapped = snap.snapped;
             }
             setActiveDragNode({ unitId: unit.id, index: i, pctX, pctY, isSnapped });
           }}
           onDragEnd={(e) => {
             const node = e.target;
             let pctX = (node.x() - layout.offsetX) / layout.drawW;
             let pctY = (node.y() - layout.offsetY) / layout.drawH;
             const newPoints = [...basePolygon];
             newPoints[i] = { pctX, pctY };
             setOptimisticCoords(newPoints);

             setActiveDragNode(null);
             handleAnchorDragEnd(e, unit.id, i);
           }}
           onClick={(e) => handleAnchorClick(e, unit.id, i)}
           onTap={(e) => handleAnchorClick(e, unit.id, i)}
           onMouseEnter={() => setIsHoveringAnchor(true)}
           onMouseLeave={() => setIsHoveringAnchor(false)}
         />
      ))}
      
      {isSelected && activeDragNode?.unitId === unit.id && activeDragNode?.isSnapped && (
         <Circle
           x={layout.offsetX + activeDragNode.pctX * layout.drawW}
           y={layout.offsetY + activeDragNode.pctY * layout.drawH}
           radius={8 / stageScale}
           stroke="#ec4899"
           strokeWidth={2 / stageScale}
           fill="transparent"
           listening={false}
         />
      )}
    </React.Fragment>
  );
};

export default React.memo(MappedUnitComponent, (prevProps, nextProps) => {
  return (
    prevProps.isRouteDropTarget === nextProps.isRouteDropTarget &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isHovered === nextProps.isHovered &&
    prevProps.stageScale === nextProps.stageScale &&
    prevProps.toolMode === nextProps.toolMode &&
    prevProps.legendFilter === nextProps.legendFilter &&
    prevProps.activeDragNode?.unitId === nextProps.activeDragNode?.unitId &&
    (prevProps.activeDragNode?.unitId !== prevProps.unit.id ? true :
      prevProps.activeDragNode?.index === nextProps.activeDragNode?.index &&
      prevProps.activeDragNode?.pctX === nextProps.activeDragNode?.pctX &&
      prevProps.activeDragNode?.pctY === nextProps.activeDragNode?.pctY &&
      prevProps.activeDragNode?.isSnapped === nextProps.activeDragNode?.isSnapped) &&
    prevProps.activeDragPolygon?.unitId === nextProps.activeDragPolygon?.unitId &&
    (prevProps.activeDragPolygon?.unitId !== prevProps.unit.id ? true :
      prevProps.activeDragPolygon?.dx === nextProps.activeDragPolygon?.dx &&
      prevProps.activeDragPolygon?.dy === nextProps.activeDragPolygon?.dy) &&
    prevProps.layout.drawW === nextProps.layout.drawW &&
    prevProps.activeStatuses.find(s => s.unit_id === prevProps.unit.id)?.temporal_state === 
    nextProps.activeStatuses.find(s => s.unit_id === nextProps.unit.id)?.temporal_state &&
    prevProps.activeStatuses.find(s => s.unit_id === prevProps.unit.id)?.milestone === 
    nextProps.activeStatuses.find(s => s.unit_id === nextProps.unit.id)?.milestone
  );
});
