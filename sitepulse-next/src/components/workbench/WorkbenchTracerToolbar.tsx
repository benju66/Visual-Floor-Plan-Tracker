'use client';

import React from 'react';
import { Hand, PenLine, Wand2, MousePointer2, Magnet, Crosshair, Search, Loader2 } from 'lucide-react';
import { useMapStore, type ToolMode } from '@/store/useMapStore';
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
  { id: 'fill_room', label: 'Fill room from walls — click inside a room (4)', icon: Wand2 },
  { id: 'select', label: 'Select / adjust (1)', icon: MousePointer2 },
];

export default function WorkbenchTracerToolbar({ isSnappingLoading }: { isSnappingLoading?: boolean }) {
  const toolMode = useMapStore((s) => s.toolMode);
  const setToolMode = useMapStore((s) => s.setToolMode);
  const setMapSettings = useSettingsStore((s) => s.setMapSettings);
  const enableSnapping = useHydratedStore((s) => s.mapSettings.enableSnapping, true);
  const showCrosshair = useHydratedStore((s) => s.mapSettings.showCrosshair, false);
  const showMagnifier = useHydratedStore((s) => s.mapSettings.showMagnifier, false);
  const magnifierZoom = useHydratedStore((s) => s.mapSettings.magnifierZoom, 3);

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

      {isSnappingLoading ? (
        <div className="p-2 rounded-full flex items-center justify-center text-violet-500 animate-spin" title="Building snap grid…">
          <Loader2 size={18} />
        </div>
      ) : (
        <button
          type="button"
          title={
            showMagnifier
              ? 'Snapping paused while the magnifier is on'
              : `${enableSnapping ? 'Disable' : 'Enable'} magnetic snapping`
          }
          onClick={() => setMapSettings({ enableSnapping: !enableSnapping })}
          className={`${btnBase} ${enableSnapping && !showMagnifier ? btnActive : btnIdle} ${showMagnifier ? 'opacity-50' : ''}`}
        >
          <Magnet size={18} />
        </button>
      )}

      <button
        type="button"
        title={`${showCrosshair ? 'Hide' : 'Show'} alignment crosshair`}
        onClick={() => setMapSettings({ showCrosshair: !showCrosshair })}
        className={`${btnBase} ${showCrosshair ? btnActive : btnIdle}`}
      >
        <Crosshair size={18} />
      </button>

      <button
        type="button"
        title={`Magnifier (${magnifierZoom}×) — press M or click to toggle. Snapping pauses while it's on. [ and ] adjust zoom`}
        onClick={() => setMapSettings({ showMagnifier: !showMagnifier })}
        className={`${btnBase} ${showMagnifier ? btnActive : btnIdle}`}
      >
        <Search size={18} />
      </button>
    </div>
  );
}
