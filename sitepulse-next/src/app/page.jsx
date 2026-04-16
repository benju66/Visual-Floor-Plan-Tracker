"use client";
import React, { useState, useEffect, useRef } from 'react';
import { Settings, FolderEdit, Trash2, Pencil } from 'lucide-react';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import FieldStatusTable from '@/components/FieldStatusTable';
import MilestoneCommandMenu from '@/components/MilestoneCommandMenu';
import SettingsMenu from '@/components/SettingsMenu';
import ProjectManagementMenu from '@/components/ProjectManagementMenu';
import { supabase } from '@/supabaseClient';
import { useProjectData } from '@/hooks/useProjectData';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import TopHeader from '@/components/TopHeader';
import MapSidebar from '@/components/MapSidebar';

function App() {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  const [settings, setSettings] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sitepulse-settings');
      if (saved) return JSON.parse(saved);
    }
    return { enableToasts: true, showHistoryHover: false, defaultViewMode: 'list' };
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sitepulse-settings', JSON.stringify(settings));
    }
  }, [settings]);

  const [viewMode, setViewMode] = useState(settings.defaultViewMode || 'list');

  const [toolMode, setToolMode] = useState('pan');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);

  const [toast, setToast] = useState(null);
  const [selectedUnitId, setSelectedUnitId] = useState(null);
  const [editingUnitId, setEditingUnitId] = useState(null);
  const listRefs = useRef({});

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
  const [confirmModal, setConfirmModal] = useState(null);

  const [colorMode, setColorMode] = useState('system');

  useEffect(() => {
    const saved = localStorage.getItem('sitepulse-color-mode');
    if (saved) setColorMode(saved);
  }, []);
  const [filterMilestone, setFilterMilestone] = useState(null);
  const [milestoneMenu, setMilestoneMenu] = useState(null);
  const [savingUnitId, setSavingUnitId] = useState(null);

  const [pendingPolygonPoints, setPendingPolygonPoints] = useState(null);
  const [unitNamingOpen, setUnitNamingOpen] = useState(false);
  const [newUnitName, setNewUnitName] = useState('');

  const {
    project, setProject,
    sheets, setSheets,
    activeSheetId, setActiveSheetId,
    units, setUnits,
    activeStatuses, setActiveStatuses,
    milestones, setMilestones,
    trackingMode, setTrackingMode,
    temporalFilters, setTemporalFilters
  } = useProjectData();

  const {
    undoStack, setUndoStack,
    redoStack, setRedoStack,
    triggerUndo, triggerRedo
  } = useUndoRedo({
    toolMode,
    setUnits,
    setActiveStatuses,
    onUpdateGeometry: (unitId, points, isUndoRedo) => handleUpdateUnitPolygon(unitId, points, isUndoRedo),
    onUpdateStatus: (unit, log, isUndoRedo) => commitUnitMilestone(unit, log, 'none', isUndoRedo)
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newLevelName, setNewLevelName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    localStorage.setItem('sitepulse-color-mode', colorMode);
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
      const { data, error } = await supabase.from('project_milestones').insert([{
        project_id: project.id,
        name,
        color,
        track
      }]).select();
      
      if (error) throw error;
      setMilestones([...milestones, data[0]]);
    } catch (err) {
      showToast('Failed to add milestone: ' + err.message, 'error');
    }
  };

  const handleUpdateMilestone = async (id, oldName, newName, newColor) => {
    try {
      const { error: updateErr } = await supabase
        .from('project_milestones')
        .update({ name: newName, color: newColor })
        .eq('id', id);
        
      if (updateErr) throw updateErr;

      // The Ripple Effect
      if ((oldName !== newName || newColor) && project) {
        const { data: projectSheets } = await supabase.from('sheets').select('id').eq('project_id', project.id);
        const sheetIds = projectSheets ? projectSheets.map(s => s.id) : [];

        if (sheetIds.length > 0) {
          // Process updates in chunks to prevent 413 Payload Too Large
          const CHUNK_SIZE = 800;
          const { data: projectUnits } = await supabase.from('units').select('id').in('sheet_id', sheetIds);
          const unitIds = projectUnits ? projectUnits.map(u => u.id) : [];
          
          if (unitIds.length > 0) {
            for (let i = 0; i < unitIds.length; i += CHUNK_SIZE) {
              const chunk = unitIds.slice(i, i + CHUNK_SIZE);
              await supabase
                .from('status_logs')
                .update({ milestone: newName, status_color: newColor })
                .eq('milestone', oldName)
                .in('unit_id', chunk);
            }
          }
        }
      }

      setMilestones(milestones.map(m => m.id === id ? { ...m, name: newName, color: newColor } : m));
      // Hot-update the active canvas statuses to reflect ripple immediately
      setActiveStatuses(prev => prev.map(s => s.milestone === oldName ? { ...s, milestone: newName, status_color: newColor } : s));
    } catch (err) {
      showToast('Failed to update milestone: ' + err.message, 'error');
    }
  };

  const handleDeleteMilestone = async (id) => {
    try {
      const { error } = await supabase.from('project_milestones').delete().eq('id', id);
      if (error) throw error;
      setMilestones(milestones.filter(m => m.id !== id));
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

    try {
      const response = await fetch(`http://127.0.0.1:8000/export-pdf/${activeSheetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Export failed on server');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = downloadUrl;
      
      let filename = `${project?.name || 'SitePulse'}_${activeSheet.sheet_name}_Status.pdf`.replace(/\s+/g, '_');
      const disposition = response.headers.get('content-disposition');
      if (disposition && disposition.indexOf('filename=') !== -1) {
          const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
          if (matches != null && matches[1]) { 
              filename = matches[1].replace(/['"]/g, '');
          }
      }
      
      a.download = filename;
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

      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(
        `http://127.0.0.1:8000/upload-floorplan/${sheetId}?page_number=${pdfPageNumber}`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Failed to convert PDF');
      }

      const { image_url } = await response.json();

      await supabase.from('sheets').update({ base_image_url: image_url }).eq('id', sheetId);

      const updatedSheet = { ...newSheet[0], base_image_url: image_url };
      setSheets([...sheets, updatedSheet]);
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
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await fetch(`http://127.0.0.1:8000/attach-original/${activeSheetId}`, {
        method: 'POST',
        body: formData
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to attach');
      }
      
      showToast('Successfully attached original PDF!', 'success');
    } catch (e) {
      showToast('Failed to attach: ' + e.message, 'error');
    }
  };

  const handleRenameSheet = async (sheetId, newName) => {
    try {
      const { error } = await supabase.from('sheets').update({ sheet_name: newName }).eq('id', sheetId);
      if (error) throw error;
      setSheets(sheets.map(s => s.id === sheetId ? { ...s, sheet_name: newName } : s));
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
      setSheets(newSheets);
      
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
    let actionAdded = false;

    if (!isUndoRedo) {
      const oldUnit = units.find(u => u.id === unitId);
      if (oldUnit) {
        setUndoStack(prev => {
          const nextStack = [...prev, {
            actionType: 'UPDATE_GEOMETRY',
            unitId: unitId,
            oldData: oldUnit.polygon_coordinates,
            newData: newPoints
          }];
          return nextStack.length > 50 ? nextStack.slice(nextStack.length - 50) : nextStack;
        });
        setRedoStack([]);
        actionAdded = true;
      }
    }

    const previousUnits = [...units];
    setUnits((prev) => prev.map((u) => u.id === unitId ? { ...u, polygon_coordinates: newPoints } : u));
    
    try {
      const { error } = await supabase.from('units').update({ polygon_coordinates: newPoints }).eq('id', unitId);
      if (error) throw error;
    } catch (err) {
      setUnits(previousUnits);
      if (actionAdded) {
        setUndoStack(prev => prev.slice(0, -1)); 
      }
      showToast('Error updating location geometry: ' + err.message, 'error');
    }
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
    const tempId = `temp-${Date.now()}`;
    
    try {
      const newUnit = {
         id: tempId,
         sheet_id: activeSheetId,
         unit_number: stampedName,
         polygon_coordinates: newPoints
      };
      setUnits(prev => [...prev, newUnit]);

      const { data, error } = await supabase
        .from('units')
        .insert([{
          sheet_id: activeSheetId,
          unit_number: stampedName,
          polygon_coordinates: newPoints,
        }])
        .select();

      if (error) throw error;
      if (data) {
        setUnits(prev => prev.map(u => u.id === tempId ? data[0] : u));
        setUndoStack(prev => {
          const next = [...prev, { actionType: 'CREATE_UNIT', unitData: data[0] }];
          return next.length > 50 ? next.slice(next.length - 50) : next;
        });
        setRedoStack([]);
      }
    } catch (err) {
      setUnits(prev => prev.filter(u => u.id !== tempId));
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
         const { error } = await supabase.from('units').update({ unit_number: name }).eq('id', editingUnitId);
         if (error) throw error;
         setUnits(prev => prev.map(u => u.id === editingUnitId ? { ...u, unit_number: name } : u));
         setUnitNamingOpen(false);
         setEditingUnitId(null);
         setNewUnitName('');
         showToast('Location renamed.', 'success');
      } else {
         const { data, error } = await supabase
           .from('units')
           .insert([
             {
               sheet_id: activeSheetId,
               unit_number: name,
               polygon_coordinates: pendingPolygonPoints,
             },
           ])
           .select();

         if (error) throw error;
         if (data) {
           setUnits([...units, data[0]]);
           setUndoStack(prev => {
             const next = [...prev, { actionType: 'CREATE_UNIT', unitData: data[0] }];
             return next.length > 50 ? next.slice(next.length - 50) : next;
           });
           setRedoStack([]);
         }
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
          const { error } = await supabase.from('units').delete().eq('id', unitId);
          if (error) throw error;
          
          setUndoStack(prev => {
            const next = [...prev, {
              actionType: 'DELETE_UNIT',
              unitData: unitToDelete,
              statusData: statusToDelete
            }];
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
          setRedoStack([]);

          setUnits((prev) => prev.filter((u) => u.id !== unitId));
          setActiveStatuses((prev) => prev.filter((s) => s.unit_id !== unitId));
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
    // Optionally: undo/redo support could be added here in the future
    const previousUnits = [...units];
    // Optimistic UI update
    setUnits((prev) => prev.map((u) => 
      u.id === unitId ? { ...u, icon_offset_x: offsetX, icon_offset_y: offsetY } : u
    ));

    try {
      const { error } = await supabase
        .from('units')
        .update({ icon_offset_x: offsetX, icon_offset_y: offsetY })
        .eq('id', unitId);
      if (error) throw error;
    } catch (err) {
      setUnits(previousUnits);
      showToast('Failed to save icon offset: ' + err.message, 'error');
    }
  };

  const handleStatusUpdate = (newStatusLog) => {
    setActiveStatuses((prev) => [
      ...prev.filter((s) => !(s.unit_id === newStatusLog.unit_id && s.track === newStatusLog.track)),
      newStatusLog,
    ]);
  };

  const commitUnitMilestone = async (unit, milestone, currentTemporalState = 'none', isUndoRedo = false) => {
    setSavingUnitId(unit.id);
    
    // Check if we are clearing the assignment
    if (milestone.isClearAction) {
      try {
        const oldLog = activeStatuses.find(s => s.unit_id === unit.id && s.track === trackingMode) || null;
        if (!oldLog) return; // Nothing to clear
        
        const { error } = await supabase
          .from('status_logs')
          .delete()
          .eq('unit_id', unit.id)
          .eq('milestone', oldLog.milestone);
          
        if (error) throw error;
        setActiveStatuses(prev => prev.filter(s => !(s.unit_id === unit.id && s.track === trackingMode)));
        
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

    // Capture old status for undo (specific to the same track)
    const oldStatus = activeStatuses.find(s => s.unit_id === unit.id && s.track === milestone.track) || null;
    
    try {
      const status_color = milestone.color || milestone.status_color;
      const { data, error } = await supabase
        .from('status_logs')
        .insert([
          {
            unit_id: unit.id,
            milestone: milestone.name || milestone.milestone,
            status_color,
            temporal_state: currentTemporalState,
          },
        ])
        .select();

      if (error) throw error;
      
      if (data) {
        const newLog = { ...data[0], track: milestone.track };
        handleStatusUpdate(newLog);
        
        if (!isUndoRedo) {
          setUndoStack(prev => {
            const next = [...prev, {
              actionType: 'UPDATE_STATUS',
              unitId: unit.id,
              oldLog: oldStatus,
              newLog: newLog, 
            }];
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
          setRedoStack([]);
        }
      }
    } catch (err) {
      console.error(err);
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
            <div className="flex-[3] lg:flex-[4] flex flex-col min-h-0 min-w-0 h-full">
              {activeSheet && activeSheet.base_image_url ? (
                <FloorplanCanvas
                  ref={floorplanRef}
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
                />
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
                <div
                  className="absolute top-6 right-6 z-[60] w-64 rounded-2xl border p-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200 backdrop-blur-md"
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
                >
                  <h2 className="text-sm font-bold mb-1.5 text-slate-900 dark:text-white">{editingUnitId ? 'Rename location' : 'Name this location'}</h2>
                  <input
                    type="text"
                    autoFocus
                    className="w-full text-sm border border-slate-300/80 dark:border-white/15 rounded-xl px-2.5 py-1.5 mb-3 bg-white/70 dark:bg-black/25 outline-none focus:ring-2 focus:ring-blue-500/50"
                    placeholder="e.g. 1204"
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveNewUnitFromPopover();
                      if (e.key === 'Escape') cancelUnitNaming();
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelUnitNaming}
                      className="px-3 py-1.5 rounded-xl border border-slate-300/80 dark:border-white/15 font-medium text-xs hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveNewUnitFromPopover()}
                      className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 font-bold text-white text-xs shadow-sm transition-colors"
                    >
                      Save location
                    </button>
                  </div>
                </div>
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="p-6 rounded-2xl shadow-2xl w-full max-w-md border glass-panel">
            <h2 className="text-xl font-bold mb-4 text-slate-900 dark:text-white">Add New Level</h2>
            <form onSubmit={handleAddLevel}>
              <div className="mb-4">
                <label className="block text-sm font-bold mb-2 text-slate-700 dark:text-slate-300">Level/Sheet Name</label>
                <input
                  type="text"
                  className="w-full border border-slate-300/80 dark:border-white/15 p-2 rounded-lg bg-white/60 dark:bg-black/25"
                  placeholder="e.g., Level 3"
                  value={newLevelName}
                  onChange={(e) => setNewLevelName(e.target.value)}
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-bold mb-2 text-slate-700 dark:text-slate-300">PDF Page Number</label>
                <input
                  type="number"
                  min="1"
                  className="w-full border border-slate-300/80 dark:border-white/15 p-2 rounded-lg bg-white/60 dark:bg-black/25"
                  value={pdfPageNumber}
                  onChange={(e) => setPdfPageNumber(e.target.value)}
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Which page contains this specific floor plan?</p>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-bold mb-2 text-slate-700 dark:text-slate-300">Floor Plan PDF</label>
                <input
                  type="file"
                  accept=".pdf"
                  className="w-full border border-slate-300/80 dark:border-white/15 p-2 rounded-lg text-sm bg-white/60 dark:bg-black/25"
                  onChange={(e) => setSelectedFile(e.target.files[0])}
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="px-4 py-2 rounded-lg bg-slate-800 dark:bg-white text-white dark:text-slate-900 font-bold disabled:opacity-60"
                >
                  {isUploading ? 'Processing...' : 'Upload & Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md flex items-center justify-center z-[60] p-4">
          <div className="rounded-2xl shadow-2xl border max-w-md w-full p-6 glass-panel">
            <p className="text-slate-800 dark:text-slate-100 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-lg border border-slate-300/80 dark:border-white/15 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmModal.onConfirm()}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

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


