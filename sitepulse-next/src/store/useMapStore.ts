import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PercentPoint } from '@/types/domain';
import type { Updater } from '@/types/utils';
import type { RoomSuggestion } from '@/utils/roomSuggestion';
import { IDENTITY_STAMP_TRANSFORM, type StampTransform } from '@/utils/stampTransform';
import type { StampDef } from '@/utils/stampLibrary';

// `capture_box` is a workbench-only mode (AI Tracing Assist — Phase 3a): a
// rubber-band box drag over a region to read (e.g. the title block). `capture_line`
// is its Phase-3b sibling: a 2-point line drag across a grid line whose endpoints
// snap to the long straight vector (the gridline annotator's axis step). Both ride
// the SHARED toolMode the workbench already drives (pan/draw/select) and are never
// exposed by the live MapHorizontalToolbar; the canvas treats them as inert no-ops
// unless an `onCaptureBox` / `onCaptureLine` handler is wired (the workbench tracer).
// `calibrate` (Scale, Measure & Production Rates — Phase 2b) is a transient
// 2-point tool: drop two snapped points across a known dimension, type its real
// length, and the drawing's `scale_units_per_px` is set. It reuses the draw click
// path + snapping + loupe and cleans up on tool change / Esc like the others.
// `measure` (Phase 4) is its ephemeral read-only sibling: drop 2..N snapped points
// on a calibrated drawing and read the running length back in fractional
// feet-inches. It persists NOTHING and cleans up its draft on tool change / Esc.
export type ToolMode = 'pan' | 'draw' | 'stamp' | 'select' | 'multi_select' | 'route' | 'add_node' | 'delete_node' | 'capture_box' | 'capture_line' | 'calibrate' | 'measure';
export type RouteSubMode = 'move' | 'add' | 'remove';

export interface MapState {
  toolMode: ToolMode;
  setToolMode: (mode: Updater<ToolMode>) => void;

  trackingMode: string;
  setTrackingMode: (mode: Updater<string>) => void;

  pendingRoute: string[];
  setPendingRoute: (val: Updater<string[]>) => void;
  
  routeSubMode: RouteSubMode;
  setRouteSubMode: (mode: RouteSubMode) => void;

  selectedUnitIds: string[];
  setSelectedUnitIds: (ids: Updater<string[]>) => void;
  toggleSelectedUnitId: (id: string) => void;
  clearSelectedUnits: () => void;

  editingUnitId: string | null;
  setEditingUnitId: (id: Updater<string | null>) => void;

  activeSheetId: string;
  setActiveSheetId: (id: Updater<string>) => void;

  savingUnitId: string | null;
  setSavingUnitId: (val: Updater<string | null>) => void;

  quickStatusUnitId: string | null;
  setQuickStatusUnitId: (val: Updater<string | null>) => void;

  quickActivityUnitId: string | null;
  setQuickActivityUnitId: (val: Updater<string | null>) => void;

  pendingPolygonPoints: PercentPoint[] | null;
  setPendingPolygonPoints: (val: Updater<PercentPoint[] | null>) => void;

  // The FROZEN room-name/type proposal for the polygon currently being named on the
  // project map (AI Tracing Assist — Phase 4), or null for a plain manual draw. Mirrors
  // the workbench's `useWorkbenchStore.labelSuggestion`: set the moment a polygon closes
  // and held un-mutated until save/cancel so the suggested-vs-final delta stays the
  // training signal. Plain JSON (IDB-safe) and intentionally NOT persisted (transient).
  mapLabelSuggestion: RoomSuggestion | null;
  setMapLabelSuggestion: (val: Updater<RoomSuggestion | null>) => void;

  // The type (subtype/unit_type) carried by the stamp currently being named through the
  // opt-in "name each stamp" flow (Stamp & Fast Markup — Phase 3), or null. It lets the
  // naming popover pre-select the stamp's type without threading a channel through the
  // canvas. Transient tool state: set the moment a drop opens the popover, cleared on
  // save/cancel — it parallels `pendingPolygonPoints`' lifecycle. Plain JSON, NOT persisted.
  pendingStampType: { subtypeId: string | null; unitType: string | null } | null;
  setPendingStampType: (val: Updater<{ subtypeId: string | null; unitType: string | null } | null>) => void;

  // The transient orientation the NEXT stamp drops with (Stamp & Fast Markup — Phase 1):
  // net 90° rotation steps + horizontal/vertical mirror. Lives only while
  // `toolMode === 'stamp'`, reset on tool change; transient + NOT persisted (partialize).
  stampTransform: StampTransform;
  rotateStamp: (dir: 'left' | 'right') => void;
  flipStamp: (axis: 'horizontal' | 'vertical') => void;
  resetStampTransform: () => void;

