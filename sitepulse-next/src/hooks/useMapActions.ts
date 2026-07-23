import { useQueryClient } from '@tanstack/react-query';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useUndoRedo, type UndoAction } from '@/hooks/useUndoRedo';
import {
  useCreateUnit, useUpdateUnitGeometry, useUpdateUnitFields,
  useDeleteUnit, useUpdateStatus, useClearStatus, useUpdateActivity, useBulkUpdateStatus
} from '@/hooks/useProjectQueries';
import type { Project, Unit, PercentPoint, StatusLog, Activity, TemporalState, Sheet, ActivityOverride, TopLevelRole } from '@/types/domain';
import type { BulkUpdateStatusVars, CommitStatusExtraProps } from '@/types/mutations';
import { queryKeys } from '@/types/queryKeys';
import { buildApplicabilityIndex } from '@/utils/applicability';
import { planAutoAdvance, type AutoAdvanceTarget } from '@/utils/autoAdvance';
import { resolveActivityId } from '@/utils/resolveActivityId';
import { useProposePendingSubtype, useSubtypes } from '@/hooks/useSubtypes';
import { taxonomyResultToUnitFields, type TaxonomyResult, type TaxonomyUnitFields } from '@/utils/subtypes';
import { useSheetText } from '@/hooks/useSheetText';
import { useNamingVocabulary } from '@/hooks/useNamingVocabulary';
import {
  buildRoomSuggestion,
  suggestionToPick,
  suggestedLabelFromSuggestion,
  deriveSuggestionSource,
  ROOM_TEXT_MODEL_VERSION,
} from '@/utils/roomSuggestion';
import {
  recordTraceEvent,
  labelSnapshotFromUnit,
  ANNOTATION_SPEC_VERSION,
  type TraceSource,
} from '@/utils/traceCapture';
import { isProjectTrainingEnabled } from '@/utils/trainingGate';
import { computeAreaFromUnitsPerPx } from '@/utils/scale';
import { loadImageDimensions } from '@/utils/imageDimensions';
import { normalizeToCentroid } from '@/utils/stampTransform';
import type { StampDef } from '@/utils/stampLibrary';
import { stampBaseName, nextStampName } from '@/utils/stampNaming';

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
  const mapLabelSuggestion = useMapStore(s => s.mapLabelSuggestion);
  const setMapLabelSuggestion = useMapStore(s => s.setMapLabelSuggestion);
  // Stamp & Fast Markup — Phase 3: the type carried by a stamp being named (opt-in flow).
  const pendingStampType = useMapStore(s => s.pendingStampType);
  const setPendingStampType = useMapStore(s => s.setPendingStampType);
  const quickStatusUnitId = useMapStore(s => s.quickStatusUnitId);
  const setQuickStatusUnitId = useMapStore(s => s.setQuickStatusUnitId);
  const quickActivityUnitId = useMapStore(s => s.quickActivityUnitId);
  const setQuickActivityUnitId = useMapStore(s => s.setQuickActivityUnitId);
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
  // Stamp & Fast Markup — Phase 2: collect committed shapes into the drawer's recents.
  const pushRecentStamp = useSettingsStore(s => s.pushRecentStamp);

  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning') => {
    // Errors and warnings always surface — "toasts off" silences routine
    // success/info confirmations, never a failure the user needs to see.
    if (!settings.enableToasts && type !== 'error' && type !== 'warning') return;
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const createUnitMutation = useCreateUnit(activeSheetId);
  const updateUnitGeometryMutation = useUpdateUnitGeometry(activeSheetId);
  const updateUnitFieldsMutation = useUpdateUnitFields(activeSheetId);
  const deleteUnitMutation = useDeleteUnit(activeSheetId);
  const updateStatusMutation = useUpdateStatus(activeSheetId);
  const clearStatusMutation = useClearStatus(activeSheetId);
  const updateActivityMutation = useUpdateActivity(project?.id as string, activeSheetId);
  const bulkUpdateStatusMutation = useBulkUpdateStatus(activeSheetId);
  const proposePendingMutation = useProposePendingSubtype();
  // Resolve a taxonomy pick into the unit's role/sub-type/unit_type columns,
  // creating an "Other (pending)" dictionary row if needed (online-first).
  const resolveTaxonomy = (pick: TaxonomyResult): Promise<TaxonomyUnitFields> =>
    taxonomyResultToUnitFields(pick, (vars) => proposePendingMutation.mutateAsync(vars));

  // ── Room-name auto-fill on the project map (AI Tracing Assist — Phase 4) ──
  // The SAME naming "brain" the workbench uses, now wired onto the live draw flow.
  // All three reads are best-effort and degrade silently (no session / offline / a
  // scanned sheet) to "no suggestion", exactly like the workbench — they can never
  // block or break a trace.
  const { data: subtypes = [] } = useSubtypes();
  const { words: sheetWords } = useSheetText(activeSheetId || null);
  const { vocabulary } = useNamingVocabulary();

  // Per-project AI-training opt-out (Global Settings → Projects). When this project
  // is opted OUT, we still BUILD a name/type suggestion (the autofill is a UX aid),
  // but we DON'T persist any training data: no provenance on the units row and no
  // trace_events. Default-ON — only an explicit false disables capture.
  const trainingEnabled = isProjectTrainingEnabled(project);

  const {
    undoStack, setUndoStack,
    redoStack, setRedoStack,
    triggerUndo, triggerRedo
  } = useUndoRedo({ toolMode, sheetId: activeSheetId });

  const handlePolygonComplete = (points: PercentPoint[]) => {
    setEditingUnitId(null);
    setPendingStampType(null); // a fresh hand-trace is never a stamp
    setPendingPolygonPoints(points);
    // Read the sheet words inside the polygon, propose a name + type, and pre-fill the
    // naming popover (Phase 4). The geometry stays 100% hand-traced; only the name/type
    // are assisted. The FROZEN proposal is held until save/cancel so the suggested-vs-
    // final delta is the training signal. Degrades silently to a blank popover.
    const suggestion = buildRoomSuggestion(points, sheetWords, subtypes, vocabulary);
    setMapLabelSuggestion(suggestion);
    setNewUnitName(suggestion?.unitNumber ?? '');
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

  const handleDuplicateUnit = async (unitId: string | null) => {
    const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
    const sourceUnit = units.find(u => u.id === unitId);
    if (!sourceUnit) return;
    
    const newPoints = (sourceUnit.polygon_coordinates as PercentPoint[]).map(p => ({
      pctX: p.pctX + 0.02,
      pctY: p.pctY + 0.02
    }));
    
    setMapLabelSuggestion(null); // a duplicate is not an AI-suggested trace
    setPendingStampType(null);   // …nor a stamp
    setPendingPolygonPoints(newPoints);
    setNewUnitName(`${sourceUnit.unit_number} (Copy)`);
    setUnitNamingOpen(true);
  };

  // Shared create + undo for both instant-stamp paths (Phase 2 extracted this so a
  // drawer stamp with NO source unit can auto-name off its own base name). `baseName`
  // is the un-suffixed name; a "(Stamp N)" suffix is appended with the next free index
  // on this sheet. Behavior for the selected-room path is unchanged.
  const commitStampedUnit = async (
    baseName: string,
    newPoints: PercentPoint[],
    // A stamp is a copy of a location, so it carries that location's type onto the copy
    // (subtype_id + unit_type + top_level_role). Omitted → the new row falls back to the
    // DB default. Copying unit_type also gives the stamped location the SAME milestone
    // applicability as its source (applicability keys on unit_type — AGENTS §3).
    typeFields?: { subtype_id: string | null; unit_type: string | null; top_level_role: TopLevelRole | null },
  ) => {
    const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];

    // Shared index math (Phase 3) so an instant drop and an Enter-through in the naming
    // popover produce the identical "{base} (Stamp N)" name.
    const stampedName = nextStampName(baseName, units.map(u => u.unit_number));
    try {
      const data = await createUnitMutation.mutateAsync({ sheet_id: activeSheetId, unit_number: stampedName, polygon_coordinates: newPoints as any, ...(typeFields ?? {}) });
      setUndoStack(prev => {
        const next = [...prev, { actionType: 'CREATE_UNIT' as const, unitData: data as any }];
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });
      setRedoStack([]);
    } catch (err: any) {
      showToast('Error stamping location: ' + err.message, 'error');
    }
  };

  const handleInstantStamp = async (sourceUnitId: string, newPoints: PercentPoint[]) => {
    const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
    const sourceUnit = units.find(u => u.id === sourceUnitId);
    if (!sourceUnit) return;

    const baseName = stampBaseName(sourceUnit.unit_number);

    // Copy the source room's type onto the stamped copy (its role is authoritative on
    // the source unit — no derivation needed).
    await commitStampedUnit(baseName, newPoints, {
      subtype_id: sourceUnit.subtype_id ?? null,
      unit_type: sourceUnit.unit_type ?? null,
      top_level_role: (sourceUnit.top_level_role as TopLevelRole) ?? null,
    });

    // Collect the source room's shape into the drawer's recents so it's re-stampable
    // without re-selecting it (Phase 2). Stored normalized to its own centroid; de-dup
    // by shape keeps repeated stamps of one room to a single recent entry.
    const sourcePoly = sourceUnit.polygon_coordinates;
    if (sourcePoly && sourcePoly.length >= 3) {
      pushRecentStamp({
        id: crypto.randomUUID(),
        name: baseName || sourceUnit.unit_number,
        points: normalizeToCentroid(sourcePoly),
        subtypeId: sourceUnit.subtype_id ?? null,
        unitType: sourceUnit.unit_type ?? null,
        createdAt: new Date().toISOString(),
      });
    }
  };

  // Instant-stamp an ARMED drawer stamp (no source unit): the "(Stamp N)" base name comes
  // from the StampDef itself. Same create/undo path as a selected-room stamp; re-collects
  // the stamp as a recent (a fresh id + timestamp keeps a saved stamp and its recent use
  // as independent drawer entries — de-dup by shape still collapses repeated drops).
  const handleInstantStampShape = async (stamp: StampDef, newPoints: PercentPoint[]) => {
    const baseName = (stamp.name || 'Stamp').trim() || 'Stamp';
    // Carry the stamp's saved type onto the copy. A StampDef stores subtype_id + unit_type
    // but not the role, so recover the role from the dictionary (same resolution the
    // naming path's stampPick uses) — never write a stray unit_type without its role.
    const st = stamp.subtypeId ? subtypes.find(s => s.id === stamp.subtypeId) : null;
    await commitStampedUnit(baseName, newPoints, {
      subtype_id: stamp.subtypeId ?? null,
      unit_type: stamp.unitType ?? null,
      top_level_role: st ? (st.top_level_role as TopLevelRole) : null,
    });
    pushRecentStamp({ ...stamp, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  };

  // Stamp & Fast Markup — Phase 3: the OPT-IN "name each stamp" drop. Instead of the
  // instant create, route the already snapped/transformed polygon through the SAME
  // pending-polygon + naming popover a fresh trace uses (mirror handleDuplicateUnit),
  // pre-filling the name ("{base} (Stamp N)", matching the instant path) and — via the
  // `pendingStampType` carrier → `stampPick` below — the stamp's type. The armed stamp
  // (or the selected room) is left untouched, so hitting Enter re-arms it for the next
  // drop. `source` is the armed StampDef's identity or the selected room's, normalized
  // in FloorplanCanvas. saveNewUnitFromPopover does the create + recent-push (no dupe).
  const handleStampWithNaming = (
    source: { name: string; subtypeId: string | null; unitType: string | null },
    newPoints: PercentPoint[],
  ) => {
    const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
    const baseName = stampBaseName(source.name || 'Stamp') || 'Stamp';
    setMapLabelSuggestion(null); // a stamp is not an AI-suggested trace
    setPendingStampType({ subtypeId: source.subtypeId ?? null, unitType: source.unitType ?? null });
    setPendingPolygonPoints(newPoints);
    setNewUnitName(nextStampName(baseName, units.map(u => u.unit_number)));
    setUnitNamingOpen(true);
  };

  const handleRenameUnitInitiate = (unitId: string | null) => {
     const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
     const unit = units.find(u => u.id === unitId);
     if (!unit) return;
     setMapLabelSuggestion(null); // a rename is an edit, never an AI suggestion
     setPendingStampType(null);
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
           if (sheet) {
             // Measure against the base image's natural size — the SAME pixel basis
             // calibration uses (loadImageDimensions), so the scale factor cancels
             // cleanly and the real area is correct.
             const dims = await loadImageDimensions(sheet.base_image_url);
             if (dims) {
                 // CORRECT area math (Phase 3): pixelArea × scale_units_per_px²
                 // (replaces the dimensionally-wrong × scale_ratio). Null when the
                 // sheet is un-scaled — the location still saves, area-less.
                 finalComputedArea = computeAreaFromUnitsPerPx(
                    pendingPolygonPoints,
                    dims.width,
                    dims.height,
                    sheet.scale_units_per_px,
                 );
             }
           }
         }

         // Capture provenance (Phase 4) — mirror useCreateWorkbenchLabel. Geometry is
         // hand-traced (method='manual'); a room born from a suggestion records whether
         // the human kept it (ai_accepted) or changed it (ai_edited) plus the FROZEN
         // original proposal, while a plain manual draw stays human. The trace_events
         // row + frozen suggested_label make map-drawn rooms first-class training data.
         const suggestion = mapLabelSuggestion;
         const source: TraceSource = suggestion ? deriveSuggestionSource(suggestion, name, pick) : 'human';

         const data = await createUnitMutation.mutateAsync({
             sheet_id: activeSheetId,
             unit_number: name,
             polygon_coordinates: pendingPolygonPoints as any,
             unit_type: taxonomy?.unit_type ?? null,
             top_level_role: taxonomy?.top_level_role ?? null,
             subtype_id: taxonomy?.subtype_id ?? null,
             computed_area: finalComputedArea,
             // Training provenance is persisted ONLY when this project is opted in.
             // Opted out → every provenance field is null and the room is just a
             // normal location (no corpus contribution).
             method: trainingEnabled ? 'manual' : null,
             source: trainingEnabled ? source : null,
             model_version: trainingEnabled && suggestion ? ROOM_TEXT_MODEL_VERSION : null,
             suggested_label: (trainingEnabled && suggestion ? suggestedLabelFromSuggestion(suggestion) : null) as Unit['suggested_label'],
             suggested_polygon: null,
             review_status: trainingEnabled ? (source === 'human' ? 'confirmed' : 'unreviewed') : null,
             spec_version: trainingEnabled ? ANNOTATION_SPEC_VERSION : null,
         });

         // Append the immutable create event (best-effort; never blocks the save). The
         // group_key is the sheet id, matching the workbench, so map-drawn rooms group
         // correctly in the corpus (ANNOTATION_SPEC §5). Skipped entirely when the
         // project is opted out of training.
         if (trainingEnabled) {
           void recordTraceEvent({
             sheetId: activeSheetId,
             unitId: (data as Unit).id,
             eventType: 'create',
             method: 'manual',
             source,
             afterPolygon: pendingPolygonPoints,
             afterLabel: labelSnapshotFromUnit(data as Unit),
             modelVersion: suggestion ? ROOM_TEXT_MODEL_VERSION : null,
             groupKey: activeSheetId,
           });
         }

         setUndoStack(prev => {
             const next = [...prev, { actionType: 'CREATE_UNIT' as const, unitData: data as any }];
             return next.length > 50 ? next.slice(next.length - 50) : next;
         });
         setRedoStack([]);

         // Collect a freshly-drawn room's shape into the stamp drawer's recents too
         // (Phase 2) — so anything you just traced is immediately re-stampable. Normalized
         // to its centroid; de-dup keeps identical shapes to one entry.
         if (pendingPolygonPoints && pendingPolygonPoints.length >= 3) {
           pushRecentStamp({
             id: crypto.randomUUID(),
             name,
             points: normalizeToCentroid(pendingPolygonPoints),
             subtypeId: taxonomy?.subtype_id ?? null,
             unitType: taxonomy?.unit_type ?? null,
             createdAt: new Date().toISOString(),
           });
         }

         setUnitNamingOpen(false);
         setPendingPolygonPoints(null);
         setMapLabelSuggestion(null);
         setPendingStampType(null);
         setNewUnitName('');
         showToast('Location saved.', 'success');
      }
    } catch (err: any) {
      showToast('Error saving location: ' + err.message, 'error');
    }
  };

  const cancelUnitNaming = () => {
    // Dismissing a freshly-traced room that HAD a suggestion = rejecting it (the user
    // walked away rather than confirm/edit). Record the reject with the FROZEN proposal
    // as the before-state; no unit is written. A rename (editingUnitId set) carries no
    // suggestion, so it never rejects. Best-effort — never blocks (Phase 4).
    if (trainingEnabled && mapLabelSuggestion && !editingUnitId) {
      void recordTraceEvent({
        sheetId: activeSheetId,
        eventType: 'reject_suggestion',
        method: 'manual',
        source: 'ai_suggested',
        beforePolygon: pendingPolygonPoints,
        beforeLabel: suggestedLabelFromSuggestion(mapLabelSuggestion),
        modelVersion: ROOM_TEXT_MODEL_VERSION,
        groupKey: activeSheetId,
      });
    }
    setUnitNamingOpen(false);
    setPendingPolygonPoints(null);
    setEditingUnitId(null);
    setNewUnitName('');
    setMapLabelSuggestion(null);
    setPendingStampType(null);
  };

  const handleDeleteUnit = (unitId: string) => {
    setConfirmModal({
      message: 'Are you sure you want to delete this location markup?',
      onConfirm: async () => {
        const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
        const activeStatuses = queryClient.getQueryData<StatusLog[]>(queryKeys.statusesBySheet(activeSheetId)) || [];
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
        const activeStatuses = queryClient.getQueryData<StatusLog[]>(queryKeys.statusesBySheet(activeSheetId)) || [];
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

  const commitUnitActivity = async (
    unit: Unit,
    activity: Partial<Activity> & { isClearAction?: boolean },
    currentTemporalState: TemporalState = 'none',
    isUndoRedo = false,
    extraProps: CommitStatusExtraProps = {}
  ): Promise<{ ok: boolean }> => {
    setSavingUnitId(unit.id);
    const activeSheetStatuses = queryClient.getQueryData<StatusLog[]>(queryKeys.statusesBySheet(activeSheetId)) || [];
    // In all-levels editing the unit may live on a different sheet than the active one, so its
    // prior logs aren't in the active-sheet cache. Fall back to the cross-sheet cache for this
    // unit so undo (oldStatus) and the auto-advance gap check see its real history. Same-sheet
    // edits keep using the active-sheet cache unchanged.
    const activeStatuses = activeSheetStatuses.some(s => s.unit_id === unit.id)
      ? activeSheetStatuses
      : [
          ...activeSheetStatuses,
          ...queryClient
            .getQueriesData<StatusLog[]>({ queryKey: queryKeys.allProjectStatusesAll() })
            .flatMap(([, d]) => d ?? [])
            .filter(s => s.unit_id === unit.id),
        ];
    const activities = queryClient.getQueryData<Activity[]>(queryKeys.activities(project?.id as string)) || [];
    const sheets = queryClient.getQueryData<Sheet[]>(queryKeys.sheets(project?.id as string)) || [];
    const activeSheet = sheets.find(s => s.id === activeSheetId);

    if (activity.isClearAction) {
      try {
        const oldLog = activeStatuses.find(s => s.unit_id === unit.id && s.track === trackingMode && s.activityName === activity.name) || activeStatuses.find(s => s.unit_id === unit.id && s.track === trackingMode) || null;
        if (!oldLog) return { ok: true }; // nothing to clear — a no-op, not a failure
        await clearStatusMutation.mutateAsync({ unitId: unit.id, track: trackingMode, activityId: oldLog.activity_id, activityName: oldLog.activityName });
        if (!isUndoRedo) {
          setUndoStack(prev => {
            const next = [...prev, { actionType: 'UPDATE_STATUS' as const, unitId: unit.id, oldLog, newLog: null }];
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
          setRedoStack([]);
        }
        return { ok: true };
      } catch (err: any) {
        showToast('Failed to clear status: ' + err.message, 'error');
        return { ok: false }; // surface failure so a batched Apply keeps this item queued
      } finally {
        setSavingUnitId(null);
      }
    }

    const activityName = activity.name as string;
    const oldStatus = activeStatuses.find(s => s.unit_id === unit.id && s.track === activity.track && s.activityName === activityName) || null;
    try {
      const status_color = activity.color || (activity as any).status_color || '';
      const sheetSchedule = (activeSheet?.activity_schedules as Record<string, any>)?.[activityName] || {};

      // status_logs.activity_id is NOT NULL. The desktop paths hand a full Activity, but the
      // mobile swipe-deck quick paths (swipe-right, PLN/ONG/✓) and synthetic bottleneck
      // placeholders (src/utils/bottleneck.ts) carry only a name — resolve the id by name+track
      // before writing, else the insert fails the NOT-NULL constraint. Fail loudly (kept in the
      // pending queue) rather than writing NULL if the activity truly can't be found.
      const resolvedActivityId = resolveActivityId(activity, activities);
      if (!resolvedActivityId) {
        throw new Error(
          `Couldn't identify the activity${activityName ? ` "${activityName}"` : ''} for this location — reopen the status picker and try again.`
        );
      }

      const newLogData = {
        unit_id: unit.id,
        activity_id: resolvedActivityId,
        activityName,
        status_color,
        temporal_state: currentTemporalState,
        track: activity.track as string,
        planned_start_date: extraProps.startDate || sheetSchedule.start_date || null,
        planned_end_date: extraProps.endDate || sheetSchedule.end_date || null,
        // Completion date. When the edit carries loggedDate, honor it (incl. an explicit
        // '' clear → null). When it does NOT (e.g. a planned-date-only edit on an already-
        // completed activity), PRESERVE the stored logged_date rather than re-stamping
        // today — otherwise fixing a planned-date typo silently rewrites the real completion
        // date and corrupts schedule-variance history. Today is stamped ONLY for a
        // genuinely-new completion (state is 'completed' AND there is no prior logged_date).
        // Mirrors the actual_start_date preservation just below (Status Sequencing Phase 3).
        logged_date: extraProps.loggedDate !== undefined
          ? (extraProps.loggedDate || null)
          : (currentTemporalState === 'completed'
              ? (oldStatus?.logged_date ?? new Date().toISOString().split('T')[0])
              : null),
        // Manually-entered actual-start (Actual-Dates Capture). Only ever changed when
        // this edit explicitly carries it; otherwise PRESERVE the stored value so an
        // unrelated edit (status / planned date) can't wipe a hand-entered actual-start
        // (there is no sheet-schedule fallback for it — it is per-slot manual).
        actual_start_date: extraProps.actualStartDate !== undefined
          ? (extraProps.actualStartDate || null)
          : (oldStatus?.actual_start_date ?? null),
        // client_timestamp from PendingChange.capturedAt (offline-capture time).
        // For immediate (online) mutations this will be null/undefined; useUpdateStatus stamps it as a fallback.
        client_timestamp: extraProps.client_timestamp || null
      };
      const newLog = await updateStatusMutation.mutateAsync(newLogData);

      // Auto-advance is a CONVENIENCE side-effect (tee up the next activity as "planned"),
      // not the change the user staged. Isolate it in its own try/catch so a failure here
      // can NOT flip the already-succeeded primary write to a failure — otherwise a batched
      // Apply would wrongly re-queue an item that actually saved. On failure we toast a
      // distinct note and carry on (record undo, return ok:true).
      // Phase 4: the auto-advance side-write (if it fires) is captured here so ONE Undo
      // reverses BOTH slots. Stays undefined when no advance happens → single-slot undo is
      // exactly as before.
      let autoAdvanceSecondary: UndoAction['secondary'];
      const autoAdvanceEnabled = settings.auto_advance_tracks?.[activity.track as string] === true;
      if (currentTemporalState === 'completed' && autoAdvanceEnabled && !isUndoRedo) {
        try {
          const overrides = queryClient.getQueryData<ActivityOverride[]>(queryKeys.activityOverrides(project?.id as string)) || [];
          const applicabilityIndex = buildApplicabilityIndex(activities, overrides);
          const trackActivities = activities.filter(a => a.track === activity.track).sort((a,b) => (a.sequence_order || 0) - (b.sequence_order || 0));
          const currentIndex = trackActivities.findIndex(a => a.name === newLogData.activityName);

          // The never-downgrade decision lives in one tested pure helper
          // (planAutoAdvance). It only tees up the next slot when that slot is Not
          // Started ('none'); if it already has progress (planned/ongoing/completed)
          // it returns null and we write NOTHING — so completing an earlier activity
          // can never overwrite a later one's saved state + dates. Per-slot state is
          // read from THIS unit's own logs, matched by the canonical activity_id slot
          // key (not the display name). Keeps the defensive prior-gap guard inside.
          const target = planAutoAdvance({
            orderedTrackActivities: trackActivities,
            unit,
            completedIndex: currentIndex,
            applicabilityIndex,
            stateOf: (i) => {
              const act = trackActivities[i];
              const log = act
                ? activeStatuses.find(s => s.unit_id === unit.id && s.activity_id === act.id)
                : null;
              return (log?.temporal_state as TemporalState) ?? 'none';
            },
          });

          if (target) {
            // Genuinely-new slot (was 'none'), so writing 'planned' + its planned dates
            // can't clobber saved progress. Read those dates from the UNIT'S OWN sheet
            // schedule (all-levels correctness — the unit may live on a different sheet
            // than the active one), and stamp the side-write with the SAME capture-time
            // client_timestamp the primary edit carried, so it doesn't win Last-Write-
            // Wins at sync-time "now".
            const targetSheet = sheets.find(s => s.id === unit.sheet_id) ?? activeSheet;
            const nextSheetSchedule = (targetSheet?.activity_schedules as Record<string, any>)?.[target.activityName] || {};

            const nextLogData = {
              unit_id: unit.id,
              activity_id: target.activityId,
              activityName: target.activityName,
              status_color: target.color,
              temporal_state: 'planned' as TemporalState,
              track: target.track,
              planned_start_date: nextSheetSchedule.start_date || null,
              planned_end_date: nextSheetSchedule.end_date || null,
              // A freshly teed-up 'planned' slot has no completion or actual-start yet. Send
              // them explicitly-null so the Phase-5 preserve-on-absent RPC can't carry a stale
              // date over from the row this lands on (planAutoAdvance only targets a 'none'
              // slot, but a legacy/edge 'none' row could still hold a leftover date — this
              // keeps the write clean regardless).
              logged_date: null,
              actual_start_date: null,
              client_timestamp: extraProps.client_timestamp || null,
            };
            const nextLog = await updateStatusMutation.mutateAsync(nextLogData);
            // Record the teed-up slot's after-state on the SAME undo entry (Phase 4). Its
            // "before" is always Not Started (planAutoAdvance only targets a 'none' slot),
            // so undo restores it to none and redo re-writes this 'planned' log.
            autoAdvanceSecondary = { unitId: unit.id, newLog: nextLog };
          }
        } catch (advErr: any) {
          showToast("Saved, but couldn't line up the next activity: " + advErr.message, 'warning');
        }
      }

      if (!isUndoRedo) {
        setUndoStack(prev => {
          const next = [...prev, { actionType: 'UPDATE_STATUS' as const, unitId: unit.id, oldLog: oldStatus, newLog, secondary: autoAdvanceSecondary }];
          return next.length > 50 ? next.slice(next.length - 50) : next;
        });
        setRedoStack([]);
      }
      return { ok: true };
    } catch (err: any) {
      showToast('Failed to update status: ' + err.message, 'error');
      // Report failure so a batched Apply records it and KEEPS this item queued for retry
      // (offline-queue "keep unsynced work" invariant, AGENTS.md §2). This is now ONLY the
      // primary write failing — auto-advance failures are handled above and don't reach here.
      return { ok: false };
    } finally {
      setSavingUnitId(null);
    }
  };

  // `unitId`/`value` admit null because the quick modals stay mounted while closed
  // (their `unitId` prop is null then, and QuickActivityModal's selection can be null
  // when the slot has no activity). Both paths already no-op safely on null (the
  // `find` misses → early return / no matching activity).
  const handleQuickUpdate = (unitId: string | null, type: 'status' | 'activity', value: string | null, extraProps: CommitStatusExtraProps = {}) => {
    const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
    const activeStatuses = queryClient.getQueryData<StatusLog[]>(queryKeys.statusesBySheet(activeSheetId)) || [];
    const activities = queryClient.getQueryData<Activity[]>(queryKeys.activities(project?.id as string)) || [];
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;

    const existingStatus = activeStatuses.find(s => s.unit_id === unitId && s.track === trackingMode);

    if (type === 'status') {
      if (value === 'none') {
        const activity = {
          isClearAction: true,
          track: trackingMode,
          name: extraProps.activityObj?.name || existingStatus?.activityName
        };
        commitUnitActivity(unit, activity);
        return;
      }

      let activityObj: Partial<Activity>;
      if (extraProps.activityObj) {
         activityObj = extraProps.activityObj;
      } else if (existingStatus) {
         activityObj = { id: existingStatus.activity_id, name: existingStatus.activityName, color: existingStatus.status_color, track: trackingMode };
      } else {
         activityObj = activities.find(a => a.track === trackingMode) || { name: 'Not Started', color: '#64748b', track: trackingMode };
      }
      commitUnitActivity(unit, activityObj, value as TemporalState, false, extraProps);
    } else if (type === 'activity') {
      const selectedActivity = activities.find(a => a.name === value && a.track === trackingMode);
      if (!selectedActivity) return;

      const temporalState = extraProps.temporal_state ? extraProps.temporal_state : (existingStatus ? existingStatus.temporal_state : 'completed');
      commitUnitActivity(unit, selectedActivity, temporalState as TemporalState, false, extraProps);
    }
  };

  // The vars the bulk dock supplies — everything the mutation needs except the
  // stable activity_id, which THIS handler resolves from the name (below).
  const handleApplyBulkStatus = async ({ unitIds, activityName, color, temporal_state, track, planned_start_date, planned_end_date, logged_date, bottlenecks = [] }: Omit<BulkUpdateStatusVars, 'activity_id'>, isUndoRedo = false) => {
    const activeStatuses = queryClient.getQueryData<StatusLog[]>(queryKeys.statusesBySheet(activeSheetId)) || [];
    const activitiesForBulk = queryClient.getQueryData<Activity[]>(queryKeys.activities(project?.id as string)) || [];
    // Resolve the applied activity name → its stable activity_id (the slot key). Null
    // for the '__KEEP_EXISTING__' / null sentinels — the bulk hook treats those as
    // keep-existing / no-op respectively.
    const bulkActivityId = (activityName && activityName !== '__KEEP_EXISTING__')
      ? (activitiesForBulk.find(a => a.name === activityName && a.track === track)?.id ?? null)
      : null;

    // Save old state for undo
    const oldLogs = activeStatuses.filter(s => unitIds.includes(s.unit_id as string) && s.track === track);

    try {
      await bulkUpdateStatusMutation.mutateAsync({ unitIds, activityName, activity_id: bulkActivityId, color, temporal_state, track, planned_start_date, planned_end_date, logged_date, bottlenecks });

      const autoAdvanceEnabled = settings.auto_advance_tracks?.[track] === true;

      // Auto-advance: each unit walks to ITS next applicable activity, so an
      // activity that is N/A for some units never receives a 'planned' stamp.
      const advancedLogs: any[] = [];
      if (temporal_state === 'completed' && autoAdvanceEnabled && activityName !== '__KEEP_EXISTING__' && activityName !== null && !isUndoRedo) {
        const activities = queryClient.getQueryData<Activity[]>(queryKeys.activities(project?.id as string)) || [];
        const overrides = queryClient.getQueryData<ActivityOverride[]>(queryKeys.activityOverrides(project?.id as string)) || [];
        const units = queryClient.getQueryData<Unit[]>(queryKeys.units(activeSheetId)) || [];
        const applicabilityIndex = buildApplicabilityIndex(activities, overrides);
        const trackActivities = activities.filter(a => a.track === track).sort((a,b) => (a.sequence_order || 0) - (b.sequence_order || 0));
        const currentIndex = trackActivities.findIndex(a => a.name === activityName);

        if (currentIndex !== -1) {
          // Same never-downgrade rule as the single path (Phase 1): run planAutoAdvance
          // PER UNIT, reading THIS unit's per-slot state by the canonical activity_id slot
          // key. A unit only joins an advance group when its next slot is Not Started
          // ('none'); if that slot already has progress (planned/ongoing/completed) the
          // helper returns null and the unit is left untouched — so bulk-completing an
          // activity can no longer wipe a finished later activity across selected locations.
          // We keep the group-by-next-activity batching (one .upsert per distinct next
          // activity) for efficiency, but membership is now gated by the pure helper — do
          // not duplicate the rule here. The map's bulk dock is active-sheet-scoped (its
          // units come from queryKeys.units(activeSheetId)), so reading state from the
          // active-sheet cache is correct for every unit it can select.
          //
          // Concurrent-Apply race (plan §Open decisions): the state read here is a snapshot
          // taken before the primary bulk write. If a near-simultaneous single Apply already
          // teed up a unit's next slot (planned), never-downgrade makes bulk SKIP it rather
          // than overwrite — the worst case is "skips when it might have teed up", never
          // destructive — so a stronger ordering guard isn't warranted for this phase.
          const targetGroups: Record<string, { target: AutoAdvanceTarget; ids: string[] }> = {};
          for (const id of unitIds as string[]) {
            const unit = units.find(u => u.id === id);
            if (!unit) continue;
            const target = planAutoAdvance({
              orderedTrackActivities: trackActivities,
              unit,
              completedIndex: currentIndex,
              applicabilityIndex,
              stateOf: (i) => {
                const act = trackActivities[i];
                const log = act
                  ? activeStatuses.find(s => s.unit_id === unit.id && s.activity_id === act.id)
                  : null;
                return (log?.temporal_state as TemporalState) ?? 'none';
              },
            });
            if (!target) continue;
            (targetGroups[target.activityId] ||= { target, ids: [] }).ids.push(id);
          }

          for (const { target, ids: groupIds } of Object.values(targetGroups)) {
            await bulkUpdateStatusMutation.mutateAsync({
               unitIds: groupIds,
               activityName: target.activityName,
               activity_id: target.activityId,
               color: target.color,
               temporal_state: 'planned',
               track
               // Planned dates are omitted on purpose (omit-preserves): the teed-up slot
               // may already carry an imported/cascaded planned window on its 'none' row —
               // never wipe it. The bulk hook sends logged_date explicit-null for a
               // non-completed state, so the fresh slot stays clean (single-path parity).
            });
            groupIds.forEach(id => advancedLogs.push({ unit_id: id, activity_id: target.activityId, activityName: target.activityName, status_color: target.color, temporal_state: 'planned', track }));
          }
        }
      }

      let newLogs: any[] = [];
      if (activityName === '__KEEP_EXISTING__') {
        if (temporal_state !== '__KEEP_EXISTING__') {
          newLogs = oldLogs.map(s => ({ ...s, temporal_state }));
        } else {
          newLogs = oldLogs;
        }
      } else if (activityName !== null && temporal_state !== 'none' && temporal_state !== '__KEEP_EXISTING__') {
        // Units that advanced are represented by their new 'planned' slot;
        // the rest keep the activity/state this bulk action applied.
        const advancedUnitIds = new Set(advancedLogs.map(l => l.unit_id));
        newLogs = [
          ...(unitIds as string[]).filter(id => !advancedUnitIds.has(id)).map(id => ({ unit_id: id, activity_id: bulkActivityId, activityName, status_color: color, temporal_state, track })),
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

  // The AI taxonomy pre-selection + the "suggested from the sheet" hint for the naming
  // popover — CREATE mode only (a rename carries no suggestion). The name pre-fill rides
  // on newUnitName; this seeds the popover's active type pick so an accepted suggestion
  // still saves with its type even when the user never opens the picker.
  const suggestedPick = !editingUnitId && mapLabelSuggestion ? suggestionToPick(mapLabelSuggestion) : null;
  const isSuggested = !editingUnitId && !!mapLabelSuggestion;

  // Stamp & Fast Markup — Phase 3: pre-select the stamp's type in the naming popover.
  // Resolve the carried `subtypeId` to a real dictionary pick (name + role) so hitting
  // Enter saves WITH the type — mirrors `suggestedPick`, gated to CREATE (never a rename).
  // Null when the stamp is typeless (no subtype) or its id has since left the dictionary,
  // in which case the popover just opens with no type pre-selected.
  const stampSubtype = !editingUnitId && pendingStampType?.subtypeId
    ? subtypes.find(s => s.id === pendingStampType.subtypeId) ?? null
    : null;
  const stampPick: TaxonomyResult | null = stampSubtype
    ? { kind: 'subtype', subtypeId: stampSubtype.id, name: stampSubtype.name, role: stampSubtype.top_level_role as TopLevelRole }
    : null;

  return {
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
    isPendingBulk: bulkUpdateStatusMutation.isPending,
    updateActivityMutation
  };
}
