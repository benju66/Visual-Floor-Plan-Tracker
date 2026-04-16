import React from 'react';

export default function UnitNamingPopover({
  editingUnitId,
  newUnitName,
  setNewUnitName,
  saveNewUnitFromPopover,
  cancelUnitNaming
}) {
  return (
    <div
      className="absolute top-6 right-6 z-[60] w-64 rounded-2xl border p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200 backdrop-blur-md"
      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
    >
      <h2 className="text-sm font-bold mb-1.5 text-slate-900 dark:text-white">{editingUnitId ? 'Rename location' : 'Name this location'}</h2>
      <input
        type="text"
        autoFocus
        className="w-full text-sm border border-slate-300/80 dark:border-white/15 rounded-xl px-2.5 py-1.5 mb-3 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 focus:ring-blue-500/50"
        placeholder="e.g. 1204"
        value={newUnitName}
        onChange={(e) => setNewUnitName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void saveNewUnitFromPopover();
          if (e.key === 'Escape') cancelUnitNaming();
        }}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancelUnitNaming}
          className="px-3 py-1.5 rounded-xl border border-slate-300/80 dark:border-white/15 font-medium text-xs hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void saveNewUnitFromPopover()}
          className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 font-bold text-white text-xs shadow-sm transition-colors"
        >
          Save location
        </button>
      </div>
    </div>
  );
}
