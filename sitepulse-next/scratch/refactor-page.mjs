import fs from 'fs';

let code = fs.readFileSync('c:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next/src/app/page.jsx', 'utf8');

// 1. Imports
code = code.replace(
  "import { useProjectData } from '@/hooks/useProjectData';",
  "import { useAppStore, useHydratedStore } from '@/store/useAppStore';\nimport { useProject, useSheets, useMilestones, useUnits, useStatuses, useCreateUnit, useUpdateUnitGeometry, useUpdateUnitFields, useDeleteUnit, useUpdateStatus, useClearStatus, useUpdateMilestone } from '@/hooks/useProjectQueries';\nimport { useQueryClient } from '@tanstack/react-query';"
);

// 2. State to Zustand
const oldStateBlock = `  const [settings, setSettings] = useState(() => {
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
  const [quickStatusUnitId, setQuickStatusUnitId] = useState(null);
  const [quickMilestoneUnitId, setQuickMilestoneUnitId] = useState(null);

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
    temporalFilters, setTemporalFilters,
    mapSettings, setMapSettings,
    legendPosition, setLegendPosition
  } = useProjectData();`;

const newStateBlock = `  const toolMode = useAppStore(s => s.toolMode);
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
  }, [selectedUnitId]);`;

code = code.replace(oldStateBlock, newStateBlock);

// 3. Undo Redo hook
const oldUndoRedo = `  const {
    undoStack, setUndoStack,
    redoStack, setRedoStack,
    triggerUndo, triggerRedo
  } = useUndoRedo({
    toolMode,
    setUnits,
    setActiveStatuses,
    onUpdateGeometry: (unitId, points, isUndoRedo) => handleUpdateUnitPolygon(unitId, points, isUndoRedo),
    onUpdateStatus: (unit, log, isUndoRedo) => commitUnitMilestone(unit, log, 'none', isUndoRedo)
  });`;
const newUndoRedo = `  const {
    undoStack, setUndoStack,
    redoStack, setRedoStack,
    triggerUndo, triggerRedo
  } = useUndoRedo({
    toolMode,
    sheetId: activeSheetId,
    unitIdsLength: units.length,
  });`;
code = code.replace(oldUndoRedo, newUndoRedo);

// 4. ColorMode effect
const oldColorModeEffect = `  useEffect(() => {
    localStorage.setItem('sitepulse-color-mode', colorMode);
    const root = document.documentElement;
    if (colorMode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', colorMode);
  }, [colorMode]);`;
const newColorModeEffect = `  useEffect(() => {
    const root = document.documentElement;
    if (colorMode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', colorMode);
  }, [colorMode]);`;
code = code.replace(oldColorModeEffect, newColorModeEffect);

// 5. Milestones Mutations
// replace entire handleAddMilestone, handleUpdateMilestone, handleDeleteMilestone
const oldMilestoneFunctions = `  const handleAddMilestone = async (name, color, track) => {
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
  };`;

const newMilestoneFunctions = `  const handleAddMilestone = async (name, color, track) => {
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
  };`;
code = code.replace(oldMilestoneFunctions, newMilestoneFunctions);

// Replace sheets queries invalidations
code = code.replace(/setSheets\(\[\.\.\.sheets, updatedSheet\]\);/g, "queryClient.invalidateQueries({ queryKey: ['sheets'] });");
code = code.replace(/setSheets\(sheets.map\(s => s.id === sheetId \? { \.\.\.s, sheet_name: newName } : s\)\);/g, "queryClient.invalidateQueries({ queryKey: ['sheets'] });");
code = code.replace(/setSheets\(newSheets\);/g, "queryClient.invalidateQueries({ queryKey: ['sheets'] });");


// Replacing Units mutations
const oldUpdatePolygon = `  const handleUpdateUnitPolygon = async (unitId, newPoints, isUndoRedo = false) => {
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
  };`;
  
const newUpdatePolygon = `  const handleUpdateUnitPolygon = async (unitId, newPoints, isUndoRedo = false) => {
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
  };`;
