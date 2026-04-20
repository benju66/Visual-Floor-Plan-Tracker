import React from 'react';

export default function QuickMilestoneModal({ isOpen, onClose, unitId, currentMilestoneId, milestones, onCommit }) {
  const [selectedMilestoneId, setSelectedMilestoneId] = React.useState(currentMilestoneId);

  React.useEffect(() => {
    setSelectedMilestoneId(currentMilestoneId);
  }, [currentMilestoneId, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div 
        className="w-[400px] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 pointer-events-auto"
        style={{
          boxShadow: 'var(--glass-shadow)',
          borderRadius: '1.5rem',
        }}
      >
        <h3 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-100">Select Milestone</h3>
        <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          {milestones.length === 0 ? (
             <div className="text-sm text-slate-500 italic p-4 text-center">No milestones available in this track.</div>
          ) : milestones.map((milestone) => (
            <button
              key={milestone.id}
              onClick={() => setSelectedMilestoneId(milestone.name)}
              className={`p-4 rounded-xl font-bold border-2 transition-all flex items-center gap-4 text-left ${selectedMilestoneId === milestone.name ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 shadow-sm' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
            >
              <div 
                className="w-5 h-5 rounded-full border-2 border-white dark:border-slate-900 shadow-sm" 
                style={{ backgroundColor: milestone.color || milestone.status_color }} 
              />
              <span className="flex-1 text-slate-800 dark:text-slate-200 text-lg">{milestone.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { onCommit(unitId, 'milestone', selectedMilestoneId); onClose(); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-sm transition-colors"
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
