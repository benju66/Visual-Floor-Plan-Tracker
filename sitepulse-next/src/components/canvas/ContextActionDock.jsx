import React from 'react';
import { Copy, FlipHorizontal, FlipVertical, Pencil, Trash2, Stamp, RotateCcw, RotateCw, Flag, Activity } from 'lucide-react';

const ActionButton = ({ icon: Icon, label, onClick, colorClass = "blue" }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all text-slate-600 hover:bg-white/40 dark:text-slate-300 dark:hover:bg-white/10`}
    >
      <Icon size={18} /> <span className="hidden lg:inline">{label}</span>
    </button>
  );
};

export default function ContextActionDock({
  selectedUnitId,
  toolMode,
  onToolModeChange,
  onRenameUnit,
  onDuplicateUnit,
  handleFlip,
  handleRotatePolygon,
  onDeleteUnit,
  onOpenMilestoneModal,
  onOpenStatusModal
}) {
  if (!selectedUnitId) return null;

  const dockClass = 'pointer-events-auto flex flex-col gap-1 p-2 rounded-2xl border shadow-xl backdrop-blur-md z-20';

  return (
    <div
      className={`${dockClass} absolute left-3 top-1/2 -translate-y-1/2`}
      style={{
        background: 'var(--glass-bg, rgba(255, 255, 255, 0.7))',
        borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
      }}
    >
      <ActionButton
        icon={Stamp}
        label="Stamp Trace"
        onClick={() => onToolModeChange?.('stamp')}
        colorClass="fuchsia"
      />
      <ActionButton 
        icon={Pencil} 
        label="Rename" 
        onClick={() => onRenameUnit?.(selectedUnitId)} 
        colorClass="purple" 
      />
      <ActionButton 
        icon={Copy} 
        label="Duplicate" 
        onClick={() => onDuplicateUnit?.(selectedUnitId)} 
        colorClass="purple" 
      />
      <ActionButton 
        icon={FlipHorizontal} 
        label="Flip H" 
        onClick={() => handleFlip?.('horizontal')} 
        colorClass="purple" 
      />
      <ActionButton 
        icon={FlipVertical} 
        label="Flip V" 
        onClick={() => handleFlip?.('vertical')} 
        colorClass="purple" 
      />
      <ActionButton
        icon={RotateCcw}
        label="Rotate Left"
        onClick={() => handleRotatePolygon?.('left')}
        colorClass="emerald"
      />
      <ActionButton
        icon={RotateCw}
        label="Rotate Right"
        onClick={() => handleRotatePolygon?.('right')}
        colorClass="emerald"
      />
      <ActionButton
        icon={Flag}
        label="Set Milestone"
        onClick={() => onOpenMilestoneModal?.(selectedUnitId)}
        colorClass="amber"
      />
      <ActionButton
        icon={Activity}
        label="Set Status"
        onClick={() => onOpenStatusModal?.(selectedUnitId)}
        colorClass="amber"
      />
      <div className="h-px bg-slate-200/80 dark:bg-white/10 mx-1 my-1" />
      <ActionButton 
        icon={Trash2} 
        label="Delete" 
        onClick={() => onDeleteUnit?.(selectedUnitId)} 
        colorClass="red" 
      />
    </div>
  );
}
