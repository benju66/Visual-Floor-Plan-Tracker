'use client';

import React, { useCallback, useEffect } from 'react';
import { FileWarning } from 'lucide-react';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import WorkbenchLabelPopover, { type WorkbenchLabelMeta } from './WorkbenchLabelPopover';
import WorkbenchTracerToolbar from './WorkbenchTracerToolbar';
import { useMapStore } from '@/store/useMapStore';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';
import { useSubtypes } from '@/hooks/useSubtypes';
import { useSnappingVectors, useUnits, useDeleteUnit } from '@/hooks/useProjectQueries';
import { useSheetText } from '@/hooks/useSheetText';
import { useCreateWorkbenchLabel, useUpdateWorkbenchLabel } from '@/hooks/useWorkbenchActions';
import { PROJECT_TYPES, type ProjectType } from '@/utils/locationTaxonomy';
import { recordTraceEvent, labelSnapshotFromUnit, type TraceMethod, type TraceSource } from '@/utils/traceCapture';
import {
  buildRoomSuggestion,
  suggestionToPick,
  suggestedLabelFromSuggestion,
  deriveSuggestionSource,
  ROOM_TEXT_MODEL_VERSION,
} from '@/utils/roomSuggestion';
import type { PercentPoint, WorkbenchDrawing } from '@/types/domain';

// Location Labeling Workbench — tracing view. Mounts the REUSED, unchanged
// `FloorplanCanvas` on a workbench drawing and wires its `onPolygonComplete` to the
// workbench naming popover (Phase 7 — standard-enforcing: required type, within-sheet
// uniqueness, two-level/void flags), banking labels (`units` rows) under the hidden
// container via `useCreateWorkbenchLabel`. No status / schedule / sync / bulk UI here.

/** Narrow the sidecar's free-text project type to a canonical ProjectType (or null). */
function asProjectType(value: string | null | undefined): ProjectType | null {
  return value && (PROJECT_TYPES as readonly string[]).includes(value) ? (value as ProjectType) : null;
}

