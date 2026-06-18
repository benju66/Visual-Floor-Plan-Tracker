'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, X, Trash2, Loader2, Layers, CircleDashed, ClipboardCheck } from 'lucide-react';
import TaxonomyPicker from '@/components/TaxonomyPicker';
import { useUnits, useDeleteUnit } from '@/hooks/useProjectQueries';
import { useSubtypes } from '@/hooks/useSubtypes';
import { useUpdateWorkbenchLabel, useUpdateWorkbenchReviewState } from '@/hooks/useWorkbenchActions';
import {
  REVIEW_STATE_LABELS,
  REVIEW_STATE_BADGE,
  narrowReviewState,
  type WorkbenchReviewState,
} from '@/utils/workbench';
import { definitionOfDoneChecks, normalizeLocationName, isNameUniqueOnSheet } from '@/utils/workbenchNaming';
import { PROJECT_TYPES, type ProjectType } from '@/utils/locationTaxonomy';
import type { TaxonomyResult } from '@/utils/subtypes';
import type { Subtype, Unit, WorkbenchDrawing } from '@/types/domain';

// Location Labeling Workbench — Phase 7 review table. The hub for the second-person
// review step (standard §9): a drawing's labels in an editable table (rename /
// re-type / two-level-void flags / delete), with the live Definition-of-Done
// checklist and the `draft → ready_for_review → reviewed` transitions. "Mark
// reviewed" is gated on every DoD check passing. All edits go through the same
// standard-enforcing workbench write hooks (normalize + uniqueness + required type).

function asProjectType(value: string | null | undefined): ProjectType | null {
  return value && (PROJECT_TYPES as readonly string[]).includes(value) ? (value as ProjectType) : null;
}

interface WorkbenchReviewTableProps {
  drawing: WorkbenchDrawing;
  containerId: string;
  userId: string | undefined;
  onClose: () => void;
}

