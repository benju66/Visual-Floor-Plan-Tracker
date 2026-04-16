import React from 'react';
import { Hand, MousePointer2, RotateCcw, Pointer, PlusCircle, MinusCircle, Copy, ZoomIn, ZoomOut, FlipHorizontal, FlipVertical, Pencil, Trash2, Stamp } from 'lucide-react';

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

export default function CanvasToolbar({
  toolMode,
  onToolModeChange,
  resetView,
  handleZoom,
  selectedUnitId,
  onRenameUnit,
  onDuplicateUnit,
  handleFlip,
  onDeleteUnit
}) {
  const dockClass = 'pointer-events-auto flex flex-col gap-1 p-2 rounded-2xl border shadow-xl backdrop-blur-md z-20';

  return (
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
  );
}
