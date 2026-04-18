import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useState, useEffect } from 'react';

export const useSettingsStore = create(
  persist(
    (set) => ({
      // Filters
      temporalFilters: ['planned', 'ongoing', 'completed', 'none'],
      setTemporalFilters: (filters) => set(typeof filters === 'function' ? (state) => ({ temporalFilters: filters(state.temporalFilters) }) : { temporalFilters: filters }),

      filterMilestone: null,
      setFilterMilestone: (ml) => set((state) => ({ filterMilestone: typeof ml === 'function' ? ml(state.filterMilestone) : ml })),

      // Settings / Local State (Persisted)
      settings: { enableToasts: true, showHistoryHover: false, defaultViewMode: 'list' },
      setSettings: (settingsFn) => set((state) => ({ 
        settings: typeof settingsFn === 'function' ? settingsFn(state.settings) : { ...state.settings, ...settingsFn } 
      })),

      mapSettings: { showHorizontalToolbar: true, showCrosshair: false, pinnedTools: ['undo', 'redo', 'pan', 'draw', 'add_node'] },
      setMapSettings: (settingsFn) => set((state) => ({ 
        mapSettings: typeof settingsFn === 'function' ? settingsFn(state.mapSettings) : { ...state.mapSettings, ...settingsFn } 
      })),

      legendPosition: { pctX: 0.05, pctY: 0.05, scaleX: 1, scaleY: 1, rotation: 0, isVisible: false },
      setLegendPosition: (posFn) => set((state) => ({ 
        legendPosition: typeof posFn === 'function' ? posFn(state.legendPosition) : { ...state.legendPosition, ...posFn } 
      })),

      colorMode: 'system',
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
export const useHydratedStore = (selector, fallback) => {
  const [isHydrated, setIsHydrated] = useState(false);
  const result = useSettingsStore(selector);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  return isHydrated ? result : fallback;
};
