import { create } from 'zustand';
import type { Updater } from '@/types/utils';

// Floating UI state for the Location Labeling Workbench (AGENTS.md §2: modals
// live in Zustand, not useState). For now this holds only the "New drawing"
// capture-modal visibility; the transient text inside the form stays local
// `useState` in the modal (same split as the dashboard's New Project modal).
// Not persisted — modal visibility should never survive a reload.
export interface WorkbenchState {
  isNewDrawingOpen: boolean;
  setIsNewDrawingOpen: (val: Updater<boolean>) => void;
}

export const useWorkbenchStore = create<WorkbenchState>()((set) => ({
  isNewDrawingOpen: false,
  setIsNewDrawingOpen: (val) =>
    set((state) => ({
      isNewDrawingOpen: typeof val === 'function' ? val(state.isNewDrawingOpen) : val,
    })),
}));
