import React from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useUnits } from '@/hooks/useProjectQueries';
import { useRef, useEffect } from 'react';

function MapSidebar({
  milestones = [], filterMilestone, setFilterMilestone,
  temporalFilters, setTemporalFilters,
  activeSheet,
  onRenameUnitInitiate, onDeleteUnit
}) {
  const activeSheetId = useAppStore(s => s.activeSheetId);
  const trackingMode = useAppStore(s => s.trackingMode);
  const selectedUnitIds = useAppStore(s => s.selectedUnitIds);
  const setToolMode = useAppStore(s => s.setToolMode);
  const setSelectedUnitIds = useAppStore(s => s.setSelectedUnitIds);
  
  const { data: units = [] } = useUnits(activeSheetId);
  
  const listRefs = useRef({});

  useEffect(() => {
    if (selectedUnitIds?.length === 1 && listRefs.current[selectedUnitIds[0]]) {
      listRefs.current[selectedUnitIds[0]].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedUnitIds]);
  return (
    <div
      className="w-full lg:w-[320px] p-4 rounded-xl border flex flex-col min-h-0 flex-shrink-0 glass-panel"
    >
      <h3 className="font-bold text-lg mb-3 border-b border-slate-200/60 dark:border-white/10 pb-2 flex-shrink-0 text-slate-800 dark:text-slate-100">
        Live legend
      </h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
        Click a milestone to highlight matching locations on the map. “All” clears the filter.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-4 max-h-[120px] overflow-y-auto pr-1">
        <button
          type="button"
          onClick={() => setFilterMilestone(null)}
          className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
            !filterMilestone
              ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900 border-transparent'
              : 'bg-white/50 dark:bg-black/20 border-slate-200/80 dark:border-white/10'
          }`}
        >
          All
        </button>
        {milestones.filter(m => m.track === trackingMode).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setFilterMilestone((prev) => (prev === m.name ? null : m.name))}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium border max-w-[140px] truncate transition ${
              filterMilestone === m.name
                ? 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900'
                : ''
            }`}
            style={{
              background: m.color,
              borderColor: 'var(--glass-border)',
            }}
            title={m.name}
          >
            {m.name.length > 22 ? `${m.name.slice(0, 20)}…` : m.name}
          </button>
        ))}
      </div>

      <h4 className="font-bold text-sm mb-2 text-slate-800 dark:text-slate-100 border-b border-slate-200/60 dark:border-white/10 pb-2">
        Progress Status Toggles
      </h4>
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { value: 'none', label: 'No Status' },
          { value: 'planned', label: 'Planned' },
          { value: 'ongoing', label: 'Ongoing' },
          { value: 'completed', label: 'Completed' }
        ].map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTemporalFilters((prev) => 
                prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
              );
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
              temporalFilters.includes(value)
                ? 'bg-blue-600/90 text-white border-blue-600'
                : 'bg-white/50 dark:bg-black/20 text-slate-500 border-slate-300 dark:border-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <h4 className="font-bold text-sm mb-2 text-slate-800 dark:text-slate-100 border-b border-slate-200/60 dark:border-white/10 pb-2">
        Mapped locations
      </h4>

      <div className="overflow-y-auto flex-1 pr-2">
        {units.length === 0 ? (
          <p className="text-slate-500 text-sm italic">
            No locations mapped on this level yet. Use Draw on the map dock to begin.
          </p>
        ) : (
          <div className="border border-slate-200/60 dark:border-white/10 rounded-lg overflow-hidden shadow-sm flex flex-col">
            <div className="bg-slate-800/95 dark:bg-white/10 text-white dark:text-slate-100 p-3 font-semibold text-sm flex items-center gap-2 backdrop-blur-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              </svg>
              {activeSheet?.sheet_name || 'Level'}
            </div>

            <ul className="flex flex-col bg-white/40 dark:bg-black/15">
              {units.map((unit, index) => (
                <li
                  key={unit.id}
                  ref={(el) => listRefs.current[unit.id] = el}
                  onClick={() => {
                    setToolMode('select');
                    setSelectedUnitIds([unit.id]);
                  }}
                  className={`cursor-pointer relative pl-10 pr-3 py-3 border-b border-slate-100/80 dark:border-white/5 last:border-0 hover:bg-white/50 dark:hover:bg-white/5 flex justify-between items-center group transition-colors ${
                    selectedUnitIds?.includes(unit.id) ? 'bg-purple-100/50 dark:bg-purple-900/30' : ''
                  }`}
                >
                  <div
                    className={`absolute left-4 top-0 w-px bg-slate-300/80 dark:bg-white/20 ${
                      index === units.length - 1 ? 'h-1/2' : 'h-full'
                    }`}
                  />
                  <div className="absolute left-4 top-1/2 w-4 h-px bg-slate-300/80 dark:bg-white/20" />

                  <span className={`text-sm ${selectedUnitIds?.includes(unit.id) ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-200'}`}>
                    Location: {unit.unit_number}
                  </span>
                  <div className="flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRenameUnitInitiate(unit.id);
                      }}
                      className="text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 p-1.5 border border-slate-200/80 dark:border-slate-700/50 rounded-lg hover:bg-sky-50 dark:hover:bg-sky-900/30 transition-colors bg-white/50 dark:bg-black/20"
                      title="Rename Location"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteUnit(unit.id);
                      }}
                      className="text-red-500 hover:text-red-700 dark:hover:text-red-400 p-1.5 border border-red-200/80 dark:border-red-900/50 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors bg-white/50 dark:bg-black/20"
                      title="Delete Location"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default MapSidebar;
