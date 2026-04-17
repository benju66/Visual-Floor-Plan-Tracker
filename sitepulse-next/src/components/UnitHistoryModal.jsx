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

        <div className="p-6 overflow-y-auto flex-1">
          {isPending ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500">
              <svg className="h-8 w-8 animate-spin text-blue-600 mb-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path
                  className="opacity-90"
                  d="M12 2a10 10 0 0 1 10 10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              <span>Loading history...</span>
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500">
              <HelpCircle size={32} className="opacity-50 mb-3" />
              <p>No activity recorded for this location yet.</p>
            </div>
          ) : (
            <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 dark:before:via-slate-700 before:to-transparent">
              {logs.map((log, i) => {
                const date = new Date(log.created_at);
                const isRecent = i === 0 && (Date.now() - date.getTime() < 1000 * 60 * 60 * 24);
                return (
                  <div key={log.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white dark:border-slate-900 bg-slate-200 dark:bg-slate-700 text-slate-500 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm relative z-10"
                      style={{ backgroundColor: log.status_color || '#cbd5e1' }}>
                    </div>
                    
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-slate-200/50 dark:border-slate-700/50 bg-white/60 dark:bg-slate-800/60 shadow-sm backdrop-blur-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-800 dark:text-slate-100">{log.milestone || 'Unknown'}</span>
                        <span className="text-xs font-medium text-slate-500 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700">
                          {log.track}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 capitalize">{log.temporal_state}</span>
                        <time className={`text-xs font-medium ${isRecent ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}>
                          {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </time>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
