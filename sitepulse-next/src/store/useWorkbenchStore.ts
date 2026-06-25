import { create } from 'zustand';
import type { Updater } from '@/types/utils';
import type { PercentPoint } from '@/types/domain';
import type { RoomSuggestion } from '@/utils/roomSuggestion';
import {
  EMPTY_FILTERS,
  type WorkbenchGroupBy,
  type WorkbenchFilters,
} from '@/utils/workbenchGrouping';

// Floating UI state for the Location Labeling Workbench (AGENTS.md §2: modals and
// transient UI live in Zustand, not useState). Not persisted — none of this should
// survive a reload.
//
// Two clusters:
//   • New-drawing capture modal visibility (Phase 5).
//   • The Phase-6 tracing view's naming popover: which freshly-traced polygon is
//     awaiting a name + type, whether the popover is open, and the draft name. The
//     active *drawing* itself is identified by the route (`/workbench/[sheetId]`),
//     so the URL is its single source of truth — only the floating popover state
//     lives here.
//
// These are deliberately SEPARATE from the live map's `useMapStore`/`useUIStore`
// equivalents so workbench tracing can never share mutable popover state with the
// live app.
export interface WorkbenchState {
  isNewDrawingOpen: boolean;
  setIsNewDrawingOpen: (val: Updater<boolean>) => void;

  /** Whether the `/workbench` corpus-health strip is collapsed (Phase 8a). */
  isHealthStripCollapsed: boolean;
  setIsHealthStripCollapsed: (val: Updater<boolean>) => void;

  /**
   * Whether the library grid also shows ARCHIVED (soft-deleted) drawings (Phase
   * 8b). Transient (not persisted) — a reload returns to the default active-only
   * view. The corpus-health strip stays fed by the ACTIVE list regardless of this.
   */
  showArchivedDrawings: boolean;
  setShowArchivedDrawings: (val: Updater<boolean>) => void;

  /**
   * Which drawing card's overflow ("⋯") action menu is open (Phase 8c) — `null` =
   * none. At most one is open at a time. Transient (not persisted). The menu holds
   * the secondary/destructive actions (currently "Delete permanently"), kept one
   * click deeper than the prominent Archive control.
   */
  openCardMenuId: string | null;
  setOpenCardMenuId: (val: Updater<string | null>) => void;

  /**
   * The drawing (`sheets` id) awaiting an IRREVERSIBLE hard-delete confirmation
   * (Phase 8c) — `null` = no purge pending. Setting it opens the type-to-confirm
   * modal; the actual purge only fires after the user types the drawing's exact
   * name there. Transient (not persisted) — a reload abandons any pending purge.
   * This is the ONLY entry point to the purge flow, so there is no path that skips
   * the typed confirmation.
   */
  purgeTargetId: string | null;
  setPurgeTargetId: (val: Updater<string | null>) => void;

  /**
   * Client-side grouping/filtering of the library grid (Phase 8d) — pure display
   * over the already-loaded drawings; never triggers a fetch. Transient (not
   * persisted): a reload returns to the default flat, unfiltered view, consistent
   * with every other workbench floating flag. The corpus-health strip is NOT
   * affected by these — it stays fed by the active corpus.
   */
  groupBy: WorkbenchGroupBy;
  setGroupBy: (val: Updater<WorkbenchGroupBy>) => void;

  /** The active per-facet grid filters (Phase 8d). Empty lists = unfiltered. */
  drawingFilters: WorkbenchFilters;
  setDrawingFilters: (val: Updater<WorkbenchFilters>) => void;

  /** The just-traced polygon awaiting a name + type (null = nothing pending). */
  pendingLabelPoints: PercentPoint[] | null;
  setPendingLabelPoints: (val: Updater<PercentPoint[] | null>) => void;

  /**
   * The FROZEN AI name/type proposal for the polygon currently being named (AI
   * Tracing Assist — Phase 2), or `null` when nothing was suggested (manual label)
   * or while editing an existing one. Set once when the polygon closes and never
   * mutated as the user edits the live draft — it is the original-vs-final training
   * signal banked on accept and the frozen `beforeLabel` recorded on reject. Lives
   * here (not `useState`) per AGENTS.md §2, alongside the rest of the popover state.
   */
  labelSuggestion: RoomSuggestion | null;
  setLabelSuggestion: (val: Updater<RoomSuggestion | null>) => void;

  /** Whether the trace naming popover is open. */
  isLabelNamingOpen: boolean;
  setIsLabelNamingOpen: (val: Updater<boolean>) => void;

  /** The name being typed in the naming popover. */
  labelDraftName: string;
  setLabelDraftName: (val: Updater<string>) => void;

  /**
   * The existing label being edited via the popover (null = naming a NEW trace).
   * Set by the canvas "Rename" action; drives the popover's edit vs. create mode.
   */
  editingLabelId: string | null;
  setEditingLabelId: (val: Updater<string | null>) => void;
}

export const useWorkbenchStore = create<WorkbenchState>()((set) => ({
  isNewDrawingOpen: false,
  setIsNewDrawingOpen: (val) =>
    set((state) => ({
      isNewDrawingOpen: typeof val === 'function' ? val(state.isNewDrawingOpen) : val,
    })),

  isHealthStripCollapsed: false,
  setIsHealthStripCollapsed: (val) =>
    set((state) => ({
      isHealthStripCollapsed:
        typeof val === 'function' ? val(state.isHealthStripCollapsed) : val,
    })),

  showArchivedDrawings: false,
  setShowArchivedDrawings: (val) =>
    set((state) => ({
      showArchivedDrawings:
        typeof val === 'function' ? val(state.showArchivedDrawings) : val,
    })),

  openCardMenuId: null,
  setOpenCardMenuId: (val) =>
    set((state) => ({
      openCardMenuId: typeof val === 'function' ? val(state.openCardMenuId) : val,
    })),

  purgeTargetId: null,
  setPurgeTargetId: (val) =>
    set((state) => ({
      purgeTargetId: typeof val === 'function' ? val(state.purgeTargetId) : val,
    })),

  groupBy: 'none',
  setGroupBy: (val) =>
    set((state) => ({
      groupBy: typeof val === 'function' ? val(state.groupBy) : val,
    })),

  drawingFilters: EMPTY_FILTERS,
  setDrawingFilters: (val) =>
    set((state) => ({
      drawingFilters: typeof val === 'function' ? val(state.drawingFilters) : val,
    })),

  pendingLabelPoints: null,
  setPendingLabelPoints: (val) =>
    set((state) => ({
      pendingLabelPoints: typeof val === 'function' ? val(state.pendingLabelPoints) : val,
    })),

  labelSuggestion: null,
  setLabelSuggestion: (val) =>
    set((state) => ({
      labelSuggestion: typeof val === 'function' ? val(state.labelSuggestion) : val,
    })),

  isLabelNamingOpen: false,
  setIsLabelNamingOpen: (val) =>
    set((state) => ({
      isLabelNamingOpen: typeof val === 'function' ? val(state.isLabelNamingOpen) : val,
    })),

  labelDraftName: '',
  setLabelDraftName: (val) =>
    set((state) => ({
      labelDraftName: typeof val === 'function' ? val(state.labelDraftName) : val,
    })),

  editingLabelId: null,
  setEditingLabelId: (val) =>
    set((state) => ({
      editingLabelId: typeof val === 'function' ? val(state.editingLabelId) : val,
    })),
}));
