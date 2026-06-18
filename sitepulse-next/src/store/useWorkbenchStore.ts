import { create } from 'zustand';
import type { Updater } from '@/types/utils';
import type { PercentPoint } from '@/types/domain';

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

  /** The just-traced polygon awaiting a name + type (null = nothing pending). */
  pendingLabelPoints: PercentPoint[] | null;
  setPendingLabelPoints: (val: Updater<PercentPoint[] | null>) => void;

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

  pendingLabelPoints: null,
  setPendingLabelPoints: (val) =>
    set((state) => ({
      pendingLabelPoints: typeof val === 'function' ? val(state.pendingLabelPoints) : val,
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
