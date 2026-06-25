import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PercentPoint } from '@/types/domain';
import type { Updater } from '@/types/utils';

// `capture_box` is a workbench-only mode (AI Tracing Assist — Phase 3a): a
// rubber-band box drag over a region to read (e.g. the title block). `capture_line`
// is its Phase-3b sibling: a 2-point line drag across a grid line whose endpoints
// snap to the long straight vector (the gridline annotator's axis step). Both ride
// the SHARED toolMode the workbench already drives (pan/draw/select) and are never
// exposed by the live MapHorizontalToolbar; the canvas treats them as inert no-ops
// unless an `onCaptureBox` / `onCaptureLine` handler is wired (the workbench tracer).
export type ToolMode = 'pan' | 'draw' | 'stamp' | 'select' | 'multi_select' | 'route' | 'add_node' | 'delete_node' | 'capture_box' | 'capture_line';
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

  quickMilestoneUnitId: string | null;
  setQuickMilestoneUnitId: (val: Updater<string | null>) => void;

  pendingPolygonPoints: PercentPoint[] | null;
  setPendingPolygonPoints: (val: Updater<PercentPoint[] | null>) => void;

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
