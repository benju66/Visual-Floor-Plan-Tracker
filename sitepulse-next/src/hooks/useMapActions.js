import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import {
  useCreateUnit, useUpdateUnitGeometry, useUpdateUnitFields,
  useDeleteUnit, useUpdateStatus, useClearStatus, useUpdateMilestone
} from '@/hooks/useProjectQueries';

export function useMapActions(project) {
  const queryClient = useQueryClient();

  const activeSheetId = useAppStore(s => s.activeSheetId);
  const trackingMode = useAppStore(s => s.trackingMode);
  const toolMode = useAppStore(s => s.toolMode);
  
  const setSavingUnitId = useAppStore(s => s.setSavingUnitId);
  const savingUnitId = useAppStore(s => s.savingUnitId);
  const editingUnitId = useAppStore(s => s.editingUnitId);
  const setEditingUnitId = useAppStore(s => s.setEditingUnitId);
  const newUnitName = useAppStore(s => s.newUnitName);
  const setNewUnitName = useAppStore(s => s.setNewUnitName);
  const setUnitNamingOpen = useAppStore(s => s.setUnitNamingOpen);
  const unitNamingOpen = useAppStore(s => s.unitNamingOpen);
  const pendingPolygonPoints = useAppStore(s => s.pendingPolygonPoints);
  const setPendingPolygonPoints = useAppStore(s => s.setPendingPolygonPoints);
  const setConfirmModal = useAppStore(s => s.setConfirmModal);
  const confirmModal = useAppStore(s => s.confirmModal);
  const quickStatusUnitId = useAppStore(s => s.quickStatusUnitId);
  const setQuickStatusUnitId = useAppStore(s => s.setQuickStatusUnitId);
  const quickMilestoneUnitId = useAppStore(s => s.quickMilestoneUnitId);
  const setQuickMilestoneUnitId = useAppStore(s => s.setQuickMilestoneUnitId);
  const setToast = useAppStore(s => s.setToast);
  const toast = useAppStore(s => s.toast);
  const settings = useAppStore(s => s.settings) || {};

  const showToast = (message, type) => {
    if (!settings.enableToasts) return;
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const createUnitMutation = useCreateUnit(activeSheetId);
  const updateUnitGeometryMutation = useUpdateUnitGeometry(activeSheetId);
  const updateUnitFieldsMutation = useUpdateUnitFields(activeSheetId);
  const deleteUnitMutation = useDeleteUnit(activeSheetId);
  const updateStatusMutation = useUpdateStatus(activeSheetId);
  const clearStatusMutation = useClearStatus(activeSheetId);
  const updateMilestoneMutation = useUpdateMilestone(project?.id, activeSheetId);

  const {
    undoStack, setUndoStack,
    redoStack, setRedoStack,
    triggerUndo, triggerRedo
  } = useUndoRedo({ toolMode, sheetId: activeSheetId });

  const handlePolygonComplete = (points) => {
    useAppStore.getState().setToolMode('pan');
    setPendingPolygonPoints(points);
    setNewUnitName('');
    setUnitNamingOpen(true);
  };

  const handleUpdateUnitPolygon = async (unitId, newPoints, isUndoRedo = false) => {
    const units = queryClient.getQueryData(['units', activeSheetId]) || [];
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
    const units = queryClient.getQueryData(['units', activeSheetId]) || [];
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
    const units = queryClient.getQueryData(['units', activeSheetId]) || [];
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
     const units = queryClient.getQueryData(['units', activeSheetId]) || [];
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
        const units = queryClient.getQueryData(['units', activeSheetId]) || [];
        const activeStatuses = queryClient.getQueryData(['statuses', activeSheetId]) || [];
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

  const commitUnitMilestone = async (unit, milestone, currentTemporalState = 'none', isUndoRedo = false) => {
    setSavingUnitId(unit.id);
    const activeStatuses = queryClient.getQueryData(['statuses', activeSheetId]) || [];
    const milestones = queryClient.getQueryData(['milestones', project?.id]) || [];
    
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

  const handleQuickUpdate = (unitId, type, value) => {
    const units = queryClient.getQueryData(['units', activeSheetId]) || [];
    const activeStatuses = queryClient.getQueryData(['statuses', activeSheetId]) || [];
    const milestones = queryClient.getQueryData(['milestones', project?.id]) || [];
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

  return {
    undoStack, triggerUndo, triggerRedo, redoStack,
    unitNamingOpen, setUnitNamingOpen,
    newUnitName, setNewUnitName,
    editingUnitId, savingUnitId,
    confirmModal, setConfirmModal,
    quickStatusUnitId, setQuickStatusUnitId,
    quickMilestoneUnitId, setQuickMilestoneUnitId,
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
    updateMilestoneMutation
  };
}
