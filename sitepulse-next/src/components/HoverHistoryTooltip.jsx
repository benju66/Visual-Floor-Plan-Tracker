import React, { useState, useEffect, useRef } from 'react';
import { computeUnitVariance, varianceFill, varianceLabel } from '@/utils/progressAnalytics';

export default function HoverHistoryTooltip({
  hoveredUnit,
  pointerPos,
  units,
  rawStatuses,
  trackingMode,
  milestones,
  dimensions,
  toolMode,
  contextMenu
}) {
  const [activeUnit, setActiveUnit] = useState(null);
  const [activePos, setActivePos] = useState(null);
  const timeoutRef = useRef(null);
  const isHoveredRef = useRef(false);
  const anchoredUnitRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    // Hide tooltip if interacting with context menus or map editing modes
    if (contextMenu || ['draw', 'add_node', 'route'].includes(toolMode)) {
      setActiveUnit(null);
      anchoredUnitRef.current = null;
      return;
    }

    if (hoveredUnit) {
      clearTimeout(timeoutRef.current);
      setActiveUnit(hoveredUnit);
    } else {
      // Small debounce to keep tooltip alive while cursor transitions
      timeoutRef.current = setTimeout(() => {
        if (!isHoveredRef.current) {
          setActiveUnit(null);
          anchoredUnitRef.current = null;
        }
      }, 150);
    }
    
    return () => clearTimeout(timeoutRef.current);
  }, [hoveredUnit, contextMenu, toolMode]);

  // Update position ONLY ONCE per hovered unit to prevent the "runaway tooltip" bug
  // and eliminate 60FPS React state re-renders for a massive performance win.
  useEffect(() => {
     if (hoveredUnit && pointerPos && anchoredUnitRef.current !== hoveredUnit) {
        setActivePos(pointerPos);
        anchoredUnitRef.current = hoveredUnit;
     }
  }, [pointerPos, hoveredUnit]);

  // Native DOM event listener for bulletproof scroll isolation
  // React's synthetic onWheel e.stopPropagation() does not prevent native bubbling to Konva
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleNativeWheel = (e) => {
      e.stopPropagation();
    };
    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, [activeUnit, activePos]);

  if (!activeUnit || !activePos) return null;

  const u = units.find(x => x.id === activeUnit);
  const unitRawLogs = rawStatuses?.filter(s => s.unit_id === activeUnit && s.track === trackingMode) || [];
  const variance = computeUnitVariance(unitRawLogs, milestones, new Date());

  // Base positioning
  let top = activePos.y + 20;
  let left = activePos.x + 20;

  // Boundary clamping to prevent viewport overflow
  if (dimensions) {
    if (top + 300 > dimensions.height) {
      top = Math.max(10, dimensions.height - 320); // Push it up
    }
    if (left + 300 > dimensions.width) {
      left = activePos.x - 320; // Flip to the left side
    }
  }

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => {
        isHoveredRef.current = true;
        clearTimeout(timeoutRef.current);
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
        timeoutRef.current = setTimeout(() => {
          setActiveUnit(null);
          anchoredUnitRef.current = null;
        }, 150);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute z-40 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 px-4 py-3 rounded-xl text-sm shadow-2xl transition-opacity animate-in fade-in duration-150 border border-slate-700 dark:border-white/20 min-w-[240px] max-w-[300px] cursor-default"
      style={{
        left,
        top,
        pointerEvents: 'auto'
      }}
    >
      <div className="font-bold text-base mb-2 border-b border-slate-700/50 dark:border-black/10 pb-2 flex justify-between items-center">
         <span>{u?.unit_number || 'Unknown Location'}</span>
         <span className="text-[9px] uppercase tracking-widest opacity-50 font-bold bg-white/10 dark:bg-black/10 px-1.5 py-0.5 rounded">
           {u?.unit_type || 'Space'}
         </span>
      </div>

      {/* Schedule variance — the unit's lag verdict at a glance */}
      <div className="flex items-center gap-2 mb-2 text-xs font-semibold">
        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: varianceFill(variance) }} />
        <span>{varianceLabel(variance)}</span>
        {variance.bottleneck && (
          <span className="opacity-50 font-normal truncate">· {variance.bottleneck}</span>
        )}
      </div>

      <div className="flex flex-col gap-2.5 max-h-[250px] overflow-y-auto overscroll-contain pr-2 custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
        {milestones.length === 0 ? (
           <div className="text-xs italic opacity-50">No milestones configured for this track.</div>
        ) : (
           milestones.map(m => {
              const log = unitRawLogs.find(s => s.milestone === m.name);
              const state = log ? log.temporal_state : 'none';
              
              let stateColor = 'text-slate-400';
              if (state === 'completed') stateColor = 'text-emerald-400 dark:text-emerald-600';
              if (state === 'ongoing') stateColor = 'text-amber-400 dark:text-amber-600';
              if (state === 'planned') stateColor = 'text-blue-400 dark:text-blue-600';
              
              return (
                 <div key={m.id} className={`flex items-center justify-between gap-4 text-xs ${state === 'none' ? 'opacity-40' : 'opacity-100'}`}>
                   <div className="flex items-center gap-2 truncate">
                     <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                     <span className="truncate font-medium">{m.name}</span>
                   </div>
                   <span className={`text-[9px] uppercase tracking-widest font-bold shrink-0 ${stateColor}`}>
                     {state === 'none' ? 'Not Started' : state}
                   </span>
                 </div>
              )
           })
        )}
      </div>
    </div>
  );
}
