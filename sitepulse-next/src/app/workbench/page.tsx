'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Library, Loader2, FileWarning, Layers } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkbenchContainer, useWorkbenchSheets } from '@/hooks/useWorkbench';
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

  const { data: drawings, isLoading: drawingsLoading } = useWorkbenchSheets(container?.id);

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
          </div>
        </header>

        {containerError ? (
          <ErrorState message={containerErr instanceof Error ? containerErr.message : undefined} />
        ) : loading ? (
          <LoadingState />
        ) : drawings && drawings.length > 0 ? (
          <DrawingGrid drawings={drawings} />
        ) : (
          <EmptyState />
        )}
      </div>
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

function EmptyState() {
  return (
    <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-10 flex flex-col items-center justify-center text-center min-h-[320px]">
      <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full mb-4 text-slate-400">
        <Layers size={32} />
      </div>
      <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-1">No drawings yet</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md">
        This is where historical PDFs you trace for labels will live. Uploading drawings is coming next.
      </p>
    </div>
  );
}

function DrawingGrid({ drawings }: { drawings: WorkbenchDrawing[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {drawings.map((drawing) => (
        <DrawingCard key={drawing.id} drawing={drawing} />
      ))}
    </div>
  );
}

function DrawingCard({ drawing }: { drawing: WorkbenchDrawing }) {
  const meta = drawing.workbench;
  return (
    <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm">
      <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-300 w-fit mb-5">
        <Layers size={24} />
      </div>
      <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2 line-clamp-1">
        {drawing.sheet_name || 'Untitled drawing'}
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {meta?.sheet_project_type && <MetaChip label={meta.sheet_project_type} />}
        {meta?.level_label && <MetaChip label={meta.level_label} />}
        {meta?.is_partial && <MetaChip label="Partial" />}
      </div>
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
