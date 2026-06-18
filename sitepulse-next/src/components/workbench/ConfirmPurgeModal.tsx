'use client';

import React, { useState } from 'react';
import { Trash2, X, Loader2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { matchesPurgeConfirmation, narrowReviewState } from '@/utils/workbench';
import type { WorkbenchDrawing } from '@/types/domain';

// Location Labeling Workbench — Phase 8c type-to-confirm dialog for the
// IRREVERSIBLE hard-delete (permanent purge). This is the ONLY entry to the purge:
// the destructive button stays disabled until the user types the drawing's exact
// name, so there is no path that skips the confirmation. Visibility is owned by
// useWorkbenchStore (`purgeTargetId`); the typed-name value stays transient local
// state here (a form field, the same split NewDrawingModal uses).

const inputClass =
  'w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50';

export default function ConfirmPurgeModal({
  drawing,
  labelCount,
  isPurging,
  error,
  onConfirm,
  onClose,
}: {
  drawing: WorkbenchDrawing;
  /** How many labels (`units`) the cascade will destroy with this drawing. */
  labelCount: number;
  /** Whether the purge write is in flight. */
  isPurging: boolean;
  /** A surfaced purge error, if the write failed. */
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typedName, setTypedName] = useState('');

  // The exact name the user must type. Falls back to the same "Untitled drawing"
  // label the card shows when `sheet_name` is blank, so there is always something
  // unambiguous to type.
  const displayName = drawing.sheet_name?.trim() || 'Untitled drawing';
  const isReviewed = narrowReviewState(drawing.workbench?.review_state) === 'reviewed';
  const confirmed = matchesPurgeConfirmation(typedName, displayName);
  const canPurge = confirmed && !isPurging;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPurge) return;
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/50 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-white/5">
          <h2 className="text-xl font-bold flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <Trash2 size={20} />
            Delete permanently
          </h2>
          <button
            type="button"
            onClick={() => !isPurging && onClose()}
            disabled={isPurging}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            aria-label="Cancel"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            You are about to <span className="font-bold text-rose-600 dark:text-rose-400">permanently destroy</span>{' '}
            <span className="font-bold text-slate-900 dark:text-white">“{displayName}”</span> and{' '}
            <span className="font-bold text-slate-900 dark:text-white">
              {labelCount} {labelCount === 1 ? 'label' : 'labels'}
            </span>{' '}
            traced on it. This also removes its stored PDF and preview. <span className="font-bold">This cannot be undone.</span>
          </p>

          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>
              To recover a drawing instead, <span className="font-bold">Archive</span> it — archiving is reversible, this is not.
            </span>
          </div>

          {isReviewed && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/40 p-3 text-xs text-rose-700 dark:text-rose-300">
              <ShieldAlert size={15} className="shrink-0 mt-0.5" />
              <span>
                This is a <span className="font-bold">Reviewed</span> drawing — its labels are finished, signed-off
                training data. Destroying it discards reviewed work permanently. Be certain.
              </span>
            </div>
          )}

          <label htmlFor="purgeConfirm" className="block text-sm font-bold text-slate-700 dark:text-slate-300 mt-5 mb-2">
            Type <span className="font-mono text-rose-600 dark:text-rose-400">{displayName}</span> to confirm
          </label>
          <input
            id="purgeConfirm"
            type="text"
            autoFocus
            autoComplete="off"
            disabled={isPurging}
            className={inputClass}
            placeholder={displayName}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
          />

          {error && (
            <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-8">
            <button
              type="button"
              onClick={onClose}
              disabled={isPurging}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canPurge}
              className="px-5 py-2.5 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPurging ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              {isPurging ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
