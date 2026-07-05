import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useState, useEffect } from 'react';
import type { Updater, DeepPartial } from '@/types/utils';
import type { LegendPosition, TemporalState } from '@/types/domain';
import {
  pushRecent, saveStamp, removeStamp, renameStamp,
  EMPTY_STAMP_LIBRARY, type StampDef, type StampLibrary,
} from '@/utils/stampLibrary';

export interface AppSettings {
  enableToasts: boolean;
  showHistoryHover: boolean;
  defaultViewMode: string;
  includeExportData?: boolean;
  pdfPaperSize?: string;
  markupThickness?: number;
  show_delay_indicators: boolean;
  auto_advance_tracks: Record<string, boolean>;
}

export interface MapSettings {
  showHorizontalToolbar: boolean;
  showCrosshair: boolean;
  enableSnapping: boolean;
  showWalkSequence: boolean;
  pinnedTools: string[];
  snappingStrength?: number;
  /** Glide mouse-wheel zoom toward a target scale instead of stepping instantly.
   *  On by default; only an explicit `false` (user toggled it off) disables it. */
  smoothWheelZoom?: boolean;
  /** Grid-aware snapping (AI Tracing Assist — Phase 3c): when a workbench sheet has
   *  confirmed gridlines, de-prioritize snapping onto those grid lines so tracing
   *  prefers real walls. On by default; only an explicit `false` disables it.
   *  Inert on the live map (no confirmed grids → nothing tagged). */
  gridAwareSnapping?: boolean;
  /** Persisted width (px) of the interactive-map right side panel. Desktop only. */
  sidebarWidth?: number;
  /** Lag Mode: color unit polygons by schedule variance instead of activity color. */
  colorByVariance?: boolean;
  /** Make-Ready Mode: color unit polygons by dependency readiness (ready / blocked /
   *  complete) instead of activity color. Mutually exclusive with Lag Mode. */
  colorByMakeReady?: boolean;
  /** Magnifier loupe on/off. Session-only — deliberately NOT restored across
   *  reloads (see persist `merge` below): a persisted-on loupe silently suspends
   *  snapping every session, which reads as "the snap tool is broken". */
  showMagnifier?: boolean;
  /** Magnifier loupe magnification factor over the on-screen view (default 3). */
  magnifierZoom?: number;
  /** Crosshair look (only when `showCrosshair` is on). 5 fixed presets; default
   *  'lines' = today's two full-bleed dashed lines. Normal persisted field — does
   *  NOT get the `showMagnifier` force-OFF-on-rehydrate treatment. */
  crosshairStyle?: 'lines' | 'lines-dot' | 'ring' | 'ring-dot' | 'gap-cross';
  /** Bottom-right mini-map: a thumbnail of the whole sheet with a box marking the
   *  visible region; click/drag it to jump around. Default OFF. Plain persisted
   *  bool — NOT the `showMagnifier` force-OFF-on-rehydrate treatment. */
  showMiniMap?: boolean;
  /** Mini-map size multiplier over the ~160×120 base envelope, set by dragging the
   *  mini-map's corner handle (aspect stays locked). Default 1. Persisted. */
  miniMapScale?: number;
  /** Persisted width (px) of the Schedule view's left Activities panel, set by dragging
   *  its divider (VS Code-style). Desktop only. Default 360. */
  scheduleActivitiesWidth?: number;
  /** Persisted width (px) of the Schedule view's right floor-plan panel, set by dragging
   *  its divider. Desktop only. Default 380. */
  schedulePlanWidth?: number;
}

export interface SettingsState {
  temporalFilters: TemporalState[];
  setTemporalFilters: (filters: Updater<TemporalState[]>) => void;

  filterActivity: string | null;
  setFilterActivity: (val: Updater<string | null>) => void;

  settings: AppSettings;
  setSettings: (settingsFn: Updater<DeepPartial<AppSettings>>) => void;

  mapSettings: MapSettings;
  setMapSettings: (settingsFn: Updater<DeepPartial<MapSettings>>) => void;

  legendPosition: LegendPosition;
  setLegendPosition: (posFn: Updater<DeepPartial<LegendPosition>>) => void;

  colorMode: 'light' | 'dark' | 'system';
  setColorMode: (modeFn: Updater<'light' | 'dark' | 'system'>) => void;

