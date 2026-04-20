import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';

export default function BulkActionDock({
  selectedUnitIds,
  onClearSelection,
  milestones,
  currentStatuses,
  onApplyBulkStatus,
  isPending
}) {
  const [selectedMilestone, setSelectedMilestone] = useState('__KEEP_EXISTING__');
  const [selectedState, setSelectedState] = useState('__KEEP_EXISTING__');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const trackingMode = useMapStore(s => s.trackingMode);

  if (!selectedUnitIds || selectedUnitIds.length < 2) return null;

  const handleApply = () => {
    if (selectedMilestone === '__KEEP_EXISTING__' && selectedState === '__KEEP_EXISTING__') return;
    
    // Support "Clear all statuses" which wipes the records
    let targetMilestone = selectedMilestone;
    let targetColor = null;
    
    if (selectedMilestone === '__CLEAR__') {
      targetMilestone = null;
    } else if (selectedMilestone !== '__KEEP_EXISTING__') {
      const m = milestones.find(m => m.name === selectedMilestone);
      targetMilestone = m?.name || null;
      targetColor = m?.color || null;
    }
    
    onApplyBulkStatus({
      unitIds: selectedUnitIds,
      milestone: targetMilestone,
      color: targetColor,
      temporal_state: selectedState,
      track: trackingMode,
      planned_start_date: startDate || null,
      planned_end_date: endDate || null
    });
    
    // Clear selection after a successful application
    setSelectedMilestone('__KEEP_EXISTING__');
    setSelectedState('__KEEP_EXISTING__');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 p-3 pr-2 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border z-50 pointer-events-auto animate-in slide-in-from-bottom-8 fade-in fade-out-0 duration-200"
      style={{
        background: 'var(--glass-bg, rgba(255, 255, 255, 0.9))',
        borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.8))',
        backdropFilter: 'blur(16px)'
      }}
    >
      <div className="flex items-center gap-2 px-2 border-r border-slate-200 dark:border-slate-700">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 text-xs font-bold">
          {selectedUnitIds.length}
        </div>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 mr-2">Selected</span>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={selectedMilestone}
          onChange={(e) => {
            setSelectedMilestone(e.target.value);
            if (e.target.value !== '__KEEP_EXISTING__' && e.target.value !== '__CLEAR__' && selectedState === '__KEEP_EXISTING__') {
              setSelectedState('completed');
            }
          }}
          disabled={isPending}
          className="bg-white/50 dark:bg-black/20 border border-slate-300/80 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-800 dark:text-slate-100 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/40 min-w-[140px]"
        >
          <option value="__KEEP_EXISTING__">Keep Existing Milestones</option>
          <option value="__CLEAR__">Clear Status (Remove)</option>
          <optgroup label={`${trackingMode === 'production' ? 'Production' : 'Inspection'} Milestones`}>
            {milestones.filter(m => m.track === trackingMode).map(m => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </optgroup>
        </select>
        
        <select
          value={selectedState}
          onChange={(e) => setSelectedState(e.target.value)}
          disabled={isPending || selectedMilestone === '__CLEAR__'}
          className={`bg-white/50 dark:bg-black/20 border border-slate-300/80 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-800 dark:text-slate-100 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/40 ${selectedMilestone === '__CLEAR__' ? 'opacity-50' : ''}`}
        >
          <option value="__KEEP_EXISTING__">No Change</option>
          <option value="planned">Planned</option>
          <option value="ongoing">Ongoing</option>
          <option value="completed">Completed</option>
        </select>
        
        <div className="flex flex-col ml-2 gap-1 text-xs">
           <div className="flex items-center gap-1">
             <span className="text-slate-500 font-semibold w-8">Start:</span>
             <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} disabled={isPending || selectedMilestone === '__CLEAR__'} className="bg-white/50 dark:bg-black/20 border border-slate-300 dark:border-slate-600 rounded px-1 min-w-[100px] outline-none" />
           </div>
           <div className="flex items-center gap-1">
             <span className="text-slate-500 font-semibold w-8">End:</span>
             <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={isPending || selectedMilestone === '__CLEAR__'} className="bg-white/50 dark:bg-black/20 border border-slate-300 dark:border-slate-600 rounded px-1 min-w-[100px] outline-none" />
           </div>
        </div>
      </div>

      <div className="flex items-center gap-1 pl-1">
        <button
          type="button"
          onClick={handleApply}
          disabled={isPending || (selectedMilestone === '__KEEP_EXISTING__' && selectedState === '__KEEP_EXISTING__')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
        >
          {isPending ? (
            <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <Check size={16} />
          )}
          Apply
        </button>
        <button
          type="button"
          onClick={onClearSelection}
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-800 rounded-lg ml-1 transition"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
