"use client";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, FolderEdit, Trash2, Pencil, X, GripVertical } from 'lucide-react';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import FieldStatusTable from '@/components/FieldStatusTable';
import ScheduleWorkspace from '@/components/schedule/ScheduleWorkspace';
import LookaheadWorkspace from '@/lookahead/LookaheadWorkspace';
import BulkActionDock from '@/components/BulkActionDock';
import MilestoneCommandMenu from '@/components/MilestoneCommandMenu';
import SettingsMenu from '@/components/SettingsMenu';
import ProjectManagementMenu from '@/components/ProjectManagementMenu';
import ProjectDashboard from '@/components/ProjectDashboard';
import UnitHistoryModal from '@/components/UnitHistoryModal';
import { supabase } from '@/supabaseClient';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore, useHydratedStore } from '@/store/useSettingsStore';
import { useProject, useSheets, useMilestones, useUnits, useStatuses, useCurrentUserRole, useSnappingVectors, useMilestoneOverrides, useSetMilestoneApplicability, useBulkSetApplicability } from '@/hooks/useProjectQueries';
import { useSubtypes } from '@/hooks/useSubtypes';
import { buildApplicabilityIndex, isMilestoneApplicable } from '@/utils/applicability';
import { deriveBottleneckStatuses } from '@/utils/bottleneck';
import { useMapActions } from '@/hooks/useMapActions';
import { useProjectActions } from '@/hooks/useProjectActions';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';

