import React from 'react';
import { Undo2, Redo2, Hand, MousePointer2, PlusCircle, MinusCircle, Stamp, Pointer, List } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

export default function MapHorizontalToolbar({
  mapSettings,
  triggerUndo,
  triggerRedo,
  undoStack,
  redoStack,
  legendIsVisible,
  onToggleLegend
}) {
  const toolMode = useAppStore(s => s.toolMode);
  const onToolModeChange = useAppStore(s => s.setToolMode);
  if (!mapSettings?.showHorizontalToolbar) return null;

  const toolIcons = {
    undo: Undo2,
    redo: Redo2,
    pan: Hand,
    draw: MousePointer2,
    add_node: PlusCircle,
    delete_node: MinusCircle,
    stamp: Stamp,
    select: Pointer
  };

  const isUndoEmpty = !undoStack || undoStack.length === 0;
  const isRedoEmpty = !redoStack || redoStack.length === 0;

  const toolsToRender = mapSettings?.pinnedTools || ['select', 'pan', 'draw', 'add_node', 'delete_node'];

  return (
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

        const isActive = toolMode === toolId;
        return (
          <button
            key={`${toolId}-${idx}`}
            type="button"
            onClick={() => onToolModeChange?.(toolId)}
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
  );
}
