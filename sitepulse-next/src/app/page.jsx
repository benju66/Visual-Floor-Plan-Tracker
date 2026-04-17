"use client";
import React, { useState, useEffect, useRef } from 'react';
import { Settings, FolderEdit, Trash2, Pencil } from 'lucide-react';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import FieldStatusTable from '@/components/FieldStatusTable';
import MilestoneCommandMenu from '@/components/MilestoneCommandMenu';
import SettingsMenu from '@/components/SettingsMenu';
import ProjectManagementMenu from '@/components/ProjectManagementMenu';
import { supabase } from '@/supabaseClient';
import { useAppStore, useHydratedStore } from '@/store/useAppStore';
import { useProject, useSheets, useMilestones } from '@/hooks/useProjectQueries';
import { useMapActions } from '@/hooks/useMapActions';
import { useProjectActions } from '@/hooks/useProjectActions';
import { useQueryClient } from '@tanstack/react-query';

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

  const toolMode = useAppStore(s => s.toolMode);
  const setToolMode = useAppStore(s => s.setToolMode);
  const viewMode = useAppStore(s => s.viewMode);
  const setViewMode = useAppStore(s => s.setViewMode);
  const trackingMode = useAppStore(s => s.trackingMode);
  const setTrackingMode = useAppStore(s => s.setTrackingMode);
  const selectedUnitId = useAppStore(s => s.selectedUnitId);
  const setSelectedUnitId = useAppStore(s => s.setSelectedUnitId);
  const activeSheetId = useAppStore(s => s.activeSheetId);
  const setActiveSheetId = useAppStore(s => s.setActiveSheetId);
  const temporalFilters = useAppStore(s => s.temporalFilters);
  const setTemporalFilters = useAppStore(s => s.setTemporalFilters);
  const filterMilestone = useAppStore(s => s.filterMilestone);
  const setFilterMilestone = useAppStore(s => s.setFilterMilestone);
  
  const settings = useHydratedStore(s => s.settings, { enableToasts: true, showHistoryHover: false, defaultViewMode: 'list' });

  useEffect(() => {
    setIsMounted(true);
    setViewMode(useAppStore.getState().settings?.defaultViewMode || 'list');
  }, [setViewMode]);
  const setSettings = useAppStore(s => s.setSettings);
  const mapSettings = useHydratedStore(s => s.mapSettings, { showHorizontalToolbar: true, pinnedTools: ['undo', 'redo', 'pan', 'draw', 'add_node'] });
  const setMapSettings = useAppStore(s => s.setMapSettings);
  const legendPosition = useHydratedStore(s => s.legendPosition, { pctX: 0.05, pctY: 0.05, scaleX: 1, scaleY: 1, rotation: 0, isVisible: false });
  const setLegendPosition = useAppStore(s => s.setLegendPosition);
  const colorMode = useHydratedStore(s => s.colorMode, 'system');
  const setColorMode = useAppStore(s => s.setColorMode);

  const queryClient = useQueryClient();
  const { data: project } = useProject();
  const { data: sheets = [] } = useSheets(project?.id);
  const { data: milestones = [] } = useMilestones(project?.id);

  // Auto-select first available sheet to prevent invalid UI mounting or empty cache fallbacks
  useEffect(() => {
    if (sheets.length > 0 && (!activeSheetId || !sheets.find(s => s.id === activeSheetId))) {
      setActiveSheetId(sheets[0].id);
    }
  }, [sheets, activeSheetId, setActiveSheetId]);

  const {
    undoStack, triggerUndo, triggerRedo, redoStack,
    unitNamingOpen, setUnitNamingOpen,
    newUnitName, setNewUnitName,
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
    handleQuickUpdate
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
    handleAddMilestone,
    handleUpdateMilestone,
    handleDeleteMilestone
  } = useProjectActions(project, sheets);

  const isSettingsOpen = useAppStore(s => s.isSettingsOpen);
  const setIsSettingsOpen = useAppStore(s => s.setIsSettingsOpen);
  const isProjectMenuOpen = useAppStore(s => s.isProjectMenuOpen);
  const setIsProjectMenuOpen = useAppStore(s => s.setIsProjectMenuOpen);
  const listRefs = useRef({});
  const milestoneMenu = useAppStore(s => s.milestoneMenu);
  const setMilestoneMenu = useAppStore(s => s.setMilestoneMenu);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (selectedUnitId) {
          setSelectedUnitId(null);
          setToolMode('pan');
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [selectedUnitId]);

  useEffect(() => {
    if (selectedUnitId && listRefs.current[selectedUnitId]) {
      listRefs.current[selectedUnitId].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedUnitId]);



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

  const activeSheet = sheets.find((s) => s.id === activeSheetId);

  const floorplanRef = useRef(null);

  const exportToPDF = async () => {
    if (!activeSheetId || !activeSheet) return;
    const units = queryClient.getQueryData(['units', activeSheetId]) || [];
    const activeStatuses = queryClient.getQueryData(['statuses', activeSheetId]) || [];
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
      const activePolygons = polygonsPayload.filter(p => activeStates.includes(p.temporal_state) && p.status !== 'Not Started');
      const uniqueNames = [...new Set(activePolygons.map(p => p.status))];
      
      const active_milestones = uniqueNames.map(name => {
        const poly = activePolygons.find(p => p.status === name);
        return {
          name: name,
          color: poly?.color || '#cccccc'
        };
      });

      const activeTemporalStates = [...new Set(activePolygons.map(p => p.temporal_state))];

      payload.legend_data = {
        pctX: legendPosition.pctX,
        pctY: legendPosition.pctY,
        scaleX: legendPosition.scaleX,
        active_milestones: active_milestones,
        active_temporal_states: activeTemporalStates
      };
    }

    try {
      const { blob, filename: serverFilename } = await exportToPDFService(activeSheetId, payload);
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
      void commitUnitMilestone(milestoneMenu.unit, m);
    }
    setMilestoneMenu(null);
  };


  const cycleColorMode = () => {
    setColorMode((prev) => (prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'));
  };

  const colorModeLabel = colorMode === 'system' ? 'System' : colorMode === 'light' ? 'Light' : 'Dark';

  if (!isMounted) return null;

  const activeStatuses = queryClient.getQueryData(['statuses', activeSheetId]) || [];

  return (
    <div
      className="h-screen flex flex-col p-4 md:p-6 text-slate-800 dark:text-slate-100"
      style={{ fontFamily: 'sans-serif', background: 'var(--bg)' }}
    >
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
        {viewMode === 'list' ? (
          <div className="h-full overflow-auto">
            <FieldStatusTable
              savingUnitId={savingUnitId}
              onChooseStatus={(unit) => setMilestoneMenu({ mode: 'unit', unit })}
              onUpdateTemporalState={(unit, log, state) => {
                 void commitUnitMilestone(unit, { name: log.milestone, color: log.status_color, track: log.track }, state);
              }}
              defaultView={settings.defaultFieldView || 'table'}
            />
          </div>
        ) : (
          <div className="h-full flex flex-col lg:flex-row gap-5 items-stretch min-h-0">
            <div className="flex-[3] lg:flex-[4] flex flex-col min-h-0 min-w-0 h-full relative">
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
                  />
                  <FloorplanCanvas
                    ref={floorplanRef}
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
                  saveNewUnitFromPopover={saveNewUnitFromPopover}
                  cancelUnitNaming={cancelUnitNaming}
                />
              )}
            </div>

            <MapSidebar
              trackingMode={trackingMode}
              milestones={milestones}
              filterMilestone={filterMilestone}
              setFilterMilestone={setFilterMilestone}
              temporalFilters={temporalFilters}
              setTemporalFilters={setTemporalFilters}
              activeSheet={activeSheet}
              setToolMode={setToolMode}
              selectedUnitId={selectedUnitId}
              setSelectedUnitId={setSelectedUnitId}
              setListRef={(id, el) => listRefs.current[id] = el}
              onRenameUnitInitiate={handleRenameUnitInitiate}
              onDeleteUnit={handleDeleteUnit}
            />
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
        onSelect={handleMilestoneMenuSelect}
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
            ? (activeStatuses.find(s => s.unit_id === quickStatusUnitId && s.track === trackingMode)?.temporal_state || 'none')
            : 'none'
        }
        onCommit={handleQuickUpdate}
      />

      <QuickMilestoneModal
        isOpen={!!quickMilestoneUnitId}
        onClose={() => setQuickMilestoneUnitId(null)}
        unitId={quickMilestoneUnitId}
        currentMilestoneId={
          quickMilestoneUnitId
            ? (activeStatuses.find(s => s.unit_id === quickMilestoneUnitId && s.track === trackingMode)?.milestone || null)
            : null
        }
        milestones={milestones.filter(m => m.track === trackingMode)}
        onCommit={handleQuickUpdate}
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
      />

      <ProjectManagementMenu
        open={isProjectMenuOpen}
        onClose={() => setIsProjectMenuOpen(false)}
        sheets={sheets}
        onRenameSheet={handleRenameSheet}
        onDeleteSheet={handleDeleteSheet}
      />
    </div>
  );
}

export default App;