import TopHeader from '@/components/TopHeader';
import MapSidebar from '@/components/MapSidebar';
import UnitNamingPopover from '@/components/UnitNamingPopover';
import { recentSubtypeIdsFromUnits } from '@/utils/subtypes';
import MapHorizontalToolbar from '@/components/MapHorizontalToolbar';
import AddLevelModal from '@/components/AddLevelModal';
import ConfirmModal from '@/components/ConfirmModal';
import QuickStatusModal from '@/components/QuickStatusModal';
import QuickMilestoneModal from '@/components/QuickMilestoneModal';
import { exportToPDFService, uploadFloorplanService, attachOriginalService } from '@/services/api';
import { prefetchOriginalPdfs } from '@/utils/pdfSource';

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
  const filterMilestone = useSettingsStore(s => s.filterMilestone);
  const setFilterMilestone = useSettingsStore(s => s.setFilterMilestone);
  
  const settings = useHydratedStore(s => s.settings, { enableToasts: true, showHistoryHover: false, defaultViewMode: 'list' });

  useEffect(() => {
    setIsMounted(true);
    if (typeof window !== 'undefined') {
      if (window.innerWidth < 768) {
        setViewMode('list');
      } else if (!sessionStorage.getItem('sitepulse-ui-session')) {
        setViewMode(useSettingsStore.getState().settings?.defaultViewMode || 'list');
      }
    }
  }, [setViewMode]);

  useEffect(() => {
    const handleMouseMove = (e) => {
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

  const handleMouseDownResize = (e) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const setSettings = useSettingsStore(s => s.setSettings);
  const mapSettings = useHydratedStore(s => s.mapSettings, { showHorizontalToolbar: true, sidebarWidth: 320, pinnedTools: ['undo', 'redo', 'select', 'multi_select', 'pan', 'draw', 'add_node'] });
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
  const projectId = params?.projectId;

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
  const { data: milestones = [] } = useMilestones(projectId);
  const { data: units = [] } = useUnits(activeSheetId);
  const { data: activeStatuses = [] } = useStatuses(activeSheetId, units.map(u => u.id), milestones);
  const { isFetching: isSnappingLoading } = useSnappingVectors(activeSheetId);
  const { data: milestoneOverrides = [] } = useMilestoneOverrides(projectId);
  const { data: subtypes = [] } = useSubtypes();

  // Single source of truth for "does milestone M apply to unit U" —
  // unit-type rules + per-unit overrides resolved via src/utils/applicability.ts
  const applicabilityIndex = useMemo(
    () => buildApplicabilityIndex(milestones, milestoneOverrides),
    [milestones, milestoneOverrides]
  );

  const setApplicabilityMutation = useSetMilestoneApplicability(projectId);
  const bulkApplicabilityMutation = useBulkSetApplicability(projectId);

  // Bottleneck/current-status derivation lives in src/utils/bottleneck.ts so the Map,
  // the level-scoped List, and the all-levels List all compute "current work" identically.
  const mapDisplayStatuses = useMemo(
    () => deriveBottleneckStatuses({ units, statuses: activeStatuses, milestones, trackingMode, applicabilityIndex }),
    [units, activeStatuses, milestones, trackingMode, applicabilityIndex]
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
    if (activeSheet?.active_scopes && activeSheet.active_scopes.length > 0) {
      if (!activeSheet.active_scopes.includes(trackingMode)) {
        setTrackingMode(activeSheet.active_scopes[0]);
      }
    }
  }, [activeSheet, trackingMode, setTrackingMode]);

  const {
    undoStack, triggerUndo, triggerRedo, redoStack,
    unitNamingOpen, setUnitNamingOpen,
    newUnitName, setNewUnitName,
    suggestedPick, isSuggested,
    editingUnitId, savingUnitId,
    confirmModal, setConfirmModal,
    quickStatusUnitId, setQuickStatusUnitId,
    quickMilestoneUnitId, setQuickMilestoneUnitId,
    pendingPolygonPoints, setPendingPolygonPoints,
    toast, setToast,
    handlePolygonComplete,
    handleUpdateUnitPolygon,
    handleDuplicateUnit,
    handleInstantStamp,
    handleRenameUnitInitiate,
    saveNewUnitFromPopover,
    cancelUnitNaming,
    handleDeleteUnit,
    handleDeleteUnits,
    handleUpdateUnitIconOffset,
    commitUnitMilestone,
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
    handleAddMilestone,
    handleUpdateMilestone,
    handleDeleteMilestone
  } = useProjectActions(project, sheets, projectId);

  const isSettingsOpen = useUIStore(s => s.isSettingsOpen);
  const setIsSettingsOpen = useUIStore(s => s.setIsSettingsOpen);
  const isProjectMenuOpen = useUIStore(s => s.isProjectMenuOpen);
  const setIsProjectMenuOpen = useUIStore(s => s.setIsProjectMenuOpen);
  const listRefs = useRef({});
  const milestoneMenu = useUIStore(s => s.milestoneMenu);
  const setMilestoneMenu = useUIStore(s => s.setMilestoneMenu);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
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
  }, [selectedUnitIds, toolMode, confirmModal, isModalOpen, isSettingsOpen, isProjectMenuOpen, quickStatusUnitId, historyModalUnitId, unitNamingOpen, quickMilestoneUnitId]);

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
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setMilestoneMenu({ mode: 'filter' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const showToast = (message, type) => {
    if (!settings.enableToasts) return;
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const floorplanRef = useRef(null);

  // Per-unit N/A toggle. Marking a slot N/A when it already has recorded
  // status asks for confirmation — history is kept but leaves all progress math.
  const handleToggleApplicability = (unit, milestone, isApplicable, currentState) => {
    const commit = () => setApplicabilityMutation.mutate({ milestoneId: milestone.id, unitId: unit.id, isApplicable });
    if (!isApplicable && currentState && currentState !== 'none') {
      setConfirmModal({
        message: `"${milestone.name}" already has recorded status for ${unit.unit_number}. Mark it Not Applicable anyway? Existing history is kept but excluded from progress.`,
        onConfirm: () => { commit(); setConfirmModal(null); }
      });
    } else {
      commit();
    }
  };

  const handleBulkApplicability = (milestoneId, unitIds, isApplicable) => {
    bulkApplicabilityMutation.mutate({ milestoneId, unitIds, isApplicable }, {
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
        
        if (stat && !temporalFilters.includes(tState)) {
          return null;
        }

        const color = stat ? stat.status_color : 'rgba(128,128,128,0.3)';
        return {
          unit_id: u.id,
          unit_number: u.unit_number,
          status: stat ? stat.milestone : 'Not Started',
          color: color,
          temporal_state: stat ? tState : 'completed',
          points: u.polygon_coordinates
        };
      })
      .filter(Boolean);

    const payload = {
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

      const uniqueMilestoneNames = [...new Set(matchingStatuses.map(s => s.milestone))];
      
      const active_milestones = uniqueMilestoneNames.map(name => {
        const milestoneDef = milestones.find(m => m.name === name);
        const log = matchingStatuses.find(s => s.milestone === name);
        return {
          name: name,
          color: milestoneDef?.color || milestoneDef?.status_color || log?.status_color || '#cccccc'
        };
      });

      const activeTemporalStates = [...new Set(matchingStatuses.map(s => s.temporal_state))];

      payload.legend_data = {
        pctX: legendPosition.pctX,
        pctY: legendPosition.pctY,
        scaleX: legendPosition.scaleX,
        active_milestones: active_milestones,
        active_temporal_states: activeTemporalStates
      };
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const { blob, filename: serverFilename } = await exportToPDFService(activeSheetId, payload, token);
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
      showToast(err.message, 'error');
    }
  };



  const handleMilestoneMenuSelect = (m) => {
    if (milestoneMenu?.mode === 'filter') {
      setFilterMilestone(m.name);
    } else if (milestoneMenu?.mode === 'unit') {
      if (milestoneMenu.onSelect) {
        milestoneMenu.onSelect(m);
      } else {
        void commitUnitMilestone(milestoneMenu.unit, m);
      }
    }
    setMilestoneMenu(null);
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
        setMilestoneMenu={setMilestoneMenu}
        trackingMode={trackingMode}
        setTrackingMode={setTrackingMode}
        viewMode={viewMode}
        setViewMode={setViewMode}
        setToolMode={setToolMode}
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
              milestones={milestones}
              trackingMode={trackingMode}
              sheets={sheets}
              activeSheet={activeSheet}
              applicabilityIndex={applicabilityIndex}
            />
          </div>
        ) : viewMode === 'list' ? (
          <div className="h-full flex flex-col min-h-0">
            <FieldStatusTable
              activeStatuses={mapDisplayStatuses}
              rawStatuses={activeStatuses}
              savingUnitId={savingUnitId}
              onChooseStatus={(unit, onSelect) => setMilestoneMenu({ mode: 'unit', unit, onSelect })}
              onApplyPendingChanges={async (changesArray) => {
                 for (const c of changesArray) {
                    await commitUnitMilestone(c.unit, c.extraProps?.milestoneObj || { id: c.log?.activity_id, name: c.log?.milestone, color: c.log?.status_color, track: trackingMode }, c.state, false, { ...c.extraProps, client_timestamp: c.capturedAt });
                 }
              }}
              sheets={sheets}
              activeSheetId={activeSheetId}
              setActiveSheetId={setActiveSheetId}
              applicabilityIndex={applicabilityIndex}
              onToggleApplicability={handleToggleApplicability}
              onLocateUnit={(unitId) => { setViewMode('map'); setTimeout(() => floorplanRef.current?.zoomToFit?.(unitId), 350); }}
              onDeleteUnit={handleDeleteUnit}
              onDeleteUnits={handleDeleteUnits}
            />
          </div>
        ) : viewMode === 'schedule' ? (
          <div className="h-full flex flex-col min-h-0">
            <ScheduleWorkspace
              units={units}
              rawStatuses={activeStatuses}
              milestones={milestones}
              applicabilityIndex={applicabilityIndex}
              sheets={sheets}
              activeSheetId={activeSheetId}
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
                    toolMode={toolMode} 
                    onToolModeChange={setToolMode}
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
                  pendingPolygonPoints={pendingPolygonPoints}
                  onPendingPolygonMove={setPendingPolygonPoints}
                  onPendingPolygonComplete={handlePolygonComplete}
                  showTooltip={settings.showTooltips}
                  onOpenStatusModal={(id) => setQuickStatusUnitId(id)}
                  onOpenMilestoneModal={(id) => setQuickMilestoneUnitId(id)}
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
                  initialPick={suggestedPick}
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
              style={{ '--sidebar-width': `${sidebarWidth}px` }}
            >
              <MapSidebar
              milestones={milestones}
              filterMilestone={filterMilestone}
              setFilterMilestone={setFilterMilestone}
              temporalFilters={temporalFilters}
              setTemporalFilters={setTemporalFilters}
              activeSheet={activeSheet}
              activeStatuses={activeStatuses}
              applicabilityIndex={applicabilityIndex}
              savingUnitId={savingUnitId}
              onRenameUnitInitiate={handleRenameUnitInitiate}
              onDeleteUnit={handleDeleteUnit}
              onLocateUnit={(unitId) => floorplanRef.current?.zoomToFit(unitId)}
              onCommitStatus={(unit, milestone, state, extraProps) => commitUnitMilestone(unit, milestone, state, false, extraProps)}
              onToggleApplicability={handleToggleApplicability}
              onOpenHistory={setHistoryModalUnitId}
            />
            </div>
          </div>
        )}
      </div>

      <MilestoneCommandMenu
        open={milestoneMenu !== null}
        onOpenChange={(open) => !open && setMilestoneMenu(null)}
        title={
          milestoneMenu?.mode === 'unit'
            ? `Status — Location ${milestoneMenu.unit.unit_number}`
            : 'Filter & search milestones'
        }
        description={
          milestoneMenu?.mode === 'filter'
            ? 'Pick one to filter the map and field list. Use Ctrl+K anytime.'
            : 'Search and press Enter to save this location’s status.'
        }
        milestones={milestones.filter(m => m.track === trackingMode)}
        onSelect={handleMilestoneMenuSelect}
      />

      {/* Map-only: the List/Schedule views use their own controls instead. */}
      {viewMode !== 'list' && viewMode !== 'dashboard' && viewMode !== 'schedule' && (
        <BulkActionDock
          selectedUnitIds={selectedUnitIds}
          onClearSelection={clearSelectedUnits}
          milestones={milestones}
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
        onCommit={(unitId, type, val, extraProps = {}) => {
          const bottleneck = mapDisplayStatuses.find(s => s.unit_id === unitId && s.track === trackingMode);
          if (bottleneck) {
             extraProps.milestoneObj = { id: bottleneck.activity_id, name: bottleneck.milestone, color: bottleneck.status_color, track: trackingMode };
          }
          handleQuickUpdate(unitId, type, val, extraProps);
        }}
      />

      <QuickMilestoneModal
        isOpen={!!quickMilestoneUnitId}
        onClose={() => setQuickMilestoneUnitId(null)}
        unitId={quickMilestoneUnitId}
        currentMilestoneId={
          quickMilestoneUnitId
            ? (mapDisplayStatuses.find(s => s.unit_id === quickMilestoneUnitId && s.track === trackingMode)?.milestone || null)
            : null
        }
        milestones={milestones.filter(m => m.track === trackingMode)}
        onCommit={(unitId, type, val, extraProps = {}) => {
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
        milestones={milestones}
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
        milestones={milestones}
        onAddMilestone={handleAddMilestone}
        onUpdateMilestone={handleUpdateMilestone}
        onDeleteMilestone={handleDeleteMilestone}
        mapSettings={mapSettings}
        onUpdateMapSettings={setMapSettings}
        sheets={sheets}
        projectId={projectId}
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

export default App;


