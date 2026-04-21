"use client";
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, FolderEdit, Trash2, Pencil } from 'lucide-react';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import FieldStatusTable from '@/components/FieldStatusTable';
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
import { useProject, useSheets, useMilestones, useUnits, useStatuses, useCurrentUserRole } from '@/hooks/useProjectQueries';
import { useMapActions } from '@/hooks/useMapActions';
import { useProjectActions } from '@/hooks/useProjectActions';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';

import TopHeader from '@/components/TopHeader';
import MapSidebar from '@/components/MapSidebar';
import UnitNamingPopover from '@/components/UnitNamingPopover';
import MapHorizontalToolbar from '@/components/MapHorizontalToolbar';
import AddLevelModal from '@/components/AddLevelModal';
import ConfirmModal from '@/components/ConfirmModal';
import QuickStatusModal from '@/components/QuickStatusModal';
import QuickMilestoneModal from '@/components/QuickMilestoneModal';
import { exportToPDFService, uploadFloorplanService, attachOriginalService } from '@/services/api';

function App() {
  const [isMounted, setIsMounted] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizingRef = useRef(false);

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
    // Only apply default view mode on fresh tabs where no session exists
    if (typeof window !== 'undefined' && !sessionStorage.getItem('sitepulse-ui-session')) {
      setViewMode(useSettingsStore.getState().settings?.defaultViewMode || 'list');
    }
  }, [setViewMode]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const newWidth = window.innerWidth - e.clientX - 24;
      if (newWidth >= 250 && newWidth <= 600) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
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
  const mapSettings = useHydratedStore(s => s.mapSettings, { showHorizontalToolbar: true, pinnedTools: ['undo', 'redo', 'select', 'multi_select', 'pan', 'draw', 'add_node'] });
  const setMapSettings = useSettingsStore(s => s.setMapSettings);
  const legendPosition = useHydratedStore(s => s.legendPosition, { pctX: 0.05, pctY: 0.05, scaleX: 1, scaleY: 1, rotation: 0, isVisible: false });
  const setLegendPosition = useSettingsStore(s => s.setLegendPosition);
  const colorMode = useHydratedStore(s => s.colorMode, 'system');
  const setColorMode = useSettingsStore(s => s.setColorMode);

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

  const { data: sheets = [] } = useSheets(projectId);
  const { data: milestones = [] } = useMilestones(projectId);
  const { data: units = [] } = useUnits(activeSheetId);
  const { data: activeStatuses = [] } = useStatuses(activeSheetId, units.map(u => u.id), milestones);

  const mapDisplayStatuses = useMemo(() => {
    const currentTrackMilestones = milestones
      .filter(m => m.track === trackingMode)
      .sort((a,b) => (a.sequence_order || 0) - (b.sequence_order || 0));
    
    return units.map(unit => {
      const unitStatuses = activeStatuses.filter(s => s.unit_id === unit.id && s.track === trackingMode);
      if (unitStatuses.length === 0) return null;

      let primaryMasterIdx = currentTrackMilestones.length - 1; // Default to end
      let masterFurthestCompletedIdx = -1;

      // 1. Find the FIRST milestone in the sequence that is NOT completed
      for (let i = 0; i < currentTrackMilestones.length; i++) {
         const m = currentTrackMilestones[i];
         const log = unitStatuses.find(s => s.milestone === m.name);
         
         if (log && log.temporal_state === 'completed') {
             masterFurthestCompletedIdx = Math.max(masterFurthestCompletedIdx, i);
         } else {
             // This is the bottleneck (planned, ongoing, or missing)
             primaryMasterIdx = i;
             break; 
         }
      }

      // 2. Reconstruct the structural active status block for the renderer
      const primaryMilestone = currentTrackMilestones[primaryMasterIdx];
      const existingLog = unitStatuses.find(s => s.milestone === primaryMilestone.name);
      
      const primaryStatus = existingLog || {
         unit_id: unit.id,
         milestone: primaryMilestone.name,
         status_color: primaryMilestone.color,
         temporal_state: (primaryMasterIdx === masterFurthestCompletedIdx && existingLog?.temporal_state === 'completed') ? 'completed' : 'planned',
         track: trackingMode
      };
      
      // 3. Find Out-of-Sequence work existing AFTER the bottleneck sequentially
      const outOfSequence = unitStatuses.filter(s => {
          if (s.temporal_state !== 'completed' && s.temporal_state !== 'ongoing') return false;
          const sIdx = currentTrackMilestones.findIndex(m => m.name === s.milestone);
          return sIdx > primaryMasterIdx;
      });

      // Return the merged object
      return {
          ...primaryStatus,
          outOfSequence
      };
    }).filter(Boolean);
  }, [units, activeStatuses, milestones, trackingMode]);

  // Auto-select first available sheet to prevent invalid UI mounting or empty cache fallbacks
  useEffect(() => {
    if (sheets.length > 0 && (!activeSheetId || !sheets.find(s => s.id === activeSheetId))) {
      setActiveSheetId(sheets[0].id);
    }
  }, [sheets, activeSheetId, setActiveSheetId]);

  const activeSheet = sheets.find((s) => s.id === activeSheetId);

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
    newUnitType, setNewUnitType,
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
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [selectedUnitIds]);

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
      className="h-screen flex flex-col p-4 md:p-6 text-slate-800 dark:text-slate-100 select-none"
      style={{ fontFamily: 'sans-serif', background: 'var(--bg)' }}
    >
      <div style={{ display: 'none' }}>
        {sheets.map(sheet => (
          sheet.base_image_url && <img key={sheet.id} src={sheet.base_image_url} alt="preload" />
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
            />
          </div>
        ) : viewMode === 'list' ? (
          <div className="h-full overflow-auto">
            <FieldStatusTable
              activeStatuses={mapDisplayStatuses}
              savingUnitId={savingUnitId}
              onChooseStatus={(unit, onSelect) => setMilestoneMenu({ mode: 'unit', unit, onSelect })}
              onApplyPendingChanges={async (changesArray) => {
                 for (const c of changesArray) {
                    await commitUnitMilestone(c.unit, c.extraProps?.milestoneObj || { name: c.log?.milestone, color: c.log?.status_color, track: trackingMode }, c.state, false, c.extraProps);
                 }
              }}
              defaultView={settings.defaultFieldView || 'table'}
            />
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
                  />
                  <FloorplanCanvas
                    ref={floorplanRef}
                  activeStatuses={mapDisplayStatuses}
                  imageUrl={activeSheet.base_image_url}
                  onUpdateUnitPolygon={handleUpdateUnitPolygon}
                  onUpdateUnitIconOffset={handleUpdateUnitIconOffset}
                  onDuplicateUnit={handleDuplicateUnit}
                  onPolygonComplete={handlePolygonComplete}
                  onRenameUnit={handleRenameUnitInitiate}
                  onDeleteUnit={handleDeleteUnit}
                  onInstantStamp={handleInstantStamp}
                  pendingPolygonPoints={pendingPolygonPoints}
                  onPendingPolygonMove={setPendingPolygonPoints}
                  onPendingPolygonComplete={handlePolygonComplete}
                  showTooltip={settings.showTooltips}
                  onOpenStatusModal={(id) => setQuickStatusUnitId(id)}
                  onOpenMilestoneModal={(id) => setQuickMilestoneUnitId(id)}
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
                  newUnitType={newUnitType}
                  setNewUnitType={setNewUnitType}
                  projectUnitTypes={project?.unit_types || ['Apartment Unit', 'Common Area', 'Back of House', 'Commercial Space', 'Other']}
                  saveNewUnitFromPopover={saveNewUnitFromPopover}
                  cancelUnitNaming={cancelUnitNaming}
                />
              )}
            </div>

            <div 
              className="hidden lg:flex w-5 items-center justify-center cursor-col-resize flex-shrink-0 bg-transparent group relative z-10"
              onMouseDown={handleMouseDownResize}
            >
               <div className="w-1 h-32 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-blue-400 transition-colors" />
            </div>

            <div 
              className="w-full lg:w-[var(--sidebar-width)] h-full flex-shrink-0 group/sidebar"
              style={{ '--sidebar-width': `${sidebarWidth}px` }}
            >
              <MapSidebar
              trackingMode={trackingMode}
              milestones={milestones}
              filterMilestone={filterMilestone}
              setFilterMilestone={setFilterMilestone}
              temporalFilters={temporalFilters}
              setTemporalFilters={setTemporalFilters}
              activeSheet={activeSheet}
              setToolMode={setToolMode}
              selectedUnitIds={selectedUnitIds}
              setSelectedUnitIds={setSelectedUnitIds}
              setListRef={(id, el) => listRefs.current[id] = el}
              onRenameUnitInitiate={handleRenameUnitInitiate}
              onDeleteUnit={handleDeleteUnit}
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

      <BulkActionDock
        selectedUnitIds={selectedUnitIds}
        onClearSelection={clearSelectedUnits}
        milestones={milestones}
        onApplyBulkStatus={(params) => {
          const bottlenecks = selectedUnitIds.map(id => mapDisplayStatuses.find(s => s.unit_id === id && s.track === trackingMode)).filter(Boolean);
          handleApplyBulkStatus({ ...params, bottlenecks });
        }}
        isPending={isPendingBulk}
      />

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
             extraProps.milestoneObj = { name: bottleneck.milestone, color: bottleneck.status_color, track: trackingMode };
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
      />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-6 py-3 rounded-lg shadow-lg font-medium text-white max-w-md text-center ${
            toast.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {toast.message}
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


