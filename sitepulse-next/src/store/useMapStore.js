import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useMapStore = create(
  persist(
    (set) => ({
  // Tool State
  toolMode: 'pan',
  setToolMode: (mode) => set((state) => ({ toolMode: typeof mode === 'function' ? mode(state.toolMode) : mode })),

  trackingMode: 'Production',
  setTrackingMode: (mode) => set((state) => ({ trackingMode: typeof mode === 'function' ? mode(state.trackingMode) : mode })),

  // Lifted Route State
  pendingRoute: [],
  setPendingRoute: (val) => set((state) => ({ pendingRoute: typeof val === 'function' ? val(state.pendingRoute) : val })),
  
  routeSubMode: 'move', // 'move', 'add', 'remove'
  setRouteSubMode: (mode) => set({ routeSubMode: mode }),

  // Selection State
  selectedUnitIds: [],
  setSelectedUnitIds: (ids) => set((state) => ({ selectedUnitIds: typeof ids === 'function' ? ids(state.selectedUnitIds) : ids })),
  toggleSelectedUnitId: (id) => set((state) => ({
    selectedUnitIds: state.selectedUnitIds.includes(id)
      ? state.selectedUnitIds.filter(uid => uid !== id)
      : [...state.selectedUnitIds, id]
  })),
  clearSelectedUnits: () => set({ selectedUnitIds: [] }),

  editingUnitId: null,
  setEditingUnitId: (id) => set((state) => ({ editingUnitId: typeof id === 'function' ? id(state.editingUnitId) : id })),

  // Active Sheet State
  activeSheetId: '',
  setActiveSheetId: (id) => set((state) => ({ activeSheetId: typeof id === 'function' ? id(state.activeSheetId) : id })),

  savingUnitId: null,
  setSavingUnitId: (val) => set((state) => ({ savingUnitId: typeof val === 'function' ? val(state.savingUnitId) : val })),

  quickStatusUnitId: null,
  setQuickStatusUnitId: (val) => set((state) => ({ quickStatusUnitId: typeof val === 'function' ? val(state.quickStatusUnitId) : val })),

  quickMilestoneUnitId: null,
  setQuickMilestoneUnitId: (val) => set((state) => ({ quickMilestoneUnitId: typeof val === 'function' ? val(state.quickMilestoneUnitId) : val })),

  pendingPolygonPoints: null,
  setPendingPolygonPoints: (val) => set((state) => ({ pendingPolygonPoints: typeof val === 'function' ? val(state.pendingPolygonPoints) : val })),

  selectedFile: null,
  setSelectedFile: (val) => set((state) => ({ selectedFile: typeof val === 'function' ? val(state.selectedFile) : val })),

  pdfPageNumber: 1,
  setPdfPageNumber: (val) => set((state) => ({ pdfPageNumber: typeof val === 'function' ? val(state.pdfPageNumber) : val })),

  isUploading: false,
  setIsUploading: (val) => set((state) => ({ isUploading: typeof val === 'function' ? val(state.isUploading) : val })),
    }),
    {
      name: 'sitepulse-map-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        activeSheetId: state.activeSheetId,
        trackingMode: state.trackingMode,
        toolMode: state.toolMode
      })
    }
  )
);
