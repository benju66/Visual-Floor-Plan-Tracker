"use client";
import React, { useState } from 'react';
import { History } from 'lucide-react';
import { BottleneckIndicator, UpdatingRing } from '@/components/ui/FieldStatusAtoms';
import StatusTrigger from '@/components/ui/StatusTrigger';
import DatesInline from '@/components/ui/DatesInline';

/**
 * DesktopCardGrid — desktop card grid presenter (viewStyle === 'card', isDesktop).
 *
 * Owns: lastClickedIndex (Shift+Click multi-select context).
 *
 * Props:
 *   visible            — { unit, log }[] from useFieldData
 *   pendingChanges     — object from useFieldData
 *   handleLocalUpdate  — fn from useFieldData
 *   savingUnitId       — string | null from page
 *   isApplying         — boolean from useFieldData
 *   selectedUnitIds    — string[] from useMapStore (via container)
 *   toggleSelectedUnitId — fn from useMapStore (via container)
 *   setSelectedUnitIds — fn from useMapStore (via container)
 *   setHistoryModalUnitId — fn from useUIStore (via container)
 *   onChooseStatus     — fn from page
 */
export default function DesktopCardGrid({
  visible,
  pendingChanges,
  handleLocalUpdate,
  savingUnitId,
  isApplying,
  selectedUnitIds,
  toggleSelectedUnitId,
  setSelectedUnitIds,
  setHistoryModalUnitId,
  onChooseStatus,
}) {
  const [lastClickedIndex, setLastClickedIndex] = useState(null);

  const handleRowClick = (e, unitId, index) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const idsToSelect = visible.slice(start, end + 1).map((r) => r.unit.id);
      const newSelected = new Set(selectedUnitIds);
      idsToSelect.forEach((id) => newSelected.add(id));
      setSelectedUnitIds(Array.from(newSelected));
    } else {
      toggleSelectedUnitId(unitId);
    }
    setLastClickedIndex(index);
  };

  return (
    <div className="grid grid-cols-4 gap-3 mt-4">
      {visible.map(({ unit, log }, index) => {
        const recent =
          log?.created_at && Date.now() - new Date(log.created_at).getTime() < 1000 * 60 * 60 * 24 * 30;
        const hero = index === 0;
        const wide = hero || (index === 1 && recent);

        let cellClass = 'col-span-1 min-h-[140px]';
        if (hero && visible.length > 1) cellClass = 'col-span-2 row-span-2 min-h-[280px]';
        else if (wide && !hero) cellClass = 'col-span-2 min-h-[140px]';

        return (
          <div
            key={unit.id}
            onClick={(e) => handleRowClick(e, unit.id, index)}
            className={`rounded-2xl border p-4 shadow-lg backdrop-blur-md flex flex-col justify-between gap-3 transition hover:scale-[1.01] cursor-pointer hover:border-blue-500/50 ${cellClass} ${
              selectedUnitIds.includes(unit.id) ? 'ring-2 ring-purple-500 bg-purple-50/50 dark:bg-purple-900/20' : ''
            }`}
            style={{
              background: 'var(--glass-bg)',
              borderColor: 'var(--glass-border)',
              boxShadow: 'var(--glass-shadow)',
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedUnitIds.includes(unit.id)}
                  readOnly
                  className="w-4 h-4 mt-1.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">
                    {unit.unit_type || 'Unknown'}
                  </span>
                  <div className={`font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 ${hero ? 'text-2xl' : 'text-lg'}`}>
                    {unit.unit_number}
                    <BottleneckIndicator outOfSequence={log?.outOfSequence} />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setHistoryModalUnitId(unit.id); }}
                  className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors cursor-pointer"
                  title="View History"
                >
                  <History size={18} />
                </button>
                {savingUnitId === unit.id && <UpdatingRing />}
              </div>
            </div>

            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Current status</p>
            <div className="flex-1">
              {/* Bug fix: pass log directly (not currentMilestone string) — resolves the original 4-arg call defect */}
              <StatusTrigger
                unit={unit}
                baseLog={log}
                pendingChange={pendingChanges[unit.id]}
                onChooseStatus={onChooseStatus}
                onLocalUpdate={handleLocalUpdate}
                isApplying={isApplying}
                savingUnitId={savingUnitId}
                large={hero}
              />
              <DatesInline
                unit={unit}
                baseLog={log}
                pendingChange={pendingChanges[unit.id]}
                onLocalUpdate={handleLocalUpdate}
                isApplying={isApplying}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
