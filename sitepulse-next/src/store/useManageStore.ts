import { create } from 'zustand';
import type { Updater } from '@/types/utils';
import { emptyFilters, type ManageFilters } from '@/utils/locationFilters';

/**
 * UI state for the desktop Locations & Status management workspace (viewMode === 'list').
 *
 * Transient by design — not persisted. Selection stays in `useMapStore.selectedUnitIds`
 * (shared with the Map). The offline-durable staging buffer stays in `useFieldData`.
 * Per AGENTS.md §6: explicit interface, Updater-typed setters.
 */

/** 'level' = active sheet only; 'all' = every level (whole building). */
export type ManageScope = 'level' | 'all';

export interface ManageState {
  scope: ManageScope;
  setScope: (val: Updater<ManageScope>) => void;

  filters: ManageFilters;
  setFilters: (val: Updater<ManageFilters>) => void;
  resetFilters: () => void;

  /** The bulk-edit panel (multi-field editor launched from the bulk action bar). */
  bulkPanelOpen: boolean;
  setBulkPanelOpen: (val: Updater<boolean>) => void;

  /** Unit whose detail drawer is open, or null. */
  detailDrawerUnitId: string | null;
  setDetailDrawerUnitId: (val: Updater<string | null>) => void;
}

export const useManageStore = create<ManageState>()((set) => ({
  scope: 'level',
  setScope: (val) => set((s) => ({ scope: typeof val === 'function' ? val(s.scope) : val })),

  filters: emptyFilters(),
  setFilters: (val) => set((s) => ({ filters: typeof val === 'function' ? val(s.filters) : val })),
  resetFilters: () => set({ filters: emptyFilters() }),

  bulkPanelOpen: false,
  setBulkPanelOpen: (val) => set((s) => ({ bulkPanelOpen: typeof val === 'function' ? val(s.bulkPanelOpen) : val })),

  detailDrawerUnitId: null,
  setDetailDrawerUnitId: (val) => set((s) => ({ detailDrawerUnitId: typeof val === 'function' ? val(s.detailDrawerUnitId) : val })),
}));
