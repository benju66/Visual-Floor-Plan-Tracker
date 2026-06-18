'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Library,
  Loader2,
  FileWarning,
  Layers,
  FilePlus,
  PenLine,
  Archive,
  ArchiveRestore,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import {
  useWorkbenchContainer,
  useWorkbenchSheets,
  useWorkbenchCorpusUnits,
} from '@/hooks/useWorkbench';
import {
  useArchiveWorkbenchDrawing,
  useRestoreWorkbenchDrawing,
} from '@/hooks/useWorkbenchActions';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';
import NewDrawingModal from '@/components/workbench/NewDrawingModal';
import WorkbenchHealthStrip from '@/components/workbench/WorkbenchHealthStrip';
import { withVersion } from '@/utils/pdfSource';
import { REVIEW_STATE_BADGE, REVIEW_STATE_LABELS, narrowReviewState } from '@/utils/workbench';
import { summarizeCorpus } from '@/utils/workbenchStats';
import type { WorkbenchDrawing } from '@/types/domain';

// Location Labeling Workbench — Phase 4 shell.
// A standalone full-page "Drawing Library" surface (its own route, NOT a modal,
// because Phase 6 mounts a zoom/pan tracing canvas here). This phase renders the
// shell + the (initially empty) list only — deliberately NO status / schedule /
// bulk / sync controls anywhere (those never belong in the workbench). PDF
// upload arrives in Phase 5, tracing in Phase 6.

