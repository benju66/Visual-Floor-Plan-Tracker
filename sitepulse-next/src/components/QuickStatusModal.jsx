import React from 'react';

export default function QuickStatusModal({ isOpen, onClose, unitId, currentStatus, onCommit }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div 
        className="w-[360px] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 pointer-events-auto"
        style={{
          boxShadow: 'var(--glass-shadow)',
          borderRadius: '1.5rem',
        }}
      >
        <h3 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-100">Update Status</h3>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => { onCommit(unitId, 'status', 'none'); onClose(); }}
            className={`p-4 rounded-xl font-bold border-2 transition-all flex flex-col items-center justify-center gap-2 ${currentStatus === 'none' ? 'border-slate-800 text-slate-800 dark:border-white dark:text-white bg-slate-100 dark:bg-slate-800' : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-400 dark:hover:border-slate-500'}`}
          >
            Clear Status
          </button>
          <button
            onClick={() => { onCommit(unitId, 'status', 'planned'); onClose(); }}
            className={`p-4 rounded-xl font-bold border-2 transition-all flex flex-col items-center justify-center gap-2 ${currentStatus === 'planned' ? 'border-slate-500 bg-slate-500 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
          >
            Planned
          </button>
          <button
            onClick={() => { onCommit(unitId, 'status', 'ongoing'); onClose(); }}
            className={`p-4 rounded-xl font-bold border-2 transition-all flex flex-col items-center justify-center gap-2 ${currentStatus === 'ongoing' ? 'border-amber-500 bg-amber-500 text-white' : 'border-amber-200 dark:border-amber-900/50 text-amber-600 dark:text-amber-500 hover:border-amber-400 dark:hover:border-amber-700'}`}
          >
            Ongoing
          </button>
          <button
            onClick={() => { onCommit(unitId, 'status', 'completed'); onClose(); }}
            className={`p-4 rounded-xl font-bold border-2 transition-all flex flex-col items-center justify-center gap-2 ${currentStatus === 'completed' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-emerald-200 dark:border-emerald-900/50 text-emerald-600 dark:text-emerald-500 hover:border-emerald-400 dark:hover:border-emerald-700'}`}
          >
            Completed
          </button>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
