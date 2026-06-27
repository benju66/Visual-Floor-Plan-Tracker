import { create } from 'zustand';
import type { Updater } from '@/types/utils';
import type { OpeningEdge, OpeningType, PercentPoint, PercentRect, TitleBlockFields } from '@/types/domain';
import type { RoomSuggestion } from '@/utils/roomSuggestion';
import type { PendingGridline } from '@/utils/gridlineParse';
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
   * Opening edges tagged on the just-traced polygon (Phase 4a), carried from the
   * canvas into the naming popover so they bank with the room on save. Index-aligned
   * with {@link pendingLabelPoints}; a node move keeps indices, so they stay valid.
   * Cleared with the rest of the pending-trace state on save/cancel.
   */
  pendingOpeningEdges: OpeningEdge[];
  setPendingOpeningEdges: (val: Updater<OpeningEdge[]>) => void;

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

  // ── Title-block reader (AI Tracing Assist — Phase 3a) ──
  // The capture-box → confirm flow's floating state (popover visibility + the
  // dragged box + the FROZEN machine proposal). Mirrors the room-name popover
  // cluster above; lives here (not useState) per AGENTS.md §2. Cleared on unmount.

  /** Whether the title-block confirm popover is open. */
  isTitleBlockOpen: boolean;
  setIsTitleBlockOpen: (val: Updater<boolean>) => void;

  /** The percent-space box the user dragged over the title block (provenance). */
  titleBlockBox: PercentRect | null;
  setTitleBlockBox: (val: Updater<PercentRect | null>) => void;

  /**
   * The FROZEN original parser proposal for the dragged box (null = nothing read /
   * manual entry). Set once when the box is read and never mutated as the user
   * edits the live draft — it is the suggested-vs-final training signal.
   */
  titleBlockProposal: TitleBlockFields | null;
  setTitleBlockProposal: (val: Updater<TitleBlockFields | null>) => void;

  // ── Gridline annotator (AI Tracing Assist — Phase 3b) ──
  // The two-part capture session's floating state (panel visibility + the active
  // in-progress grid + the accumulated pending list). Mirrors the title-block
  // cluster; lives here (not useState) per AGENTS.md §2. Cleared on unmount.

  /**
   * Whether the gridline capture session is active. Doubles as the capture-box
   * ROUTING flag: while true, a `capture_box` drag reads a grid BUBBLE label (not
   * the title block) and a `capture_line` drag records the grid AXIS. The panel is
   * shown for the duration.
   */
  isGridlineOpen: boolean;
  setIsGridlineOpen: (val: Updater<boolean>) => void;

  /**
   * The in-progress grid: a bubble label has been read and we're awaiting the axis
   * drag (null = on the bubble step, nothing read yet). `label` is the EDITABLE
   * draft (the human may fix a misread before drawing the axis); `suggestedLabel`
   * is the FROZEN machine read (null = the box found no token). When the axis drag
   * completes this is combined into a {@link PendingGridline} and cleared.
   */
  gridProposal: { label: string; suggestedLabel: string | null } | null;
  setGridProposal: (val: Updater<{ label: string; suggestedLabel: string | null } | null>) => void;

  /**
   * Grids captured this session but not yet saved — rendered as distinct pending
   * overlays and banked together by "accept all". Never the offline queue; a plain
   * transient list (AGENTS.md §2).
   */
  pendingGridlines: PendingGridline[];
  setPendingGridlines: (val: Updater<PendingGridline[]>) => void;

  /**
   * Which already-SAVED grid (index into `sheet_gridlines.gridlines`) is selected
   * for editing during a gridline session — `null` = none. Selecting one highlights
   * it on the canvas (where it becomes draggable to reposition) and in the panel
   * (where its label is editable and it can be deleted). Transient; cleared when the
   * session closes or the tracer unmounts. Index-based because saved grids carry no
   * stable id; a delete clears the selection rather than risk a stale index.
   */
  selectedGridlineIndex: number | null;
  setSelectedGridlineIndex: (val: Updater<number | null>) => void;

  // ── Opening-edge capture (AI Tracing Assist — Phase 4a) ──
  // Tool settings for tagging floor-level passages on a room's perimeter. Per
  // AGENTS.md §2 these live in the store (not useState). The transient in-progress
  // tags of a half-drawn trace stay co-located with the canvas's draft polygon (the
  // same ephemeral draw buffer), and are handed up only when the polygon closes.

  /**
   * Whether the openings session is active. While true, an "Openings" panel shows the
   * active type, holding the opening key during a trace marks the next edge, and a
   * saved room's boundary edges become clickable to tag/clear (edit-after).
   */
  isOpeningModeOpen: boolean;
  setIsOpeningModeOpen: (val: Updater<boolean>) => void;

  /** The opening type applied by the next tag (in-draw or edit-after). Defaults to `door`. */
  activeOpeningType: OpeningType;
  setActiveOpeningType: (val: Updater<OpeningType>) => void;
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

  pendingOpeningEdges: [],
  setPendingOpeningEdges: (val) =>
    set((state) => ({
      pendingOpeningEdges: typeof val === 'function' ? val(state.pendingOpeningEdges) : val,
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

  isTitleBlockOpen: false,
  setIsTitleBlockOpen: (val) =>
    set((state) => ({
      isTitleBlockOpen: typeof val === 'function' ? val(state.isTitleBlockOpen) : val,
    })),

  titleBlockBox: null,
  setTitleBlockBox: (val) =>
    set((state) => ({
      titleBlockBox: typeof val === 'function' ? val(state.titleBlockBox) : val,
    })),

  titleBlockProposal: null,
  setTitleBlockProposal: (val) =>
    set((state) => ({
      titleBlockProposal: typeof val === 'function' ? val(state.titleBlockProposal) : val,
    })),

  isGridlineOpen: false,
  setIsGridlineOpen: (val) =>
    set((state) => ({
      isGridlineOpen: typeof val === 'function' ? val(state.isGridlineOpen) : val,
    })),

  gridProposal: null,
  setGridProposal: (val) =>
    set((state) => ({
      gridProposal: typeof val === 'function' ? val(state.gridProposal) : val,
    })),

  pendingGridlines: [],
  setPendingGridlines: (val) =>
    set((state) => ({
      pendingGridlines: typeof val === 'function' ? val(state.pendingGridlines) : val,
    })),

  selectedGridlineIndex: null,
  setSelectedGridlineIndex: (val) =>
    set((state) => ({
      selectedGridlineIndex:
        typeof val === 'function' ? val(state.selectedGridlineIndex) : val,
    })),

  isOpeningModeOpen: false,
  setIsOpeningModeOpen: (val) =>
    set((state) => ({
      isOpeningModeOpen: typeof val === 'function' ? val(state.isOpeningModeOpen) : val,
    })),

  activeOpeningType: 'door',
  setActiveOpeningType: (val) =>
    set((state) => ({
      activeOpeningType: typeof val === 'function' ? val(state.activeOpeningType) : val,
    })),
}));
