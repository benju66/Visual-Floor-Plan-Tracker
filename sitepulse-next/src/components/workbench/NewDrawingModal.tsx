'use client';

import React, { useState } from 'react';
import { FilePlus, X, Loader2, FileWarning, FileText } from 'lucide-react';
import { useCreateWorkbenchDrawing } from '@/hooks/useWorkbenchActions';
import { PROJECT_TYPES, type ProjectType } from '@/utils/locationTaxonomy';
import { VECTOR_QUALITIES, type VectorQuality } from '@/utils/workbench';

// Location Labeling Workbench — Phase 5 capture form. Opens from the Drawing
// Library; uploads a historical PDF through the EXISTING upload pipeline and
// captures the §8 per-drawing metadata into the `workbench_sheets` sidecar.
// Visibility is owned by useWorkbenchStore (Zustand); the transient field values
// stay local `useState` here, the same split as the dashboard New Project modal.

const VECTOR_QUALITY_LABELS: Record<VectorQuality, string> = {
  clean: 'Clean — vector PDF (snapping works)',
  scanned: 'Scanned — raster image (no snapping)',
};

const inputClass =
  'w-full bg-slate-50 dark:bg-black/20 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50';
const labelClass = 'block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2';

export default function NewDrawingModal({
  containerId,
  onClose,
}: {
  containerId: string | undefined;
  onClose: () => void;
}) {
  const [sheetName, setSheetName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pageNumber, setPageNumber] = useState('1');
  const [sheetProjectType, setSheetProjectType] = useState<ProjectType | ''>('');
  const [levelLabel, setLevelLabel] = useState('');
  const [sourceSheetNumber, setSourceSheetNumber] = useState('');
  const [sourceBuilding, setSourceBuilding] = useState('');
  const [vectorQuality, setVectorQuality] = useState<VectorQuality | ''>('');
  const [isPartial, setIsPartial] = useState(false);

  const createDrawing = useCreateWorkbenchDrawing(containerId);
  const busy = createDrawing.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !sheetName.trim() || busy) return;
    const pdfPageNumber = Math.max(1, parseInt(pageNumber, 10) || 1);
    try {
      await createDrawing.mutateAsync({
        file,
        sheetName,
        pdfPageNumber,
        sheetProjectType,
        levelLabel,
        sourceSheetNumber,
        sourceBuilding,
        vectorQuality,
        isPartial,
      });
      onClose();
    } catch {
      // Surfaced inline via createDrawing.error below; keep the modal open.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-white/5">
          <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white">
            <FilePlus size={20} className="text-violet-500" />
            New drawing
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto">
          <div className="mb-5">
            <label htmlFor="wbName" className={labelClass}>
              Drawing name
            </label>
            <input
              id="wbName"
              type="text"
              autoFocus
              required
              disabled={busy}
              className={inputClass}
              placeholder="e.g. Oakhaven Tower — Level 3"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
            />
          </div>

          <div className="mb-5">
            <label htmlFor="wbFile" className={labelClass}>
              Floor plan PDF
            </label>
            <input
              id="wbFile"
              type="file"
              accept=".pdf"
              required
              disabled={busy}
              className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-violet-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-violet-700 dark:file:bg-violet-900/40 dark:file:text-violet-300`}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <FileText size={13} className="shrink-0" />
                <span className="truncate">{file.name}</span>
              </p>
            )}
          </div>

          <div className="mb-5">
            <label htmlFor="wbPage" className={labelClass}>
              PDF page number
            </label>
            <input
              id="wbPage"
              type="number"
              min="1"
              disabled={busy}
              className={inputClass}
              value={pageNumber}
              onChange={(e) => setPageNumber(e.target.value)}
            />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Which page of the PDF holds this floor plan? (Historical sets are often multi-page.)
            </p>
          </div>

          <div className="mb-5">
            <label htmlFor="wbProjectType" className={labelClass}>
              Project type <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <select
              id="wbProjectType"
              disabled={busy}
              className={inputClass}
              value={sheetProjectType}
              onChange={(e) => setSheetProjectType(e.target.value as ProjectType | '')}
            >
              <option value="">— Not set —</option>
              {PROJECT_TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {pt}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              The drawing’s vertical — workbench drawings are mixed, so this is set per drawing (not per project).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label htmlFor="wbLevel" className={labelClass}>
                Level label <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="wbLevel"
                type="text"
                disabled={busy}
                className={inputClass}
                placeholder="e.g. L3"
                value={levelLabel}
                onChange={(e) => setLevelLabel(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="wbSheetNo" className={labelClass}>
                Source sheet # <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="wbSheetNo"
                type="text"
                disabled={busy}
                className={inputClass}
                placeholder="e.g. A-201"
                value={sourceSheetNumber}
                onChange={(e) => setSourceSheetNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="mb-5">
            <label htmlFor="wbBuilding" className={labelClass}>
              Source building <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="wbBuilding"
              type="text"
              disabled={busy}
              className={inputClass}
              placeholder="e.g. Oakhaven Tower"
              value={sourceBuilding}
              onChange={(e) => setSourceBuilding(e.target.value)}
            />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Group sheets from the same building under one tag — keeps them together when
              splitting training vs. test data (mixing them inflates model accuracy).
            </p>
          </div>

          <div className="mb-5">
            <label htmlFor="wbVector" className={labelClass}>
              Vector quality <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <select
              id="wbVector"
              disabled={busy}
              className={inputClass}
              value={vectorQuality}
              onChange={(e) => setVectorQuality(e.target.value as VectorQuality | '')}
            >
              <option value="">— Not set —</option>
              {VECTOR_QUALITIES.map((vq) => (
                <option key={vq} value={vq}>
                  {VECTOR_QUALITY_LABELS[vq]}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-3 mb-2 cursor-pointer select-none">
            <input
              type="checkbox"
              disabled={busy}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-violet-600 focus:ring-violet-500"
              checked={isPartial}
              onChange={(e) => setIsPartial(e.target.checked)}
            />
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Partial drawing
              <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                Only part of the floor is shown on this sheet.
              </span>
            </span>
          </label>

          {createDrawing.isError && (
            <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl text-sm text-rose-600 dark:text-rose-400 flex items-start gap-2">
              <FileWarning size={16} className="shrink-0 mt-0.5" />
              <span>
                {createDrawing.error instanceof Error
                  ? createDrawing.error.message
                  : 'Upload failed. Please try again.'}
              </span>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-8">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !sheetName.trim() || !file}
              className="px-5 py-2.5 rounded-xl text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              {busy ? 'Uploading…' : 'Upload & save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
