'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, FileWarning } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkbenchContainer, useWorkbenchSheets } from '@/hooks/useWorkbench';
import WorkbenchTracer from '@/components/workbench/WorkbenchTracer';
import WorkbenchReviewControl from '@/components/workbench/WorkbenchReviewControl';
import type { WorkbenchDrawing } from '@/types/domain';

// Location Labeling Workbench — Phase 6 tracing route. A dedicated full-page
// sub-route (not a modal) because it hosts a zoom/pan tracing canvas. It resolves
// the drawing the SAME way the library does — through `useWorkbenchSheets`, which
// is always scoped to the hidden `kind='workbench'` container — so only a genuine
// workbench drawing can ever open here (a non-workbench sheet id simply isn't found).

export default function WorkbenchTracerPage() {
  const params = useParams();
  const sheetId = params?.sheetId as string;

  const { session } = useAuth();
  const userId = session?.user?.id;

  const {
    data: container,
    isLoading: containerLoading,
    isError: containerError,
    error: containerErr,
  } = useWorkbenchContainer(userId);

  // Include archived drawings here so an archived (recoverable) drawing still
  // opens in the tracer — e.g. opened from the "Show archived" view to inspect or
  // restore it. Still container-scoped (Phase 8b).
  const { data: drawings, isLoading: drawingsLoading } = useWorkbenchSheets(container?.id, {
    includeArchived: true,
  });

  const drawing = drawings?.find((d) => d.id === sheetId);
  const loading = containerLoading || (!!container && drawingsLoading);

  return (
    <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <header className="shrink-0 border-b border-slate-200 dark:border-white/10 px-4 md:px-8 py-4">
        <Link
          href="/workbench"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
        >
          <ArrowLeft size={16} />
          Back to Library
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {drawing?.sheet_name || 'Drawing'}
          </h1>
          {drawing && <DrawingMeta drawing={drawing} />}
          {drawing && container && (
            <div className="ml-auto">
              <WorkbenchReviewControl drawing={drawing} containerId={container.id} userId={userId} />
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col p-3 md:p-5">
        {containerError ? (
          <CenteredError message={containerErr instanceof Error ? containerErr.message : undefined} />
        ) : loading ? (
          <CenteredSpinner />
        ) : !drawing ? (
          <CenteredError message="This drawing isn’t in the Drawing Library. It may have been removed." />
        ) : (
          <WorkbenchTracer drawing={drawing} />
        )}
      </main>
    </div>
  );
}

function DrawingMeta({ drawing }: { drawing: WorkbenchDrawing }) {
  const meta = drawing.workbench;
  const chips = [
    meta?.sheet_project_type,
    meta?.level_label,
    meta?.source_sheet_number,
    meta?.vector_quality,
    meta?.is_partial ? 'Partial' : null,
  ].filter((c): c is string => !!c);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((label) => (
        <span
          key={label}
          className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function CenteredSpinner() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="animate-spin w-8 h-8 text-violet-500" />
    </div>
  );
}

function CenteredError({ message }: { message?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-6 flex items-start gap-3 max-w-md">
        <FileWarning className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-bold text-rose-700 dark:text-rose-300 mb-1">Could not open this drawing</h3>
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {message || 'Something went wrong. Go back to the library and try again.'}
          </p>
        </div>
      </div>
    </div>
  );
}