  // Stamp & Fast Markup — Phase 2: the persisted stamp drawer (this browser only). Plain
  // JSON `StampDef` objects; the pure ops live in `@/utils/stampLibrary`. Read via
  // `useHydratedStore` to avoid an SSR hydration mismatch.
  stampLibrary: StampLibrary;
  pushRecentStamp: (stamp: StampDef) => void;
  saveStampToLibrary: (stamp: StampDef) => void;
  removeSavedStamp: (id: string) => void;
  renameSavedStamp: (id: string, name: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      temporalFilters: ['planned', 'ongoing', 'completed', 'none'],
      setTemporalFilters: (filters) => set(typeof filters === 'function' ? (state) => ({ temporalFilters: filters(state.temporalFilters) }) : { temporalFilters: filters }),

      filterActivity: null,
      setFilterActivity: (val) => set((state) => ({ filterActivity: typeof val === 'function' ? val(state.filterActivity) : val })),

      settings: { enableToasts: true, showHistoryHover: false, defaultViewMode: 'dashboard', show_delay_indicators: true, auto_advance_tracks: { 'Production': true } },
      setSettings: (settingsFn) => set((state) => ({ 
        settings: typeof settingsFn === 'function' ? { ...state.settings, ...settingsFn(state.settings) } : { ...state.settings, ...settingsFn } 
      }) as Partial<SettingsState>),

      mapSettings: { showHorizontalToolbar: true, showCrosshair: false, crosshairStyle: 'lines', enableSnapping: true, showWalkSequence: false, smoothWheelZoom: true, gridAwareSnapping: true, sidebarWidth: 320, colorByVariance: false, colorByMakeReady: false, showMagnifier: false, magnifierZoom: 3, showMiniMap: false, miniMapScale: 1, scheduleActivitiesWidth: 360, schedulePlanWidth: 380, pinnedTools: ['undo', 'redo', 'pan', 'draw', 'add_node'] },
      setMapSettings: (settingsFn) => set((state) => ({ 
        mapSettings: typeof settingsFn === 'function' ? { ...state.mapSettings, ...settingsFn(state.mapSettings) } : { ...state.mapSettings, ...settingsFn } 
      }) as Partial<SettingsState>),

      legendPosition: { pctX: 0.05, pctY: 0.05, scaleX: 1, scaleY: 1, rotation: 0, isVisible: false },
      setLegendPosition: (posFn) => set((state) => ({ 
        legendPosition: typeof posFn === 'function' ? { ...state.legendPosition, ...posFn(state.legendPosition) } : { ...state.legendPosition, ...posFn } 
      }) as Partial<SettingsState>),

      colorMode: 'dark',
      setColorMode: (modeFn) => set((state) => ({
        colorMode: typeof modeFn === 'function' ? modeFn(state.colorMode) : modeFn
      })),

      stampLibrary: EMPTY_STAMP_LIBRARY,
      pushRecentStamp: (stamp) => set((state) => ({
        stampLibrary: { ...state.stampLibrary, recents: pushRecent(state.stampLibrary.recents, stamp) },
      })),
      saveStampToLibrary: (stamp) => set((state) => ({
        stampLibrary: { ...state.stampLibrary, saved: saveStamp(state.stampLibrary.saved, stamp) },
      })),
      removeSavedStamp: (id) => set((state) => ({
        stampLibrary: { ...state.stampLibrary, saved: removeStamp(state.stampLibrary.saved, id) },
      })),
      renameSavedStamp: (id, name) => set((state) => ({
        stampLibrary: { ...state.stampLibrary, saved: renameStamp(state.stampLibrary.saved, id, name) },
      })),
    }),
    {
      name: 'sitepulse-settings-storage',
      partialize: (state) => ({
        settings: state.settings,
        mapSettings: state.mapSettings,
        legendPosition: state.legendPosition,
        colorMode: state.colorMode,
        stampLibrary: state.stampLibrary,
      }),
      // Default shallow merge, but the magnifier loupe is forced OFF on every
      // rehydrate. It's a transient placement aid that suspends snapping while
      // up; restoring it as "on" across reloads silently kills the pink snap
      // ring every session. `magnifierZoom` (a harmless preference) is kept.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...p,
          mapSettings: {
            ...current.mapSettings,
            ...(p.mapSettings ?? {}),
            showMagnifier: false,
          },
        };
      },
    }
  )
);

// CRITICAL DIRECTIVE A: Custom Hook to bypass React Hydration Mismatch for persisted store values
export function useHydratedStore<T>(
  selector: (state: SettingsState) => T,
  fallback: T
): T {
  const [isHydrated, setIsHydrated] = useState(false);
  const result = useSettingsStore(selector);

  // Flip to hydrated exactly once after mount: this is the intentional SSR
  // hydration guard (see "CRITICAL DIRECTIVE A"). The one-shot setState is the
  // pattern's whole point, so the set-state-in-effect rule is a false positive here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsHydrated(true);
  }, []);

  return isHydrated ? result : fallback;
}
