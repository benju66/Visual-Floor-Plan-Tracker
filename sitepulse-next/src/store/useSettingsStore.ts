import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useState, useEffect } from 'react';
import type { Updater, DeepPartial } from '@/types/utils';
import type { LegendPosition, TemporalState } from '@/types/domain';

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
  /** Lag Mode: color unit polygons by schedule variance instead of milestone color. */
  colorByVariance?: boolean;
}

export interface SettingsState {
  temporalFilters: TemporalState[];
  setTemporalFilters: (filters: Updater<TemporalState[]>) => void;

  filterMilestone: string | null;
  setFilterMilestone: (ml: Updater<string | null>) => void;

  settings: AppSettings;
  setSettings: (settingsFn: Updater<DeepPartial<AppSettings>>) => void;

  mapSettings: MapSettings;
  setMapSettings: (settingsFn: Updater<DeepPartial<MapSettings>>) => void;

  legendPosition: LegendPosition;
  setLegendPosition: (posFn: Updater<DeepPartial<LegendPosition>>) => void;

  colorMode: 'light' | 'dark' | 'system';
  setColorMode: (modeFn: Updater<'light' | 'dark' | 'system'>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      temporalFilters: ['planned', 'ongoing', 'completed', 'none'],
      setTemporalFilters: (filters) => set(typeof filters === 'function' ? (state) => ({ temporalFilters: filters(state.temporalFilters) }) : { temporalFilters: filters }),

      filterMilestone: null,
      setFilterMilestone: (ml) => set((state) => ({ filterMilestone: typeof ml === 'function' ? ml(state.filterMilestone) : ml })),

      settings: { enableToasts: true, showHistoryHover: false, defaultViewMode: 'dashboard', show_delay_indicators: true, auto_advance_tracks: { 'Production': true } },
      setSettings: (settingsFn) => set((state) => ({ 
        settings: typeof settingsFn === 'function' ? { ...state.settings, ...settingsFn(state.settings) } : { ...state.settings, ...settingsFn } 
      }) as Partial<SettingsState>),

      mapSettings: { showHorizontalToolbar: true, showCrosshair: false, enableSnapping: true, showWalkSequence: false, colorByVariance: false, pinnedTools: ['undo', 'redo', 'pan', 'draw', 'add_node'] },
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
    }),
    {
      name: 'sitepulse-settings-storage',
      partialize: (state) => ({
        settings: state.settings,
        mapSettings: state.mapSettings,
        legendPosition: state.legendPosition,
        colorMode: state.colorMode,
      }),
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
