"use client";
import React, { useMemo, useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, History } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useProject, useUnits, useMilestones } from '@/hooks/useProjectQueries';
import { useParams } from 'next/navigation';

function UpdatingRing() {
  return (
    <svg className="h-7 w-7 shrink-0 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

const BottleneckIndicator = ({ outOfSequence }) => {
  if (!outOfSequence || outOfSequence.length === 0) return null;
  return (
    <div className="relative group/bottleneck flex items-center ml-1">
      <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-[pulse_2s_ease-in-out_infinite] shadow-[0_0_8px_rgba(239,68,68,0.6)] cursor-help ring-2 ring-red-500/20" />
      <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover/bottleneck:block w-56 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs rounded-xl p-3 shadow-2xl z-50 pointer-events-none before:content-[''] before:absolute before:-left-1 before:top-1/2 before:-translate-y-1/2 before:w-2 before:h-2 before:bg-slate-900 dark:before:bg-slate-100 before:rotate-45">
        <div className="font-bold text-red-500 dark:text-red-600 mb-1 flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          Sequence Blocked
        </div>
        <p className="opacity-80 mb-2 leading-tight text-slate-300 dark:text-slate-600">This baseline status is pending. Operations logged ahead in sequence:</p>
        <div className="flex flex-col gap-1.5 border-t border-white/10 dark:border-black/5 pt-2">
          {outOfSequence.map(seq => (
            <div key={seq.id} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: seq.status_color }} />
              <span className="truncate font-medium">{seq.milestone}</span>
              <span className="text-[9px] uppercase tracking-widest opacity-50 ml-auto pt-[1px]">{seq.temporal_state}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function FieldStatusTable({
  activeStatuses = [],
  savingUnitId,
  onChooseStatus,
  defaultView = 'table',
  onApplyPendingChanges,
}) {
  const activeSheetId = useMapStore(s => s.activeSheetId);
  const selectedUnitIds = useMapStore(s => s.selectedUnitIds);
  const toggleSelectedUnitId = useMapStore(s => s.toggleSelectedUnitId);
  const setSelectedUnitIds = useMapStore(s => s.setSelectedUnitIds);
  const trackingMode = useMapStore(s => s.trackingMode);
  const statusFilter = useSettingsStore(s => s.filterMilestone);
  const setHistoryModalUnitId = useUIStore(s => s.setHistoryModalUnitId);
  
  const [lastClickedIndex, setLastClickedIndex] = useState(null);
  const [sortColumn, setSortColumn] = useState('unit'); // 'unit', 'status', 'updated'
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc', 'desc'
  
  const params = useParams();
  const projectId = params?.projectId;
  
  const { data: project } = useProject(projectId);
  const { data: allMilestones = [] } = useMilestones(projectId);
  const { data: units = [] } = useUnits(activeSheetId);

  const [viewStyle, setViewStyle] = useState(defaultView);
  const [pendingChanges, setPendingChanges] = useState({});
  const [isApplying, setIsApplying] = useState(false);

  const handleLocalUpdate = (unit, baseLog, state, extraProps = {}) => {
    setPendingChanges(prev => {
      const existing = prev[unit.id] || { log: baseLog || {}, state: baseLog?.temporal_state || 'none', extraProps: {} };
      return {
        ...prev,
        [unit.id]: {
          unit,
          log: baseLog,
          state,
          extraProps: { ...existing.extraProps, ...extraProps }
        }
      };
    });
  };

  const handleApplyAll = async () => {
    const changesArray = Object.values(pendingChanges);
    if (changesArray.length === 0) return;
    setIsApplying(true);
    await onApplyPendingChanges?.(changesArray);
    setPendingChanges({});
    setIsApplying(false);
  };

  useEffect(() => {
    setViewStyle(defaultView);
  }, [defaultView]);

  const ranked = useMemo(() => {
    return [...units]
      .map((unit) => ({
        unit,
        log: activeStatuses.find((s) => s.unit_id === unit.id),
      }))
      .sort((a, b) => {
        let cmp = 0;
        if (sortColumn === 'unit') {
          cmp = a.unit.unit_number.localeCompare(b.unit.unit_number, undefined, { numeric: true, sensitivity: 'base' });
        } else if (sortColumn === 'status') {
          const ma = a.log?.milestone || '';
          const mb = b.log?.milestone || '';
          cmp = ma.localeCompare(mb);
          if (cmp === 0) {
            const sa = a.log?.temporal_state || '';
            const sb = b.log?.temporal_state || '';
            cmp = sa.localeCompare(sb);
          }
        } else if (sortColumn === 'updated') {
          const ta = a.log?.logged_date ? new Date(a.log.logged_date).getTime() : (a.log?.created_at ? new Date(a.log.created_at).getTime() : 0);
          const tb = b.log?.logged_date ? new Date(b.log.logged_date).getTime() : (b.log?.created_at ? new Date(b.log.created_at).getTime() : 0);
          cmp = ta - tb;
        }

        // If comparison is equal, fallback to natural sort on unit_number
        if (cmp === 0 && sortColumn !== 'unit') {
            cmp = a.unit.unit_number.localeCompare(b.unit.unit_number, undefined, { numeric: true, sensitivity: 'base' });
        }
        
        return sortDirection === 'asc' ? cmp : -cmp;
      });
  }, [units, activeStatuses, sortColumn, sortDirection]);

  const visible = useMemo(() => {
    if (!statusFilter) return ranked;
    return ranked.filter((row) => row.log?.milestone === statusFilter);
  }, [ranked, statusFilter]);

  if (!units || units.length === 0) {
    return (
      <div
        className="p-8 text-center text-slate-600 rounded-2xl border shadow-lg backdrop-blur-md"
        style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
      >
        No locations mapped on this level yet. Switch to Map view to draw locations.
      </div>
    );
  }

  const renderStatusTrigger = (unit, baseLog, large) => {
    const pending = pendingChanges[unit.id];
    const log = pending ? { ...baseLog, temporal_state: pending.state } : baseLog;
    const currentMilestone = pending?.extraProps?.milestoneObj?.name || log?.milestone || '';

    return (
      <div className="flex flex-col sm:flex-row gap-2 w-full">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChooseStatus?.(unit, (m) => handleLocalUpdate(unit, baseLog, pending?.state || log?.temporal_state || 'completed', { milestoneObj: m })); }}
          disabled={savingUnitId === unit.id || isApplying}
          className={`w-full sm:flex-1 text-left rounded-xl border ${pending?.extraProps?.milestoneObj ? 'border-amber-400 dark:border-amber-500 ring-2 ring-amber-500/20' : 'border-slate-200/80 dark:border-white/10'} bg-white/40 dark:bg-black/15 px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 shadow-sm transition hover:bg-white/70 dark:hover:bg-black/25 disabled:opacity-50 ${large ? 'py-3 text-base' : ''}`}
        >
          {currentMilestone || 'Choose status…'}
        </button>
        {currentMilestone && (
          <select
            value={log?.temporal_state || 'completed'}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              handleLocalUpdate(unit, baseLog, e.target.value);
            }}
            disabled={savingUnitId === unit.id || isApplying}
            className={`w-full sm:w-auto rounded-xl border ${pending?.state && pending.state !== baseLog?.temporal_state ? 'border-amber-400 dark:border-amber-500 ring-2 ring-amber-500/20' : 'border-slate-200/80 dark:border-white/10'} bg-white/60 dark:bg-black/25 px-2 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/40 ${large ? 'py-3 text-base' : ''}`}
          >
            <option value="none">No status (Choose status)</option>
            <option value="planned">Planned</option>
            <option value="ongoing">Ongoing</option>
            <option value="completed">Completed</option>
          </select>
        )}
      </div>
    );
  };

  const renderDatesInline = (unit, baseLog) => {
    if (!baseLog) return null;
    const pending = pendingChanges[unit.id];
    const log = pending ? { 
        ...baseLog, 
        planned_start_date: pending.extraProps.startDate !== undefined ? pending.extraProps.startDate : baseLog.planned_start_date,
        planned_end_date: pending.extraProps.endDate !== undefined ? pending.extraProps.endDate : baseLog.planned_end_date,
        logged_date: pending.extraProps.loggedDate !== undefined ? pending.extraProps.loggedDate : baseLog.logged_date,
        temporal_state: pending.state || baseLog.temporal_state
    } : baseLog;

    return (
      <div className="flex flex-row flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-200/50 dark:border-white/5">
        <label className="flex flex-col flex-1 min-w-[120px]">
          <span className="text-[10px] text-slate-500 font-semibold uppercase mb-0.5">Planned Start</span>
          <input 
            type="date"
            value={log.planned_start_date || ''}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handleLocalUpdate(unit, baseLog, pending?.state || log.temporal_state, { startDate: e.target.value, endDate: log.planned_end_date })}
            disabled={isApplying}
            className={`bg-transparent border ${pending?.extraProps?.startDate !== undefined ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200/80 dark:border-white/10'} rounded px-2 py-1 text-xs font-medium outline-none hover:bg-slate-50 dark:hover:bg-slate-800`}
          />
        </label>
        <label className="flex flex-col flex-1 min-w-[120px]">
          <span className="text-[10px] text-slate-500 font-semibold uppercase mb-0.5">Planned Finish</span>
          <input 
            type="date"
            value={log.planned_end_date || ''}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handleLocalUpdate(unit, baseLog, pending?.state || log.temporal_state, { startDate: log.planned_start_date, endDate: e.target.value })}
            disabled={isApplying}
            className={`bg-transparent border ${pending?.extraProps?.endDate !== undefined ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200/80 dark:border-white/10'} rounded px-2 py-1 text-xs font-medium outline-none hover:bg-slate-50 dark:hover:bg-slate-800`}
          />
        </label>
        {log.temporal_state === 'completed' && (
          <div className="flex flex-col flex-1 min-w-[120px]">
            <span className="text-[10px] text-slate-500 font-semibold uppercase mb-0.5">Actual Complete</span>
            <input 
              type="date"
              value={log.logged_date || ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => handleLocalUpdate(unit, baseLog, pending?.state || log.temporal_state, { startDate: log.planned_start_date, endDate: log.planned_end_date, loggedDate: e.target.value })}
              disabled={isApplying}
              className={`bg-transparent border ${pending?.extraProps?.loggedDate !== undefined ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200/80 dark:border-white/10'} rounded px-2 py-1 text-xs font-bold ${!pending?.extraProps?.loggedDate ? 'text-emerald-600 dark:text-emerald-400' : ''} outline-none hover:bg-slate-50 dark:hover:bg-slate-800`}
            />
          </div>
        )}
      </div>
    );
  };

  const handleRowClick = (e, unitId, index) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const idsToSelect = visible.slice(start, end + 1).map(r => r.unit.id);
      
      const newSelected = new Set(selectedUnitIds);
      idsToSelect.forEach(id => newSelected.add(id));
      setSelectedUnitIds(Array.from(newSelected));
    } else {
      toggleSelectedUnitId(unitId);
    }
    setLastClickedIndex(index);
  };

  const allVisibleSelected = visible.length > 0 && visible.every(r => selectedUnitIds.includes(r.unit.id));
  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedUnitIds(selectedUnitIds.filter(id => !visible.find(r => r.unit.id === id)));
    } else {
      const newSelected = new Set(selectedUnitIds);
      visible.forEach(r => newSelected.add(r.unit.id));
      setSelectedUnitIds(Array.from(newSelected));
    }
  };

  const handleSort = (col) => {
    if (sortColumn === col) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const renderSortIcon = (col) => {
    if (sortColumn !== col) return null;
    return sortDirection === 'asc' ? <ArrowUp size={14} className="inline-block ml-1" /> : <ArrowDown size={14} className="inline-block ml-1" />;
  };

  return (
    <div className="w-full pb-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex-1">
          {Object.keys(pendingChanges).length > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl px-4 py-2 shadow-sm animate-in fade-in zoom-in-95 duration-200">
              <span className="text-sm font-semibold text-amber-800 dark:text-amber-400">
                {Object.keys(pendingChanges).length} pending {Object.keys(pendingChanges).length === 1 ? 'change' : 'changes'}
              </span>
              <button
                onClick={handleApplyAll}
                disabled={isApplying}
                className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold ml-auto transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {isApplying ? <UpdatingRing /> : 'Apply Changes'}
              </button>
              <button
                onClick={() => setPendingChanges({})}
                disabled={isApplying}
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-xs font-semibold px-2 py-1.5 transition-colors"
               >
                Discard
              </button>
            </div>
          )}
        </div>
        <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm ml-4">
          <button
            type="button"
            onClick={() => setViewStyle('table')}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              viewStyle === 'table'
                ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => setViewStyle('card')}
            className={`px-3 py-1.5 text-xs font-semibold border-l border-slate-300/80 dark:border-white/10 transition-colors ${
              viewStyle === 'card'
                ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            Cards
          </button>
        </div>
      </div>

      {viewStyle === 'card' ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {visible.map(({ unit, log }, index) => {
              const currentMilestone = log?.milestone ?? '';
              const featured = index === 0 && log?.created_at;
              return (
                <div
                  key={unit.id}
                  onClick={(e) => handleRowClick(e, unit.id, index)}
                  className={`rounded-2xl border p-4 shadow-lg backdrop-blur-md flex flex-col gap-3 transition-transform cursor-pointer hover:border-blue-500/50 ${featured ? 'ring-2 ring-blue-400/40' : ''} ${selectedUnitIds.includes(unit.id) ? 'ring-2 ring-purple-500 bg-purple-50/50 dark:bg-purple-900/20' : ''}`}
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <input 
                        type="checkbox" 
                        checked={selectedUnitIds.includes(unit.id)} 
                        readOnly 
                        className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500" 
                      />
                      <div className={`font-bold text-slate-900 dark:text-slate-100 ${featured ? 'text-xl' : 'text-lg'}`}>
                        Location {unit.unit_number}
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
                  {renderStatusTrigger(unit, currentMilestone, log, featured)}
                  {renderDatesInline(unit, log)}
                </div>
              );
            })}
          </div>

          <div className="hidden md:grid md:grid-cols-4 md:gap-3">
            {visible.map(({ unit, log }, index) => {
              const currentMilestone = log?.milestone ?? '';
              const recent = log?.created_at && Date.now() - new Date(log.created_at).getTime() < 1000 * 60 * 60 * 24 * 30;
              const hero = index === 0;
              const wide = hero || (index === 1 && recent);

              let cellClass = 'md:col-span-1 md:min-h-[140px]';
              if (hero && visible.length > 1) cellClass = 'md:col-span-2 md:row-span-2 md:min-h-[280px]';
              else if (wide && !hero) cellClass = 'md:col-span-2 md:min-h-[140px]';

              return (
                <div
                  key={unit.id}
                  onClick={(e) => handleRowClick(e, unit.id, index)}
                  className={`rounded-2xl border p-4 shadow-lg backdrop-blur-md flex flex-col justify-between gap-3 transition hover:scale-[1.01] cursor-pointer hover:border-blue-500/50 ${cellClass} ${selectedUnitIds.includes(unit.id) ? 'ring-2 ring-purple-500 bg-purple-50/50 dark:bg-purple-900/20' : ''}`}
                  style={{
                    background: 'var(--glass-bg)',
                    borderColor: 'var(--glass-border)',
                    boxShadow: 'var(--glass-shadow)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <input 
                        type="checkbox" 
                        checked={selectedUnitIds.includes(unit.id)} 
                        readOnly 
                        className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500" 
                      />
                      <div className={`font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 ${hero ? 'text-2xl' : 'text-lg'}`}>
                        {unit.unit_number}
                        <BottleneckIndicator outOfSequence={log?.outOfSequence} />
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
                    {renderStatusTrigger(unit, currentMilestone, log, hero)}
                    {renderDatesInline(unit, log)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/40 dark:bg-black/15 shadow-sm backdrop-blur-md">
          <table className="w-full text-left border-collapse text-sm text-slate-800 dark:text-slate-200">
            <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-white/10">
              <tr>
                <th className="px-5 py-3 w-10">
                  <input 
                    type="checkbox" 
                    checked={allVisibleSelected} 
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer" 
                  />
                </th>
                <th 
                  onClick={() => handleSort('unit')}
                  className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 w-1/4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors"
                >
                  Location {renderSortIcon('unit')}
                </th>
                <th 
                  onClick={() => handleSort('status')}
                  className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 min-w-[200px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors"
                >
                  Milestone & Status {renderSortIcon('status')}
                </th>
                <th className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                  Planned Start
                </th>
                <th className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                  Planned Completion
                </th>
                <th 
                  onClick={() => handleSort('updated')}
                  className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 w-1/4 text-right cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors"
                >
                  <div className="flex justify-end items-center gap-1">
                    Actual Completed {renderSortIcon('updated')}
                  </div>
                </th>
                <th className="px-5 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ unit, log }, index) => (
                <tr key={unit.id} onClick={(e) => handleRowClick(e, unit.id, index)} className={`border-b border-slate-200/50 dark:border-white/5 last:border-none hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer ${selectedUnitIds.includes(unit.id) ? 'bg-purple-50/40 dark:bg-purple-900/10' : ''}`}>
                  <td className="px-5 py-3 align-middle text-center">
                    <input 
                      type="checkbox" 
                      checked={selectedUnitIds.includes(unit.id)} 
                      readOnly 
                      className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500" 
                    />
                  </td>
                  <td className="px-5 py-3 font-bold text-slate-900 dark:text-slate-100 align-middle">
                    <div className="flex items-center gap-2 relative">
                       {unit.unit_number}
                       <BottleneckIndicator outOfSequence={log?.outOfSequence} />
                       {savingUnitId === unit.id && <UpdatingRing />}
                    </div>
                  </td>
                  <td className="px-5 py-2 align-middle">
                    {(() => {
                      const pending = pendingChanges[unit.id];
                      const dLog = pending ? { ...log, temporal_state: pending.state } : log;
                      return renderStatusTrigger(unit, dLog, false);
                    })()}
                  </td>
                  <td className="px-5 py-2 align-middle">
                    {log ? (
                       <input 
                         type="date"
                         value={pendingChanges[unit.id]?.extraProps?.startDate !== undefined ? pendingChanges[unit.id].extraProps.startDate : (log?.planned_start_date || '')}
                         onChange={(e) => handleLocalUpdate(unit, log || {}, pendingChanges[unit.id]?.state || log.temporal_state || 'none', { startDate: e.target.value, endDate: log.planned_end_date })}
                         disabled={isApplying}
                         className={`bg-transparent border ${pendingChanges[unit.id]?.extraProps?.startDate !== undefined ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200/80 dark:border-white/10'} rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-50 dark:hover:bg-slate-800`}
                       />
                    ) : <span className="text-slate-400 text-xs italic">—</span>}
                  </td>
                  <td className="px-5 py-2 align-middle">
                    {log ? (
                       <input 
                         type="date"
                         value={pendingChanges[unit.id]?.extraProps?.endDate !== undefined ? pendingChanges[unit.id].extraProps.endDate : (log?.planned_end_date || '')}
                         onChange={(e) => handleLocalUpdate(unit, log || {}, pendingChanges[unit.id]?.state || log.temporal_state || 'none', { startDate: log.planned_start_date, endDate: e.target.value })}
                         disabled={isApplying}
                         className={`bg-transparent border ${pendingChanges[unit.id]?.extraProps?.endDate !== undefined ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200/80 dark:border-white/10'} rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-50 dark:hover:bg-slate-800`}
                       />
                    ) : <span className="text-slate-400 text-xs italic">—</span>}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500 dark:text-slate-400 text-right align-middle font-medium">
                    {(pendingChanges[unit.id]?.state || log?.temporal_state) === 'completed' ? (
                       <input 
                         type="date"
                         value={pendingChanges[unit.id]?.extraProps?.loggedDate !== undefined ? pendingChanges[unit.id].extraProps.loggedDate : (log?.logged_date || '')}
                         onClick={(e) => e.stopPropagation()}
                         onChange={(e) => handleLocalUpdate(unit, log || {}, pendingChanges[unit.id]?.state || log.temporal_state || 'none', { startDate: log.planned_start_date, endDate: log.planned_end_date, loggedDate: e.target.value })}
                         disabled={isApplying}
                         className={`bg-transparent border ${pendingChanges[unit.id]?.extraProps?.loggedDate !== undefined ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400' : 'border-slate-200/80 dark:border-white/10'} rounded px-2 py-1.5 text-xs font-medium w-[125px] outline-none hover:bg-slate-50 dark:hover:bg-slate-800 ${!pendingChanges[unit.id]?.extraProps?.loggedDate ? 'text-emerald-600 dark:text-emerald-400' : ''} transition`}
                       />
                    ) : <span className="text-slate-400 text-xs italic">—</span>}
                  </td>
                  <td className="px-5 py-3 align-middle text-right">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setHistoryModalUnitId(unit.id); }}
                      className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors cursor-pointer"
                      title="View History"
                    >
                      <History size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {statusFilter && visible.length === 0 && (
        <p className="mt-4 text-center text-sm text-slate-500">No locations match this milestone filter.</p>
      )}
    </div>
  );
}
