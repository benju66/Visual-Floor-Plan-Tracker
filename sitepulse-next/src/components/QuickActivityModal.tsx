import React, { startTransition } from 'react';
import type { Activity } from '@/types/domain';
import type { CommitStatusExtraProps } from '@/types/mutations';

interface QuickActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Null while the modal is closed (the page keeps it mounted; `isOpen` gates rendering). */
  unitId: string | null;
  /** The current activity's NAME (the write path keys 'activity' commits by name). */
  currentActivityName: string | null;
  activities: Activity[];
  onCommit: (
    unitId: string | null,
    type: 'status' | 'activity',
    val: string | null,
    extraProps?: CommitStatusExtraProps
  ) => void;
}

export default function QuickActivityModal({ isOpen, onClose, unitId, currentActivityName, activities, onCommit }: QuickActivityModalProps) {
  const [selectedActivityName, setSelectedActivityName] = React.useState<string | null>(currentActivityName);

  React.useEffect(() => {
    setSelectedActivityName(currentActivityName);
  }, [currentActivityName, isOpen]);

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
        <h3 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-100">Select Activity</h3>
        <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          {activities.length === 0 ? (
             <div className="text-sm text-slate-500 italic p-4 text-center">No activities available in this track.</div>
          ) : activities.map((activity) => (
            <button
              key={activity.id}
              onClick={() => setSelectedActivityName(activity.name)}
              className={`p-4 rounded-xl font-bold border-2 transition-all flex items-center gap-4 text-left ${selectedActivityName === activity.name ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 shadow-sm' : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
            >
              <div
                className="w-5 h-5 rounded-full border-2 border-white dark:border-slate-900 shadow-sm"
                style={{ backgroundColor: activity.color }}
              />
              <span className="flex-1 text-slate-800 dark:text-slate-200 text-lg">{activity.name}</span>
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
            onClick={() => { 
              startTransition(() => {
                onCommit(unitId, 'activity', selectedActivityName);
              });
              onClose(); 
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-sm transition-colors"
          >
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
