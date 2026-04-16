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
import { useProject, useSheets, useMilestones, useUnits, useStatuses, useCreateUnit, useUpdateUnitGeometry, useUpdateUnitFields, useDeleteUnit, useUpdateStatus, useClearStatus, useUpdateMilestone } from '@/hooks/useProjectQueries';
import { useQueryClient } from '@tanstack/react-query';
import { useUndoRedo } from '@/hooks/useUndoRedo';
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
  useEffect(() => setIsMounted(true), []);

  const toolMode = useAppStore(s => s.toolMode);
  const setToolMode = useAppStore(s => s.setToolMode);
  const viewMode = useAppStore(s => s.viewMode);
  const setViewMode = useAppStore(s => s.setViewMode);
  const trackingMode = useAppStore(s => s.trackingMode);
  const setTrackingMode = useAppStore(s => s.setTrackingMode);
  const selectedUnitId = useAppStore(s => s.selectedUnitId);
  const setSelectedUnitId = useAppStore(s => s.setSelectedUnitId);
  const editingUnitId = useAppStore(s => s.editingUnitId);
  const setEditingUnitId = useAppStore(s => s.setEditingUnitId);
  const activeSheetId = useAppStore(s => s.activeSheetId);
  const setActiveSheetId = useAppStore(s => s.setActiveSheetId);
  const temporalFilters = useAppStore(s => s.temporalFilters);
  const setTemporalFilters = useAppStore(s => s.setTemporalFilters);
  const filterMilestone = useAppStore(s => s.filterMilestone);
  const setFilterMilestone = useAppStore(s => s.setFilterMilestone);
  
  const settings = useHydratedStore(s => s.settings, { enableToasts: true, showHistoryHover: false, defaultViewMode: 'list' });
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
  const { data: units = [] } = useUnits(activeSheetId);
  const { data: activeStatuses = [] } = useStatuses(activeSheetId, units.map(u => u.id), milestones);

  const createUnitMutation = useCreateUnit(activeSheetId);
  const updateUnitGeometryMutation = useUpdateUnitGeometry(activeSheetId);
  const updateUnitFieldsMutation = useUpdateUnitFields(activeSheetId);
  const deleteUnitMutation = useDeleteUnit(activeSheetId);
  const updateStatusMutation = useUpdateStatus(activeSheetId, units.length);
  const clearStatusMutation = useClearStatus(activeSheetId, units.length);
  const updateMilestoneMutation = useUpdateMilestone(project?.id, activeSheetId, units.length);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const listRefs = useRef({});
  const [confirmModal, setConfirmModal] = useState(null);
  const [milestoneMenu, setMilestoneMenu] = useState(null);
  const [savingUnitId, setSavingUnitId] = useState(null);
  const [quickStatusUnitId, setQuickStatusUnitId] = useState(null);
  const [quickMilestoneUnitId, setQuickMilestoneUnitId] = useState(null);
  const [pendingPolygonPoints, setPendingPolygonPoints] = useState(null);
  const [unitNamingOpen, setUnitNamingOpen] = useState(false);
  const [newUnitName, setNewUnitName] = useState('');

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

  const {
    undoStack, setUndoStack,
    redoStack, setRedoStack,
    triggerUndo, triggerRedo
  } = useUndoRedo({
    toolMode,
    sheetId: activeSheetId,
    unitIdsLength: units.length,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newLevelName, setNewLevelName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [isUploading, setIsUploading] = useState(false);

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

  const handleAddMilestone = async (name, color, track) => {
    if (!name || !project) return;
    try {
      const { data, error } = await supabase.from('project_milestones').insert([{ project_id: project.id, name, color, track }]).select();
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['milestones'] });
    } catch (err) {
      showToast('Failed to add milestone: ' + err.message, 'error');
    }
  };

  const handleUpdateMilestone = async (id, oldName, newName, newColor) => {
    try {
      await updateMilestoneMutation.mutateAsync({ id, oldName, newName, newColor });
    } catch (err) {
      showToast('Failed to update milestone: ' + err.message, 'error');
    }
  };

  const handleDeleteMilestone = async (id) => {
    try {
      const { error } = await supabase.from('project_milestones').delete().eq('id', id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['milestones'] });
    } catch (err) {
      showToast('Failed to delete milestone: ' + err.message, 'error');
    }
  };

  const showToast = (message, type) => {
    if (!settings.enableToasts) return;
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const activeSheet = sheets.find((s) => s.id === activeSheetId);

  const floorplanRef = useRef(null);

  const exportToPDF = async () => {
    if (!activeSheetId || !activeSheet) return;
    
    showToast('Generating Vector PDF... This may take a few seconds.', 'success');
    
    const currentTrackStatuses = activeStatuses.filter((s) => s.track === trackingMode);
    
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

  const handleAddLevel = async (e) => {
    e.preventDefault();
    if (!selectedFile || !newLevelName) return;
    setIsUploading(true);

    try {
      const { data: newSheet, error } = await supabase
        .from('sheets')
        .insert([{ project_id: project.id, sheet_name: newLevelName }])
        .select();

      if (error) throw error;
      const sheetId = newSheet[0].id;

      const { image_url } = await uploadFloorplanService(sheetId, selectedFile, pdfPageNumber);

      await supabase.from('sheets').update({ base_image_url: image_url }).eq('id', sheetId);

      const updatedSheet = { ...newSheet[0], base_image_url: image_url };
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      setActiveSheetId(sheetId);
      setIsModalOpen(false);
      setNewLevelName('');
      setSelectedFile(null);
      setPdfPageNumber(1);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAttachOriginal = async (file) => {
    if (!activeSheetId || !file) return;
    try {
      showToast('Uploading original PDF...', 'success');
      await attachOriginalService(activeSheetId, file);
      showToast('Successfully attached original PDF!', 'success');
    } catch (e) {
      showToast('Failed to attach: ' + e.message, 'error');
    }
  };

  const handleRenameSheet = async (sheetId, newName) => {
    try {
      const { error } = await supabase.from('sheets').update({ sheet_name: newName }).eq('id', sheetId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      showToast('Level renamed successfully!', 'success');
    } catch (e) {
      showToast('Failed to rename: ' + e.message, 'error');
    }
  };

  const handleDeleteSheet = async (sheetId) => {
    try {
      showToast('Wiping level and all data...', 'success');
      
      await supabase.storage.from('floorplans').remove([
        `converted/${sheetId}.png`,
        `originals/${sheetId}.pdf`
      ]);

      const { data: sheetUnits } = await supabase.from('units').select('id').eq('sheet_id', sheetId);
      if (sheetUnits && sheetUnits.length > 0) {
        const unitIds = sheetUnits.map(u => u.id);
        await supabase.from('status_logs').delete().in('unit_id', unitIds);
        await supabase.from('units').delete().in('id', unitIds);
      }

      const { error } = await supabase.from('sheets').delete().eq('id', sheetId);
      if (error) throw error;

      const newSheets = sheets.filter(s => s.id !== sheetId);
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      
      if (activeSheetId === sheetId) {
        setActiveSheetId(newSheets.length > 0 ? newSheets[0].id : '');
      }

      showToast('Level deleted successfully!', 'success');
    } catch (e) {
      showToast('Failed to delete: ' + e.message, 'error');
    }
  };

  const handlePolygonComplete = (points) => {
    setToolMode('pan');
    setPendingPolygonPoints(points);
    setNewUnitName('');
    setUnitNamingOpen(true);
  };

  const handleUpdateUnitPolygon = async (unitId, newPoints, isUndoRedo = false) => {
    if (!isUndoRedo) {
      const oldUnit = units.find(u => u.id === unitId);
      if (oldUnit) {
        setUndoStack(prev => {
          const nextStack = [...prev, { actionType: 'UPDATE_GEOMETRY', unitId: unitId, oldData: oldUnit.polygon_coordinates, newData: newPoints }];
          return nextStack.length > 50 ? nextStack.slice(nextStack.length - 50) : nextStack;
        });
        setRedoStack([]);
      }
    }
    await updateUnitGeometryMutation.mutateAsync({ unitId, polygon_coordinates: newPoints }).catch(err => {
      if (!isUndoRedo) setUndoStack(prev => prev.slice(0, -1)); 
      showToast('Error updating location geometry: ' + err.message, 'error');
    });
  };

  const handleDuplicateUnit = async (unitId) => {
    const sourceUnit = units.find(u => u.id === unitId);
    if (!sourceUnit) return;
    
    const newPoints = sourceUnit.polygon_coordinates.map(p => ({
      pctX: p.pctX + 0.02,
      pctY: p.pctY + 0.02
    }));
    
    setPendingPolygonPoints(newPoints);
    setNewUnitName(`${sourceUnit.unit_number} (Copy)`);
    setUnitNamingOpen(true);
  };

  const handleInstantStamp = async (sourceUnitId, newPoints) => {
    const sourceUnit = units.find(u => u.id === sourceUnitId);
    if (!sourceUnit) return;
    
    const baseNameMatch = sourceUnit.unit_number.match(/^(.*?)(?:\s*\(Stamp\s*(\d+)\))?$/);
    const baseName = baseNameMatch ? baseNameMatch[1].trim() : sourceUnit.unit_number;
    
    let nextIndex = 1;
    units.forEach(u => {
      if (u.unit_number.startsWith(`${baseName} (Stamp`)) {
        const match = u.unit_number.match(/\(Stamp\s*(\d+)\)$/);
        if (match) {
          const idx = parseInt(match[1]);
          if (idx >= nextIndex) nextIndex = idx + 1;
        }
      }
    });
    
    const stampedName = `${baseName} (Stamp ${nextIndex})`;
    try {
      const data = await createUnitMutation.mutateAsync({ sheet_id: activeSheetId, unit_number: stampedName, polygon_coordinates: newPoints });
      setUndoStack(prev => {
        const next = [...prev, { actionType: 'CREATE_UNIT', unitData: data }];
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });
      setRedoStack([]);
    } catch (err) {
      showToast('Error stamping location: ' + err.message, 'error');
    }
  };

  const handleRenameUnitInitiate = (unitId) => {
     const unit = units.find(u => u.id === unitId);
     if (!unit) return;
     setEditingUnitId(unitId);
     setNewUnitName(unit.unit_number);
     setUnitNamingOpen(true);
  };

  const saveNewUnitFromPopover = async () => {
    const name = newUnitName.trim();
    if (!name) return;
    if (!editingUnitId && !pendingPolygonPoints) return;

    try {
      if (editingUnitId) {
         await updateUnitFieldsMutation.mutateAsync({ unitId: editingUnitId, updates: { unit_number: name } });
         setUnitNamingOpen(false);
         setEditingUnitId(null);
         setNewUnitName('');
         showToast('Location renamed.', 'success');
      } else {
         const data = await createUnitMutation.mutateAsync({ sheet_id: activeSheetId, unit_number: name, polygon_coordinates: pendingPolygonPoints });
         setUndoStack(prev => {
             const next = [...prev, { actionType: 'CREATE_UNIT', unitData: data }];
             return next.length > 50 ? next.slice(next.length - 50) : next;
         });
         setRedoStack([]);
         setUnitNamingOpen(false);
         setPendingPolygonPoints(null);
         setNewUnitName('');
         showToast('Location saved.', 'success');
      }
    } catch (err) {
      showToast('Error saving location: ' + err.message, 'error');
    }
  };

  const cancelUnitNaming = () => {
    setUnitNamingOpen(false);
    setPendingPolygonPoints(null);
    setEditingUnitId(null);
    setNewUnitName('');
  };

  const handleDeleteUnit = (unitId) => {
    setConfirmModal({
      message: 'Are you sure you want to delete this location markup?',
      onConfirm: async () => {
        const unitToDelete = units.find(u => u.id === unitId);
        const statusToDelete = activeStatuses.find(s => s.unit_id === unitId);
        
        try {
          await deleteUnitMutation.mutateAsync(unitId);
          setUndoStack(prev => {
            const next = [...prev, { actionType: 'DELETE_UNIT', unitData: unitToDelete, statusData: statusToDelete }];
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
          setRedoStack([]);
          showToast('Location deleted successfully.', 'success');
        } catch (err) {
          showToast('Error deleting location: ' + err.message, 'error');
        } finally {
          setConfirmModal(null);
        }
      },
    });
  };

  const handleUpdateUnitIconOffset = async (unitId, offsetX, offsetY) => {
    try {
      await updateUnitFieldsMutation.mutateAsync({ unitId, updates: { icon_offset_x: offsetX, icon_offset_y: offsetY } });
    } catch (err) {
      showToast('Failed to save icon offset: ' + err.message, 'error');
    }
  };

  const handleQuickUpdate = (unitId, type, value) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;

    const existingStatus = activeStatuses.find(s => s.unit_id === unitId && s.track === trackingMode);

    if (type === 'status') {
      if (value === 'none') {
        const milestone = { isClearAction: true, track: trackingMode };
        commitUnitMilestone(unit, milestone);
        return;
      }
      
      let milestoneObj;
      if (existingStatus) {
         milestoneObj = { name: existingStatus.milestone, color: existingStatus.status_color, track: trackingMode };
      } else {
         milestoneObj = milestones.find(m => m.track === trackingMode) || { name: 'Not Started', color: '#64748b', track: trackingMode };
      }
      commitUnitMilestone(unit, milestoneObj, value);
    } else if (type === 'milestone') {
      const selectedMilestone = milestones.find(m => m.name === value && m.track === trackingMode);
      if (!selectedMilestone) return;

      const temporalState = existingStatus ? existingStatus.temporal_state : 'completed';
      commitUnitMilestone(unit, selectedMilestone, temporalState);
    }
  };

  const commitUnitMilestone = async (unit, milestone, currentTemporalState = 'none', isUndoRedo = false) => {
    setSavingUnitId(unit.id);
    if (milestone.isClearAction) {
      try {
        const oldLog = activeStatuses.find(s => s.unit_id === unit.id && s.track === trackingMode) || null;
        if (!oldLog) return;
        await clearStatusMutation.mutateAsync({ unitId: unit.id, track: trackingMode, milestone: oldLog.milestone });
        if (!isUndoRedo) {
          setUndoStack(prev => {
            const next = [...prev, { actionType: 'UPDATE_STATUS', unitId: unit.id, oldLog, newLog: null }];
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
          setRedoStack([]);
        }
      } catch (err) {
        showToast('Failed to clear status: ' + err.message, 'error');
      } finally {
        setSavingUnitId(null);
      }
      return;
    }

    const oldStatus = activeStatuses.find(s => s.unit_id === unit.id && s.track === milestone.track) || null;
    try {
      const status_color = milestone.color || milestone.status_color;
      const newLogData = {
        unit_id: unit.id,
        milestone: milestone.name || milestone.milestone,
        status_color,
        temporal_state: currentTemporalState,
        track: milestone.track
      };
      const newLog = await updateStatusMutation.mutateAsync(newLogData);
      if (!isUndoRedo) {
        setUndoStack(prev => {
          const next = [...prev, { actionType: 'UPDATE_STATUS', unitId: unit.id, oldLog: oldStatus, newLog }];
          return next.length > 50 ? next.slice(next.length - 50) : next;
        });
        setRedoStack([]);
      }
    } catch (err) {
      showToast('Failed to update status: ' + err.message, 'error');
    } finally {
      setSavingUnitId(null);
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

  const currentTrackStatuses = activeStatuses.filter((s) => s.track === trackingMode);

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
              units={units}
              activeStatuses={currentTrackStatuses}
              statusFilter={filterMilestone}
              savingUnitId={savingUnitId}
              onChooseStatus={(unit) => setMilestoneMenu({ mode: 'unit', unit })}
              onUpdateTemporalState={(unit, log, state) => {
                 void commitUnitMilestone(unit, { name: log.milestone, color: log.status_color, track: log.track }, state);
              }}
              defaultView={settings.defaultFieldView || 'table'}
              milestones={milestones.filter(m => m.track === trackingMode)}
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
                    mapSettings={mapSettings}
                  imageUrl={activeSheet.base_image_url}
                  units={units}
                  activeStatuses={currentTrackStatuses}
                  toolMode={toolMode}
                  onToolModeChange={setToolMode}
                  onUpdateUnitPolygon={handleUpdateUnitPolygon}
                  onUpdateUnitIconOffset={handleUpdateUnitIconOffset}
                  onDuplicateUnit={handleDuplicateUnit}
                  onPolygonComplete={handlePolygonComplete}
                  legendFilter={filterMilestone}
                  selectedUnitId={selectedUnitId}
                  onSelectUnit={(id) => {
                    setSelectedUnitId(id);
                    if (id && listRefs.current[id]) {
                       console.log('Detected map selection -> scrolling list to unit', id);
                       listRefs.current[id].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                  onRenameUnit={handleRenameUnitInitiate}
                  onDeleteUnit={handleDeleteUnit}
                  onInstantStamp={handleInstantStamp}
                  pendingPolygonPoints={pendingPolygonPoints}
                  onPendingPolygonMove={setPendingPolygonPoints}
                  onPendingPolygonComplete={handlePolygonComplete}
                  showTooltip={settings.showTooltips}
                  settings={settings}
                  temporalFilters={temporalFilters}
                  onOpenStatusModal={(id) => setQuickStatusUnitId(id)}
                  onOpenMilestoneModal={(id) => setQuickMilestoneUnitId(id)}
                  legendPosition={legendPosition}
                  onLegendDragEnd={(pos) => setLegendPosition(prev => ({ ...prev, ...pos }))}
                  milestones={milestones.filter(m => m.track === trackingMode)}
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
              milestones={milestones}
              trackingMode={trackingMode}
              filterMilestone={filterMilestone}
              setFilterMilestone={setFilterMilestone}
              temporalFilters={temporalFilters}
              setTemporalFilters={setTemporalFilters}
              units={units}
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
        milestones={milestones.filter(m => m.track === trackingMode)}
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


