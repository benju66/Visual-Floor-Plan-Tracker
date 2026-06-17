import { useQueryClient } from '@tanstack/react-query';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import {
  useCreateUnit, useUpdateUnitGeometry, useUpdateUnitFields,
  useDeleteUnit, useUpdateStatus, useClearStatus, useUpdateMilestone, useBulkUpdateStatus
} from '@/hooks/useProjectQueries';
import type { Project, Unit, PercentPoint, StatusLog, Milestone, TemporalState, Sheet, MilestoneOverride } from '@/types/domain';
import { queryKeys } from '@/types/queryKeys';
import { buildApplicabilityIndex, hasSequenceGaps, nextApplicableIndex } from '@/utils/applicability';
import { useProposePendingSubtype } from '@/hooks/useSubtypes';
import { taxonomyResultToUnitFields, type TaxonomyResult, type TaxonomyUnitFields } from '@/utils/subtypes';

export function useMapActions(project: Project | null | undefined) {
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
  const clearSelectedUnits = useMapStore(s => s.clearSelectedUnits);

  const newUnitName = useUIStore(s => s.newUnitName);
  const setNewUnitName = useUIStore(s => s.setNewUnitName);
  const setUnitNamingOpen = useUIStore(s => s.setUnitNamingOpen);
  const unitNamingOpen = useUIStore(s => s.unitNamingOpen);
  const setConfirmModal = useUIStore(s => s.setConfirmModal);
  const confirmModal = useUIStore(s => s.confirmModal);
  const setToast = useUIStore(s => s.setToast);
  const toast = useUIStore(s => s.toast);

  const settings = useSettingsStore(s => s.settings) || {};

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning') => {
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
  const updateMilestoneMutation = useUpdateMilestone(project?.id as string, activeSheetId);
  const bulkUpdateStatusMutation = useBulkUpdateStatus(activeSheetId);
  const proposePendingMutation = useProposePendingSubtype();
  // Resolve a taxonomy pick into the unit's role/sub-type/unit_type columns,
  // creating an "Other (pending)" dictionary row if needed (online-first).
  const resolveTaxonomy = (pick: TaxonomyResult): Promise<TaxonomyUnitFields> =>
    taxonomyResultToUnitFields(pick, (vars) => proposePendingMutation.mutateAsync(vars));

  const {
    undoStack, setUndoStack,
    redoStack, setRedoStack,
    triggerUndo, triggerRedo
  } = useUndoRedo({ toolMode, sheetId: activeSheetId });

  const handlePolygonComplete = (points: PercentPoint[]) => {
    setPendingPolygonPoints(points);
    setNewUnitName('');
    setUnitNamingOpen(true);
  };

  const handleUpdateUnitPolygon = async (unitId: string, newPoints: PercentPoint[], isUndoRedo = false) => {
    const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
    if (!isUndoRedo) {
      const oldUnit = units.find(u => u.id === unitId);
      if (oldUnit) {
        setUndoStack(prev => {
          const nextStack = [...prev, { actionType: 'UPDATE_GEOMETRY' as const, unitId: unitId, oldData: oldUnit.polygon_coordinates, newData: newPoints }];
          return nextStack.length > 50 ? nextStack.slice(nextStack.length - 50) : nextStack;
        });
        setRedoStack([]);
      }
    }
    await updateUnitGeometryMutation.mutateAsync({ unitId, polygon_coordinates: newPoints }).catch((err: any) => {
      if (!isUndoRedo) setUndoStack(prev => prev.slice(0, -1)); 
      showToast('Error updating location geometry: ' + err.message, 'error');
    });
  };

  const handleDuplicateUnit = async (unitId: string) => {
    const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
    const sourceUnit = units.find(u => u.id === unitId);
    if (!sourceUnit) return;
    
    const newPoints = (sourceUnit.polygon_coordinates as PercentPoint[]).map(p => ({
      pctX: p.pctX + 0.02,
      pctY: p.pctY + 0.02
    }));
    
    setPendingPolygonPoints(newPoints);
    setNewUnitName(`${sourceUnit.unit_number} (Copy)`);
    setUnitNamingOpen(true);
  };

  const handleInstantStamp = async (sourceUnitId: string, newPoints: PercentPoint[]) => {
    const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
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
      const data = await createUnitMutation.mutateAsync({ sheet_id: activeSheetId, unit_number: stampedName, polygon_coordinates: newPoints as any });
      setUndoStack(prev => {
        const next = [...prev, { actionType: 'CREATE_UNIT' as const, unitData: data as any }];
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });
      setRedoStack([]);
    } catch (err: any) {
      showToast('Error stamping location: ' + err.message, 'error');
    }
  };

  const handleRenameUnitInitiate = (unitId: string) => {
     const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
     const unit = units.find(u => u.id === unitId);
     if (!unit) return;
     setEditingUnitId(unitId);
     setNewUnitName(unit.unit_number);
     setUnitNamingOpen(true);
  };

  const saveNewUnitFromPopover = async (pick: TaxonomyResult | null = null) => {
    const name = newUnitName.trim();
    if (!name) return;
    if (!editingUnitId && !pendingPolygonPoints) return;

    try {
      // `pick === null` means "leave the type unchanged": on rename it preserves
      // the location's existing role/sub-type; on create it saves no type. A pick
      // resolves to role + subtype_id (+ unit_type, kept for applicability back-compat).
      const taxonomy = pick ? await resolveTaxonomy(pick) : null;

      if (editingUnitId) {
         const updates: Partial<Unit> = { unit_number: name };
         if (taxonomy) Object.assign(updates, taxonomy);
         await updateUnitFieldsMutation.mutateAsync({ unitId: editingUnitId, updates });
         setUnitNamingOpen(false);
         setEditingUnitId(null);
         setNewUnitName('');
         showToast('Location renamed.', 'success');
      } else {
         let finalComputedArea: number | null = null;
         if (pendingPolygonPoints && pendingPolygonPoints.length >= 3) {
           const sheets = queryClient.getQueryData<Sheet[]>(queryKeys.sheets(project?.id as string)) || [];
           const sheet = sheets.find(s => s.id === activeSheetId);
           if (sheet && sheet.base_image_url) {
             const img = new Image();
             img.src = sheet.base_image_url;
             await new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve; // proceed even if err
             });
             if (img.naturalWidth && img.naturalHeight) {
                 let area = 0;
                 for (let i = 0; i < pendingPolygonPoints.length; i++) {
                    const j = (i + 1) % pendingPolygonPoints.length;
                    const xA = pendingPolygonPoints[i].pctX * img.naturalWidth;
                    const yA = pendingPolygonPoints[i].pctY * img.naturalHeight;
                    const xB = pendingPolygonPoints[j].pctX * img.naturalWidth;
                    const yB = pendingPolygonPoints[j].pctY * img.naturalHeight;
                    area += xA * yB - xB * yA;
                 }
                 area = Math.abs(area) / 2;
                 if (sheet.scale_ratio) {
                    finalComputedArea = area * sheet.scale_ratio;
                 }
             }
           }
         }

         const data = await createUnitMutation.mutateAsync({
             sheet_id: activeSheetId,
             unit_number: name,
             polygon_coordinates: pendingPolygonPoints as any,
             unit_type: taxonomy?.unit_type ?? null,
             top_level_role: taxonomy?.top_level_role ?? null,
             subtype_id: taxonomy?.subtype_id ?? null,
             computed_area: finalComputedArea
         });
         setUndoStack(prev => {
             const next = [...prev, { actionType: 'CREATE_UNIT' as const, unitData: data as any }];
             return next.length > 50 ? next.slice(next.length - 50) : next;
         });
         setRedoStack([]);
         setUnitNamingOpen(false);
         setPendingPolygonPoints(null);
         setNewUnitName('');
         showToast('Location saved.', 'success');
      }
    } catch (err: any) {
      showToast('Error saving location: ' + err.message, 'error');
    }
  };

  const cancelUnitNaming = () => {
    setUnitNamingOpen(false);
    setPendingPolygonPoints(null);
    setEditingUnitId(null);
    setNewUnitName('');
  };

  const handleDeleteUnit = (unitId: string) => {
    setConfirmModal({
      message: 'Are you sure you want to delete this location markup?',
      onConfirm: async () => {
        const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
        const activeStatuses = queryClient.getQueryData<StatusLog[]>(['statuses', activeSheetId]) || [];
        const unitToDelete = units.find(u => u.id === unitId);
        const statusesToDelete = activeStatuses.filter(s => s.unit_id === unitId);

        try {
          await deleteUnitMutation.mutateAsync(unitId);
          setUndoStack(prev => {
            const next = [...prev, { actionType: 'DELETE_UNIT' as const, unitData: unitToDelete, statusLogs: statusesToDelete }];
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
          setRedoStack([]);
          showToast('Location deleted successfully.', 'success');
        } catch (err: any) {
          showToast('Error deleting location: ' + err.message, 'error');
        } finally {
          setConfirmModal(null);
        }
      },
    });
  };

  const handleDeleteUnits = (unitIds: string[]) => {
    if (!unitIds || unitIds.length === 0) return;
    if (unitIds.length === 1) {
      handleDeleteUnit(unitIds[0]);
      return;
    }
    setConfirmModal({
      message: `Delete ${unitIds.length} selected locations? This removes their markups and recorded status.`,
      onConfirm: async () => {
        const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
        const activeStatuses = queryClient.getQueryData<StatusLog[]>(['statuses', activeSheetId]) || [];
        const deleted: { unitData?: Unit; statusLogs?: StatusLog[] }[] = [];
        let failed = 0;

        for (const unitId of unitIds) {
          const unitToDelete = units.find(u => u.id === unitId);
          const statusesToDelete = activeStatuses.filter(s => s.unit_id === unitId);
          try {
            await deleteUnitMutation.mutateAsync(unitId);
            deleted.push({ unitData: unitToDelete, statusLogs: statusesToDelete });
          } catch {
            failed++;
          }
        }

        if (deleted.length > 0) {
          setUndoStack(prev => {
            const next = [
              ...prev,
              ...deleted.map(d => ({ actionType: 'DELETE_UNIT' as const, unitData: d.unitData, statusLogs: d.statusLogs })),
            ];
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
          setRedoStack([]);
        }

        clearSelectedUnits();

        if (failed === 0) {
          showToast(`${deleted.length} locations deleted.`, 'success');
        } else {
          showToast(`Deleted ${deleted.length} location(s); ${failed} failed.`, 'error');
        }
        setConfirmModal(null);
      },
    });
  };

  const handleUpdateUnitIconOffset = async (unitId: string, offsetX: number, offsetY: number) => {
    try {
      await updateUnitFieldsMutation.mutateAsync({ unitId, updates: { icon_offset_x: offsetX, icon_offset_y: offsetY } });
    } catch (err: any) {
      showToast('Failed to save icon offset: ' + err.message, 'error');
    }
  };

  const commitUnitMilestone = async (
    unit: Unit, 
    milestone: Partial<Milestone> & { isClearAction?: boolean }, 
    currentTemporalState: TemporalState = 'none', 
    isUndoRedo = false, 
    extraProps: any = {}
  ) => {
    setSavingUnitId(unit.id);
    const activeStatuses = queryClient.getQueryData<StatusLog[]>(['statuses', activeSheetId]) || [];
    const milestones = queryClient.getQueryData<Milestone[]>(queryKeys.milestones(project?.id as string)) || [];
    const sheets = queryClient.getQueryData<Sheet[]>(queryKeys.sheets(project?.id as string)) || [];
    const activeSheet = sheets.find(s => s.id === activeSheetId);
    
    if (milestone.isClearAction) {
      try {
        const oldLog = activeStatuses.find(s => s.unit_id === unit.id && s.track === trackingMode && s.milestone === milestone.name) || activeStatuses.find(s => s.unit_id === unit.id && s.track === trackingMode) || null;
        if (!oldLog) return;
        await clearStatusMutation.mutateAsync({ unitId: unit.id, track: trackingMode, milestone: oldLog.milestone });
        if (!isUndoRedo) {
          setUndoStack(prev => {
            const next = [...prev, { actionType: 'UPDATE_STATUS' as const, unitId: unit.id, oldLog, newLog: null }];
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
          setRedoStack([]);
        }
      } catch (err: any) {
        showToast('Failed to clear status: ' + err.message, 'error');
      } finally {
        setSavingUnitId(null);
      }
      return;
    }

    const milestoneName = milestone.name as string;
    const oldStatus = activeStatuses.find(s => s.unit_id === unit.id && s.track === milestone.track && s.milestone === milestoneName) || null;
    try {
      const status_color = milestone.color || (milestone as any).status_color || '';
      const sheetSchedule = (activeSheet?.milestone_schedules as Record<string, any>)?.[milestoneName] || {};
      
      const newLogData = {
        unit_id: unit.id,
        milestone: milestoneName,
        status_color,
        temporal_state: currentTemporalState,
        track: milestone.track as string,
        planned_start_date: extraProps.startDate || sheetSchedule.start_date || null,
        planned_end_date: extraProps.endDate || sheetSchedule.end_date || null,
        logged_date: extraProps.loggedDate !== undefined ? (extraProps.loggedDate || null) : (currentTemporalState === 'completed' ? new Date().toISOString().split('T')[0] : null),
        // client_timestamp from PendingChange.capturedAt (offline-capture time).
        // For immediate (online) mutations this will be null/undefined; useUpdateStatus stamps it as a fallback.
        client_timestamp: extraProps.client_timestamp || null
      };
      const newLog = await updateStatusMutation.mutateAsync(newLogData);
      
      const autoAdvanceEnabled = settings.auto_advance_tracks?.[milestone.track as string] === true;
      if (currentTemporalState === 'completed' && autoAdvanceEnabled && !isUndoRedo) {
        const overrides = queryClient.getQueryData<MilestoneOverride[]>(queryKeys.milestoneOverrides(project?.id as string)) || [];
        const applicabilityIndex = buildApplicabilityIndex(milestones, overrides);
        const trackMilestones = milestones.filter(m => m.track === milestone.track).sort((a,b) => (a.sequence_order || 0) - (b.sequence_order || 0));
        const currentIndex = trackMilestones.findIndex(m => m.name === newLogData.milestone);

        // Defensive Auto-Advance: Only advance if the backlog track sequence is
        // flawless. Milestones not applicable to this unit are not gaps.
        const hasGaps = currentIndex > 0 && hasSequenceGaps(
          trackMilestones, unit, currentIndex, applicabilityIndex,
          (name) => activeStatuses.find(s => s.unit_id === unit.id && s.milestone === name)
        );

        // Walk PAST inapplicable milestones — never land auto-advance on an N/A slot
        const nextIndex = currentIndex === -1 ? -1 : nextApplicableIndex(trackMilestones, unit, currentIndex, applicabilityIndex);
        if (!hasGaps && nextIndex !== -1) {
          const nextMilestone = trackMilestones[nextIndex];
          const nextMilestoneName = nextMilestone.name;
          const nextSheetSchedule = (activeSheet?.milestone_schedules as Record<string, any>)?.[nextMilestoneName] || {};
          
          const nextLogData = {
            unit_id: unit.id,
            milestone: nextMilestoneName,
            status_color: nextMilestone.color,
            temporal_state: 'planned' as TemporalState,
            track: nextMilestone.track,
            planned_start_date: nextSheetSchedule.start_date || null,
            planned_end_date: nextSheetSchedule.end_date || null
          };
          await updateStatusMutation.mutateAsync(nextLogData);
        }
      }

      if (!isUndoRedo) {
        setUndoStack(prev => {
          const next = [...prev, { actionType: 'UPDATE_STATUS' as const, unitId: unit.id, oldLog: oldStatus, newLog }];
          return next.length > 50 ? next.slice(next.length - 50) : next;
        });
        setRedoStack([]);
      }
    } catch (err: any) {
      showToast('Failed to update status: ' + err.message, 'error');
    } finally {
      setSavingUnitId(null);
    }
  };

  const handleQuickUpdate = (unitId: string, type: 'status' | 'milestone', value: string, extraProps: any = {}) => {
    const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
    const activeStatuses = queryClient.getQueryData<StatusLog[]>(['statuses', activeSheetId]) || [];
    const milestones = queryClient.getQueryData<Milestone[]>(queryKeys.milestones(project?.id as string)) || [];
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;

    const existingStatus = activeStatuses.find(s => s.unit_id === unitId && s.track === trackingMode);

    if (type === 'status') {
      if (value === 'none') {
        const milestone = { 
          isClearAction: true, 
          track: trackingMode,
          name: extraProps.milestoneObj?.name || existingStatus?.milestone 
        };
        commitUnitMilestone(unit, milestone);
        return;
      }
      
      let milestoneObj: Partial<Milestone>;
      if (extraProps.milestoneObj) {
         milestoneObj = extraProps.milestoneObj;
      } else if (existingStatus) {
         milestoneObj = { name: existingStatus.milestone, color: existingStatus.status_color, track: trackingMode };
      } else {
         milestoneObj = milestones.find(m => m.track === trackingMode) || { name: 'Not Started', color: '#64748b', track: trackingMode };
      }
      commitUnitMilestone(unit, milestoneObj, value as TemporalState, false, extraProps);
    } else if (type === 'milestone') {
      const selectedMilestone = milestones.find(m => m.name === value && m.track === trackingMode);
      if (!selectedMilestone) return;

      const temporalState = extraProps.temporal_state ? extraProps.temporal_state : (existingStatus ? existingStatus.temporal_state : 'completed');
      commitUnitMilestone(unit, selectedMilestone, temporalState as TemporalState, false, extraProps);
    }
  };

  const handleApplyBulkStatus = async ({ unitIds, milestone, color, temporal_state, track, planned_start_date, planned_end_date, logged_date, bottlenecks = [] }: any, isUndoRedo = false) => {
    const activeStatuses = queryClient.getQueryData<StatusLog[]>(['statuses', activeSheetId]) || [];
    
    // Save old state for undo
    const oldLogs = activeStatuses.filter(s => unitIds.includes(s.unit_id as string) && s.track === track);

    try {
      await bulkUpdateStatusMutation.mutateAsync({ unitIds, milestone, color, temporal_state, track, planned_start_date, planned_end_date, logged_date, bottlenecks });
      
      const autoAdvanceEnabled = settings.auto_advance_tracks?.[track] === true;

      // Auto-advance: each unit walks to ITS next applicable milestone, so a
      // milestone that is N/A for some units never receives a 'planned' stamp.
      const advancedLogs: any[] = [];
      if (temporal_state === 'completed' && autoAdvanceEnabled && milestone !== '__KEEP_EXISTING__' && milestone !== null && !isUndoRedo) {
        const milestones = queryClient.getQueryData<Milestone[]>(queryKeys.milestones(project?.id as string)) || [];
        const overrides = queryClient.getQueryData<MilestoneOverride[]>(queryKeys.milestoneOverrides(project?.id as string)) || [];
        const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
        const applicabilityIndex = buildApplicabilityIndex(milestones, overrides);
        const trackMilestones = milestones.filter(m => m.track === track).sort((a,b) => (a.sequence_order || 0) - (b.sequence_order || 0));
        const currentIndex = trackMilestones.findIndex(m => m.name === milestone);

        if (currentIndex !== -1) {
          const targetGroups: Record<number, string[]> = {};
          for (const id of unitIds as string[]) {
            const unit = units.find(u => u.id === id);
            if (!unit) continue;
            const nextIndex = nextApplicableIndex(trackMilestones, unit, currentIndex, applicabilityIndex);
            if (nextIndex === -1) continue;
            (targetGroups[nextIndex] ||= []).push(id);
          }

          for (const [idxStr, groupIds] of Object.entries(targetGroups)) {
            const nextMilestone = trackMilestones[Number(idxStr)];
            await bulkUpdateStatusMutation.mutateAsync({
               unitIds: groupIds,
               milestone: nextMilestone.name,
               color: nextMilestone.color,
               temporal_state: 'planned',
               track,
               planned_start_date: null,
               planned_end_date: null
            });
            groupIds.forEach(id => advancedLogs.push({ unit_id: id, milestone: nextMilestone.name, status_color: nextMilestone.color, temporal_state: 'planned', track }));
          }
        }
      }

      let newLogs: any[] = [];
      if (milestone === '__KEEP_EXISTING__') {
        if (temporal_state !== '__KEEP_EXISTING__') {
          newLogs = oldLogs.map(s => ({ ...s, temporal_state }));
        } else {
          newLogs = oldLogs;
        }
      } else if (milestone !== null && temporal_state !== 'none' && temporal_state !== '__KEEP_EXISTING__') {
        // Units that advanced are represented by their new 'planned' slot;
        // the rest keep the milestone/state this bulk action applied.
        const advancedUnitIds = new Set(advancedLogs.map(l => l.unit_id));
        newLogs = [
          ...(unitIds as string[]).filter(id => !advancedUnitIds.has(id)).map(id => ({ unit_id: id, milestone, status_color: color, temporal_state, track })),
          ...advancedLogs
        ];
      }
      
      if (!isUndoRedo) {
        setUndoStack(prev => {
          const next = [...prev, { actionType: 'BULK_UPDATE_STATUS' as const, unitIds, track, oldLogs, newLogs }];
          return next.length > 50 ? next.slice(next.length - 50) : next;
        });
        setRedoStack([]);
      }
      showToast(`${unitIds.length} locations updated.`, 'success');
    } catch (err: any) {
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
    handleDeleteUnits,
    handleUpdateUnitIconOffset,
    commitUnitMilestone,
    handleQuickUpdate,
    handleApplyBulkStatus,
    isPendingBulk: bulkUpdateStatusMutation.isPending,
    updateMilestoneMutation
  };
}
