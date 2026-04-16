"use client";

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useState, useEffect } from 'react';

export const useAppStore = create(
  persist(
    (set) => ({
      // Tool State
      toolMode: 'pan',
      setToolMode: (mode) => set({ toolMode: mode }),
      viewMode: 'list',
      setViewMode: (mode) => set({ viewMode: mode }),
      trackingMode: 'Production',
      setTrackingMode: (mode) => set({ trackingMode: mode }),

      // Selection State
      selectedUnitId: null,
      setSelectedUnitId: (id) => set({ selectedUnitId: id }),
      editingUnitId: null,
      setEditingUnitId: (id) => set({ editingUnitId: id }),

      // Filters
      temporalFilters: ['none', 'planned', 'ongoing', 'completed'],
      setTemporalFilters: (filters) => set({ temporalFilters: filters }),
      filterMilestone: null,
      setFilterMilestone: (milestone) => set({ filterMilestone: milestone }),

      // Active Sheet State
      activeSheetId: '',
      setActiveSheetId: (id) => set({ activeSheetId: id }),

      // Settings/Local State
      mapSettings: { showHorizontalToolbar: true, pinnedTools: ['undo', 'redo', 'pan', 'draw', 'add_node'] },
      setMapSettings: (updater) => set((state) => ({ mapSettings: typeof updater === 'function' ? updater(state.mapSettings) : updater })),
      legendPosition: { pctX: 0.05, pctY: 0.05, scaleX: 1, scaleY: 1, rotation: 0, isVisible: false },
      setLegendPosition: (updater) => set((state) => ({ legendPosition: typeof updater === 'function' ? updater(state.legendPosition) : updater })),
      settings: { enableToasts: true, showHistoryHover: false, defaultViewMode: 'list' },
      setSettings: (updater) => set((state) => ({ settings: typeof updater === 'function' ? updater(state.settings) : updater })),
      colorMode: 'system',
      setColorMode: (mode) => set({ colorMode: mode }),
    }),
    {
      name: 'sitepulse-storage',
      partialize: (state) => ({
        mapSettings: state.mapSettings,
        legendPosition: state.legendPosition,
        settings: state.settings,
        colorMode: state.colorMode, // Kept colorMode persist
      }),
    }
  )
);

// Directive A: Hydration safe access
export function useHydratedStore(selector, fallback) {
  const store = useAppStore(selector);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  return isHydrated ? store : fallback;
}
