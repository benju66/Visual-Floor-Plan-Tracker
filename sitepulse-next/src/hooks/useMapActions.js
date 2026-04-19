import { useQueryClient } from '@tanstack/react-query';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import {
  useCreateUnit, useUpdateUnitGeometry, useUpdateUnitFields,
  useDeleteUnit, useUpdateStatus, useClearStatus, useUpdateMilestone, useBulkUpdateStatus
} from '@/hooks/useProjectQueries';

export function useMapActions(project) {
  const queryClient = useQueryClient();

  const activeSheetId = useMapStore(s => s.activeSheetId);
  const trackingMode = useMapStore(s => s.trackingMode);
  const toolMode = useMapStore(s => s.toolMode);
  
  const setSavingUnitId = useMapStore(s => s.setSavingUnitId);
  const savingUnitId = useMapStore(s => s.savingUnitId);
  const editingUnitId = useMapStore(s => s.editingUnitId);
  const setEditingUnitId = useMapStore(s => s.setEditingUnitId);
  const pendingPolygonPoints = useMapStore(s => s.pendingPolygonPoints);
  const setPendingPolygonPoints = useMapStore(s => s.setPendingPolygonPoints);
  const quickStatusUnitId = useMapStore(s => s.quickStatusUnitId);
  const setQuickStatusUnitId = useMapStore(s => s.setQuickStatusUnitId);
  const quickMilestoneUnitId = useMapStore(s => s.quickMilestoneUnitId);
  const setQuickMilestoneUnitId = useMapStore(s => s.setQuickMilestoneUnitId);

  const newUnitName = useUIStore(s => s.newUnitName);
  const setNewUnitName = useUIStore(s => s.setNewUnitName);
  const setUnitNamingOpen = useUIStore(s => s.setUnitNamingOpen);
  const unitNamingOpen = useUIStore(s => s.unitNamingOpen);
  const setConfirmModal = useUIStore(s => s.setConfirmModal);
  const confirmModal = useUIStore(s => s.confirmModal);
  const setToast = useUIStore(s => s.setToast);
  const toast = useUIStore(s => s.toast);

  const settings = useSettingsStore(s => s.settings) || {};

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
  const bulkUpdateStatusMutation = useBulkUpdateStatus(activeSheetId);

  const {
    undoStack, setUndoStack,
    redoStack, setRedoStack,
    triggerUndo, triggerRedo
  } = useUndoRedo({ toolMode, sheetId: activeSheetId });

  const handlePolygonComplete = (points) => {
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
      
      const autoAdvanceEnabled = settings.auto_advance_enabled !== false;
      let nextLog = null;
      if (currentTemporalState === 'completed' && autoAdvanceEnabled && !isUndoRedo) {
        const trackMilestones = milestones.filter(m => m.track === milestone.track).sort((a,b) => a.sequence_order - b.sequence_order);
        const currentIndex = trackMilestones.findIndex(m => m.name === newLogData.milestone);
        if (currentIndex !== -1 && currentIndex < trackMilestones.length - 1) {
          const nextMilestone = trackMilestones[currentIndex + 1];
          const nextLogData = {
            unit_id: unit.id,
            milestone: nextMilestone.name,
            status_color: nextMilestone.color,
            temporal_state: 'planned',
            track: nextMilestone.track
          };
          nextLog = await updateStatusMutation.mutateAsync(nextLogData);
        }
      }

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

  const handleApplyBulkStatus = async ({ unitIds, milestone, color, temporal_state, track }, isUndoRedo = false) => {
    const activeStatuses = queryClient.getQueryData(['statuses', activeSheetId]) || [];
    
    // Save old state for undo
    const oldLogs = activeStatuses.filter(s => unitIds.includes(s.unit_id) && s.track === track);

    try {
      await bulkUpdateStatusMutation.mutateAsync({ unitIds, milestone, color, temporal_state, track });
      
      const autoAdvanceEnabled = settings.auto_advance_enabled !== false;
      let usedTemporalState = temporal_state;
      let usedMilestone = milestone;
      let usedColor = color;

      if (temporal_state === 'completed' && autoAdvanceEnabled && milestone !== '__KEEP_EXISTING__' && milestone !== null && !isUndoRedo) {
        const milestones = queryClient.getQueryData(['milestones', project?.id]) || [];
        const trackMilestones = milestones.filter(m => m.track === track).sort((a,b) => a.sequence_order - b.sequence_order);
        const currentIndex = trackMilestones.findIndex(m => m.name === milestone);
        
        if (currentIndex !== -1 && currentIndex < trackMilestones.length - 1) {
          const nextMilestone = trackMilestones[currentIndex + 1];
          usedMilestone = nextMilestone.name;
          usedColor = nextMilestone.color;
          usedTemporalState = 'planned';
          
          await bulkUpdateStatusMutation.mutateAsync({
             unitIds,
             milestone: usedMilestone,
             color: usedColor,
             temporal_state: usedTemporalState,
             track
          });
        }
      }

      let newLogs = [];
      if (usedMilestone === '__KEEP_EXISTING__') {
        if (usedTemporalState !== '__KEEP_EXISTING__') {
          newLogs = oldLogs.map(s => ({ ...s, temporal_state: usedTemporalState }));
        } else {
          newLogs = oldLogs;
        }
      } else if (usedMilestone !== null && usedTemporalState !== 'none' && usedTemporalState !== '__KEEP_EXISTING__') {
        newLogs = unitIds.map(id => ({ unit_id: id, milestone: usedMilestone, status_color: usedColor, temporal_state: usedTemporalState, track }));
      }
      
      if (!isUndoRedo) {
        setUndoStack(prev => {
          const next = [...prev, { actionType: 'BULK_UPDATE_STATUS', unitIds, track, oldLogs, newLogs }];
          return next.length > 50 ? next.slice(next.length - 50) : next;
        });
        setRedoStack([]);
      }
      showToast(`${unitIds.length} locations updated.`, 'success');
    } catch (err) {
      showToast('Error applying bulk status: ' + err.message, 'error');
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
    handleApplyBulkStatus,
    isPendingBulk: bulkUpdateStatusMutation.isPending,
    updateMilestoneMutation
  };
}
