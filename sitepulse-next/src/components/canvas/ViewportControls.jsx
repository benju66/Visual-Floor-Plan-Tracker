import React from 'react';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';

export default function ViewportControls({ resetView, handleZoom }) {
  const dockClass = 'pointer-events-auto flex flex-col gap-1 p-2 rounded-2xl border shadow-xl backdrop-blur-md z-20';

  return (
    <div
      className={`${dockClass} absolute left-3 top-3`}
      style={{
        background: 'var(--glass-bg, rgba(255, 255, 255, 0.7))',
        borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
      }}
    >
      <button
        type="button"
        onClick={() => resetView?.()}
        className="p-2.5 text-slate-600 hover:text-slate-900 hover:bg-white/50 rounded-xl transition-colors flex items-center justify-center dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/10"
        title="Reset view"
      >
        <RotateCcw size={20} />
      </button>
      <div className="flex bg-white/30 dark:bg-black/20 rounded-xl overflow-hidden border border-slate-200/50 dark:border-white/10 mb-1 mt-0.5">
         <button type="button" onClick={() => handleZoom?.(-1)} className="flex-1 p-2 flex items-center justify-center text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-white/10 transition-colors" title="Zoom Out">
           <ZoomOut size={16} />
         </button>
         <div className="w-px bg-slate-200/80 dark:bg-white/10" />
         <button type="button" onClick={() => handleZoom?.(1)} className="flex-1 p-2 flex items-center justify-center text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-white/10 transition-colors" title="Zoom In">
           <ZoomIn size={16} />
         </button>
      </div>
    </div>
  );
}