export default function WorkbenchPage() {
  // AuthProvider is JS and exposes an untyped context — narrow it here at the
  // boundary so the rest of the component is type-clean (AGENTS.md §6).
  const { session } = useAuth() as { session: { user?: { id?: string } } | null };
  const userId = session?.user?.id;

  const {
    data: container,
    isLoading: containerLoading,
    isError: containerError,
    error: containerErr,
  } = useWorkbenchContainer(userId);

  const isNewDrawingOpen = useWorkbenchStore((s) => s.isNewDrawingOpen);
  const setIsNewDrawingOpen = useWorkbenchStore((s) => s.setIsNewDrawingOpen);
  const isHealthStripCollapsed = useWorkbenchStore((s) => s.isHealthStripCollapsed);
  const setIsHealthStripCollapsed = useWorkbenchStore((s) => s.setIsHealthStripCollapsed);
  const showArchived = useWorkbenchStore((s) => s.showArchivedDrawings);
  const setShowArchived = useWorkbenchStore((s) => s.setShowArchivedDrawings);

  // Soft-delete (Phase 8b): the grid shows archived drawings only when "Show
  // archived" is on; the hook excludes them by default.
  const { data: drawings, isLoading: drawingsLoading } = useWorkbenchSheets(container?.id, {
    includeArchived: showArchived,
  });

  // Container-scoped label aggregate for the corpus-health strip (Phase 8a) —
  // the contamination guard keeps this scoped to the workbench container's own
  // sheets; it never touches the live dashboard or `progressAnalytics`.
  const { data: corpusUnits } = useWorkbenchCorpusUnits(container?.id);

  // The health strip ALWAYS summarizes the ACTIVE corpus only — archived drawings
  // are excluded from the metrics regardless of whether the grid is showing them
  // (Phase 8b). With "Show archived" off, `drawings` is already active-only.
  const activeDrawings = React.useMemo(
    () => (drawings ?? []).filter((d) => !d.workbench?.deleted_at),
    [drawings],
  );
  const summary = React.useMemo(
    () => summarizeCorpus(activeDrawings, corpusUnits ?? {}),
    [activeDrawings, corpusUnits],
  );

  const archiveDrawing = useArchiveWorkbenchDrawing(container?.id);
  const restoreDrawing = useRestoreWorkbenchDrawing(container?.id);
  const handleArchive = (sheetId: string) =>
    archiveDrawing.mutate({ sheetId, archivedBy: userId ?? null });
  const handleRestore = (sheetId: string) => restoreDrawing.mutate(sheetId);
  const archivingId = archiveDrawing.isPending ? archiveDrawing.variables?.sheetId : undefined;
  const restoringId = restoreDrawing.isPending ? restoreDrawing.variables : undefined;

  const loading = containerLoading || (!!container && drawingsLoading);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 px-4 py-8 md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-5"
          >
            <ArrowLeft size={16} />
            Back to Dashboard
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3 mb-2">
                <span className="p-2 bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 rounded-xl">
                  <Library size={28} />
                </span>
                Drawing Library
              </h1>
              <p className="text-slate-500 dark:text-slate-400 font-medium">
                Bank clean, standard-compliant location labels from historical drawings — separate from your live project trackers.
              </p>
            </div>
            {container && (
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  aria-pressed={showArchived}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                    showArchived
                      ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 border-slate-300 dark:border-slate-600'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {showArchived ? <EyeOff size={16} /> : <Eye size={16} />}
                  {showArchived ? 'Hide archived' : 'Show archived'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsNewDrawingOpen(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition-colors"
                >
                  <FilePlus size={18} />
                  New drawing
                </button>
              </div>
            )}
          </div>
        </header>

        {containerError ? (
          <ErrorState message={containerErr instanceof Error ? containerErr.message : undefined} />
        ) : loading ? (
          <LoadingState />
        ) : drawings && drawings.length > 0 ? (
          <>
            {/* The strip reflects the active corpus only — hidden when there's
                nothing active (e.g. viewing an all-archived library). */}
            {activeDrawings.length > 0 && (
              <WorkbenchHealthStrip
                summary={summary}
                collapsed={isHealthStripCollapsed}
                onToggle={() => setIsHealthStripCollapsed((v) => !v)}
              />
            )}
            <DrawingGrid
              drawings={drawings}
              onArchive={handleArchive}
              onRestore={handleRestore}
              archivingId={archivingId}
              restoringId={restoringId}
            />
          </>
        ) : (
          <EmptyState onNewDrawing={() => setIsNewDrawingOpen(true)} />
        )}
      </div>

      {isNewDrawingOpen && container && (
        <NewDrawingModal
          containerId={container.id}
          onClose={() => setIsNewDrawingOpen(false)}
        />
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="animate-spin w-8 h-8 text-violet-500" />
    </div>
  );
}

function ErrorState({ message }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-6 flex items-start gap-3">
      <FileWarning className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
      <div>
        <h3 className="font-bold text-rose-700 dark:text-rose-300 mb-1">Could not open the Drawing Library</h3>
        <p className="text-sm text-rose-600 dark:text-rose-400">
          {message || 'Something went wrong setting up the workbench. Please refresh to try again.'}
        </p>
      </div>
    </div>
  );
}

function EmptyState({ onNewDrawing }: { onNewDrawing: () => void }) {
  return (
    <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-10 flex flex-col items-center justify-center text-center min-h-[320px]">
      <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full mb-4 text-slate-400">
        <Layers size={32} />
      </div>
      <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-1">No drawings yet</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6">
        This is where historical PDFs you trace for labels will live. Upload a drawing to get started.
      </p>
      <button
        type="button"
        onClick={onNewDrawing}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition-colors"
      >
        <FilePlus size={18} />
        New drawing
      </button>
    </div>
  );
}

interface DrawingGridProps {
  drawings: WorkbenchDrawing[];
  onArchive: (sheetId: string) => void;
  onRestore: (sheetId: string) => void;
  /** The drawing id currently being archived (per-card spinner), if any. */
  archivingId?: string;
  /** The drawing id currently being restored (per-card spinner), if any. */
  restoringId?: string;
}

function DrawingGrid({ drawings, onArchive, onRestore, archivingId, restoringId }: DrawingGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {drawings.map((drawing) => (
        <DrawingCard
          key={drawing.id}
          drawing={drawing}
          onArchive={onArchive}
          onRestore={onRestore}
          pending={drawing.id === archivingId || drawing.id === restoringId}
        />
      ))}
    </div>
  );
}

interface DrawingCardProps {
  drawing: WorkbenchDrawing;
  onArchive: (sheetId: string) => void;
  onRestore: (sheetId: string) => void;
  /** Whether THIS card's archive/restore write is in flight. */
  pending: boolean;
}

function DrawingCard({ drawing, onArchive, onRestore, pending }: DrawingCardProps) {
  const meta = drawing.workbench;
  const reviewState = narrowReviewState(meta?.review_state);
  const isArchived = !!meta?.deleted_at;
  const preview = drawing.base_image_url
    ? withVersion(drawing.base_image_url, drawing.pdf_version)
    : null;

  // The action button is a SIBLING of the <Link>, never nested inside it — an
  // interactive control inside an <a> is invalid HTML and would fight the
  // navigation. preventDefault/stopPropagation are belt-and-braces (Phase 8b).
  const handleAction = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    if (isArchived) onRestore(drawing.id);
    else onArchive(drawing.id);
  };

  return (
    <div
      className={`group relative bg-white dark:bg-slate-900/50 border rounded-2xl shadow-sm overflow-hidden transition-all ${
        isArchived
          ? 'border-slate-200 dark:border-white/10'
          : 'border-slate-200 dark:border-white/10 hover:border-violet-400 dark:hover:border-violet-500/50 hover:shadow-md'
      }`}
    >
      <Link
        href={`/workbench/${drawing.id}`}
        className={`block ${isArchived ? 'opacity-60 hover:opacity-90 transition-opacity' : ''}`}
      >
        <div className="relative aspect-[4/3] bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- public storage URL, not a Next asset
            <img
              src={preview}
              alt={`${drawing.sheet_name || 'Drawing'} preview`}
              className="w-full h-full object-contain"
            />
          ) : (
            <Layers size={32} className="text-slate-400" />
          )}
          {/* Review-state badge — display-only (matches the tracer header badge), so
              it stays inside the card link without nesting an interactive control. */}
          <span
            className={`absolute top-2.5 right-2.5 inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border shadow-sm ${REVIEW_STATE_BADGE[reviewState]}`}
          >
            {REVIEW_STATE_LABELS[reviewState]}
          </span>
        </div>
        <div className="p-6">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2 line-clamp-1">
            {drawing.sheet_name || 'Untitled drawing'}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {isArchived && (
              <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
                Archived
              </span>
            )}
            {meta?.sheet_project_type && <MetaChip label={meta.sheet_project_type} />}
            {meta?.level_label && <MetaChip label={meta.level_label} />}
            {meta?.source_sheet_number && <MetaChip label={meta.source_sheet_number} />}
            {meta?.vector_quality && <MetaChip label={meta.vector_quality} />}
            {meta?.is_partial && <MetaChip label="Partial" />}
          </div>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-600 dark:text-violet-400 opacity-80 group-hover:opacity-100 transition-opacity">
            <PenLine size={15} />
            {isArchived ? 'Open to inspect' : 'Open to trace'}
          </span>
        </div>
      </Link>

      {/* Archive (active) / Restore (archived) — outside the Link. Archive only
          appears on hover/focus to keep the card clean; Restore is always shown so
          an archived drawing is one click from coming back. */}
      <button
        type="button"
        onClick={handleAction}
        disabled={pending}
        aria-label={isArchived ? `Restore ${drawing.sheet_name || 'drawing'}` : `Archive ${drawing.sheet_name || 'drawing'}`}
        className={`absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold border shadow-sm backdrop-blur transition disabled:opacity-60 disabled:cursor-wait focus-visible:opacity-100 ${
          isArchived
            ? 'bg-white/90 dark:bg-slate-800/90 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
            : 'opacity-0 group-hover:opacity-100 bg-white/90 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:hover:bg-rose-500/10 dark:hover:text-rose-300'
        }`}
      >
        {pending ? (
          <Loader2 size={13} className="animate-spin" />
        ) : isArchived ? (
          <ArchiveRestore size={13} />
        ) : (
          <Archive size={13} />
        )}
        {isArchived ? 'Restore' : 'Archive'}
      </button>
    </div>
  );
}

function MetaChip({ label }: { label: string }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300">
      {label}
    </span>
  );
}
