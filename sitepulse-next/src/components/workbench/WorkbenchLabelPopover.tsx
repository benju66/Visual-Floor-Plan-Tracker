'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info, Layers, CircleDashed, Sparkles } from 'lucide-react';
import TaxonomyPicker from '@/components/TaxonomyPicker';
import { normalizeLocationName, isNameUniqueOnSheet, suggestNextName } from '@/utils/workbenchNaming';
import type { TaxonomyResult } from '@/utils/subtypes';
import type { ProjectType, Subtype, TopLevelRole, Unit } from '@/types/domain';

// Location Labeling Workbench — Phase 7 naming popover. A workbench-only sibling of
// the live `UnitNamingPopover`: it reuses the shared `TaxonomyPicker` but adds the
// standard-enforcing rules the live map intentionally does NOT impose — within-sheet
// uniqueness + normalization, a REQUIRED role/type, the two-level (§7) and void (§5)
// label flags, and interior-face guidance (§3). Built as a separate component (not
// extra props on the shared `.jsx`) so the live naming flow's contract is untouched.
//
// Doubles as the in-place EDIT popover (canvas "Rename" action): pass `editingUnit`
// to pre-fill the current name/type/flags; otherwise it names a freshly-traced label.

export interface WorkbenchLabelMeta {
  pick: TaxonomyResult;
  spansLevels: boolean;
  levelNote: string;
  hasVoid: boolean;
}

/** Reconstruct the current type as a picker result so an edit starts pre-selected. */
function reconstructPick(unit: Unit, subtypes: Subtype[]): TaxonomyResult | null {
  if (unit.subtype_id) {
    const s = subtypes.find((sub) => sub.id === unit.subtype_id);
    if (s) return { kind: 'subtype', subtypeId: s.id, name: s.name, role: s.top_level_role as TopLevelRole };
  }
  // Role set but no resolvable sub-type (a degraded/pending label) — represent the
  // current free-typed name under its role so the picker shows it and save is allowed.
  if (unit.top_level_role) {
    return { kind: 'pending', role: unit.top_level_role as TopLevelRole, name: unit.unit_type ?? '' };
  }
  return null;
}

interface WorkbenchLabelPopoverProps {
  /** The draft name (lives in the workbench store so it survives popover re-renders). */
  name: string;
  setName: (val: string) => void;
  subtypes: Subtype[];
  /** The SHEET's project type (per-drawing) — scopes the picker's ordering. */
  projectType: ProjectType | null;
  /** Existing label names on this sheet for the uniqueness check (EXCLUDING the one being edited). */
  existingNames: string[];
  isSaving: boolean;
  onSave: (meta: WorkbenchLabelMeta) => void;
  onCancel: () => void;
  /** When set, the popover edits this label (pre-fills type + flags); otherwise it creates. */
  editingUnit?: Unit | null;
  /** Sub-type ids of locations already on this sheet — the picker's "Used in this project" row. */
  recentSubtypeIds?: string[];
  /**
   * The AI taxonomy pre-selection for a freshly-traced room (AI Tracing Assist —
   * Phase 2). Only used in CREATE mode; the name is pre-filled separately via
   * {@link name}. `null` = no type was suggested (user picks one).
   */
  suggestedPick?: TaxonomyResult | null;
  /** Whether the pre-filled name/type came from the sheet text (renders the hint). */
  isSuggested?: boolean;
}

