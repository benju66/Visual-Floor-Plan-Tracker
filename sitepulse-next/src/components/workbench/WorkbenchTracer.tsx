'use client';

import React, { useCallback, useEffect, useMemo } from 'react';
import { FileWarning } from 'lucide-react';
import { ScanText } from 'lucide-react';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import type { GridlineOverlayItem } from '@/components/canvas/GridlineOverlay';
import type { OpeningOverlayUnit, OpeningEditTarget } from '@/components/canvas/OpeningEdgeOverlay';
import WorkbenchLabelPopover, { type WorkbenchLabelMeta } from './WorkbenchLabelPopover';
import TitleBlockPopover from './TitleBlockPopover';
import GridlinePanel from './GridlinePanel';
import OpeningModePanel from './OpeningModePanel';
import WorkbenchTracerToolbar from './WorkbenchTracerToolbar';
import { useMapStore } from '@/store/useMapStore';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';
import { useSubtypes } from '@/hooks/useSubtypes';
import { useSnappingVectors, useUnits, useDeleteUnit } from '@/hooks/useProjectQueries';
import { useSheetText } from '@/hooks/useSheetText';
import { useNamingVocabulary } from '@/hooks/useNamingVocabulary';
import { useSheetMetadata, useUpsertSheetMetadata } from '@/hooks/useSheetMetadata';
import { useSheetGridlines, useUpsertSheetGridlines } from '@/hooks/useSheetGridlines';
import { parseTitleBlock } from '@/utils/titleBlockParse';
import {
  parseBubbleLabel,
  inferAxis,
  mapPendingGridlinesToRow,
  updateSavedGridline,
  deleteSavedGridline,
  type PendingGridline,
} from '@/utils/gridlineParse';
import {
  useCreateWorkbenchLabel,
  useUpdateWorkbenchLabel,
  useUpdateWorkbenchOpeningEdges,
  useUpdateWorkbenchGeometry,
} from '@/hooks/useWorkbenchActions';
import { resolveOpenings, toggleOpeningEdge, openingTypeForKey } from '@/utils/openingEdges';
import { recentSubtypeIdsFromUnits } from '@/utils/subtypes';
import { PROJECT_TYPES, type ProjectType } from '@/utils/locationTaxonomy';
import { recordTraceEvent, labelSnapshotFromUnit, type TraceMethod, type TraceSource } from '@/utils/traceCapture';
import {
  buildRoomSuggestion,
  suggestionToPick,
  suggestedLabelFromSuggestion,
  deriveSuggestionSource,
  ROOM_TEXT_MODEL_VERSION,
} from '@/utils/roomSuggestion';
import type { OpeningEdge, PercentPoint, WorkbenchDrawing } from '@/types/domain';

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
  const toolMode = useMapStore((s) => s.toolMode);
  const selectedUnitIds = useMapStore((s) => s.selectedUnitIds);

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
      wb.setIsTitleBlockOpen(false);
      wb.setTitleBlockBox(null);
      wb.setTitleBlockProposal(null);
      wb.setIsGridlineOpen(false);
      wb.setGridProposal(null);
      wb.setPendingGridlines([]);
      wb.setSelectedGridlineIndex(null);
      wb.setIsOpeningModeOpen(false);
      wb.setActiveOpeningType('door');
      wb.setPendingOpeningEdges([]);
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
  // Title-block reader (Phase 3a) floating state.
  const isTitleBlockOpen = useWorkbenchStore((s) => s.isTitleBlockOpen);
  const setIsTitleBlockOpen = useWorkbenchStore((s) => s.setIsTitleBlockOpen);
  const titleBlockBox = useWorkbenchStore((s) => s.titleBlockBox);
  const setTitleBlockBox = useWorkbenchStore((s) => s.setTitleBlockBox);
  const titleBlockProposal = useWorkbenchStore((s) => s.titleBlockProposal);
  const setTitleBlockProposal = useWorkbenchStore((s) => s.setTitleBlockProposal);
  // Gridline annotator (Phase 3b) floating state.
  const isGridlineOpen = useWorkbenchStore((s) => s.isGridlineOpen);
  const setIsGridlineOpen = useWorkbenchStore((s) => s.setIsGridlineOpen);
  const gridProposal = useWorkbenchStore((s) => s.gridProposal);
  const setGridProposal = useWorkbenchStore((s) => s.setGridProposal);
  const pendingGridlines = useWorkbenchStore((s) => s.pendingGridlines);
  const setPendingGridlines = useWorkbenchStore((s) => s.setPendingGridlines);
  const selectedGridlineIndex = useWorkbenchStore((s) => s.selectedGridlineIndex);
  const setSelectedGridlineIndex = useWorkbenchStore((s) => s.setSelectedGridlineIndex);
  // Opening-edge capture (Phase 4a) floating state.
  const isOpeningModeOpen = useWorkbenchStore((s) => s.isOpeningModeOpen);
  const setIsOpeningModeOpen = useWorkbenchStore((s) => s.setIsOpeningModeOpen);
  const activeOpeningType = useWorkbenchStore((s) => s.activeOpeningType);
  const setActiveOpeningType = useWorkbenchStore((s) => s.setActiveOpeningType);
  const pendingOpeningEdges = useWorkbenchStore((s) => s.pendingOpeningEdges);
  const setPendingOpeningEdges = useWorkbenchStore((s) => s.setPendingOpeningEdges);

  const { data: subtypes = [] } = useSubtypes();
  const { data: units = [] } = useUnits(sheetId);
  const { isFetching: isSnappingLoading } = useSnappingVectors(sheetId);
  // The sheet's cached PDF words feed room-name auto-fill (online-only; degrades to
  // no suggestion when null/empty — a scanned sheet or no session).
  const { words: sheetWords } = useSheetText(sheetId);
  // The company-wide learned naming vocabulary (Phase 2) — sharpens the name (drops
  // learned noise) and guesses the type from confirmed history. Best-effort: degrades
  // to an empty model ("no learning") offline or on error, never blocking a trace.
  const { vocabulary } = useNamingVocabulary();
  // The sheet's confirmed title-block facts (Phase 3a) — drives the saved chip and
  // persists across reloads. Null until the user reads the title block once.
  const { metadata: savedMetadata } = useSheetMetadata(sheetId);
  const upsertMetadata = useUpsertSheetMetadata(sheetId);
  // The sheet's confirmed gridlines (Phase 3b) — drives the saved overlays and the
  // "accept all" merge target. Null until the user banks the first batch.
  const { gridlines: savedGridlines } = useSheetGridlines(sheetId);
  const upsertGridlines = useUpsertSheetGridlines(sheetId);
  const createLabel = useCreateWorkbenchLabel(sheetId);
  const updateLabel = useUpdateWorkbenchLabel(sheetId);
  const updateOpeningEdges = useUpdateWorkbenchOpeningEdges(sheetId);
  const updateGeometry = useUpdateWorkbenchGeometry(sheetId);
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

  // "Used in this project" recents for the type picker — the sub-types of locations
  // already on this sheet, most-recent first (derived, no new storage).
  const recentSubtypeIds = useMemo(() => recentSubtypeIdsFromUnits(units), [units]);

  // Feed the picker the SHEET's project type (per-drawing, from the Phase-5
  // sidecar) — workbench drawings are heterogeneous, so this is not a project-level type.
  const projectType = asProjectType(drawing.workbench?.sheet_project_type);

  // A completed trace opens the naming popover in CREATE mode (clear any edit
  // target). AI Tracing Assist (Phase 2): read the sheet words that fall INSIDE the
  // polygon, propose a name + taxonomy type, and pre-fill the popover as an editable
  // draft. The geometry stays 100% hand-traced; only the name is assisted. Degrades
  // silently to a blank popover when nothing is suggested.
  const handlePolygonComplete = useCallback(
    (points: PercentPoint[], openingEdges?: OpeningEdge[]) => {
      setEditingLabelId(null);
      setPendingLabelPoints(points);
      // Carry any in-draw opening tags (Phase 4a) into the naming popover so they bank
      // with the room on save (index-aligned with the polygon).
      setPendingOpeningEdges(openingEdges ?? []);
      const suggestion = buildRoomSuggestion(points, sheetWords, subtypes, vocabulary);
      setLabelSuggestion(suggestion);
      setLabelDraftName(suggestion?.unitNumber ?? '');
      setIsLabelNamingOpen(true);
    },
    [
      setEditingLabelId,
      setPendingLabelPoints,
      setPendingOpeningEdges,
      setLabelSuggestion,
      setLabelDraftName,
      setIsLabelNamingOpen,
      sheetWords,
      subtypes,
      vocabulary,
    ],
  );

  // Capture-box tool: the user dragged a box over a region. ROUTED by session —
  // during a gridline session (Phase 3b) the box reads a grid BUBBLE label and
  // advances to the axis step; otherwise it reads the title block (Phase 3a). The
  // live session flag is read from the store to avoid a stale closure. Geometry
  // (the box) is 100% human-drawn; only the field values are proposed.
  const handleCaptureBox = useCallback(
    (rect: { x0: number; y0: number; x1: number; y1: number }) => {
      if (useWorkbenchStore.getState().isGridlineOpen) {
        // Grid bubble read: parse the single short token in the box, freeze it as
        // the proposal, and advance to the axis-line step (capture_line).
        const label = parseBubbleLabel(sheetWords, rect);
        setGridProposal({ label: label ?? '', suggestedLabel: label });
        setToolMode('capture_line');
        return;
      }
      // Title-block read (Phase 3a). Drop back to pan so the next action isn't
      // another accidental box.
      const proposal = parseTitleBlock(sheetWords, rect);
      setTitleBlockBox(rect);
      setTitleBlockProposal(proposal);
      setIsTitleBlockOpen(true);
      setToolMode('pan');
    },
    [sheetWords, setGridProposal, setTitleBlockBox, setTitleBlockProposal, setIsTitleBlockOpen, setToolMode],
  );

  // Capture-line tool (Phase 3b): the user dragged the axis line across a grid line
  // (endpoints already snapped to the detected vectors by the canvas). Combine it
  // with the in-progress bubble proposal, infer the axis from the drag, push a
  // pending grid, and return to the bubble step for the next grid. The proposal is
  // read from the store (live), so a label edited in the panel is honored.
  const handleCaptureLine = useCallback(
    (p1: PercentPoint, p2: PercentPoint) => {
      const wb = useWorkbenchStore.getState();
      if (!wb.isGridlineOpen) return;
      const proposal = wb.gridProposal;
      const pending: PendingGridline = {
        id: crypto.randomUUID(),
        label: proposal?.label ?? '',
        suggestedLabel: proposal?.suggestedLabel ?? null,
        p1,
        p2,
        axis: inferAxis(p1, p2),
      };
      setPendingGridlines((list) => [...list, pending]);
      setGridProposal(null);
      setToolMode('capture_box'); // back to the bubble step for the next grid
    },
    [setPendingGridlines, setGridProposal, setToolMode],
  );

  // "Accept all": merge the pending batch onto whatever's saved (one upsert
  // replaces the whole 1:1 array) and bank with M1 provenance. On success the
  // pending list clears and the saved overlays refresh from the refetch.
  const acceptAllGridlines = useCallback(async () => {
    const wb = useWorkbenchStore.getState();
    const existing = savedGridlines
      ? { gridlines: savedGridlines.gridlines, suggested: savedGridlines.suggested_gridlines ?? [] }
      : null;
    const payload = mapPendingGridlinesToRow(wb.pendingGridlines, existing);
    try {
      await upsertGridlines.mutateAsync(payload);
      setPendingGridlines([]);
      setGridProposal(null);
    } catch {
      // Surfaced inline via the panel's saveError; keep the session open to retry.
    }
  }, [savedGridlines, upsertGridlines, setPendingGridlines, setGridProposal]);

  // ── Manage ALREADY-SAVED grids (Phase 3c follow-up): relabel / reposition /
  // delete. Each maps the whole 1:1 saved array through a pure helper and banks one
  // upsert (reusing the accept-all write hook). Online-first like the rest of the
  // gridline path; errors surface via the panel's saveError.
  const savedForEdit = useCallback(
    () => ({
      gridlines: savedGridlines?.gridlines ?? [],
      suggested: savedGridlines?.suggested_gridlines ?? [],
    }),
    [savedGridlines],
  );

  const relabelSavedGridline = useCallback(
    (index: number, label: string) => {
      upsertGridlines.mutate(updateSavedGridline(savedForEdit(), index, { label }));
    },
    [savedForEdit, upsertGridlines],
  );

  // Drag-to-reposition commit: the canvas hands back snapped endpoints; the helper
  // re-infers the axis from them and keeps the frozen suggested proposal intact.
  const adjustSavedGridline = useCallback(
    (index: number, p1: PercentPoint, p2: PercentPoint) => {
      upsertGridlines.mutate(updateSavedGridline(savedForEdit(), index, { p1, p2 }));
    },
    [savedForEdit, upsertGridlines],
  );

  const deleteSavedGridlineAt = useCallback(
    (index: number) => {
      setSelectedGridlineIndex(null); // indices shift on delete — drop the selection
      upsertGridlines.mutate(deleteSavedGridline(savedForEdit(), index));
    },
    [savedForEdit, upsertGridlines, setSelectedGridlineIndex],
  );

  // Canvas selection (Select tool clicks a saved grid): pick it AND open the panel so
  // relabel/delete are right there. `null` (clicking empty canvas) just deselects.
  const selectSavedGridlineFromCanvas = useCallback(
    (index: number | null) => {
      setSelectedGridlineIndex(index);
      if (index !== null) setIsGridlineOpen(true);
    },
    [setSelectedGridlineIndex, setIsGridlineOpen],
  );

  // End the gridline session (panel ✕). Discards the in-progress proposal + any
  // unaccepted captures (saved grids persist); mirrors the toolbar toggle's close.
  const closeGridlines = useCallback(() => {
    setIsGridlineOpen(false);
    setGridProposal(null);
    setPendingGridlines([]);
    setSelectedGridlineIndex(null);
    setToolMode('pan');
  }, [setIsGridlineOpen, setGridProposal, setPendingGridlines, setSelectedGridlineIndex, setToolMode]);

  // Saved + pending grids drawn on the canvas overlay (display-only). The
  // in-progress proposal (label read, no axis yet) isn't drawn here — the live
  // CaptureLineOverlay shows its line while dragging.
  const gridlineOverlays = useMemo<GridlineOverlayItem[]>(
    () => [
      ...(savedGridlines?.gridlines ?? []).map((g, i) => ({ ...g, kind: 'saved' as const, savedIndex: i })),
      ...pendingGridlines.map((p) => ({
        label: p.label,
        p1: p.p1,
        p2: p.p2,
        axis: p.axis,
        kind: 'pending' as const,
      })),
    ],
    [savedGridlines, pendingGridlines],
  );

  // Confirm: bank the (edited) fields to sheet_metadata with M1 provenance — the
  // frozen proposal decides ai_accepted vs ai_edited (vs human for manual entry).
  const saveTitleBlock = useCallback(
    async (fields: { sheetNumber: string | null; sheetName: string | null; architectFirm: string | null }) => {
      try {
        await upsertMetadata.mutateAsync({ fields, box: titleBlockBox, proposal: titleBlockProposal });
        setIsTitleBlockOpen(false);
        setTitleBlockBox(null);
        setTitleBlockProposal(null);
      } catch {
        // Surfaced inline via the popover's saveError; keep it open to retry.
      }
    },
    [upsertMetadata, titleBlockBox, titleBlockProposal, setIsTitleBlockOpen, setTitleBlockBox, setTitleBlockProposal],
  );

  // Dismiss without saving. No reject is logged: trace_events is room/polygon-
  // shaped, so the title-block tool banks provenance only on a confirmed
  // sheet_metadata row (Phase 3a design point — flagged in the kickoff).
  const cancelTitleBlock = useCallback(() => {
    setIsTitleBlockOpen(false);
    setTitleBlockBox(null);
    setTitleBlockProposal(null);
  }, [setIsTitleBlockOpen, setTitleBlockBox, setTitleBlockProposal]);

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

  // Persist a node move from the "Select / adjust" tool. Without this the canvas's
  // node drag was a no-op write (visual only), so the polygon reverted to its saved
  // shape on the next refetch. Geometry-only + optimistic; the label is untouched.
  const handleUpdateUnitPolygon = useCallback(
    (unitId: string, points: PercentPoint[]) => {
      updateGeometry.mutate({ unitId, points });
    },
    [updateGeometry],
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
    setPendingOpeningEdges([]);
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
    setPendingOpeningEdges,
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
            openingEdges: pendingOpeningEdges,
            ...suggestionProvenance,
          });
        }
        cancelNaming();
      } catch {
        // Surfaced inline via the error banner below; keep the popover open so the
        // labeler can retry without re-tracing.
      }
    },
    [labelDraftName, editingLabelId, pendingLabelPoints, pendingOpeningEdges, labelSuggestion, createLabel, updateLabel, drawing, cancelNaming],
  );

  // ── Opening edges (Phase 4a): derived overlays + the edit-after toggle ──
  // The room whose boundary edges are clickable: a single selected saved room while
  // the openings session is active and the Select tool is in hand.
  const openingEditTarget = useMemo<OpeningEditTarget | null>(() => {
    if (!isOpeningModeOpen || toolMode !== 'select' || selectedUnitIds.length !== 1) return null;
    const unit = units.find((u) => u.id === selectedUnitIds[0]);
    if (!unit || !unit.polygon_coordinates || unit.polygon_coordinates.length < 3) return null;
    return { unitId: unit.id, polygon: unit.polygon_coordinates, edges: unit.opening_edges };
  }, [isOpeningModeOpen, toolMode, selectedUnitIds, units]);

  // Saved rooms' openings to draw (display). The pending (un-named) trace shows its
  // own tags too. The edit-target room is drawn by the overlay's clickable layer, so
  // it's excluded here to avoid double-drawing the same segments.
  const openingOverlays = useMemo<OpeningOverlayUnit[]>(() => {
    const items: OpeningOverlayUnit[] = [];
    for (const u of units) {
      if (u.id === openingEditTarget?.unitId) continue;
      if (!u.opening_edges.length || !u.polygon_coordinates) continue;
      const segments = resolveOpenings(u.polygon_coordinates, u.opening_edges);
      if (segments.length) items.push({ unitId: u.id, segments });
    }
    if (pendingLabelPoints && pendingOpeningEdges.length) {
      const segments = resolveOpenings(pendingLabelPoints, pendingOpeningEdges);
      if (segments.length) items.push({ unitId: 'PENDING', segments });
    }
    return items;
  }, [units, pendingLabelPoints, pendingOpeningEdges, openingEditTarget]);

  // Total tagged passages on the sheet (the panel readout).
  const totalOpenings = useMemo(
    () => units.reduce((sum, u) => sum + u.opening_edges.length, 0),
    [units],
  );

  // Edit-after: click a saved room's boundary edge → toggle it against the active
  // type (set / replace / clear), banked through the openings update hook.
  const toggleOpeningEdgeOnUnit = useCallback(
    (unitId: string, edgeIndex: number) => {
      const unit = units.find((u) => u.id === unitId);
      if (!unit || !unit.polygon_coordinates) return;
      const next = toggleOpeningEdge(unit.opening_edges, edgeIndex, activeOpeningType);
      updateOpeningEdges.mutate({ unitId, openingEdges: next, polygonLength: unit.polygon_coordinates.length });
    },
    [units, activeOpeningType, updateOpeningEdges],
  );

  // Toggle the openings session (toolbar door button + the `O` shortcut). Opening it
  // closes the capture-box sessions (one annotation flow at a time) and drops into the
  // Trace tool — the headline flow is "hold D/C/H/P while tracing"; edit-after just
  // needs the Select tool. Closing returns to Pan. Mirrors the gridline/title toggles.
  const toggleOpenings = useCallback(() => {
    if (isOpeningModeOpen) {
      setIsOpeningModeOpen(false);
      setToolMode('pan');
    } else {
      setIsTitleBlockOpen(false);
      setIsGridlineOpen(false);
      setGridProposal(null);
      setPendingGridlines([]);
      setIsOpeningModeOpen(true);
      setToolMode('draw');
    }
  }, [
    isOpeningModeOpen,
    setIsOpeningModeOpen,
    setToolMode,
    setIsTitleBlockOpen,
    setIsGridlineOpen,
    setGridProposal,
    setPendingGridlines,
  ]);

  // End the openings session (panel ✕) — discards nothing saved.
  const closeOpeningMode = useCallback(() => {
    setIsOpeningModeOpen(false);
    setToolMode('pan');
  }, [setIsOpeningModeOpen, setToolMode]);

  // Keyboard: `O` toggles the openings tool from anywhere on the tracer; while the
  // tool is open, D/C/H/P set the active opening type (for the panel + edit-after
  // click-to-tag — the in-draw "hold to mark" is handled inside the canvas). Ignored
  // while typing in an input and for modifier/auto-repeat keypresses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        toggleOpenings();
        return;
      }
      if (useWorkbenchStore.getState().isOpeningModeOpen) {
        const type = openingTypeForKey(e.key);
        if (type) setActiveOpeningType(type);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleOpenings, setActiveOpeningType]);

  const editingOpeningUnitName = openingEditTarget
    ? units.find((u) => u.id === openingEditTarget.unitId)?.unit_number ?? null
    : null;

  const saveError = createLabel.error ?? updateLabel.error;

  // The AI pre-selection for the popover (CREATE mode only; null when editing or
  // when no type was suggested). The name pre-fill rides on `labelDraftName` above.
  const suggestedPick = labelSuggestion ? suggestionToPick(labelSuggestion) : null;

  return (
    <div className="relative flex-1 min-h-0 h-full">
      <WorkbenchTracerToolbar
        isSnappingLoading={isSnappingLoading}
        confirmedGridCount={savedGridlines?.gridlines.length ?? 0}
        onToggleOpenings={toggleOpenings}
      />

      {/* Saved title-block facts (Phase 3a) — confirms persistence across reloads. */}
      {savedMetadata && (savedMetadata.sheet_number || savedMetadata.architect_firm) && (
        <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 rounded-full border border-violet-200 dark:border-violet-900/50 bg-violet-50/90 dark:bg-violet-950/40 px-3 py-1.5 shadow-sm backdrop-blur-sm text-xs font-semibold text-violet-700 dark:text-violet-300">
          <ScanText size={13} className="shrink-0" />
          <span className="truncate max-w-[16rem]">
            {[savedMetadata.sheet_number, savedMetadata.sheet_name, savedMetadata.architect_firm]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      )}

      <FloorplanCanvas
        activeStatuses={[]}
        rawStatuses={[]}
        imageUrl={drawing.base_image_url ?? ''}
        pdfVersion={drawing.pdf_version ?? null}
        onPolygonComplete={handlePolygonComplete}
        onCaptureBox={handleCaptureBox}
        onCaptureLine={handleCaptureLine}
        gridlineOverlays={gridlineOverlays}
        confirmedGridlines={savedGridlines?.gridlines}
        editableGridlines={isGridlineOpen}
        selectedGridlineIndex={selectedGridlineIndex}
        onAdjustGridline={adjustSavedGridline}
        onSelectGridline={selectSavedGridlineFromCanvas}
        openingCaptureEnabled={isOpeningModeOpen}
        activeOpeningType={activeOpeningType}
        openingOverlays={openingOverlays}
        openingEditTarget={openingEditTarget}
        onToggleOpeningEdge={toggleOpeningEdgeOnUnit}
        pendingPolygonPoints={pendingLabelPoints}
        onPendingPolygonMove={setPendingLabelPoints}
        onRenameUnit={handleRenameUnit}
        onDeleteUnit={handleDeleteUnit}
        onUpdateUnitPolygon={handleUpdateUnitPolygon}
      />

      {isTitleBlockOpen && (
        <TitleBlockPopover
          key={titleBlockBox ? `${titleBlockBox.x0.toFixed(4)}-${titleBlockBox.y0.toFixed(4)}` : 'tb'}
          proposal={titleBlockProposal}
          isSaving={upsertMetadata.isPending}
          saveError={upsertMetadata.error instanceof Error ? upsertMetadata.error.message : null}
          onSave={saveTitleBlock}
          onCancel={cancelTitleBlock}
        />
      )}

      {isGridlineOpen && (
        <GridlinePanel
          proposal={gridProposal}
          pending={pendingGridlines}
          saved={savedGridlines?.gridlines ?? []}
          selectedSavedIndex={selectedGridlineIndex}
          isSaving={upsertGridlines.isPending}
          saveError={upsertGridlines.error instanceof Error ? upsertGridlines.error.message : null}
          onProposalLabelChange={(label) =>
            setGridProposal((p) => (p ? { ...p, label } : p))
          }
          onPendingLabelChange={(id, label) =>
            setPendingGridlines((list) => list.map((g) => (g.id === id ? { ...g, label } : g)))
          }
          onRemovePending={(id) =>
            setPendingGridlines((list) => list.filter((g) => g.id !== id))
          }
          onAcceptAll={acceptAllGridlines}
          onSelectSaved={setSelectedGridlineIndex}
          onRelabelSaved={relabelSavedGridline}
          onDeleteSaved={deleteSavedGridlineAt}
          onClose={closeGridlines}
        />
      )}

      {isOpeningModeOpen && (
        <OpeningModePanel
          activeType={activeOpeningType}
          onActiveTypeChange={setActiveOpeningType}
          totalOpenings={totalOpenings}
          editingUnitName={editingOpeningUnitName}
          onClose={closeOpeningMode}
        />
      )}

      {isLabelNamingOpen && (
        <WorkbenchLabelPopover
          name={labelDraftName}
          setName={setLabelDraftName}
          subtypes={subtypes}
          projectType={projectType}
          existingNames={existingNames}
          editingUnit={editingUnit}
          recentSubtypeIds={recentSubtypeIds}
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
