'use client';

import React, { useState } from 'react';
import {
  Grid3x3,
  X,
  Sparkles,
  MousePointerClick,
  MoveHorizontal,
  MoveVertical,
  FileWarning,
  Trash2,
  Crosshair,
} from 'lucide-react';
import type { PendingGridline } from '@/utils/gridlineParse';
import type { Gridline } from '@/types/domain';

// Location Labeling Workbench — Phase 3b gridline annotator panel. The session
// controller for the two-part capture: it shows the current step (box a bubble →
// drag the axis), lets the human confirm/fix each captured grid's label, and banks
// the whole batch with one "Accept all". A workbench sibling of TitleBlockPopover:
// same glass styling + native-event isolation (overscroll-contain). All durable
// state (the active proposal, the pending list) lives in useWorkbenchStore (§2);
// this is a pure presenter over props.

interface GridlinePanelProps {
  /**
   * The in-progress grid (a bubble label has been read, awaiting the axis drag),
   * or null on the BUBBLE step (nothing read yet). `label` is editable; the panel
   * routes edits up so the canvas-triggered axis handler reads the latest value.
   */
  proposal: { label: string; suggestedLabel: string | null } | null;
  /** Grids captured this session, awaiting "accept all". */
  pending: PendingGridline[];
  /** The grids already saved on this sheet (persisted) — the manage list. */
  saved: Gridline[];
  /** Which saved grid (index) is selected for editing, or null. */
  selectedSavedIndex: number | null;
  isSaving: boolean;
  saveError?: string | null;
  /** Edit the in-progress proposal's label (before drawing its axis). */
  onProposalLabelChange: (label: string) => void;
  /** Edit a pending grid's label (fix a misread without re-capturing). */
  onPendingLabelChange: (id: string, label: string) => void;
  /** Drop a pending grid (a bad capture). */
  onRemovePending: (id: string) => void;
  /** Bank the whole pending batch to sheet_gridlines (one upsert). */
  onAcceptAll: () => void;
  /** Select a saved grid for editing (null toggles selection off). */
  onSelectSaved: (index: number | null) => void;
  /** Persist a relabel of a saved grid. */
  onRelabelSaved: (index: number, label: string) => void;
  /** Delete a saved grid. */
  onDeleteSaved: (index: number) => void;
  /** End the session (keeps saved grids; discards the in-progress proposal). */
  onClose: () => void;
}

const labelInput =
  'w-12 text-center text-sm font-bold border border-slate-300/80 dark:border-white/15 rounded-lg px-1 py-1 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 focus:ring-violet-500/50';

/**
 * One row in the "Saved on this sheet" manage list. The label is a controlled draft
 * that commits on blur / Enter — a saved relabel writes to the DB, so we don't fire
 * one per keystroke. Selecting the row highlights the grid on the canvas (where it
 * becomes draggable to reposition) and exposes delete.
 */
