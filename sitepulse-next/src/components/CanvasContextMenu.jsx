import React from 'react';
import { Pencil, Copy, FlipHorizontal, FlipVertical, Trash2, RotateCcw, RotateCw, Flag, Activity } from 'lucide-react';

export default function CanvasContextMenu({
  contextMenu,
  setContextMenu,
  dimensions,
  onRenameUnit,
  onDuplicateUnit,
  handleFlip,
  handleRotatePolygon,
  onDeleteUnit,
  onOpenMilestoneModal,
  onOpenStatusModal
}) {
  if (!contextMenu) return null;

  return (
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
      <button type="button" onClick={() => { handleRotatePolygon?.('left', contextMenu.unitId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors text-left">
        <RotateCcw size={16} className="text-emerald-500" /> Rotate 90° Left
      </button>
      <button type="button" onClick={() => { handleRotatePolygon?.('right', contextMenu.unitId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors text-left">
        <RotateCw size={16} className="text-emerald-500" /> Rotate 90° Right
      </button>
      <button type="button" onClick={() => { onOpenMilestoneModal?.(contextMenu.unitId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors text-left">
        <Flag size={16} className="text-amber-500" /> Change Milestone
      </button>
      <button type="button" onClick={() => { onOpenStatusModal?.(contextMenu.unitId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors text-left">
        <Activity size={16} className="text-amber-500" /> Change Status
      </button>
      <div className="h-px bg-slate-200/50 dark:bg-slate-700/50 mx-1 my-1" />
      <button type="button" onClick={() => { onDeleteUnit?.(contextMenu.unitId); setContextMenu(null); }} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 text-sm font-bold text-red-600 transition-colors text-left">
        <Trash2 size={16} className="text-red-500" /> Delete Location
      </button>
    </div>
  );
}
