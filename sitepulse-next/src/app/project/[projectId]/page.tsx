"use client";
import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { Settings, FolderEdit, Trash2, Pencil, X, GripVertical } from 'lucide-react';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import FieldStatusTable from '@/components/FieldStatusTable';
import ScheduleWorkspace from '@/components/schedule/ScheduleWorkspace';
import LookaheadWorkspace from '@/lookahead/LookaheadWorkspace';
import BulkActionDock from '@/components/BulkActionDock';
import ActivityCommandMenuJs from '@/components/ActivityCommandMenu';
import SettingsMenu from '@/components/SettingsMenu';
import ProjectManagementMenu from '@/components/ProjectManagementMenu';
import ProjectDashboard from '@/components/ProjectDashboard';
import UnitHistoryModal from '@/components/UnitHistoryModal';
import { supabase } from '@/supabaseClient';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore, useHydratedStore, type AppSettings, type MapSettings } from '@/store/useSettingsStore';
import { useProject, useSheets, useActivities, useUnits, useStatuses, useCurrentUserRole, useSnappingVectors, useActivityOverrides, useSetActivityApplicability, useBulkSetApplicability } from '@/hooks/useProjectQueries';
import { useSubtypes } from '@/hooks/useSubtypes';
import { buildApplicabilityIndex, isActivityApplicable } from '@/utils/applicability';
import { deriveBottleneckStatuses } from '@/utils/bottleneck';
import { useMapActions } from '@/hooks/useMapActions';
import { useProjectActions } from '@/hooks/useProjectActions';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import { isValidViewMode, resolveInitialView } from '@/utils/viewRouting';

import TopHeader from '@/components/TopHeader';
import MapSidebar from '@/components/MapSidebar';
import UnitNamingPopoverJs from '@/components/UnitNamingPopover';
import { recentSubtypeIdsFromUnits, type TaxonomyResult } from '@/utils/subtypes';
import MapHorizontalToolbar from '@/components/MapHorizontalToolbar';
import AddLevelModal from '@/components/AddLevelModal';
import ConfirmModal from '@/components/ConfirmModal';
import QuickStatusModal from '@/components/QuickStatusModal';
import QuickActivityModal from '@/components/QuickActivityModal';
import { exportToPDFService, uploadFloorplanService, attachOriginalService, type ExportPDFPayload } from '@/services/api';
import { prefetchOriginalPdfs } from '@/utils/pdfSource';
import { isStringArray, type Unit, type Activity, type Subtype, type TemporalState } from '@/types/domain';
import type { Toast } from '@/store/useUIStore';

// ── Typed boundaries for still-untyped (.jsx) modals ──
// UnitNamingPopover and ActivityCommandMenu are JS/untyped, so importing them into
// this typed page infers `never[]`/`null` prop types from their default values.
// Give them a real prop contract here (AGENTS.md §6 — narrow untyped JS at the seam)
// so this page's prop-threading is type-checked. Behavior is unchanged — these are
// the same components, just with a typed view; a later phase converts them properly.
interface UnitNamingPopoverProps {
  editingUnitId: string | null;
  newUnitName: string;
  setNewUnitName: (val: string) => void;
  subtypes?: Subtype[];
  projectType?: string | null;
  initialSubtypeId?: string | null;
  initialUnitType?: string | null;
  initialPick?: TaxonomyResult | null;
  isSuggested?: boolean;
  recentSubtypeIds?: string[];
  saveNewUnitFromPopover: (pick?: TaxonomyResult | null) => void | Promise<void>;
  cancelUnitNaming: () => void;
}
const UnitNamingPopover = UnitNamingPopoverJs as unknown as React.FC<UnitNamingPopoverProps>;

interface ActivityCommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (m: Activity) => void;
  title?: string;
  description?: string;
  activities?: Activity[];
}
const ActivityCommandMenu = ActivityCommandMenuJs as unknown as React.FC<ActivityCommandMenuProps>;

// The subset of FloorplanCanvas's imperative handle this page uses (the canvas is
// forwardRef<any>, decomposed in a later slice). Only `zoomToFit` is consumed here.
interface FloorplanCanvasHandle {
  zoomToFit: (unitId: string) => void;
}

