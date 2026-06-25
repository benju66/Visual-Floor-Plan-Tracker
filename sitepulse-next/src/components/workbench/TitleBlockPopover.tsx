'use client';

import React, { useState } from 'react';
import { Sparkles, ScanText, FileWarning } from 'lucide-react';
import type { TitleBlockFields } from '@/types/domain';

// Location Labeling Workbench — Phase 3a title-block confirm popover. After the
// user drags a box over the title block, the app reads the sheet's own text and
// proposes the sheet number / name / architect firm; this popover lets the human
// confirm or edit each field, then banks it (with provenance) to `sheet_metadata`.
// A workbench sibling of `WorkbenchLabelPopover`: same glass styling + native-event
// isolation (overscroll-contain), three plain text fields instead of a taxonomy.
// Transient field drafts stay local useState (like the room popover's pick/flags);
// the popover VISIBILITY + the frozen proposal live in `useWorkbenchStore` (§2).

interface TitleBlockPopoverProps {
  /**
   * The FROZEN parser proposal that seeded the fields (null = nothing was read,
   * fully-manual entry). Used for the "suggested" hint; the SAVE source derivation
   * (ai_accepted/ai_edited vs human) uses it upstream in the tracer.
   */
  proposal: TitleBlockFields | null;
  isSaving: boolean;
  saveError?: string | null;
  /** Confirm: hands the edited fields up to the tracer's `sheet_metadata` upsert. */
  onSave: (fields: TitleBlockFields) => void;
  onCancel: () => void;
}

const fieldClass =
  'w-full text-sm border border-slate-300/80 dark:border-white/15 rounded-xl px-2.5 py-1.5 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 focus:ring-violet-500/50';
const labelClass = 'block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1';

export default function TitleBlockPopover({
  proposal,
  isSaving,
  saveError,
  onSave,
  onCancel,
}: TitleBlockPopoverProps) {
  const [sheetNumber, setSheetNumber] = useState(proposal?.sheetNumber ?? '');
  const [sheetName, setSheetName] = useState(proposal?.sheetName ?? '');
  const [architectFirm, setArchitectFirm] = useState(proposal?.architectFirm ?? '');

  const isBlank =
    sheetNumber.trim().length === 0 &&
    sheetName.trim().length === 0 &&
    architectFirm.trim().length === 0;
  const canSave = !isBlank && !isSaving;
  // Did the parser propose anything at all? (vs. a fully-blank box / scanned sheet)
  const hadProposal =
    !!proposal && !!(proposal.sheetNumber || proposal.sheetName || proposal.architectFirm);

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      sheetNumber: sheetNumber.trim() || null,
      sheetName: sheetName.trim() || null,
      architectFirm: architectFirm.trim() || null,
    });
  };

  return (
    <div
      className="absolute top-6 right-6 z-[60] w-72 rounded-2xl border p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200 backdrop-blur-md max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain"
      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
    >
      <h2 className="text-sm font-bold mb-1.5 flex items-center gap-1.5 text-slate-900 dark:text-white">
        <ScanText size={15} className="text-violet-500" />
        Title block
      </h2>

      {hadProposal ? (
        <p className="mb-3 flex items-center gap-1.5 text-[11px] font-medium text-violet-600 dark:text-violet-300">
          <Sparkles size={13} className="shrink-0" />
          Read from the title block — confirm or edit.
        </p>
      ) : (
        <p className="mb-3 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          No text found in that box — type the fields, or cancel and drag a tighter box.
        </p>
      )}

      <div className="space-y-3">
        <div>
          <label htmlFor="tbNumber" className={labelClass}>
            Sheet number
          </label>
          <input
            id="tbNumber"
            type="text"
            autoFocus
            className={fieldClass}
            placeholder="e.g. A-201"
            value={sheetNumber}
            onChange={(e) => setSheetNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') onCancel();
            }}
          />
        </div>

        <div>
          <label htmlFor="tbName" className={labelClass}>
            Sheet name
          </label>
          <input
            id="tbName"
            type="text"
            className={fieldClass}
            placeholder="e.g. SECOND FLOOR PLAN"
            value={sheetName}
            onChange={(e) => setSheetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') onCancel();
            }}
          />
        </div>

        <div>
          <label htmlFor="tbFirm" className={labelClass}>
            Architect / firm
          </label>
          <input
            id="tbFirm"
            type="text"
            className={fieldClass}
            placeholder="e.g. RSP Architects"
            value={architectFirm}
            onChange={(e) => setArchitectFirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') onCancel();
            }}
          />
          <p className="mt-1 text-[10px] leading-tight text-slate-400">
            Groups the corpus + tunes later sheets in the set.
          </p>
        </div>
      </div>

      {saveError && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
          <FileWarning size={13} className="shrink-0 mt-px" />
          <span>{saveError}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-xl border border-slate-300/80 dark:border-white/15 font-medium text-xs hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="px-3 py-1.5 rounded-xl bg-violet-500 hover:bg-violet-600 font-bold text-white text-xs shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
