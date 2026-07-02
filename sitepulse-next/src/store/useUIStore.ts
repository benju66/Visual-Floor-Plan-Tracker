import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Updater } from '@/types/utils';

export interface Toast {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export interface ConfirmModal {
  message: string;
  onConfirm: () => void | Promise<void>;
}

export interface UIState {
  viewMode: string;
  setViewMode: (mode: Updater<string>) => void;

  historyModalUnitId: string | null;
  setHistoryModalUnitId: (id: Updater<string | null>) => void;

  isSettingsOpen: boolean;
  setIsSettingsOpen: (val: Updater<boolean>) => void;

  isProjectMenuOpen: boolean;
  setIsProjectMenuOpen: (val: Updater<boolean>) => void;

  toast: Toast | null;
  setToast: (val: Updater<Toast | null>) => void;

  confirmModal: ConfirmModal | null;
  setConfirmModal: (val: Updater<ConfirmModal | null>) => void;

  activityMenu: string | null;
  setActivityMenu: (val: Updater<string | null>) => void;

  unitNamingOpen: boolean;
  setUnitNamingOpen: (val: Updater<boolean>) => void;

  newUnitName: string;
  setNewUnitName: (val: Updater<string>) => void;

  newUnitType: string;
  setNewUnitType: (val: Updater<string>) => void;

  isModalOpen: boolean;
  setIsModalOpen: (val: Updater<boolean>) => void;

  newLevelName: string;
  setNewLevelName: (val: Updater<string>) => void;

  hideCompletedTimeline: boolean;
  setHideCompletedTimeline: (val: Updater<boolean>) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      viewMode: 'list',
      setViewMode: (mode) => set((state) => ({ viewMode: typeof mode === 'function' ? mode(state.viewMode) : mode })),

      historyModalUnitId: null,
      setHistoryModalUnitId: (id) => set((state) => ({ historyModalUnitId: typeof id === 'function' ? id(state.historyModalUnitId) : id })),

      isSettingsOpen: false,
      setIsSettingsOpen: (val) => set((state) => ({ isSettingsOpen: typeof val === 'function' ? val(state.isSettingsOpen) : val })),

      isProjectMenuOpen: false,
      setIsProjectMenuOpen: (val) => set((state) => ({ isProjectMenuOpen: typeof val === 'function' ? val(state.isProjectMenuOpen) : val })),

      toast: null,
      setToast: (val) => set((state) => ({ toast: typeof val === 'function' ? val(state.toast) : val })),

      confirmModal: null,
      setConfirmModal: (val) => set((state) => ({ confirmModal: typeof val === 'function' ? val(state.confirmModal) : val })),

      activityMenu: null,
      setActivityMenu: (val) => set((state) => ({ activityMenu: typeof val === 'function' ? val(state.activityMenu) : val })),

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

      hideCompletedTimeline: false,
      setHideCompletedTimeline: (val) => set((state) => ({ hideCompletedTimeline: typeof val === 'function' ? val(state.hideCompletedTimeline) : val })),
    }),
    {
      name: 'sitepulse-ui-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        viewMode: state.viewMode,
        hideCompletedTimeline: state.hideCompletedTimeline,
      })
    }
  )
);