function App() {
  const [isMounted, setIsMounted] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizingRef = useRef(false);
  const lastWidthRef = useRef(320);

  const toolMode = useMapStore(s => s.toolMode);
  const setToolMode = useMapStore(s => s.setToolMode);
  const trackingMode = useMapStore(s => s.trackingMode);
  const setTrackingMode = useMapStore(s => s.setTrackingMode);
  const selectedUnitIds = useMapStore(s => s.selectedUnitIds);
  const setSelectedUnitIds = useMapStore(s => s.setSelectedUnitIds);
  const clearSelectedUnits = useMapStore(s => s.clearSelectedUnits);
  const activeSheetId = useMapStore(s => s.activeSheetId);
  const setActiveSheetId = useMapStore(s => s.setActiveSheetId);

  const viewMode = useUIStore(s => s.viewMode);
  const setViewMode = useUIStore(s => s.setViewMode);
  const historyModalUnitId = useUIStore(s => s.historyModalUnitId);
  const setHistoryModalUnitId = useUIStore(s => s.setHistoryModalUnitId);
  
  const temporalFilters = useSettingsStore(s => s.temporalFilters);
  const setTemporalFilters = useSettingsStore(s => s.setTemporalFilters);
  const filterActivity = useSettingsStore(s => s.filterActivity);
  const setFilterActivity = useSettingsStore(s => s.setFilterActivity);
  
  const settings = useHydratedStore<AppSettings>(s => s.settings, { enableToasts: true, showHistoryHover: false, defaultViewMode: 'list', show_delay_indicators: true, auto_advance_tracks: { Production: true } });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // ── View-in-the-URL (Navigation plan, Phase 1) ──
  // `?view=<mode>` is the source of truth for the active view; useUIStore.viewMode
  // stays as the in-memory mirror. navigateToView pushes a history entry (Back walks
  // views); the effect below resolves the first load and syncs Back/Forward.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const didResolveInitialView = useRef(false);

  const navigateToView = useCallback((mode: string) => {
    if (!isValidViewMode(mode)) return;
    setViewMode(mode);
    setToolMode('pan');
    if (searchParams?.get('view') !== mode) {
      router.push(`${pathname}?view=${mode}`, { scroll: false });
    }
  }, [searchParams, pathname, router, setViewMode, setToolMode]);

  useEffect(() => {
    const param = searchParams?.get('view') ?? null;
    if (!didResolveInitialView.current) {
      didResolveInitialView.current = true;
      const resolved = resolveInitialView({
        urlParam: param,
        isMobile: window.innerWidth < 768,
        defaultViewMode: useSettingsStore.getState().settings?.defaultViewMode,
        // Phase 1 keeps the hard force-to-list for phones WITHOUT a ?view= param
        // (the header switcher is hidden on mobile, so other views would strand).
        // A valid deep link still wins above. Nav Phase 4 (bottom tab bar) widens
        // this to MOBILE_VIEWS.
        mobileAllowed: ['list'],
      });
      setViewMode(resolved);
      // Stamp the resolved view onto the entry URL (replace, not push) so the
      // first Back after a view switch returns here instead of appearing dead.
      if (param !== resolved) {
        router.replace(`${pathname}?view=${resolved}`, { scroll: false });
      }
      return;
    }
    // Back/Forward (and any external URL change): reconcile a valid param into the
    // store. No-op when they already match — the guard against push/update loops.
    if (isValidViewMode(param) && param !== useUIStore.getState().viewMode) {
      setViewMode(param);
      setToolMode('pan');
    }
  }, [searchParams, pathname, router, setViewMode, setToolMode]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = window.innerWidth - e.clientX - 24;
      if (newWidth >= 250 && newWidth <= 600) {
        setSidebarWidth(newWidth);
        lastWidthRef.current = newWidth;
      }
    };
    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
      // Persist the chosen width once, at the end of the drag (not per mousemove).
      setMapSettings({ sidebarWidth: lastWidthRef.current });
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const setSettings = useSettingsStore(s => s.setSettings);
  const mapSettings = useHydratedStore<MapSettings>(s => s.mapSettings, { showHorizontalToolbar: true, showCrosshair: false, enableSnapping: true, showWalkSequence: false, sidebarWidth: 320, pinnedTools: ['undo', 'redo', 'select', 'multi_select', 'pan', 'draw', 'add_node'] });
  const setMapSettings = useSettingsStore(s => s.setMapSettings);
  const legendPosition = useHydratedStore(s => s.legendPosition, { pctX: 0.05, pctY: 0.05, scaleX: 1, scaleY: 1, rotation: 0, isVisible: false });
  const setLegendPosition = useSettingsStore(s => s.setLegendPosition);
  const colorMode = useHydratedStore(s => s.colorMode, 'system');
  const setColorMode = useSettingsStore(s => s.setColorMode);

  // Seed the live sidebar width from the persisted value once the store hydrates.
  useEffect(() => {
    if (!isResizingRef.current && typeof mapSettings.sidebarWidth === 'number') {
      setSidebarWidth(mapSettings.sidebarWidth);
      lastWidthRef.current = mapSettings.sidebarWidth;
    }
  }, [mapSettings.sidebarWidth]);

  const handleResetSidebarWidth = () => {
    setSidebarWidth(320);
    lastWidthRef.current = 320;
    setMapSettings({ sidebarWidth: 320 });
  };

  const params = useParams();
  const projectId = params?.projectId as string;

  const queryClient = useQueryClient();
  const { data: project } = useProject(projectId);
  const { data: currentUserRole, isSuccess: roleLoaded } = useCurrentUserRole(projectId);

  // Auto-Enroll verified employees as Viewers when they access a new project
  useEffect(() => {
    async function autoEnrollUser() {
      if (roleLoaded && currentUserRole === null) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await supabase.from('project_members').insert([{
            project_id: projectId,
            user_id: session.user.id,
            role: 'viewer' 
          }]);
          // Refresh the user's role and the team list
          queryClient.invalidateQueries({ queryKey: ['current_user_role', projectId] });
          queryClient.invalidateQueries({ queryKey: ['project_members', projectId] });
        }
      }
    }
    autoEnrollUser();
  }, [roleLoaded, currentUserRole, projectId, queryClient]);

  const { data: sheets = [], isSuccess: isSheetsLoaded } = useSheets(projectId);
  const { data: activities = [] } = useActivities(projectId);
  const { data: units = [] } = useUnits(activeSheetId);
  const { data: activeStatuses = [] } = useStatuses(activeSheetId, units.map(u => u.id));
  const { isFetching: isSnappingLoading } = useSnappingVectors(activeSheetId);
  const { data: activityOverrides = [] } = useActivityOverrides(projectId);
  const { data: subtypes = [] } = useSubtypes();

  // Single source of truth for "does activity M apply to unit U" —
  // unit-type rules + per-unit overrides resolved via src/utils/applicability.ts
  const applicabilityIndex = useMemo(
    () => buildApplicabilityIndex(activities, activityOverrides),
    [activities, activityOverrides]
  );

  const setApplicabilityMutation = useSetActivityApplicability(projectId);
  const bulkApplicabilityMutation = useBulkSetApplicability(projectId);

  // Bottleneck/current-status derivation lives in src/utils/bottleneck.ts so the Map,
  // the level-scoped List, and the all-levels List all compute "current work" identically.
  const mapDisplayStatuses = useMemo(
    () => deriveBottleneckStatuses({ units, statuses: activeStatuses, activities, trackingMode, applicabilityIndex }),
    [units, activeStatuses, activities, trackingMode, applicabilityIndex]
  );

  // Auto-select first available sheet to prevent invalid UI mounting or empty cache fallbacks
  useEffect(() => {
    if (!isMounted || !isSheetsLoaded) return;

    // If sheets have loaded, but the activeSheetId doesn't belong to this project's sheets
    if (sheets && !sheets.find(s => s.id === activeSheetId)) {
      // If the project has sheets, pick the first one. If it's a new project with 0 sheets, clear it.
      const fallbackId = sheets.length > 0 ? sheets[0].id : '';
      if (activeSheetId !== fallbackId) {
        setActiveSheetId(fallbackId);
      }
    }
  }, [sheets, activeSheetId, setActiveSheetId, isSheetsLoaded, isMounted]);

  const activeSheet = sheets.find((s) => s.id === activeSheetId);

  // Warm the browser HTTP cache with sibling levels' PDFs once the active
  // sheet has had time to load, so switching levels is fast on first visit.
  useEffect(() => {
    if (!activeSheetId || sheets.length < 2) return;
    const timer = setTimeout(() => prefetchOriginalPdfs(sheets, activeSheetId), 4000);
    return () => clearTimeout(timer);
  }, [sheets, activeSheetId]);

  // Auto-select valid tracking mode if the active sheet changes and doesn't contain it
  useEffect(() => {
    // active_scopes is JSONB (typed Json); narrow it to string[] at the boundary (§6).
    const scopes = activeSheet?.active_scopes;
    if (isStringArray(scopes) && scopes.length > 0) {
      if (!scopes.includes(trackingMode)) {
        setTrackingMode(scopes[0]);
      }
    }
  }, [activeSheet, trackingMode, setTrackingMode]);

  const {
    undoStack, triggerUndo, triggerRedo, redoStack,
    unitNamingOpen, setUnitNamingOpen,
    newUnitName, setNewUnitName,
    suggestedPick, isSuggested, stampPick,
    editingUnitId, savingUnitId,
    confirmModal, setConfirmModal,
    quickStatusUnitId, setQuickStatusUnitId,
    quickActivityUnitId, setQuickActivityUnitId,
    pendingPolygonPoints, setPendingPolygonPoints,
    toast, setToast,
    handlePolygonComplete,
    handleUpdateUnitPolygon,
    handleDuplicateUnit,
    handleInstantStamp,
    handleInstantStampShape,
    handleStampWithNaming,
    handleRenameUnitInitiate,
    saveNewUnitFromPopover,
    cancelUnitNaming,
    handleDeleteUnit,
    handleDeleteUnits,
    handleUpdateUnitIconOffset,
    commitUnitActivity,
    handleQuickUpdate,
    handleApplyBulkStatus,
    isPendingBulk
  } = useMapActions(project);

  const {
    isModalOpen, setIsModalOpen,
    newLevelName, setNewLevelName,
    selectedFile, setSelectedFile,
    pdfPageNumber, setPdfPageNumber,
    isUploading, setIsUploading,
    handleAddLevel,
    handleAttachOriginal,
    handleRenameSheet,
    handleDeleteSheet,
    handleReorderSheets,
    handleAddActivity,
    handleUpdateActivity,
    handleDeleteActivity
  } = useProjectActions(project, sheets, projectId);

  const isSettingsOpen = useUIStore(s => s.isSettingsOpen);
  const setIsSettingsOpen = useUIStore(s => s.setIsSettingsOpen);
  const isProjectMenuOpen = useUIStore(s => s.isProjectMenuOpen);
  const setIsProjectMenuOpen = useUIStore(s => s.setIsProjectMenuOpen);
  const listRefs = useRef<Record<string, HTMLElement>>({});
  const activityMenu = useUIStore(s => s.activityMenu);
  const setActivityMenu = useUIStore(s => s.setActivityMenu);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedUnitIds?.length > 0) {
          clearSelectedUnits();
          setToolMode('pan');
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement?.tagName === 'INPUT') return;
        if (selectedUnitIds.length > 0) {
          handleDeleteUnits(selectedUnitIds);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [selectedUnitIds, toolMode, confirmModal, isModalOpen, isSettingsOpen, isProjectMenuOpen, quickStatusUnitId, historyModalUnitId, unitNamingOpen, quickActivityUnitId]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast, setToast]);

  useEffect(() => {
    if (selectedUnitIds?.length === 1 && listRefs.current[selectedUnitIds[0]]) {
      listRefs.current[selectedUnitIds[0]].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedUnitIds]);



  useEffect(() => {
    const root = document.documentElement;
    if (colorMode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', colorMode);
  }, [colorMode]);



  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setActivityMenu({ mode: 'filter' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const showToast = (message: string, type: Toast['type']) => {
    if (!settings.enableToasts) return;
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const floorplanRef = useRef<FloorplanCanvasHandle>(null);

  // Per-unit N/A toggle. Marking a slot N/A when it already has recorded
  // status asks for confirmation — history is kept but leaves all progress math.
  const handleToggleApplicability = (unit: Unit, activity: Activity, isApplicable: boolean, currentState?: TemporalState | string | null) => {
    const commit = () => setApplicabilityMutation.mutate({ activityId: activity.id, unitId: unit.id, isApplicable });
    if (!isApplicable && currentState && currentState !== 'none') {
      setConfirmModal({
        message: `"${activity.name}" already has recorded status for ${unit.unit_number}. Mark it Not Applicable anyway? Existing history is kept but excluded from progress.`,
        onConfirm: () => { commit(); setConfirmModal(null); }
      });
    } else {
      commit();
    }
  };

  const handleBulkApplicability = (activityId: string, unitIds: string[], isApplicable: boolean) => {
    bulkApplicabilityMutation.mutate({ activityId, unitIds, isApplicable }, {
      onSuccess: () => showToast(`${unitIds.length} location(s) updated.`, 'success'),
      onError: (err) => showToast('Error updating applicability: ' + err.message, 'error')
    });
  };

  const exportToPDF = async () => {
    if (!activeSheetId || !activeSheet) return;
    const currentTrackStatuses = activeStatuses.filter((s) => s.track === trackingMode);
    
    showToast('Generating Vector PDF... This may take a few seconds.', 'success');
    
    const polygonsPayload = units
      .filter(u => u.polygon_coordinates && u.polygon_coordinates.length > 2)
      .map(u => {
        const stat = currentTrackStatuses.find((s) => s.unit_id === u.id);
        const tState = stat?.temporal_state || 'completed';
        
        if (stat && !temporalFilters.includes(tState as TemporalState)) {
          return null;
        }

        const color = stat ? stat.status_color : 'rgba(128,128,128,0.3)';
        return {
          unit_id: u.id,
          unit_number: u.unit_number,
          status: stat ? stat.activityName : 'Not Started',
          color: color,
          temporal_state: stat ? tState : 'completed',
          points: u.polygon_coordinates
        };
      })
      .filter(Boolean);

    const payload: ExportPDFPayload = {
      include_data: settings.includeExportData !== false,
      polygons: polygonsPayload,
      project_name: project?.name || 'Project',
      sheet_name: activeSheet.sheet_name
    };

    if (legendPosition?.isVisible) {
      const activeStates = ['planned', 'ongoing', 'completed'];
      
      const matchingStatuses = currentTrackStatuses.filter(s => 
        activeStates.includes(s.temporal_state) &&
        units.some(u => u.id === s.unit_id)
      );

      const uniqueActivityNames = [...new Set(matchingStatuses.map(s => s.activityName))];

      const activeLegendActivities = uniqueActivityNames.map(name => {
        const activityDef = activities.find(a => a.name === name);
        const log = matchingStatuses.find(s => s.activityName === name);
        return {
          name: name,
          // `activityDef` is an Activity (no status_color column) — dropped the dead
          // `activityDef?.status_color` term this typing surfaced (it was always undefined).
          color: activityDef?.color || log?.status_color || '#cccccc'
        };
      });

      const activeTemporalStates = [...new Set(matchingStatuses.map(s => s.temporal_state))];

      payload.legend_data = {
        pctX: legendPosition.pctX,
        pctY: legendPosition.pctY,
        scaleX: legendPosition.scaleX,
        active_activities: activeLegendActivities,
        active_temporal_states: activeTemporalStates
      };
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const { blob, filename: serverFilename } = await exportToPDFService(activeSheetId, payload, token as string);
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = downloadUrl;
      
      const fallbackFilename = `${project?.name || 'SitePulse'}_${activeSheet.sheet_name}_Status.pdf`.replace(/\s+/g, '_');
      a.download = serverFilename !== 'Export.pdf' ? serverFilename : fallbackFilename;
      
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
      
      showToast('Vector PDF Exported!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };



  const handleActivityMenuSelect = (m: Activity) => {
    if (activityMenu?.mode === 'filter') {
      setFilterActivity(m.name);
    } else if (activityMenu?.mode === 'unit') {
      if (activityMenu.onSelect) {
        activityMenu.onSelect(m);
      } else {
        void commitUnitActivity(activityMenu.unit, m);
      }
    }
    setActivityMenu(null);
  };


  const cycleColorMode = () => {
    setColorMode((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'));
  };

  const colorModeLabel = colorMode === 'system' ? 'System' : colorMode === 'light' ? 'Light' : 'Dark';

  const targetHistoryUnit = units.find(u => u.id === historyModalUnitId);

  if (!isMounted) return null;

  return (
    <div
      className="h-[100dvh] flex flex-col p-2 md:p-6 text-slate-800 dark:text-slate-100 select-none"
      style={{ fontFamily: 'sans-serif', background: 'var(--bg)' }}
    >
      <div style={{ display: 'none' }}>
        {sheets.map(sheet => (
          sheet.base_image_url && !sheet.tile_manifest_url && <img key={sheet.id} src={sheet.base_image_url} alt="preload" />
        ))}
      </div>
      <TopHeader
        project={project}
        sheets={sheets}
        activeSheetId={activeSheetId}
        setActiveSheetId={setActiveSheetId}
        setIsModalOpen={setIsModalOpen}
        setIsProjectMenuOpen={setIsProjectMenuOpen}
        setActivityMenu={setActivityMenu}
        trackingMode={trackingMode}
        setTrackingMode={setTrackingMode}
        viewMode={viewMode}
        navigateToView={navigateToView}
        activeSheet={activeSheet}
        exportToPDF={exportToPDF}
        setIsSettingsOpen={setIsSettingsOpen}
        triggerUndo={triggerUndo}
        triggerRedo={triggerRedo}
        undoStack={undoStack}
        redoStack={redoStack}
      />

      <div className="flex-1 min-h-0 flex flex-col">
        {viewMode === 'dashboard' ? (
          <div className="h-full overflow-hidden">
            <ProjectDashboard
              units={units}
              activeStatuses={activeStatuses}
              activities={activities}
              trackingMode={trackingMode}
              sheets={sheets}
              activeSheet={activeSheet}
              applicabilityIndex={applicabilityIndex}
              navigateToView={navigateToView}
            />
          </div>
        ) : viewMode === 'list' ? (
          <div className="h-full flex flex-col min-h-0">
            <FieldStatusTable
              activeStatuses={mapDisplayStatuses}
              rawStatuses={activeStatuses}
              savingUnitId={savingUnitId}
              onChooseStatus={(unit, onSelect) => setActivityMenu({ mode: 'unit', unit, onSelect })}
              onApplyPendingChanges={async (changesArray) => {
                 for (const c of changesArray) {
                    await commitUnitActivity(c.unit, c.extraProps?.activityObj || { id: c.log?.activity_id, name: c.log?.activityName, color: c.log?.status_color, track: trackingMode }, c.state, false, { ...c.extraProps, client_timestamp: c.capturedAt });
                 }
              }}
              sheets={sheets}
              activeSheetId={activeSheetId}
              setActiveSheetId={setActiveSheetId}
              applicabilityIndex={applicabilityIndex}
              onToggleApplicability={handleToggleApplicability}
              onLocateUnit={(unitId) => { navigateToView('map'); setTimeout(() => floorplanRef.current?.zoomToFit?.(unitId), 350); }}
              onDeleteUnit={handleDeleteUnit}
              onDeleteUnits={handleDeleteUnits}
            />
          </div>
        ) : viewMode === 'schedule' ? (
          <div className="h-full flex flex-col min-h-0">
            <ScheduleWorkspace
              units={units}
              rawStatuses={activeStatuses}
              activities={activities}
              applicabilityIndex={applicabilityIndex}
              sheets={sheets}
              activeSheetId={activeSheetId}
              settings={settings}
              onUpdateSettings={setSettings}
              onAddActivity={handleAddActivity}
              onUpdateActivity={handleUpdateActivity}
              onDeleteActivity={handleDeleteActivity}
            />
          </div>
        ) : viewMode === 'lookahead' ? (
          <div className="h-full min-h-0 overflow-auto">
            <LookaheadWorkspace projectId={projectId} />
          </div>
        ) : (
          <div className="h-full flex flex-col lg:flex-row items-stretch min-h-0">
            <div className="flex-1 flex flex-col min-h-0 min-w-0 h-full relative mb-5 lg:mb-0">
              {activeSheet && activeSheet.base_image_url ? (
                <>
                  <MapHorizontalToolbar
                    mapSettings={mapSettings}
                    triggerUndo={triggerUndo}
                    triggerRedo={triggerRedo}
                    undoStack={undoStack}
                    redoStack={redoStack}
                    legendIsVisible={legendPosition.isVisible}
                    onToggleLegend={() => setLegendPosition(prev => ({ ...prev, isVisible: !prev.isVisible }))}
                    onUpdateMapSettings={setMapSettings}
                    isSnappingLoading={isSnappingLoading}
                    settings={settings}
                    onUpdateSettings={setSettings}
                  />
                  <FloorplanCanvas
                    ref={floorplanRef}
                  activeStatuses={mapDisplayStatuses}
                  rawStatuses={activeStatuses}
                  imageUrl={activeSheet.base_image_url}
                  pdfVersion={activeSheet.pdf_version ?? null}
                  onUpdateUnitPolygon={handleUpdateUnitPolygon}
                  onUpdateUnitIconOffset={handleUpdateUnitIconOffset}
                  onDuplicateUnit={handleDuplicateUnit}
                  onPolygonComplete={handlePolygonComplete}
                  onRenameUnit={handleRenameUnitInitiate}
                  onDeleteUnit={(ids) => { if (Array.isArray(ids)) handleDeleteUnits(ids); else if (ids) handleDeleteUnit(ids); }}
                  onInstantStamp={handleInstantStamp}
                  onInstantStampShape={handleInstantStampShape}
                  onStampWithNaming={handleStampWithNaming}
                  pendingPolygonPoints={pendingPolygonPoints}
                  onPendingPolygonMove={setPendingPolygonPoints}
                  onOpenStatusModal={(id) => setQuickStatusUnitId(id)}
                  onOpenActivityModal={(id) => setQuickActivityUnitId(id)}
                  applicabilityIndex={applicabilityIndex}
                />
                </>
              ) : (
                <div
                  className="w-full h-full border-2 border-dashed rounded-xl flex items-center justify-center text-slate-500 glass-panel"
                >
                  {sheets.length === 0
                    ? 'Click "+ Add Level" to upload your first floor plan.'
                    : 'Loading floor plan...'}
                </div>
              )}

              {unitNamingOpen && (
                <UnitNamingPopover
                  editingUnitId={editingUnitId}
                  newUnitName={newUnitName}
                  setNewUnitName={setNewUnitName}
                  subtypes={subtypes}
                  projectType={project?.project_type || null}
                  initialSubtypeId={editingUnitId ? (units.find(u => u.id === editingUnitId)?.subtype_id || null) : null}
                  initialUnitType={editingUnitId ? (units.find(u => u.id === editingUnitId)?.unit_type || null) : null}
                  initialPick={stampPick ?? suggestedPick}
                  isSuggested={isSuggested}
                  recentSubtypeIds={recentSubtypeIdsFromUnits(units)}
                  saveNewUnitFromPopover={saveNewUnitFromPopover}
                  cancelUnitNaming={cancelUnitNaming}
                />
              )}
            </div>

            <div
              className="hidden lg:flex w-5 items-center justify-center cursor-col-resize flex-shrink-0 bg-transparent group relative z-10"
              onMouseDown={handleMouseDownResize}
              onDoubleClick={handleResetSidebarWidth}
              title="Drag to resize · double-click to reset"
            >
               <div className="flex items-center justify-center w-full h-16 rounded-full bg-slate-200/70 dark:bg-white/10 group-hover:bg-blue-500 transition-colors shadow-sm">
                 <GripVertical size={14} className="text-slate-400 dark:text-slate-300 group-hover:text-white transition-colors" />
               </div>
            </div>

            <div 
              className="w-full lg:w-[var(--sidebar-width)] h-full flex-shrink-0 group/sidebar"
              style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
            >
              <MapSidebar
              activities={activities}
              filterActivity={filterActivity}
              setFilterActivity={setFilterActivity}
              temporalFilters={temporalFilters}
              setTemporalFilters={setTemporalFilters}
              activeSheet={activeSheet}
              activeStatuses={activeStatuses}
              applicabilityIndex={applicabilityIndex}
              savingUnitId={savingUnitId}
              onRenameUnitInitiate={handleRenameUnitInitiate}
              onDeleteUnit={handleDeleteUnit}
              onLocateUnit={(unitId) => floorplanRef.current?.zoomToFit(unitId)}
              onCommitStatus={(unit, activity, state, extraProps) => commitUnitActivity(unit, activity, state, false, extraProps)}
              onToggleApplicability={handleToggleApplicability}
              onOpenHistory={setHistoryModalUnitId}
            />
            </div>
          </div>
        )}
      </div>

      <ActivityCommandMenu
        open={activityMenu !== null}
        onOpenChange={(open) => !open && setActivityMenu(null)}
        title={
          activityMenu?.mode === 'unit'
            ? `Status — Location ${activityMenu.unit.unit_number}`
            : 'Filter & search activities'
        }
        description={
          activityMenu?.mode === 'filter'
            ? 'Pick one to filter the map and field list. Use Ctrl+K anytime.'
            : 'Search and press Enter to save this location’s status.'
        }
        activities={activities.filter(m => m.track === trackingMode)}
        onSelect={handleActivityMenuSelect}
      />

      {/* Map-only: the List/Schedule views use their own controls instead. */}
      {viewMode !== 'list' && viewMode !== 'dashboard' && viewMode !== 'schedule' && (
        <BulkActionDock
          selectedUnitIds={selectedUnitIds}
          onClearSelection={clearSelectedUnits}
          activities={activities}
          onApplyBulkStatus={(params) => {
            const bottlenecks = selectedUnitIds.map(id => mapDisplayStatuses.find(s => s.unit_id === id && s.track === trackingMode)).filter(Boolean);
            handleApplyBulkStatus({ ...params, bottlenecks });
          }}
          onApplyBulkApplicability={handleBulkApplicability}
          isPending={isPendingBulk || bulkApplicabilityMutation.isPending}
        />
      )}

      {isModalOpen && (
        <AddLevelModal
          handleAddLevel={handleAddLevel}
          newLevelName={newLevelName}
          setNewLevelName={setNewLevelName}
          pdfPageNumber={pdfPageNumber}
          setPdfPageNumber={setPdfPageNumber}
          setSelectedFile={setSelectedFile}
          setIsModalOpen={setIsModalOpen}
          isUploading={isUploading}
        />
      )}

      <ConfirmModal
        confirmModal={confirmModal}
        setConfirmModal={setConfirmModal}
      />

      <QuickStatusModal
        isOpen={!!quickStatusUnitId}
        onClose={() => setQuickStatusUnitId(null)}
        unitId={quickStatusUnitId}
        currentStatus={
          quickStatusUnitId 
            ? (mapDisplayStatuses.find(s => s.unit_id === quickStatusUnitId && s.track === trackingMode)?.temporal_state || 'none')
            : 'none'
        }
        onCommit={(unitId: string, type: 'status' | 'activity', val: string, extraProps: Record<string, unknown> = {}) => {
          const bottleneck = mapDisplayStatuses.find(s => s.unit_id === unitId && s.track === trackingMode);
          if (bottleneck) {
             extraProps.activityObj = { id: bottleneck.activity_id, name: bottleneck.activityName, color: bottleneck.status_color, track: trackingMode };
          }
          handleQuickUpdate(unitId, type, val, extraProps);
        }}
      />

      <QuickActivityModal
        isOpen={!!quickActivityUnitId}
        onClose={() => setQuickActivityUnitId(null)}
        unitId={quickActivityUnitId}
        currentActivityId={
          quickActivityUnitId
            ? (mapDisplayStatuses.find(s => s.unit_id === quickActivityUnitId && s.track === trackingMode)?.activityName || null)
            : null
        }
        activities={activities.filter(m => m.track === trackingMode)}
        onCommit={(unitId: string, type: 'status' | 'activity', val: string, extraProps: Record<string, unknown> = {}) => {
          const bottleneck = mapDisplayStatuses.find(s => s.unit_id === unitId && s.track === trackingMode);
          if (bottleneck) {
             extraProps.temporal_state = bottleneck.temporal_state;
          }
          handleQuickUpdate(unitId, type, val, extraProps);
        }}
      />

      <UnitHistoryModal
        isOpen={!!historyModalUnitId}
        onClose={() => setHistoryModalUnitId(null)}
        unitId={historyModalUnitId}
        unitNumber={targetHistoryUnit?.unit_number}
        unitType={targetHistoryUnit?.unit_type}
        activities={activities}
        trackingMode={trackingMode}
        currentStatuses={activeStatuses}
        applicabilityIndex={applicabilityIndex}
      />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-[100px] sm:bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-2xl font-bold text-white max-w-sm sm:max-w-md w-max flex items-center justify-between gap-4 transition-all animate-in fade-in slide-in-from-bottom-4 ${
            toast.type === 'error' ? 'bg-red-600' : 
            toast.type === 'info' ? 'bg-sky-600' : 'bg-emerald-600'
          }`}
        >
          <span className="text-sm tracking-wide truncate">{toast.message}</span>
          <button 
            onClick={() => setToast(null)}
            className="p-1 hover:bg-white/20 rounded-full transition-colors active:scale-95 shrink-0"
            aria-label="Dismiss notification"
          >
            <X size={16} strokeWidth={3} />
          </button>
        </div>
      )}

      <SettingsMenu
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={setSettings}
        colorMode={colorMode}
        setColorMode={setColorMode}
        onAttachOriginal={handleAttachOriginal}
        activities={activities}
        mapSettings={mapSettings}
        onUpdateMapSettings={setMapSettings}
        sheets={sheets}
        projectId={projectId}
        navigateToView={navigateToView}
      />

      <ProjectManagementMenu
        open={isProjectMenuOpen}
        onClose={() => setIsProjectMenuOpen(false)}
        sheets={sheets}
        onRenameSheet={handleRenameSheet}
        onDeleteSheet={handleDeleteSheet}
        onReorderSheets={handleReorderSheets}
      />
    </div>
  );
}

// useSearchParams needs a Suspense boundary above it during prerendering
// (node_modules/next/dist/docs — missing-suspense-with-csr-bailout). App renders
// null until mounted anyway, so a null fallback is visually identical.
export default function ProjectPage() {
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );
}


