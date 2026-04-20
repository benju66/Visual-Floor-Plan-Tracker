import React from 'react';
import { X, Clock, HelpCircle } from 'lucide-react';
import { useUnitHistory } from '@/hooks/useProjectQueries';

export default function UnitHistoryModal({ isOpen, onClose, unitId, unitNumber }) {
  const { data: logs, isPending } = useUnitHistory(unitId);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div 
        className="w-full max-w-md flex flex-col max-h-[85vh] rounded-2xl border shadow-2xl relative"
        style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.9))',
          borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.8))',
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200/50 dark:border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
              <Clock size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">Status History</h2>
              <p className="text-xs text-slate-500 font-medium">Location {unitNumber}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50 dark:bg-slate-900/20">
          {isPending ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500">
              <svg className="h-8 w-8 animate-spin text-blue-600 mb-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span>Loading history...</span>
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500">
              <HelpCircle size={32} className="opacity-50 mb-3" />
              <p>No activity recorded for this location yet.</p>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Milestone</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Status</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 text-right">Date Logged</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {logs.map((log) => {
                    const date = new Date(log.created_at);
                    const isCompleted = log.temporal_state === 'completed';
                    const isOngoing = log.temporal_state === 'ongoing';
                    return (
                      <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-4 py-3 font-medium flex items-center gap-2 text-slate-800 dark:text-slate-200">
                          <span className="w-3 h-3 rounded-full shadow-sm shrink-0" style={{ backgroundColor: log.status_color || '#cbd5e1' }} />
                          {log.milestone || 'Unknown'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider
                            ${isCompleted ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 
                              isOngoing ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 
                              'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}
                          >
                            {log.temporal_state}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400 font-medium">
                          {date.toLocaleDateString()} <span className="text-xs ml-1 opacity-60">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
