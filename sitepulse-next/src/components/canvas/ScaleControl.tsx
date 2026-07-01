"use client";
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Ruler } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';
import {
  useSheetById,
  useUpdateSheetScale,
  useUnits,
  useRecalculateSheetAreas,
  type RecalculateAreaUpdate,
} from '@/hooks/useProjectQueries';
import {
  ARCH_SCALE_PRESETS,
  presetUnitsPerPx,
  describeScale,
  computeAreaFromUnitsPerPx,
} from '@/utils/scale';
import { isScaleCalibration, isPercentPointArray } from '@/types/domain';
import { loadImageDimensions } from '@/utils/imageDimensions';

/**
 * Scale tool (Scale, Measure & Production Rates — Phase 2). A ruler button in the
 * top-left dock that opens a glass popover to SET a drawing's real-world scale (by
 * an architectural preset now; by drawing a calibration line in 2b) and READ the
 * current scale back in plain words.
 *
 * Self-contained on purpose: it resolves the active sheet by PK ({@link useSheetById})
 * and keys the write off that sheet's own `project_id`, so it behaves identically on
 * the live map and in the workbench (where there is no `projectId` route param and
 * the sheet is cached under a different key). Mounted once by `FloorplanCanvas` via
 * `ViewportControls`.
 */
export default function ScaleControl() {
  const activeSheetId = useMapStore(s => s.activeSheetId);
  const setToolMode = useMapStore(s => s.setToolMode);
  const { data: sheet } = useSheetById(activeSheetId || null);
  const projectId = (sheet?.project_id as string) || '';
  const updateScale = useUpdateSheetScale(projectId);
  const { data: units = [] } = useUnits(activeSheetId || '');
  const recalc = useRecalculateSheetAreas(activeSheetId || '');

  const [isOpen, setIsOpen] = useState(false);
  // Recalculate flow: 'idle' → 'confirm' (show the affected count) → write.
  const [confirmingRecalc, setConfirmingRecalc] = useState(false);
  const [recalcResult, setRecalcResult] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside pointer-down / wheel — same UX as ZoomIndicator. Clicks
  // INSIDE the popover are excluded so choosing a preset doesn't dismiss it.
  useEffect(() => {
    if (!isOpen) return;
    const close = (e?: Event) => {
      if (e && wrapRef.current && e.target instanceof Node && wrapRef.current.contains(e.target)) return;
      setIsOpen(false);
    };
    window.addEventListener('pointerdown', close, { capture: true });
    window.addEventListener('wheel', () => setIsOpen(false), { passive: true });
    return () => {
      window.removeEventListener('pointerdown', close, { capture: true });
      window.removeEventListener('wheel', () => setIsOpen(false));
    };
  }, [isOpen]);

  const calibration = isScaleCalibration(sheet?.scale_calibration) ? sheet!.scale_calibration : null;
  const readout = describeScale({
    unitsPerPx: sheet?.scale_units_per_px,
    preset: sheet?.scale_preset,
    source: calibration?.source ?? null,
  });

  // The preset currently selected (only if it's one of our known presets — a
  // legacy custom ratio has no matching option).
  const activePresetLabel = ARCH_SCALE_PRESETS.some(p => p.label === sheet?.scale_preset)
    ? sheet?.scale_preset
    : '';

  const applyPreset = (label: string) => {
    const preset = ARCH_SCALE_PRESETS.find(p => p.label === label);
    if (!preset || !sheet) return;
    updateScale.mutate({
      sheetId: sheet.id,
      scale_preset: preset.label,
      // Legacy linear factor = real inches per paper inch (mirrors SettingsMenu).
      scale_ratio: preset.realFeetPerPaperInch * 12,
      scale_units_per_px: presetUnitsPerPx(preset.realFeetPerPaperInch),
      scale_unit: 'ft',
      scale_calibration: {
        // Preset provenance: no measured line, so store the canonical unit and the
        // ratio's real feet-per-paper-inch. The caller stamps `at` (scale.ts stays
        // Date.now()-free).
        p1: { pctX: 0, pctY: 0 },
        p2: { pctX: 1, pctY: 1 },
        length: preset.realFeetPerPaperInch,
        unit: 'ft',
        source: 'preset',
        preset: preset.label,
        at: new Date().toISOString(),
      },
    });
  };

  // Reset the Recalculate flow whenever the popover closes or the sheet changes,
  // so a stale confirm/result can't carry over to another drawing.
  useEffect(() => {
    setConfirmingRecalc(false);
    setRecalcResult(null);
  }, [isOpen, activeSheetId]);

  const hasScale = typeof sheet?.scale_units_per_px === 'number' && sheet.scale_units_per_px > 0;

  // Locations on this sheet whose area we can recompute — a valid closed polygon.
  const recalcTargets = useMemo(
    () => units.filter(u => isPercentPointArray(u.polygon_coordinates) && u.polygon_coordinates.length >= 3),
    [units],
  );

  // Recompute every eligible unit's area from the sheet's current scale and write
  // them in one bulk pass. Loads the base-image natural dims ONCE (the same basis
  // the create paths use), then applies computeAreaFromUnitsPerPx per polygon.
  const runRecalculate = async () => {
    if (!sheet || !hasScale) return;
    const url = sheet.base_image_url;
    if (!url) {
      setRecalcResult('This drawing has no base image to measure against.');
      setConfirmingRecalc(false);
      return;
    }
    const dims = await loadImageDimensions(url);
    if (!dims || !dims.width || !dims.height) {
      setRecalcResult("Couldn't read the drawing's dimensions. Try again.");
      setConfirmingRecalc(false);
      return;
    }
    const updates: RecalculateAreaUpdate[] = recalcTargets.map(u => ({
      unitId: u.id,
      computed_area: computeAreaFromUnitsPerPx(
        u.polygon_coordinates!,
        dims.width,
        dims.height,
        sheet.scale_units_per_px,
      ),
    }));
    try {
      const n = await recalc.mutateAsync(updates);
      setRecalcResult(`Updated the square footage on ${n} location${n === 1 ? '' : 's'}.`);
    } catch {
      setRecalcResult("Couldn't update areas. Check your connection and try again.");
    } finally {
      setConfirmingRecalc(false);
    }
  };

  const disabled = !sheet;

  return (
    <div ref={wrapRef} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        disabled={disabled}
        className={`p-2.5 rounded-xl transition-colors flex items-center justify-center
          ${isOpen
            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
            : 'text-slate-600 hover:text-slate-900 hover:bg-white/50 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/10'}
          ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        title="Drawing scale"
      >
        <Ruler size={20} />
      </button>

      {isOpen && sheet && (
        <div
          className="absolute left-full top-0 ml-2 w-64 rounded-xl border shadow-xl backdrop-blur-md p-3 z-30"
          style={{
            background: 'var(--glass-bg, rgba(255, 255, 255, 0.95))',
            borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
          }}
        >
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">Drawing scale</div>

          {/* Current-scale readout */}
          <div className="mb-3 px-2.5 py-2 rounded-lg bg-slate-100/70 dark:bg-white/5 text-xs font-medium text-slate-700 dark:text-slate-200 tabular-nums">
            {readout}
          </div>

          {/* Preset dropdown */}
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
            Architectural preset
          </label>
          <select
            value={activePresetLabel || ''}
            onChange={(e) => applyPreset(e.target.value)}
            disabled={updateScale.isPending}
            className="w-full text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 mb-1 disabled:opacity-50"
          >
            <option value="" disabled>Choose a scale…</option>
            {ARCH_SCALE_PRESETS.map(p => (
              <option key={p.label} value={p.label}>{p.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3">
            Presets are approximate. Calibrate for an exact scale.
          </p>

          {/* Calibrate — drop a 2-point line on a known dimension (handled on the canvas). */}
          <button
            type="button"
            onClick={() => { setToolMode('calibrate'); setIsOpen(false); }}
            className="w-full text-sm font-semibold rounded-lg px-3 py-1.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
            title="Draw a line on a known dimension, then type its real length"
          >
            Calibrate by drawing a line
          </button>

          {/* Recalculate — refresh SF on every traced location from the current scale. */}
          <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-white/10">
            {recalcResult ? (
              <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 px-1">
                {recalcResult}
              </p>
            ) : confirmingRecalc ? (
              <div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 mb-2 px-1">
                  This will update the square footage on{' '}
                  <span className="font-bold">{recalcTargets.length}</span>{' '}
                  location{recalcTargets.length === 1 ? '' : 's'} on this drawing. Continue?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={runRecalculate}
                    disabled={recalc.isPending}
                    className="flex-1 text-sm font-semibold rounded-lg px-3 py-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                  >
                    {recalc.isPending ? 'Updating…' : 'Continue'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRecalc(false)}
                    disabled={recalc.isPending}
                    className="flex-1 text-sm font-semibold rounded-lg px-3 py-1.5 bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmingRecalc(true)}
                  disabled={!hasScale || recalcTargets.length === 0}
                  className="w-full text-sm font-semibold rounded-lg px-3 py-1.5 text-slate-700 dark:text-slate-200 bg-slate-500/10 hover:bg-slate-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Refresh the square footage on every traced location using the current scale"
                >
                  Recalculate areas on this drawing
                </button>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 px-1">
                  {!hasScale
                    ? 'Set a scale first to enable this.'
                    : recalcTargets.length === 0
                      ? 'No traced locations to update yet.'
                      : `Refreshes SF on ${recalcTargets.length} location${recalcTargets.length === 1 ? '' : 's'}.`}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
