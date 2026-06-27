'use client';

import React from 'react';
import { Hand, PenLine, MousePointer2, Magnet, Loader2, ScanText, Grid3x3, Grid2x2Check, DoorOpen } from 'lucide-react';
import { useMapStore, type ToolMode } from '@/store/useMapStore';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';
import { useSettingsStore, useHydratedStore } from '@/store/useSettingsStore';

// Minimal toolbar for the Location Labeling Workbench tracing view. Deliberately
// trimmed vs. the live `MapHorizontalToolbar`: it exposes ONLY geometry tools
// (pan / trace / select) + the magnetic-snapping toggle — no Lag Mode, walk
// route, legend, or hover-history, all of which are status/progress surfaces the
// workbench must never mount (plan § Phase 6). Tools drive the SHARED canvas via
// `useMapStore.toolMode`, the same store the canvas reads.

const TOOLS: { id: ToolMode; label: string; icon: React.ElementType }[] = [
  { id: 'pan', label: 'Pan (2)', icon: Hand },
  { id: 'draw', label: 'Trace a location (3)', icon: PenLine },
  { id: 'select', label: 'Select / adjust (1)', icon: MousePointer2 },
];

export default function WorkbenchTracerToolbar({
  isSnappingLoading,
  confirmedGridCount = 0,
  onToggleOpenings,
}: {
  isSnappingLoading?: boolean;
  /** How many gridlines are confirmed on this sheet — drives the grid-aware tooltip. */
  confirmedGridCount?: number;
  /**
   * Toggle the openings session (Phase 4a). Owned by the tracer so the same handler
   * backs both this button and the `O` keyboard shortcut; it coordinates closing the
   * capture-box sessions and the tool switch.
   */
  onToggleOpenings?: () => void;
}) {
  const toolMode = useMapStore((s) => s.toolMode);
  const setToolMode = useMapStore((s) => s.setToolMode);
  const setMapSettings = useSettingsStore((s) => s.setMapSettings);
  const enableSnapping = useHydratedStore((s) => s.mapSettings.enableSnapping, true);
  // Grid-aware snapping (Phase 3c): default on; only an explicit `false` is off.
  const gridAwareSnapping = useHydratedStore((s) => s.mapSettings.gridAwareSnapping, true) !== false;

  // Gridline annotator session (Phase 3b) + title-block flow share the capture-box
  // mode, so the two are mutually exclusive: activating one closes the other.
  const isGridlineOpen = useWorkbenchStore((s) => s.isGridlineOpen);
  const setIsGridlineOpen = useWorkbenchStore((s) => s.setIsGridlineOpen);
  const setGridProposal = useWorkbenchStore((s) => s.setGridProposal);
  const setPendingGridlines = useWorkbenchStore((s) => s.setPendingGridlines);
  const setIsTitleBlockOpen = useWorkbenchStore((s) => s.setIsTitleBlockOpen);

  // Openings session (Phase 4a) — tag floor-level passages while tracing / on a
  // selected room. Independent of the capture-box sessions; opening it closes them
  // (one annotation flow at a time) and drops into the trace tool for the common flow.
  const isOpeningModeOpen = useWorkbenchStore((s) => s.isOpeningModeOpen);
  const setIsOpeningModeOpen = useWorkbenchStore((s) => s.setIsOpeningModeOpen);

  // Title block is "active" only when capturing a box OUTSIDE a gridline session
  // (inside one, capture_box reads a grid bubble instead).
  const titleBlockActive = toolMode === 'capture_box' && !isGridlineOpen;

  const toggleTitleBlock = () => {
    if (titleBlockActive) {
      setToolMode('pan');
    } else {
      setIsGridlineOpen(false);
      setIsOpeningModeOpen(false);
      setGridProposal(null);
      setToolMode('capture_box');
    }
  };

  const toggleGridlines = () => {
    if (isGridlineOpen) {
      setIsGridlineOpen(false);
      setGridProposal(null);
      setPendingGridlines([]); // closing ends the session — drop unaccepted captures
      setToolMode('pan');
    } else {
      setIsTitleBlockOpen(false);
      setIsOpeningModeOpen(false);
      setGridProposal(null);
      setIsGridlineOpen(true);
      setToolMode('capture_box'); // step 1: box a grid bubble
    }
  };


  const btnBase = 'p-2 rounded-full flex items-center justify-center transition-all';
  const btnActive = 'bg-violet-500 text-white shadow-sm scale-110';
  const btnIdle =
    'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-white';

  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 rounded-full shadow-lg z-20"
      style={{
        background: 'var(--glass-bg, rgba(255, 255, 255, 0.7))',
        borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
        borderWidth: '1px',
        backdropFilter: 'blur(12px)',
      }}
    >
      {TOOLS.map(({ id, label, icon: Icon }) => {
        const active = toolMode === id;
        return (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => setToolMode(active ? 'pan' : id)}
            className={`${btnBase} ${active ? btnActive : btnIdle}`}
          >
            <Icon size={18} />
          </button>
        );
      })}

      <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />

      {/* Title-block reader (AI Tracing Assist — Phase 3a): drag a box over the
          title block to read the sheet number / name / architect firm. */}
      <button
        type="button"
        title="Read title block — drag a box over it"
        onClick={toggleTitleBlock}
        className={`${btnBase} ${titleBlockActive ? btnActive : btnIdle}`}
      >
        <ScanText size={18} />
      </button>

      {/* Gridline annotator (AI Tracing Assist — Phase 3b): box each grid bubble to
          read its label, then drag the axis line across the grid line. */}
      <button
        type="button"
        title="Capture gridlines — box a bubble, then click its two ends"
        onClick={toggleGridlines}
        className={`${btnBase} ${isGridlineOpen ? btnActive : btnIdle}`}
      >
        <Grid3x3 size={18} />
      </button>

      {/* Openings (AI Tracing Assist — Phase 4a): tag floor-level passages. Toggle with
          this button or the `O` key; hold D/C/H/P while tracing, or click a selected
          room's edges. */}
      <button
        type="button"
        title="Tag openings (O) — hold D/C/H/P while tracing, or click a selected room's edges"
        onClick={onToggleOpenings}
        className={`${btnBase} ${isOpeningModeOpen ? btnActive : btnIdle}`}
      >
        <DoorOpen size={18} />
      </button>

      <div className="w-px h-6 bg-slate-300 dark:bg-slate-600 mx-1" />

      {isSnappingLoading ? (
        <div className="p-2 rounded-full flex items-center justify-center text-violet-500 animate-spin" title="Building snap grid…">
          <Loader2 size={18} />
        </div>
      ) : (
        <button
          type="button"
          title={`${enableSnapping ? 'Disable' : 'Enable'} magnetic snapping`}
          onClick={() => setMapSettings({ enableSnapping: !enableSnapping })}
          className={`${btnBase} ${enableSnapping ? btnActive : btnIdle}`}
        >
          <Magnet size={18} />
        </button>
      )}

      {/* Grid-aware snapping (AI Tracing Assist — Phase 3c): once this sheet's
          gridlines are confirmed, prefer real walls over those grid lines while
          tracing. Only meaningful with magnetic snapping on, so it disables with it. */}
      <button
        type="button"
        disabled={!enableSnapping}
        title={
          !enableSnapping
            ? 'Grid-aware snapping — enable magnetic snapping first'
            : confirmedGridCount > 0
              ? `Grid-aware snapping ${gridAwareSnapping ? 'on' : 'off'} — snapping tuned to ${confirmedGridCount} confirmed grid line${confirmedGridCount === 1 ? '' : 's'} (prefers walls)`
              : 'Grid-aware snapping — confirm this sheet’s gridlines to tune it'
        }
        onClick={() => setMapSettings({ gridAwareSnapping: !gridAwareSnapping })}
        className={`${btnBase} ${gridAwareSnapping && enableSnapping ? btnActive : btnIdle} ${!enableSnapping ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        <Grid2x2Check size={18} />
      </button>
    </div>
  );
}
