import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useState, useEffect } from 'react';

export const useAppStore = create(
  persist(
    (set) => ({
      // Tool State
      toolMode: 'pan',
      setToolMode: (mode) => set({ toolMode: typeof mode === 'function' ? mode(useAppStore.getState().toolMode) : mode }),

      viewMode: 'list',
      setViewMode: (mode) => set({ viewMode: typeof mode === 'function' ? mode(useAppStore.getState().viewMode) : mode }),

      trackingMode: 'Production',
      setTrackingMode: (mode) => set({ trackingMode: typeof mode === 'function' ? mode(useAppStore.getState().trackingMode) : mode }),

      // Selection State
      selectedUnitIds: [],
      setSelectedUnitIds: (ids) => set({ selectedUnitIds: typeof ids === 'function' ? ids(useAppStore.getState().selectedUnitIds) : ids }),
      toggleSelectedUnitId: (id) => set((state) => ({
        selectedUnitIds: state.selectedUnitIds.includes(id)
          ? state.selectedUnitIds.filter(uid => uid !== id)
          : [...state.selectedUnitIds, id]
      })),
      clearSelectedUnits: () => set({ selectedUnitIds: [] }),

      editingUnitId: null,
      setEditingUnitId: (id) => set({ editingUnitId: typeof id === 'function' ? id(useAppStore.getState().editingUnitId) : id }),

      historyModalUnitId: null,
      setHistoryModalUnitId: (id) => set({ historyModalUnitId: typeof id === 'function' ? id(useAppStore.getState().historyModalUnitId) : id }),

      // Filters
      temporalFilters: ['planned', 'ongoing', 'completed', 'none'],
      setTemporalFilters: (filters) => set(typeof filters === 'function' ? (state) => ({ temporalFilters: filters(state.temporalFilters) }) : { temporalFilters: filters }),

      filterMilestone: null,
      setFilterMilestone: (ml) => set({ filterMilestone: typeof ml === 'function' ? ml(useAppStore.getState().filterMilestone) : ml }),

      // Active Sheet State
      activeSheetId: '',
      setActiveSheetId: (id) => set({ activeSheetId: typeof id === 'function' ? id(useAppStore.getState().activeSheetId) : id }),

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

      // Lifted UI State
      isSettingsOpen: false,
      setIsSettingsOpen: (val) => set((state) => ({ isSettingsOpen: typeof val === 'function' ? val(state.isSettingsOpen) : val })),

      isProjectMenuOpen: false,
      setIsProjectMenuOpen: (val) => set((state) => ({ isProjectMenuOpen: typeof val === 'function' ? val(state.isProjectMenuOpen) : val })),

      toast: null,
      setToast: (val) => set((state) => ({ toast: typeof val === 'function' ? val(state.toast) : val })),

      confirmModal: null,
      setConfirmModal: (val) => set((state) => ({ confirmModal: typeof val === 'function' ? val(state.confirmModal) : val })),

      milestoneMenu: null,
      setMilestoneMenu: (val) => set((state) => ({ milestoneMenu: typeof val === 'function' ? val(state.milestoneMenu) : val })),

      savingUnitId: null,
      setSavingUnitId: (val) => set((state) => ({ savingUnitId: typeof val === 'function' ? val(state.savingUnitId) : val })),

      quickStatusUnitId: null,
      setQuickStatusUnitId: (val) => set((state) => ({ quickStatusUnitId: typeof val === 'function' ? val(state.quickStatusUnitId) : val })),

      quickMilestoneUnitId: null,
      setQuickMilestoneUnitId: (val) => set((state) => ({ quickMilestoneUnitId: typeof val === 'function' ? val(state.quickMilestoneUnitId) : val })),

      pendingPolygonPoints: null,
      setPendingPolygonPoints: (val) => set((state) => ({ pendingPolygonPoints: typeof val === 'function' ? val(state.pendingPolygonPoints) : val })),

      unitNamingOpen: false,
      setUnitNamingOpen: (val) => set((state) => ({ unitNamingOpen: typeof val === 'function' ? val(state.unitNamingOpen) : val })),

      newUnitName: '',
      setNewUnitName: (val) => set((state) => ({ newUnitName: typeof val === 'function' ? val(state.newUnitName) : val })),

      isModalOpen: false,
      setIsModalOpen: (val) => set((state) => ({ isModalOpen: typeof val === 'function' ? val(state.isModalOpen) : val })),

      newLevelName: '',
      setNewLevelName: (val) => set((state) => ({ newLevelName: typeof val === 'function' ? val(state.newLevelName) : val })),

      selectedFile: null,
      setSelectedFile: (val) => set((state) => ({ selectedFile: typeof val === 'function' ? val(state.selectedFile) : val })),

      pdfPageNumber: 1,
      setPdfPageNumber: (val) => set((state) => ({ pdfPageNumber: typeof val === 'function' ? val(state.pdfPageNumber) : val })),

      isUploading: false,
      setIsUploading: (val) => set((state) => ({ isUploading: typeof val === 'function' ? val(state.isUploading) : val })),


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
  const result = useAppStore(selector);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  return isHydrated ? result : fallback;
};
