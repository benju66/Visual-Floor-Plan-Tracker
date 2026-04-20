import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useUIStore = create(
  persist(
    (set) => ({
  viewMode: 'list',
  setViewMode: (mode) => set((state) => ({ viewMode: typeof mode === 'function' ? mode(state.viewMode) : mode })),

  historyModalUnitId: null,
  setHistoryModalUnitId: (id) => set((state) => ({ historyModalUnitId: typeof id === 'function' ? id(state.historyModalUnitId) : id })),

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

  unitNamingOpen: false,
  setUnitNamingOpen: (val) => set((state) => ({ unitNamingOpen: typeof val === 'function' ? val(state.unitNamingOpen) : val })),

  newUnitName: '',
  setNewUnitName: (val) => set((state) => ({ newUnitName: typeof val === 'function' ? val(state.newUnitName) : val })),

  newUnitType: 'Apartment Unit',
  setNewUnitType: (val) => set((state) => ({ newUnitType: typeof val === 'function' ? val(state.newUnitType) : val })),

  isModalOpen: false,
  setIsModalOpen: (val) => set((state) => ({ isModalOpen: typeof val === 'function' ? val(state.isModalOpen) : val })),

  newLevelName: '',
  setNewLevelName: (val) => set((state) => ({ newLevelName: typeof val === 'function' ? val(state.newLevelName) : val })),
    }),
    {
      name: 'sitepulse-ui-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        viewMode: state.viewMode,
      })
    }
  )
);
