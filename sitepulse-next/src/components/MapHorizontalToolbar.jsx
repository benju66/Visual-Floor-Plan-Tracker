import React from 'react';
import { Undo2, Redo2, Hand, MousePointer2, PlusCircle, MinusCircle, Stamp, Pointer, List, Crosshair, ListChecks, Magnet, Loader2, Route, Footprints, Move, Plus, Minus } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';

export default function MapHorizontalToolbar({
  mapSettings,
  triggerUndo,
  triggerRedo,
  undoStack,
  redoStack,
  legendIsVisible,
  onToggleLegend,
  onUpdateMapSettings,
  isSnappingLoading
}) {
  const toolMode = useMapStore(s => s.toolMode);
  const onToolModeChange = useMapStore(s => s.setToolMode);
  const routeSubMode = useMapStore(s => s.routeSubMode);
  const setRouteSubMode = useMapStore(s => s.setRouteSubMode);
  if (!mapSettings?.showHorizontalToolbar) return null;

  const toolIcons = {
    undo: Undo2,
    redo: Redo2,
    pan: Hand,
    draw: MousePointer2,
    add_node: PlusCircle,
    delete_node: MinusCircle,
    stamp: Stamp,
    select: Pointer,
    multi_select: ListChecks,
    crosshair: Crosshair,
    route: Route
  };

  const isUndoEmpty = !undoStack || undoStack.length === 0;
  const isRedoEmpty = !redoStack || redoStack.length === 0;

  let toolsToRender = mapSettings?.pinnedTools || ['select', 'multi_select', 'pan', 'route', 'draw', 'add_node', 'delete_node'];
  if (!toolsToRender.includes('route')) {
    toolsToRender = [...toolsToRender];
    const panIdx = toolsToRender.indexOf('pan');
    if (panIdx !== -1) {
      toolsToRender.splice(panIdx + 1, 0, 'route');
    } else {
      toolsToRender.push('route');
    }
  }

  return (
    <>
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 rounded-full shadow-lg z-20 transition-all duration-200"
        style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.7))',
          borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
          borderWidth: '1px',
          backdropFilter: 'blur(12px)'
        }}
      >
      {toolsToRender.map((toolId, idx) => {
        const Icon = toolIcons[toolId];
        if (!Icon) return null;

        if (toolId === 'undo' || toolId === 'redo') {
          const isEmpty = toolId === 'undo' ? isUndoEmpty : isRedoEmpty;
          const handler = toolId === 'undo' ? triggerUndo : triggerRedo;

          return (
            <button
              key={`${toolId}-${idx}`}
              type="button"
              onClick={handler}
              disabled={isEmpty}
              className={`p-2 rounded-full flex items-center justify-center transition-all ${
                isEmpty 
                  ? 'opacity-40 cursor-not-allowed text-slate-400 dark:text-slate-500' 
                  : 'text-slate-700 hover:bg-slate-200/50 hover:text-slate-900 active:scale-95 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:hover:text-white'
              }`}
              title={toolId === 'undo' ? 'Undo' : 'Redo'}
            >
              <Icon size={18} />
            </button>
          );
        }

        if (toolId === 'crosshair') {
          return (
            <button
              key={`${toolId}-${idx}`}
              type="button"
              onClick={() => onUpdateMapSettings?.({ ...mapSettings, showCrosshair: !mapSettings?.showCrosshair })}
              className={`p-2 rounded-full flex items-center justify-center transition-all ${
                mapSettings?.showCrosshair 
                  ? 'bg-blue-500 text-white shadow-sm scale-110' 
                  : 'text-slate-700 hover:bg-slate-200/50 hover:text-slate-900 active:scale-95 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:hover:text-white'
              }`}
              title="Toggle Crosshairs"
            >
              <Icon size={18} />
            </button>
          );
        }

        if (toolId === 'route') {
          return (
            <button
              key={`${toolId}-${idx}`}
              type="button"
              onClick={() => onToolModeChange(toolMode === 'route' ? 'pan' : 'route')}
              className={`hidden md:flex p-2 rounded-full items-center justify-center transition-all ${
                toolMode === 'route'
                  ? 'bg-blue-500 text-white shadow-sm scale-110'
                  : 'text-slate-700 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:hover:text-white'
              }`}
              title="Draw Walking Route"
            >
              <Icon size={18} />
            </button>
          );
        }

        const isActive = toolMode === toolId;
        return (
          <button
            key={`${toolId}-${idx}`}
            type="button"
            onClick={() => onToolModeChange(isActive ? 'pan' : toolId)}
            className={`p-2 rounded-full flex items-center justify-center transition-all ${
              isActive 
                ? 'bg-blue-500 text-white shadow-sm scale-110' 
                : 'text-slate-700 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:hover:text-white'
            }`}
            title={toolId.charAt(0).toUpperCase() + toolId.slice(1).replace('_', ' ')}
          >
            <Icon size={18} />
          </button>
        );
      })}

      <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />

      {isSnappingLoading ? (
        <div className="p-2 rounded-full flex items-center justify-center text-blue-500 animate-spin" title="Building Smart Grid...">
          <Loader2 size={18} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onUpdateMapSettings?.({ ...mapSettings, enableSnapping: !mapSettings?.enableSnapping })}
          className={`p-2 rounded-full flex items-center justify-center transition-all ${
            mapSettings?.enableSnapping
              ? 'bg-blue-500 text-white shadow-sm scale-110'
              : 'text-slate-700 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:hover:text-white'
          }`}
          title={`${mapSettings?.enableSnapping ? 'Disable' : 'Enable'} Magnetic Snapping`}
        >
          <Magnet size={18} />
        </button>
      )}

      <button
        type="button"
        onClick={() => onUpdateMapSettings?.({ ...mapSettings, showWalkSequence: !mapSettings?.showWalkSequence })}
        className={`p-2 rounded-full flex items-center justify-center transition-all ${
          mapSettings?.showWalkSequence 
            ? 'bg-blue-500 text-white shadow-sm scale-110' 
            : 'text-slate-700 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:hover:text-white'
        }`}
        title={`${mapSettings?.showWalkSequence ? 'Hide' : 'Show'} Route Path`}
      >
        <Footprints size={18} />
      </button>

      <button
        type="button"
        onClick={onToggleLegend}
        className={`p-2 rounded-full flex items-center justify-center transition-all ${
          legendIsVisible 
            ? 'bg-emerald-500 text-white shadow-sm scale-110' 
            : 'text-slate-700 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:hover:text-white'
        }`}
        title={`${legendIsVisible ? 'Hide' : 'Show'} Legend`}
      >
        <List size={18} />
      </button>
    </div>

    {toolMode === 'route' && (
      <div 
        className="absolute top-16 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 rounded-full shadow-lg z-20 animate-in slide-in-from-top-2 fade-in duration-200"
        style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.7))',
          borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
          borderWidth: '1px',
          backdropFilter: 'blur(12px)'
        }}
      >
        <button
          type="button"
          onClick={() => setRouteSubMode('move')}
          className={`p-2 rounded-full flex items-center gap-1.5 px-3 transition-all text-sm font-bold ${
            routeSubMode === 'move' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Move size={16} /> Move
        </button>
        <div className="w-px h-4 bg-slate-300 dark:bg-slate-600" />
        <button
          type="button"
          onClick={() => setRouteSubMode('add')}
          className={`p-2 rounded-full flex items-center gap-1.5 px-3 transition-all text-sm font-bold ${
            routeSubMode === 'add' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Plus size={16} /> Add Node
        </button>
        <button
          type="button"
          onClick={() => setRouteSubMode('remove')}
          className={`p-2 rounded-full flex items-center gap-1.5 px-3 transition-all text-sm font-bold ${
            routeSubMode === 'remove' ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
          }`}
        >
          <Minus size={16} /> Remove
        </button>
      </div>
    )}
    </>
  );
}
