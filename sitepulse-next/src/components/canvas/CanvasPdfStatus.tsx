"use client";
import React from 'react';

export interface CanvasPdfStatusProps {
  pdfLoading: boolean;
  pdfSharpening: boolean;
  pdfError: string | null;
  pdfRetry: (() => void) | null;
}

/**
 * The PDF pipeline's floating status chrome (FloorplanCanvas Decomposition —
 * Phase 10): the initial "Loading drawing…" overlay, the non-blocking
 * "Sharpening…" chip while the base LOD renders behind the preview, and the
 * error card with its retry button. Pure presentation over the four pieces of
 * PdfBaseLayer-driven state the parent owns.
 */
export default function CanvasPdfStatus({
  pdfLoading,
  pdfSharpening,
  pdfError,
  pdfRetry,
}: CanvasPdfStatusProps) {
  return (
    <>
      {/* PDF Loading overlay — shown during initial download+render */}
      {pdfLoading && !pdfError && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="flex items-center gap-3 bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm px-4 py-2 rounded-lg shadow-sm border border-slate-200/60 dark:border-white/10">
            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">Loading drawing...</span>
          </div>
        </div>
      )}

      {/* Sharpening chip — preview visible and interactive, base LOD still rendering */}
      {!pdfLoading && !pdfError && pdfSharpening && (
        <div className="absolute bottom-3 left-3 z-10 pointer-events-none">
          <div className="flex items-center gap-2 bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border border-slate-200/60 dark:border-white/10">
            <div className="animate-spin h-3.5 w-3.5 border-2 border-blue-500 border-t-transparent rounded-full" />
            <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Sharpening…</span>
          </div>
        </div>
      )}

      {/* PDF Error overlay — shown when download/render fails */}
      {pdfError && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-6 py-4 rounded-xl shadow-lg border border-red-200/30 dark:border-red-900/30">
            <p className="text-sm text-red-500 font-bold">Failed to load drawing</p>
            <p className="text-xs text-slate-500 max-w-64 text-center">{pdfError}</p>
            {pdfRetry && (
              <button
                type="button"
                onClick={pdfRetry}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-4 py-1.5 rounded-lg shadow-sm font-medium transition-all"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
