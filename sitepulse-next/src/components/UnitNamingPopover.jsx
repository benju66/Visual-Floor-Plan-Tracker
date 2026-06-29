import React, { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import TaxonomyPicker from './TaxonomyPicker';

export default function UnitNamingPopover({
  editingUnitId,
  newUnitName,
  setNewUnitName,
  subtypes = [],
  projectType = null,
  initialSubtypeId = null,
  initialUnitType = null,
  initialPick = null,
  isSuggested = false,
  recentSubtypeIds = [],
  saveNewUnitFromPopover,
  cancelUnitNaming,
}) {
  // The active taxonomy pick for THIS save, or null = "leave type unchanged"
  // (on rename, preserves the location's existing role/sub-type; on create, no type).
  // Seeded from the AI suggestion (Phase 4) so an accepted name/type saves WITH its
  // type even if the user never opens the picker; null for rename / a plain draw.
  const [pick, setPick] = useState(initialPick);

  // Keyboard flow: name → Tab → type search → Tab → Save → Enter. Save here is
  // never disabled, so focusing it directly (no effect) is fine.
  const searchRef = useRef(null);
  const saveRef = useRef(null);

  const selectedSubtypeId = pick
    ? (pick.kind === 'subtype' ? pick.subtypeId : null)
    : initialSubtypeId;
  const currentName = pick ? pick.name : initialUnitType;
  const isPending = pick?.kind === 'pending';

  const handleSave = () => void saveNewUnitFromPopover(pick);

  return (
    <div
      className="absolute top-6 right-6 z-[60] w-64 rounded-2xl border p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200 backdrop-blur-md"
      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
      onKeyDown={(e) => { if (e.key === 'Escape') cancelUnitNaming(); }}
    >
      <h2 className="text-sm font-bold mb-1.5 text-slate-900 dark:text-white">{editingUnitId ? 'Rename location' : 'Name this location'}</h2>

      {/* AI Tracing Assist (Phase 4): the name/type were pre-filled from the sheet's own
          text — confirm or edit. Display-only. */}
      {!editingUnitId && isSuggested && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-violet-600 dark:text-violet-300">
          <Sparkles size={13} className="shrink-0" />
          Suggested from the sheet — confirm or edit.
        </p>
      )}

      <input
        type="text"
        autoFocus
        className="w-full text-sm border border-slate-300/80 dark:border-white/15 rounded-xl px-2.5 py-1.5 mb-3 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 focus:ring-blue-500/50"
        placeholder="e.g. 1204"
        value={newUnitName}
        onChange={(e) => setNewUnitName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); searchRef.current?.focus(); }
        }}
      />

      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Type</span>
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
          {currentName ? (
            <>{currentName}{isPending && <span className="text-amber-500"> · pending</span>}</>
          ) : (
            <span className="text-slate-400 italic">none</span>
          )}
        </span>
      </div>
      <div className="mb-3 rounded-xl border border-slate-300/80 dark:border-white/15 bg-white/50 dark:bg-black/20 p-1">
        <TaxonomyPicker
          subtypes={subtypes}
          projectType={projectType}
          selectedSubtypeId={selectedSubtypeId}
          onPick={setPick}
          variant="popover"
          restrictToProjectType
          recentSubtypeIds={recentSubtypeIds}
          searchRef={searchRef}
          onAdvance={() => saveRef.current?.focus()}
          autoFocusSearch={false}
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancelUnitNaming}
          className="px-3 py-1.5 rounded-xl border border-slate-300/80 dark:border-white/15 font-medium text-xs hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        >
          Cancel
        </button>
        <button
          ref={saveRef}
          type="button"
          onClick={handleSave}
          className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 font-bold text-white text-xs shadow-sm transition-colors"
        >
          Save location
        </button>
      </div>
    </div>
  );
}
