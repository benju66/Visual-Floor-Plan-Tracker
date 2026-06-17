import { create } from 'zustand';
import type { AdminStatusFilter } from '@/utils/subtypes';

/**
 * Transient UI state for the global Location Library admin (Phase-4 dictionary
 * admin + review queue). Filters and the "which row is being aliased" target
 * are floating UI state, so they live in a Zustand store (AGENTS §2) rather
 * than component `useState`. Intentionally NOT persisted — these reset each
 * time the global settings modal opens, so no `useHydratedStore` is needed.
 */
export interface TaxonomyAdminState {
  /** Status filter for the main dictionary list (`'all'` shows every status). */
  statusFilter: AdminStatusFilter;
  setStatusFilter: (status: AdminStatusFilter) => void;

  /** Free-text search over sub-type names + aliases. */
  search: string;
  setSearch: (query: string) => void;

  /** Sub-type id whose inline "add alias" input is open, or null. */
  aliasingId: string | null;
  setAliasingId: (id: string | null) => void;
}

export const useTaxonomyAdminStore = create<TaxonomyAdminState>()((set) => ({
  statusFilter: 'all',
  setStatusFilter: (status) => set({ statusFilter: status }),

  search: '',
  setSearch: (query) => set({ search: query }),

  aliasingId: null,
  setAliasingId: (id) => set({ aliasingId: id }),
}));