  // The drawer stamp currently ARMED for placement (Stamp & Fast Markup — Phase 2), or
  // null when placement falls back to the selected room. A `StampDef` is plain JSON, but
  // this is transient tool state (never persisted — not in `partialize`) and is cleared
  // the moment we leave stamp mode. `armStamp` is the atomic "pick this from the drawer"
  // action: arm the shape, enter stamp mode, drop any selection + stale orientation, and
  // reveal the drawer, all in one commit.
  armedStamp: StampDef | null;
  armStamp: (stamp: StampDef) => void;
  clearArmedStamp: () => void;

  // Whether the stamp drawer strip is expanded. Transient floating-UI state (Zustand,
  // per AGENTS §2) — NOT persisted; defaults closed each session.
  stampDrawerOpen: boolean;
  setStampDrawerOpen: (val: Updater<boolean>) => void;

  selectedFile: File | null;
  setSelectedFile: (val: Updater<File | null>) => void;

  pdfPageNumber: number;
  setPdfPageNumber: (val: Updater<number>) => void;

  isUploading: boolean;
  setIsUploading: (val: Updater<boolean>) => void;
}

export const useMapStore = create<MapState>()(
  persist(
    (set) => ({
      toolMode: 'pan',
      setToolMode: (mode) => set((state) => ({ toolMode: typeof mode === 'function' ? mode(state.toolMode) : mode })),

      trackingMode: 'Production',
      setTrackingMode: (mode) => set((state) => ({ trackingMode: typeof mode === 'function' ? mode(state.trackingMode) : mode })),

      pendingRoute: [],
      setPendingRoute: (val) => set((state) => ({ pendingRoute: typeof val === 'function' ? val(state.pendingRoute) : val })),
      
      routeSubMode: 'move',
      setRouteSubMode: (mode) => set({ routeSubMode: mode }),

      selectedUnitIds: [],
      setSelectedUnitIds: (ids) => set((state) => ({ selectedUnitIds: typeof ids === 'function' ? ids(state.selectedUnitIds) : ids })),
      toggleSelectedUnitId: (id) => set((state) => ({
        selectedUnitIds: state.selectedUnitIds.includes(id)
          ? state.selectedUnitIds.filter((uid: string) => uid !== id)
          : [...state.selectedUnitIds, id]
      })),
      clearSelectedUnits: () => set({ selectedUnitIds: [] }),

      editingUnitId: null,
      setEditingUnitId: (id) => set((state) => ({ editingUnitId: typeof id === 'function' ? id(state.editingUnitId) : id })),

      activeSheetId: '',
      setActiveSheetId: (id) => set((state) => ({ activeSheetId: typeof id === 'function' ? id(state.activeSheetId) : id })),

      savingUnitId: null,
      setSavingUnitId: (val) => set((state) => ({ savingUnitId: typeof val === 'function' ? val(state.savingUnitId) : val })),

      quickStatusUnitId: null,
      setQuickStatusUnitId: (val) => set((state) => ({ quickStatusUnitId: typeof val === 'function' ? val(state.quickStatusUnitId) : val })),

      quickActivityUnitId: null,
      setQuickActivityUnitId: (val) => set((state) => ({ quickActivityUnitId: typeof val === 'function' ? val(state.quickActivityUnitId) : val })),

      pendingPolygonPoints: null,
      setPendingPolygonPoints: (val) => set((state) => ({ pendingPolygonPoints: typeof val === 'function' ? val(state.pendingPolygonPoints) : val })),

      mapLabelSuggestion: null,
      setMapLabelSuggestion: (val) => set((state) => ({ mapLabelSuggestion: typeof val === 'function' ? val(state.mapLabelSuggestion) : val })),

      pendingStampType: null,
      setPendingStampType: (val) => set((state) => ({ pendingStampType: typeof val === 'function' ? val(state.pendingStampType) : val })),

      stampTransform: IDENTITY_STAMP_TRANSFORM,
      rotateStamp: (dir) => set((state) => ({
        stampTransform: { ...state.stampTransform, rotation: state.stampTransform.rotation + (dir === 'right' ? 1 : -1) },
      })),
      flipStamp: (axis) => set((state) => ({
        stampTransform: axis === 'horizontal'
          ? { ...state.stampTransform, flipX: !state.stampTransform.flipX }
          : { ...state.stampTransform, flipY: !state.stampTransform.flipY },
      })),
      resetStampTransform: () => set({ stampTransform: IDENTITY_STAMP_TRANSFORM }),

      armedStamp: null,
      armStamp: (stamp) => set({
        armedStamp: stamp,
        toolMode: 'stamp',
        selectedUnitIds: [],
        stampTransform: IDENTITY_STAMP_TRANSFORM,
        stampDrawerOpen: true,
      }),
      clearArmedStamp: () => set({ armedStamp: null }),

      stampDrawerOpen: false,
      setStampDrawerOpen: (val) => set((state) => ({ stampDrawerOpen: typeof val === 'function' ? val(state.stampDrawerOpen) : val })),

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
