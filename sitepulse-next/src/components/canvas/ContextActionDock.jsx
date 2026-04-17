import React from 'react';
import { Copy, FlipHorizontal, FlipVertical, Pencil, Trash2, Stamp, RotateCcw, RotateCw, Flag, Activity, History } from 'lucide-react';

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
  selectedUnitIds,
  toolMode,
  onToolModeChange,
  onRenameUnit,
  onDuplicateUnit,
  handleFlip,
  handleRotatePolygon,
  onDeleteUnit,
  onOpenMilestoneModal,
  onOpenStatusModal,
  onOpenHistoryModal,
  isLegendSelected,
  onRotateLegend,
  onHideLegend
}) {
  if ((!selectedUnitIds || selectedUnitIds.length === 0) && !isLegendSelected) return null;

  const isMulti = selectedUnitIds?.length > 1;
  const isSingle = selectedUnitIds?.length === 1;
  const targetId = isSingle ? selectedUnitIds[0] : null;

  const dockClass = 'pointer-events-auto flex flex-col gap-1 p-2 rounded-2xl border shadow-xl backdrop-blur-md z-20';

  if (isLegendSelected) {
    return (
      <div
        className={`${dockClass} absolute left-3 top-1/2 -translate-y-1/2`}
        style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.7))',
          borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
        }}
      >
        <ActionButton
          icon={RotateCcw}
          label="Rotate Left"
          onClick={() => onRotateLegend?.('left')}
          colorClass="emerald"
        />
        <ActionButton
          icon={RotateCw}
          label="Rotate Right"
          onClick={() => onRotateLegend?.('right')}
          colorClass="emerald"
        />
        <div className="h-px bg-slate-200/80 dark:bg-white/10 mx-1 my-1" />
        <ActionButton 
          icon={Trash2} 
          label="Delete" 
          onClick={onHideLegend} 
          colorClass="red" 
        />
      </div>
    );
  }

  return (
    <div
      className={`${dockClass} absolute left-3 top-1/2 -translate-y-1/2`}
      style={{
        background: 'var(--glass-bg, rgba(255, 255, 255, 0.7))',
        borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
      }}
    >
      {isSingle && (
        <>
          <ActionButton
            icon={Stamp}
            label="Stamp Trace"
            onClick={() => onToolModeChange?.('stamp')}
            colorClass="fuchsia"
          />
          <ActionButton 
            icon={Pencil} 
            label="Rename" 
            onClick={() => onRenameUnit?.(targetId)} 
            colorClass="purple" 
          />
          <ActionButton 
            icon={Copy} 
            label="Duplicate" 
            onClick={() => onDuplicateUnit?.(targetId)} 
            colorClass="purple" 
          />
        </>
      )}
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
      {isSingle && (
        <>
          <ActionButton
            icon={Flag}
            label="Set Milestone"
            onClick={() => onOpenMilestoneModal?.(targetId)}
            colorClass="amber"
          />
          <ActionButton
            icon={Activity}
            label="Set Status"
            onClick={() => onOpenStatusModal?.(targetId)}
            colorClass="amber"
          />
          <ActionButton
            icon={History}
            label="History"
            onClick={() => onOpenHistoryModal?.(targetId)}
            colorClass="blue"
          />
        </>
      )}
      <div className="h-px bg-slate-200/80 dark:bg-white/10 mx-1 my-1" />
      <ActionButton 
        icon={Trash2} 
        label={isMulti ? "Delete All" : "Delete"} 
        onClick={() => onDeleteUnit?.(isMulti ? selectedUnitIds : targetId)} 
        colorClass="red" 
      />
    </div>
  );
}