export default function WorkbenchTracer({ drawing }: { drawing: WorkbenchDrawing }) {
  const sheetId = drawing.id;

  const setActiveSheetId = useMapStore((s) => s.setActiveSheetId);
  const setToolMode = useMapStore((s) => s.setToolMode);
  const clearSelectedUnits = useMapStore((s) => s.clearSelectedUnits);

  // Point the SHARED canvas at this workbench sheet. The canvas reads
  // `activeSheetId` (and `useUnits`/`useSnappingVectors` off it) from `useMapStore`
  // internally, so we set it here on mount and restore the prior live-map session
  // on unmount — the tracer shares that store and must never leak its sheet, tool,
  // selection, or half-finished trace into the live map. (Mount/unmount lifecycle
  // sync, not "state management in an effect" — same pattern the live page uses to
  // own `activeSheetId`.)
  useEffect(() => {
    const { activeSheetId: prevSheetId, toolMode: prevToolMode } = useMapStore.getState();
    setActiveSheetId(sheetId);
    setToolMode('pan');
    clearSelectedUnits();
    return () => {
      setActiveSheetId(prevSheetId);
      setToolMode(prevToolMode);
      clearSelectedUnits();
      const wb = useWorkbenchStore.getState();
      wb.setIsLabelNamingOpen(false);
      wb.setPendingLabelPoints(null);
      wb.setLabelDraftName('');
      wb.setEditingLabelId(null);
      wb.setLabelSuggestion(null);
    };
  }, [sheetId, setActiveSheetId, setToolMode, clearSelectedUnits]);

  const pendingLabelPoints = useWorkbenchStore((s) => s.pendingLabelPoints);
  const setPendingLabelPoints = useWorkbenchStore((s) => s.setPendingLabelPoints);
  const isLabelNamingOpen = useWorkbenchStore((s) => s.isLabelNamingOpen);
  const setIsLabelNamingOpen = useWorkbenchStore((s) => s.setIsLabelNamingOpen);
  const labelDraftName = useWorkbenchStore((s) => s.labelDraftName);
  const setLabelDraftName = useWorkbenchStore((s) => s.setLabelDraftName);
  const editingLabelId = useWorkbenchStore((s) => s.editingLabelId);
  const setEditingLabelId = useWorkbenchStore((s) => s.setEditingLabelId);
  const labelSuggestion = useWorkbenchStore((s) => s.labelSuggestion);
  const setLabelSuggestion = useWorkbenchStore((s) => s.setLabelSuggestion);

  const { data: subtypes = [] } = useSubtypes();
  const { data: units = [] } = useUnits(sheetId);
  const { isFetching: isSnappingLoading } = useSnappingVectors(sheetId);
  // The sheet's cached PDF words feed room-name auto-fill (online-only; degrades to
  // no suggestion when null/empty — a scanned sheet or no session).
  const { words: sheetWords } = useSheetText(sheetId);
  const createLabel = useCreateWorkbenchLabel(sheetId);
  const updateLabel = useUpdateWorkbenchLabel(sheetId);
  const deleteUnit = useDeleteUnit(sheetId);

  // The label currently being edited in-place (canvas "Rename"), or null when the
  // popover is naming a freshly-traced polygon.
  const editingUnit = editingLabelId ? units.find((u) => u.id === editingLabelId) ?? null : null;

  // Existing label names on this sheet for the popover's within-sheet uniqueness
  // check (standard §4.5) — EXCLUDING the label being edited (a name never collides
  // with itself). Reuses the same `useUnits(sheetId)` query the canvas reads.
  const existingNames = units
    .filter((u) => u.id !== editingLabelId)
    .map((u) => u.unit_number)
    .filter((n): n is string => !!n && n.trim().length > 0);

  // Feed the picker the SHEET's project type (per-drawing, from the Phase-5
  // sidecar) — workbench drawings are heterogeneous, so this is not a project-level type.
  const projectType = asProjectType(drawing.workbench?.sheet_project_type);

  // A completed trace opens the naming popover in CREATE mode (clear any edit
  // target). AI Tracing Assist (Phase 2): read the sheet words that fall INSIDE the
  // polygon, propose a name + taxonomy type, and pre-fill the popover as an editable
  // draft. The geometry stays 100% hand-traced; only the name is assisted. Degrades
  // silently to a blank popover when nothing is suggested.
  const handlePolygonComplete = useCallback(
    (points: PercentPoint[]) => {
      setEditingLabelId(null);
      setPendingLabelPoints(points);
      const suggestion = buildRoomSuggestion(points, sheetWords, subtypes);
      setLabelSuggestion(suggestion);
      setLabelDraftName(suggestion?.unitNumber ?? '');
      setIsLabelNamingOpen(true);
    },
    [
      setEditingLabelId,
      setPendingLabelPoints,
      setLabelSuggestion,
      setLabelDraftName,
      setIsLabelNamingOpen,
      sheetWords,
      subtypes,
    ],
  );

  // Canvas "Rename" → open the popover in EDIT mode, pre-filled from the label.
  const handleRenameUnit = useCallback(
    (unitId: string | null) => {
      if (!unitId) return;
      const unit = units.find((u) => u.id === unitId);
      if (!unit) return;
      setPendingLabelPoints(null);
      setEditingLabelId(unitId);
      setLabelSuggestion(null);
      setLabelDraftName(unit.unit_number ?? '');
      setIsLabelNamingOpen(true);
    },
    [units, setPendingLabelPoints, setEditingLabelId, setLabelSuggestion, setLabelDraftName, setIsLabelNamingOpen],
  );

  // Canvas "Delete" → remove the label(s). Reuses the live delete path (no
  // status_logs exist on a workbench label, so the cascade is just the unit).
  // Before deleting, append an immutable 'delete' trace event capturing the label's
  // final state (plan M1) — a deletion is itself training-relevant signal. The event
  // is recorded with no unit_id (the row is about to vanish; its identity lives in
  // the before-snapshot), so there's no FK race with the cascading delete.
  const handleDeleteUnit = useCallback(
    (ids: string | string[] | null) => {
      if (!ids) return;
      const list = Array.isArray(ids) ? ids : [ids];
      list.forEach((id) => {
        const u = units.find((x) => x.id === id);
        if (u) {
          void recordTraceEvent({
            sheetId,
            eventType: 'delete',
            method: (u.method as TraceMethod | null) ?? null,
            source: (u.source as TraceSource | null) ?? null,
            beforePolygon: u.polygon_coordinates ?? null,
            beforeLabel: labelSnapshotFromUnit(u),
            groupKey: sheetId,
          });
        }
        deleteUnit.mutate(id);
      });
    },
    [deleteUnit, units, sheetId],
  );

  const cancelNaming = useCallback(() => {
    // Dismissing a freshly-traced room that HAD a suggestion = rejecting it (the user
    // walked away rather than confirm/edit). Record the reject as training signal with
    // the FROZEN proposal as the before-state; no unit is written (plan M1 capture
    // invariant). Edits (editingLabelId set) carry no suggestion, so never reject.
    if (labelSuggestion && !editingLabelId) {
      void recordTraceEvent({
        sheetId,
        eventType: 'reject_suggestion',
        method: 'manual',
        source: 'ai_suggested',
        beforePolygon: pendingLabelPoints,
        beforeLabel: suggestedLabelFromSuggestion(labelSuggestion),
        modelVersion: ROOM_TEXT_MODEL_VERSION,
        groupKey: sheetId,
      });
    }
    setIsLabelNamingOpen(false);
    setPendingLabelPoints(null);
    setLabelDraftName('');
    setEditingLabelId(null);
    setLabelSuggestion(null);
  }, [
    labelSuggestion,
    editingLabelId,
    pendingLabelPoints,
    sheetId,
    setIsLabelNamingOpen,
    setPendingLabelPoints,
    setLabelDraftName,
    setEditingLabelId,
    setLabelSuggestion,
  ]);

  const saveLabel = useCallback(
    async (meta: WorkbenchLabelMeta) => {
      if (!labelDraftName.trim()) return;
      try {
        if (editingLabelId) {
          // EDIT an existing label (rename / re-type / flags).
          await updateLabel.mutateAsync({
            unitId: editingLabelId,
            name: labelDraftName,
            pick: meta.pick,
            spansLevels: meta.spansLevels,
            levelNote: meta.levelNote,
            hasVoid: meta.hasVoid,
          });
        } else {
          // CREATE a label from the freshly-traced polygon. When the name/type were
          // AI-suggested (Phase 2), carry the capture provenance: geometry is still
          // hand-traced (method='manual'), but source becomes 'ai_accepted' (kept the
          // suggestion exactly) or 'ai_edited' (changed it), with the FROZEN original
          // proposal as suggestedLabel — the before-vs-final delta is the training
          // signal. A plain manual trace (no suggestion) omits these and stays human.
          if (!pendingLabelPoints || pendingLabelPoints.length < 3) return;
          const suggestionProvenance = labelSuggestion
            ? {
                method: 'manual' as const,
                source: deriveSuggestionSource(labelSuggestion, labelDraftName, meta.pick),
                suggestedLabel: suggestedLabelFromSuggestion(labelSuggestion),
                modelVersion: ROOM_TEXT_MODEL_VERSION,
              }
            : {};
          await createLabel.mutateAsync({
            name: labelDraftName,
            points: pendingLabelPoints,
            pick: meta.pick,
            sheet: drawing,
            spansLevels: meta.spansLevels,
            levelNote: meta.levelNote,
            hasVoid: meta.hasVoid,
            ...suggestionProvenance,
          });
        }
        cancelNaming();
      } catch {
        // Surfaced inline via the error banner below; keep the popover open so the
        // labeler can retry without re-tracing.
      }
    },
    [labelDraftName, editingLabelId, pendingLabelPoints, labelSuggestion, createLabel, updateLabel, drawing, cancelNaming],
  );

  const saveError = createLabel.error ?? updateLabel.error;

  // The AI pre-selection for the popover (CREATE mode only; null when editing or
  // when no type was suggested). The name pre-fill rides on `labelDraftName` above.
  const suggestedPick = labelSuggestion ? suggestionToPick(labelSuggestion) : null;

  return (
    <div className="relative flex-1 min-h-0 h-full">
      <WorkbenchTracerToolbar isSnappingLoading={isSnappingLoading} />

      <FloorplanCanvas
        activeStatuses={[]}
        rawStatuses={[]}
        imageUrl={drawing.base_image_url ?? ''}
        pdfVersion={drawing.pdf_version ?? null}
        onPolygonComplete={handlePolygonComplete}
        pendingPolygonPoints={pendingLabelPoints}
        onPendingPolygonMove={setPendingLabelPoints}
        onRenameUnit={handleRenameUnit}
        onDeleteUnit={handleDeleteUnit}
      />

      {isLabelNamingOpen && (
        <WorkbenchLabelPopover
          name={labelDraftName}
          setName={setLabelDraftName}
          subtypes={subtypes}
          projectType={projectType}
          existingNames={existingNames}
          editingUnit={editingUnit}
          suggestedPick={suggestedPick}
          isSuggested={!!labelSuggestion}
          isSaving={createLabel.isPending || updateLabel.isPending}
          onSave={saveLabel}
          onCancel={cancelNaming}
        />
      )}

      {saveError && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-start gap-2 max-w-md rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-4 py-2.5 shadow-lg text-sm text-rose-600 dark:text-rose-300">
          <FileWarning size={16} className="shrink-0 mt-0.5" />
          <span>
            {saveError instanceof Error ? saveError.message : 'Could not save the label. Please try again.'}
          </span>
        </div>
      )}
    </div>
  );
}