export default function WorkbenchReviewTable({ drawing, containerId, userId, onClose }: WorkbenchReviewTableProps) {
  const sheetId = drawing.id;
  const { data: units = [] } = useUnits(sheetId);
  const { data: subtypes = [] } = useSubtypes();
  const updateLabel = useUpdateWorkbenchLabel(sheetId);
  const deleteUnit = useDeleteUnit(sheetId);
  const updateReview = useUpdateWorkbenchReviewState(containerId);

  const reviewState = narrowReviewState(drawing.workbench?.review_state);
  const projectType = asProjectType(drawing.workbench?.sheet_project_type);
  const dod = definitionOfDoneChecks(
    units.map((u) => ({ unit_number: u.unit_number, top_level_role: u.top_level_role })),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const transition = (next: WorkbenchReviewState) => {
    updateReview.mutate({ sheetId, reviewState: next, reviewerId: userId ?? null });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl bg-white dark:bg-slate-900">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <ClipboardCheck size={18} className="text-violet-500 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
              Review — {drawing.sheet_name || 'Drawing'}
            </h2>
            <p className="text-xs text-slate-400">{units.length} location{units.length === 1 ? '' : 's'}</p>
          </div>
          <span
            className={`ml-auto text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border ${REVIEW_STATE_BADGE[reviewState]}`}
          >
            {REVIEW_STATE_LABELS[reviewState]}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Definition-of-Done strip */}
        <div className="shrink-0 px-5 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {dod.checks.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1.5 text-xs">
                {c.passed ? (
                  <Check size={13} className="text-emerald-500 shrink-0" />
                ) : (
                  <X size={13} className="text-rose-500 shrink-0" />
                )}
                <span className={c.passed ? 'text-slate-500 dark:text-slate-400' : 'text-slate-800 dark:text-slate-100 font-medium'}>
                  {c.label}
                  {c.detail && <span className="text-rose-500"> · {c.detail}</span>}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Editable table */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {units.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              No locations yet. Trace some on the drawing, then come back to review.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-slate-900 z-10 text-[10px] uppercase tracking-widest text-slate-400">
                <tr className="border-b border-slate-200 dark:border-white/10">
                  <th className="text-left font-bold px-3 py-2 w-8">#</th>
                  <th className="text-left font-bold px-3 py-2">Name</th>
                  <th className="text-left font-bold px-3 py-2">Type</th>
                  <th className="text-center font-bold px-2 py-2">2-Lvl</th>
                  <th className="text-center font-bold px-2 py-2">Void</th>
                  <th className="px-2 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {units.map((unit, i) => (
                  <WorkbenchReviewRow
                    key={unit.id}
                    unit={unit}
                    index={i + 1}
                    subtypes={subtypes}
                    projectType={projectType}
                    otherNames={units
                      .filter((o) => o.id !== unit.id)
                      .map((o) => o.unit_number)
                      .filter((n): n is string => !!n && n.trim().length > 0)}
                    onUpdate={(patch) => updateLabel.mutate({ unitId: unit.id, ...patch })}
                    onDelete={() => deleteUnit.mutate(unit.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer — review transitions */}
        <div className="shrink-0 px-5 py-3 border-t border-slate-200 dark:border-white/10 flex items-center gap-2">
          {updateReview.isError && (
            <span className="text-[11px] text-rose-500 mr-auto">
              {updateReview.error instanceof Error ? updateReview.error.message : 'Could not update the review state.'}
            </span>
          )}
          {!updateReview.isError && !dod.passed && reviewState !== 'reviewed' && (
            <span className="text-[11px] text-slate-400 mr-auto">
              Resolve every check above to mark this drawing reviewed.
            </span>
          )}
          {!updateReview.isError && (dod.passed || reviewState === 'reviewed') && <span className="mr-auto" />}

          {reviewState === 'draft' && (
            <FooterButton onClick={() => transition('ready_for_review')} busy={updateReview.isPending}>
              Mark ready for review
            </FooterButton>
          )}
          {reviewState === 'ready_for_review' && (
            <>
              <FooterButton variant="ghost" onClick={() => transition('draft')} busy={updateReview.isPending}>
                Back to draft
              </FooterButton>
              <FooterButton
                variant="primary"
                onClick={() => transition('reviewed')}
                busy={updateReview.isPending}
                disabled={!dod.passed}
              >
                Mark reviewed
              </FooterButton>
            </>
          )}
          {reviewState === 'reviewed' && (
            <FooterButton variant="ghost" onClick={() => transition('draft')} busy={updateReview.isPending}>
              Reopen (back to draft)
            </FooterButton>
          )}
        </div>
      </div>
    </div>
  );
}

interface RowPatch {
  name?: string;
  pick?: TaxonomyResult;
  spansLevels?: boolean;
  levelNote?: string | null;
  hasVoid?: boolean;
}

function WorkbenchReviewRow({
  unit,
  index,
  subtypes,
  projectType,
  otherNames,
  onUpdate,
  onDelete,
}: {
  unit: Unit;
  index: number;
  subtypes: Subtype[];
  projectType: ProjectType | null;
  otherNames: string[];
  onUpdate: (patch: RowPatch) => void;
  onDelete: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(unit.unit_number ?? '');
  const [noteDraft, setNoteDraft] = useState(unit.level_note ?? '');
  const [typeOpen, setTypeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-sync local drafts whenever the saved row changes (after a successful write).
  useEffect(() => setNameDraft(unit.unit_number ?? ''), [unit.unit_number]);
  useEffect(() => setNoteDraft(unit.level_note ?? ''), [unit.level_note]);

  const normalized = normalizeLocationName(nameDraft);
  const isBlank = normalized.length === 0;
  const isDuplicate = !isBlank && !isNameUniqueOnSheet(normalized, otherNames);
  const nameChanged = normalized !== normalizeLocationName(unit.unit_number ?? '');

  const commitName = () => {
    if (isBlank || isDuplicate) {
      setNameDraft(unit.unit_number ?? ''); // discard an invalid edit
      return;
    }
    if (nameChanged) onUpdate({ name: normalized });
  };

  const commitNote = () => {
    const next = noteDraft.trim();
    if (next !== (unit.level_note ?? '').trim()) onUpdate({ levelNote: next || null });
  };

  const rowOk =
    !isBlank &&
    !isDuplicate &&
    !!unit.top_level_role &&
    (unit.unit_number ?? '') === normalizeLocationName(unit.unit_number ?? '');

  return (
    <tr className="border-b border-slate-100 dark:border-white/5 align-top">
      <td className="px-3 py-2 text-slate-400 tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          {rowOk ? <Check size={13} className="text-emerald-500" /> : <X size={13} className="text-rose-500" />}
          {index}
        </span>
      </td>

      {/* Name */}
      <td className="px-3 py-2">
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setNameDraft(unit.unit_number ?? '');
          }}
          className={`w-full text-sm rounded-lg px-2 py-1 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 ${
            isBlank || isDuplicate
              ? 'border border-rose-400 focus:ring-rose-400/40'
              : 'border border-slate-300/80 dark:border-white/15 focus:ring-blue-500/40'
          }`}
        />
        {isDuplicate && <span className="block mt-0.5 text-[10px] text-rose-500">Duplicate name on this sheet.</span>}
        {isBlank && <span className="block mt-0.5 text-[10px] text-rose-500">A name is required.</span>}
        {unit.spans_levels && (
          <input
            type="text"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            placeholder="Second-level note"
            className="mt-1 w-full text-xs rounded-lg px-2 py-0.5 bg-white/70 dark:bg-black/25 border border-slate-300/80 dark:border-white/15 outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        )}
      </td>

      {/* Type */}
      <td className="px-3 py-2 relative">
        <button
          type="button"
          onClick={() => setTypeOpen((v) => !v)}
          className={`text-left text-sm px-2 py-1 rounded-lg border w-full truncate transition-colors ${
            unit.top_level_role
              ? 'border-slate-300/80 dark:border-white/15 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5'
              : 'border-amber-400 text-amber-600 dark:text-amber-400'
          }`}
        >
          {unit.unit_type || 'Set type…'}
        </button>
        {typeOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setTypeOpen(false)} aria-hidden />
            <div
              className="absolute left-3 right-3 mt-1 z-20 rounded-xl border border-slate-300/80 dark:border-white/15 p-1 shadow-2xl backdrop-blur-md"
              style={{ background: 'var(--glass-bg)' }}
            >
              <TaxonomyPicker
                subtypes={subtypes}
                projectType={projectType}
                selectedSubtypeId={unit.subtype_id}
                onPick={(pick) => {
                  onUpdate({ pick });
                  setTypeOpen(false);
                }}
                variant="popover"
              />
            </div>
          </>
        )}
      </td>

      {/* Two-level */}
      <td className="px-2 py-2 text-center">
        <CellToggle
          on={!!unit.spans_levels}
          icon={<Layers size={14} />}
          onClick={() => onUpdate({ spansLevels: !unit.spans_levels })}
        />
      </td>

      {/* Void */}
      <td className="px-2 py-2 text-center">
        <CellToggle
          on={!!unit.has_void}
          icon={<CircleDashed size={14} />}
          onClick={() => onUpdate({ hasVoid: !unit.has_void })}
        />
      </td>

      {/* Delete */}
      <td className="px-2 py-2 text-center">
        {confirmDelete ? (
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onDelete}
              title="Confirm delete"
              className="p-1 rounded-md text-white bg-rose-500 hover:bg-rose-600"
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              title="Cancel"
              className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <X size={13} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            title="Delete location"
            className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
          >
            <Trash2 size={15} />
          </button>
        )}
      </td>
    </tr>
  );
}

function CellToggle({ on, icon, onClick }: { on: boolean; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-colors ${
        on
          ? 'border-emerald-400/70 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'border-slate-300/80 dark:border-white/15 text-slate-300 dark:text-slate-600 hover:bg-slate-50 dark:hover:bg-white/5'
      }`}
    >
      {icon}
    </button>
  );
}

function FooterButton({
  children,
  onClick,
  busy,
  disabled,
  variant = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'ghost';
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const styles =
    variant === 'primary'
      ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm'
      : variant === 'ghost'
        ? 'border border-slate-300/80 dark:border-white/15 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
        : 'bg-sky-500 hover:bg-sky-600 text-white shadow-sm';
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} className={`${base} ${styles}`}>
      {busy && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
}