function SavedGridRow({
  grid,
  index,
  selected,
  onSelect,
  onRelabel,
  onDelete,
}: {
  grid: Gridline;
  index: number;
  selected: boolean;
  onSelect: (index: number | null) => void;
  onRelabel: (index: number, label: string) => void;
  onDelete: (index: number) => void;
}) {
  const [draft, setDraft] = useState(grid.label);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== grid.label) onRelabel(index, next);
    else setDraft(grid.label); // snap an empty/unchanged edit back
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2 py-1 transition-colors ${
        selected
          ? 'border-violet-400 dark:border-violet-500/60 bg-violet-50/80 dark:bg-violet-950/40 ring-1 ring-violet-400/50'
          : 'border-slate-200/70 dark:border-white/10 bg-white/40 dark:bg-white/5'
      }`}
    >
      <input
        type="text"
        maxLength={4}
        className={labelInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(grid.label);
        }}
      />
      <span
        className="flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400"
        title={grid.axis === 'h' ? 'Horizontal grid line' : 'Vertical grid line'}
      >
        {grid.axis === 'h' ? <MoveHorizontal size={13} /> : <MoveVertical size={13} />}
        {grid.axis === 'h' ? 'Horizontal' : 'Vertical'}
      </span>
      <button
        type="button"
        onClick={() => onSelect(selected ? null : index)}
        title={selected ? 'Stop editing (deselect)' : 'Select to move it on the drawing'}
        className={`ml-auto p-1 rounded-md transition-colors ${
          selected
            ? 'text-violet-600 dark:text-violet-300 bg-violet-100/70 dark:bg-violet-900/40'
            : 'text-slate-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-950/40'
        }`}
      >
        <Crosshair size={13} />
      </button>
      <button
        type="button"
        onClick={() => onDelete(index)}
        title="Delete this grid"
        className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export default function GridlinePanel({
  proposal,
  pending,
  saved,
  selectedSavedIndex,
  isSaving,
  saveError,
  onProposalLabelChange,
  onPendingLabelChange,
  onRemovePending,
  onAcceptAll,
  onSelectSaved,
  onRelabelSaved,
  onDeleteSaved,
  onClose,
}: GridlinePanelProps) {
  const onAxisStep = proposal !== null;
  const hadRead = !!proposal?.suggestedLabel;
  const canAccept = pending.some((p) => p.label.trim().length > 0) && !isSaving;

  return (
    <div
      className="absolute top-6 right-6 z-[60] w-72 rounded-2xl border p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200 backdrop-blur-md max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain"
      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-sm font-bold flex items-center gap-1.5 text-slate-900 dark:text-white">
          <Grid3x3 size={15} className="text-violet-500" />
          Gridlines
        </h2>
        <button
          type="button"
          onClick={onClose}
          title="Close gridlines"
          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        >
          <X size={15} />
        </button>
      </div>

      {/* Current step */}
      {onAxisStep ? (
        <div className="mb-3 rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/80 dark:bg-violet-950/30 p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300 mb-2">
            <MousePointerClick size={13} className="shrink-0" />
            Now drag a line across this grid line.
          </p>
          <div className="flex items-center gap-2">
            <label htmlFor="gridProposalLabel" className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Label
            </label>
            <input
              id="gridProposalLabel"
              type="text"
              autoFocus
              maxLength={4}
              className={labelInput}
              value={proposal.label}
              onChange={(e) => onProposalLabelChange(e.target.value)}
            />
            {hadRead && (
              <span className="flex items-center gap-1 text-[10px] text-violet-500" title="Read from the sheet text">
                <Sparkles size={11} /> read
              </span>
            )}
          </div>
          {!hadRead && (
            <p className="mt-1.5 text-[10px] leading-tight text-slate-500 dark:text-slate-400">
              No label found in that box — type it, then drag the axis.
            </p>
          )}
        </div>
      ) : (
        <p className="mb-3 flex items-center gap-1.5 text-[11px] font-medium text-violet-600 dark:text-violet-300">
          <Sparkles size={13} className="shrink-0" />
          Box a grid bubble to read its label (A / 1).
        </p>
      )}

      {/* Pending captures */}
      {pending.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Captured ({pending.length})
          </p>
          {pending.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200/70 dark:border-white/10 bg-white/40 dark:bg-white/5 px-2 py-1"
            >
              <input
                type="text"
                maxLength={4}
                className={labelInput}
                value={g.label}
                onChange={(e) => onPendingLabelChange(g.id, e.target.value)}
              />
              <span
                className="flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400"
                title={g.axis === 'h' ? 'Horizontal grid line' : 'Vertical grid line'}
              >
                {g.axis === 'h' ? <MoveHorizontal size={13} /> : <MoveVertical size={13} />}
                {g.axis === 'h' ? 'Horizontal' : 'Vertical'}
              </span>
              <button
                type="button"
                onClick={() => onRemovePending(g.id)}
                title="Remove this grid"
                className="ml-auto p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          No grids captured yet this session.
        </p>
      )}

      {/* Saved on this sheet — select to move, relabel inline, or delete. */}
      {saved.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-slate-200/60 dark:border-white/10 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Saved on this sheet ({saved.length})
          </p>
          {saved.map((g, i) => (
            <SavedGridRow
              key={`${i}-${g.label}-${g.axis}`}
              grid={g}
              index={i}
              selected={selectedSavedIndex === i}
              onSelect={onSelectSaved}
              onRelabel={onRelabelSaved}
              onDelete={onDeleteSaved}
            />
          ))}
          {selectedSavedIndex !== null && (
            <p className="flex items-center gap-1 text-[10px] leading-tight text-violet-600 dark:text-violet-300">
              <MousePointerClick size={11} className="shrink-0" />
              Drag the highlighted line on the drawing to move it.
            </p>
          )}
        </div>
      )}

      {saveError && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
          <FileWarning size={13} className="shrink-0 mt-px" />
          <span>{saveError}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-400">
          {saved.length > 0 ? `${saved.length} saved on this sheet` : 'None saved yet'}
        </span>
        <button
          type="button"
          onClick={onAcceptAll}
          disabled={!canAccept}
          className="px-3 py-1.5 rounded-xl bg-violet-500 hover:bg-violet-600 font-bold text-white text-xs shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving…' : `Accept all${pending.length ? ` (${pending.length})` : ''}`}
        </button>
      </div>
    </div>
  );
}