export default function WorkbenchLabelPopover({
  name,
  setName,
  subtypes,
  projectType,
  existingNames,
  isSaving,
  onSave,
  onCancel,
  editingUnit,
  recentSubtypeIds = [],
  suggestedPick = null,
  isSuggested = false,
}: WorkbenchLabelPopoverProps) {
  const isEditing = !!editingUnit;
  const [pick, setPick] = useState<TaxonomyResult | null>(() =>
    editingUnit ? reconstructPick(editingUnit, subtypes) : suggestedPick,
  );
  const [spansLevels, setSpansLevels] = useState(() => editingUnit?.spans_levels ?? false);
  const [levelNote, setLevelNote] = useState(() => editingUnit?.level_note ?? '');
  const [hasVoid, setHasVoid] = useState(() => editingUnit?.has_void ?? false);

  const normalized = normalizeLocationName(name);
  const isBlank = normalized.length === 0;
  const isDuplicate = !isBlank && !isNameUniqueOnSheet(normalized, existingNames);
  const suggestion = isDuplicate ? suggestNextName(existingNames) : null;
  const hasType = pick !== null;
  const canSave = !isBlank && !isDuplicate && hasType && !isSaving;

  const typeName = pick ? pick.name : null;
  const isPending = pick?.kind === 'pending';

  // Keyboard flow (plan §A4/§A5): name → Tab → search box → Tab → Save → Enter.
  const nameRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const saveRef = useRef<HTMLButtonElement | null>(null);
  const advanceRequestedRef = useRef(false);

  // Tab out of the type list requests focus on Save; do it from an effect so the
  // button has re-rendered enabled (a disabled button can't take focus) after the
  // pick commits.
  const requestAdvanceToSave = () => { advanceRequestedRef.current = true; };
  useEffect(() => {
    if (advanceRequestedRef.current && canSave) {
      advanceRequestedRef.current = false;
      saveRef.current?.focus();
    }
  }, [pick, canSave]);

  // Keep selected + AI-suggested types visible even when the project-type filter
  // would hide them.
  const selectedSubtypeId = pick && pick.kind === 'subtype' ? pick.subtypeId : null;
  const suggestedSubtypeId = suggestedPick && suggestedPick.kind === 'subtype' ? suggestedPick.subtypeId : null;

  const handleSave = () => {
    if (!canSave || !pick) return;
    onSave({ pick, spansLevels, levelNote, hasVoid });
  };

  return (
    <div
      className="absolute top-6 right-6 z-[60] w-80 rounded-2xl border p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200 backdrop-blur-md max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain"
      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <h2 className="text-sm font-bold mb-1.5 text-slate-900 dark:text-white">
        {isEditing ? 'Edit location' : 'Name this location'}
      </h2>

      {/* AI Tracing Assist (Phase 2): the name/type were pre-filled from the sheet's
          own text — confirm or edit. Display-only; no canvas overlay. */}
      {!isEditing && isSuggested && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-violet-600 dark:text-violet-300">
          <Sparkles size={13} className="shrink-0" />
          Suggested from the sheet — confirm or edit.
        </p>
      )}

      {/* Interior-face guidance (standard §3) — text only, no geometry enforcement. */}
      <p className="mb-2.5 flex items-start gap-1.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        <Info size={13} className="shrink-0 mt-px text-sky-500" />
        Trace the <span className="font-semibold">interior face</span> of the walls — one polygon per location.
      </p>

      <input
        ref={nameRef}
        type="text"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        className="w-full text-sm border border-slate-300/80 dark:border-white/15 rounded-xl px-2.5 py-1.5 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 focus:ring-blue-500/50"
        placeholder="e.g. 1204"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          // Tab moves into the type search box (the list); Escape handled at the popover root.
          if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); searchRef.current?.focus(); }
        }}
      />

      {isDuplicate && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
          <AlertTriangle size={13} className="shrink-0" />
          <span>“{normalized}” already exists on this sheet.</span>
          {suggestion && (
            <button
              type="button"
              onClick={() => setName(suggestion)}
              className="font-bold underline decoration-dotted underline-offset-2 hover:text-rose-700 dark:hover:text-rose-300"
            >
              Use {suggestion}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Type<span className="text-rose-500"> *</span>
        </span>
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">
          {typeName ? (
            <>
              {typeName}
              {isPending && <span className="text-amber-500"> · pending</span>}
            </>
          ) : (
            <span className="text-amber-500 italic">required</span>
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
          suggestedSubtypeId={suggestedSubtypeId}
          recentSubtypeIds={recentSubtypeIds}
          searchRef={searchRef}
          onAdvance={requestAdvanceToSave}
          autoFocusSearch={false}
        />
      </div>

      {/* Two-level + void label metadata (standard §7 / §5). */}
      <div className="mb-3 space-y-1.5">
        <MetaToggle
          icon={<Layers size={14} />}
          label="Spans two levels"
          hint="Loft / mezzanine / double-height"
          checked={spansLevels}
          onChange={setSpansLevels}
        />
        {spansLevels && (
          <input
            type="text"
            value={levelNote}
            onChange={(e) => setLevelNote(e.target.value)}
            placeholder="Note the second level (e.g. mezzanine over)"
            className="w-full text-xs border border-slate-300/80 dark:border-white/15 rounded-lg px-2 py-1 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        )}
        <MetaToggle
          icon={<CircleDashed size={14} />}
          label="Encloses a void"
          hint="Donut: a tracked core (shaft) inside"
          checked={hasVoid}
          onChange={setHasVoid}
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-xl border border-slate-300/80 dark:border-white/15 font-medium text-xs hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        >
          Cancel
        </button>
        <button
          ref={saveRef}
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 font-bold text-white text-xs shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Save location'}
        </button>
      </div>
    </div>
  );
}

function MetaToggle({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-left transition-colors ${
        checked
          ? 'border-emerald-400/70 bg-emerald-50 dark:bg-emerald-500/10'
          : 'border-slate-300/80 dark:border-white/15 hover:bg-white/50 dark:hover:bg-white/5'
      }`}
    >
      <span className={checked ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        <span className="block text-[10px] leading-tight text-slate-400 truncate">{hint}</span>
      </span>
      <span
        className={`shrink-0 w-8 h-[18px] rounded-full p-0.5 transition-colors ${
          checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/15'
        }`}
      >
        <span
          className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-3.5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}
