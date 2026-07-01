"use client";
import React from 'react';
import { RulerDimensionLine } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';
import { useSheetById } from '@/hooks/useProjectQueries';

/**
 * Measure tool button (Scale, Measure & Production Rates — Phase 4). A tape-measure
 * button in the top-left dock that toggles `toolMode 'measure'`: drop 2..N snapped
 * points on the canvas and read the running length back in fractional feet-inches
 * (the readout + fraction selector render on the canvas while the tool is active).
 *
 * Self-contained like {@link ScaleControl}: it resolves the active sheet by PK so it
 * behaves identically on the live map and in the workbench, and it DISABLES itself on
 * an un-scaled sheet (no `scale_units_per_px`) — you can't measure without a scale, so
 * it points you at the ruler tool instead of showing a wrong number. Mounted once by
 * `FloorplanCanvas` via `ViewportControls`.
 */
export default function MeasureControl() {
  const activeSheetId = useMapStore(s => s.activeSheetId);
  const toolMode = useMapStore(s => s.toolMode);
  const setToolMode = useMapStore(s => s.setToolMode);
  const { data: sheet } = useSheetById(activeSheetId || null);

  const hasScale = typeof sheet?.scale_units_per_px === 'number' && sheet.scale_units_per_px > 0;
  const isActive = toolMode === 'measure';
  const disabled = !sheet || !hasScale;

  return (
    <button
      type="button"
      onClick={() => setToolMode(isActive ? 'pan' : 'measure')}
      disabled={disabled}
      className={`p-2.5 rounded-xl transition-colors flex items-center justify-center
        ${isActive
          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
          : 'text-slate-600 hover:text-slate-900 hover:bg-white/50 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/10'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      title={
        !sheet
          ? 'Measure'
          : hasScale
            ? 'Measure a distance'
            : 'Set a scale first (ruler tool) to measure'
      }
    >
      <RulerDimensionLine size={20} />
    </button>
  );
}