code = code.replace(oldUpdatePolygon, newUpdatePolygon);

const oldInstantStamp = `  const handleInstantStamp = async (sourceUnitId, newPoints) => {
    const sourceUnit = units.find(u => u.id === sourceUnitId);
    if (!sourceUnit) return;
    
    const baseNameMatch = sourceUnit.unit_number.match(/^(.*?)(?:\\s*\\(Stamp\\s*(\\d+)\\))?$/);
    const baseName = baseNameMatch ? baseNameMatch[1].trim() : sourceUnit.unit_number;
    
    let nextIndex = 1;
    units.forEach(u => {
      if (u.unit_number.startsWith(\`\${baseName} (Stamp\`)) {
        const match = u.unit_number.match(/\\(Stamp\\s*(\\d+)\\)$/);
        if (match) {
          const idx = parseInt(match[1]);
          if (idx >= nextIndex) nextIndex = idx + 1;
        }
      }
    });
    
    const stampedName = \`\${baseName} (Stamp \${nextIndex})\`;
    const tempId = \`temp-\${Date.now()}\`;
    
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
  };`;
const newInstantStamp = `  const handleInstantStamp = async (sourceUnitId, newPoints) => {
    const sourceUnit = units.find(u => u.id === sourceUnitId);
    if (!sourceUnit) return;
    
    const baseNameMatch = sourceUnit.unit_number.match(/^(.*?)(?:\\s*\\(Stamp\\s*(\\d+)\\))?$/);
    const baseName = baseNameMatch ? baseNameMatch[1].trim() : sourceUnit.unit_number;
    
    let nextIndex = 1;
    units.forEach(u => {
      if (u.unit_number.startsWith(\`\${baseName} (Stamp\`)) {
        const match = u.unit_number.match(/\\(Stamp\\s*(\\d+)\\)$/);
        if (match) {
          const idx = parseInt(match[1]);
          if (idx >= nextIndex) nextIndex = idx + 1;
        }
      }
    });
    
    const stampedName = \`\${baseName} (Stamp \${nextIndex})\`;
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
  };`;
code = code.replace(oldInstantStamp, newInstantStamp);

const oldSaveNewUnit = `  const saveNewUnitFromPopover = async () => {
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
  };`;
const newSaveNewUnit = `  const saveNewUnitFromPopover = async () => {
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
  };`;
code = code.replace(oldSaveNewUnit, newSaveNewUnit);

const oldDeleteUnit = `  const handleDeleteUnit = (unitId) => {
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
  };`;
const newDeleteUnit = `  const handleDeleteUnit = (unitId) => {
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
  };`;
code = code.replace(oldDeleteUnit, newDeleteUnit);


const oldIconOffset = `  const handleUpdateUnitIconOffset = async (unitId, offsetX, offsetY) => {
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
  };`;
const newIconOffset = `  const handleUpdateUnitIconOffset = async (unitId, offsetX, offsetY) => {
    try {
      await updateUnitFieldsMutation.mutateAsync({ unitId, updates: { icon_offset_x: offsetX, icon_offset_y: offsetY } });
    } catch (err) {
      showToast('Failed to save icon offset: ' + err.message, 'error');
    }
  };`;
code = code.replace(oldIconOffset, newIconOffset);

const oldStatusUpdates = `  const handleStatusUpdate = (newStatusLog) => {
    setActiveStatuses((prev) => [
      ...prev.filter((s) => !(s.unit_id === newStatusLog.unit_id && s.track === newStatusLog.track)),
      newStatusLog,
    ]);
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
  };`;
const newStatusUpdates = `  const handleQuickUpdate = (unitId, type, value) => {
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
  };`;
code = code.replace(oldStatusUpdates, newStatusUpdates);

fs.writeFileSync('c:/Users/BUrness/Dev/Visual-Floor-Plan-Tracker/sitepulse-next/src/app/page.jsx', code);
console.log('Script executed successfully');
