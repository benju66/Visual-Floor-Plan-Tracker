import React from 'react';
import { Copy, FlipHorizontal, FlipVertical, Pencil, Trash2, Stamp, RotateCcw, RotateCw, Flag, Activity, History, Check } from 'lucide-react';
import type { ToolMode } from '@/store/useMapStore';
import type { StampTransform } from '@/utils/stampTransform';

interface ActionButtonProps {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  colorClass?: string;
  /** Keyboard shortcut shown as a chip (used by the stamp transform controls). */
  hint?: string;
  /** Highlight the button when its toggle is currently applied (e.g. an active flip). */
  active?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({ icon: Icon, label, onClick, colorClass = "blue", hint, active }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint ? `${label} (${hint})` : label}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
        active
          ? 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300'
          : 'text-slate-600 hover:bg-white/40 dark:text-slate-300 dark:hover:bg-white/10'
      }`}
    >
      <Icon size={18} /> <span className="hidden lg:inline">{label}</span>
      {hint && (
        <kbd className="ml-auto hidden lg:inline-block rounded border border-slate-300/70 dark:border-white/20 bg-white/70 dark:bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
          {hint}
        </kbd>
      )}
    </button>
  );
};

export interface ContextActionDockProps {
  selectedUnitIds: string[] | null;
  toolMode: ToolMode;
  onToolModeChange?: (mode: ToolMode) => void;
  onRenameUnit?: (id: string | null) => void;
  onDuplicateUnit?: (id: string | null) => void;
  handleFlip?: (direction: 'horizontal' | 'vertical') => void;
  handleRotatePolygon?: (direction: 'left' | 'right') => void;
  // Stamp & Fast Markup — Phase 1: while stamping, the dock morphs into these live
  // transform controls (mirroring the R / Shift+R / H / V keys). Distinct from
  // handleFlip/handleRotatePolygon, which edit a SAVED unit — these steer the
  // transient stamp ghost being placed.
  stampTransform?: StampTransform;
  onRotateStamp?: (dir: 'left' | 'right') => void;
  onFlipStamp?: (axis: 'horizontal' | 'vertical') => void;
  // Phase 2: an armed drawer stamp has NO selected unit, but the rotate/flip controls
  // must still appear while placing it. When true, the stamp-transform panel shows in
  // stamp mode even with an empty selection.
  hasArmedStamp?: boolean;
  onDeleteUnit?: (ids: string | string[] | null) => void;
  onOpenActivityModal?: (id: string | null) => void;
  onOpenStatusModal?: (id: string | null) => void;
  onOpenHistoryModal?: (id: string | null) => void;
  isLegendSelected?: boolean;
  onRotateLegend?: (dir: 'left' | 'right') => void;
  onHideLegend?: () => void;
}

export default function ContextActionDock({
  selectedUnitIds,
  toolMode,
  onToolModeChange,
  onRenameUnit,
  onDuplicateUnit,
  handleFlip,
  handleRotatePolygon,
  stampTransform,
  onRotateStamp,
  onFlipStamp,
  hasArmedStamp,
  onDeleteUnit,
  onOpenActivityModal,
  onOpenStatusModal,
  onOpenHistoryModal,
  isLegendSelected,
  onRotateLegend,
  onHideLegend
}: ContextActionDockProps) {
  const stampArmedNoSelection = toolMode === 'stamp' && !!hasArmedStamp;
  if ((!selectedUnitIds || selectedUnitIds.length === 0) && !isLegendSelected && !stampArmedNoSelection) return null;

  const isMulti = selectedUnitIds && selectedUnitIds.length > 1;
  const isSingle = selectedUnitIds && selectedUnitIds.length === 1;
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

  // Stamp & Fast Markup — Phase 1: clicking "Stamp Trace" swaps this dock to the live
  // stamp transform controls — the same R / Shift+R / H / V keys, shown as chips and
  // doubling as buttons. Active flips are highlighted. "Done" returns to the normal dock.
  if (toolMode === 'stamp' && (isSingle || hasArmedStamp)) {
    return (
      <div
        className={`${dockClass} absolute left-3 top-1/2 -translate-y-1/2`}
        style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.7))',
          borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
        }}
      >
        <div className="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-fuchsia-500">
          Stamping — click to place
        </div>
        <ActionButton icon={RotateCw} label="Rotate Right" hint="R" onClick={() => onRotateStamp?.('right')} />
        <ActionButton icon={RotateCcw} label="Rotate Left" hint="⇧R" onClick={() => onRotateStamp?.('left')} />
        <ActionButton icon={FlipHorizontal} label="Flip H" hint="H" active={!!stampTransform?.flipX} onClick={() => onFlipStamp?.('horizontal')} />
        <ActionButton icon={FlipVertical} label="Flip V" hint="V" active={!!stampTransform?.flipY} onClick={() => onFlipStamp?.('vertical')} />
        <div className="h-px bg-slate-200/80 dark:bg-white/10 mx-1 my-1" />
        <ActionButton icon={Check} label="Done" onClick={() => onToolModeChange?.('select')} />
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
      {/* Status/edit actions render only when their handler is supplied. The live
          map passes every handler (unchanged behavior); the Location Labeling
          Workbench passes none of them, so a selected label exposes only geometry
          actions (flip/rotate) — never a status/activity/history control. */}
      {isSingle && (
        <>
          <ActionButton
            icon={Stamp}
            label="Stamp Trace"
            onClick={() => onToolModeChange?.('stamp')}
            colorClass="fuchsia"
          />
          {onRenameUnit && (
            <ActionButton
              icon={Pencil}
              label="Rename"
              onClick={() => onRenameUnit(targetId)}
              colorClass="purple"
            />
          )}
          {onDuplicateUnit && (
            <ActionButton
              icon={Copy}
              label="Duplicate"
              onClick={() => onDuplicateUnit(targetId)}
              colorClass="purple"
            />
          )}
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
          {onOpenActivityModal && (
            <ActionButton
              icon={Flag}
              label="Set Activity"
              onClick={() => onOpenActivityModal(targetId)}
              colorClass="amber"
            />
          )}
          {onOpenStatusModal && (
            <ActionButton
              icon={Activity}
              label="Set Status"
              onClick={() => onOpenStatusModal(targetId)}
              colorClass="amber"
            />
          )}
          {onOpenHistoryModal && (
            <ActionButton
              icon={History}
              label="History"
              onClick={() => onOpenHistoryModal(targetId)}
              colorClass="blue"
            />
          )}
        </>
      )}
      {onDeleteUnit && (
        <>
          <div className="h-px bg-slate-200/80 dark:bg-white/10 mx-1 my-1" />
          <ActionButton
            icon={Trash2}
            label={isMulti ? "Delete All" : "Delete"}
            onClick={() => onDeleteUnit(isMulti ? selectedUnitIds : targetId)}
            colorClass="red"
          />
        </>
      )}
    </div>
  );
}
