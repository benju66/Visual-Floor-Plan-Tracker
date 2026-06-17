'use client';

import React, { useCallback, useEffect } from 'react';
import { FileWarning } from 'lucide-react';
import FloorplanCanvas from '@/components/FloorplanCanvas';
import UnitNamingPopoverUntyped from '@/components/UnitNamingPopover';
import WorkbenchTracerToolbar from './WorkbenchTracerToolbar';
import { useMapStore } from '@/store/useMapStore';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';
import { useSubtypes } from '@/hooks/useSubtypes';
import { useSnappingVectors } from '@/hooks/useProjectQueries';
import { useCreateWorkbenchLabel } from '@/hooks/useWorkbenchActions';
import { PROJECT_TYPES, type ProjectType } from '@/utils/locationTaxonomy';
import type { TaxonomyResult } from '@/utils/subtypes';
import type { PercentPoint, Subtype, WorkbenchDrawing } from '@/types/domain';

// UnitNamingPopover is an untyped `.jsx`; its prop types would otherwise be
// inferred from its default args (`subtypes = []` → never[], `projectType = null`
// → null), which a `.tsx` consumer can't satisfy. Type it at the boundary so this
// file stays type-clean (AGENTS.md §6) while reusing the component unchanged.
interface UnitNamingPopoverProps {
  editingUnitId: string | null;
  newUnitName: string;
  setNewUnitName: (val: string) => void;
  subtypes: Subtype[];
  projectType: ProjectType | null;
  initialSubtypeId: string | null;
  initialUnitType: string | null;
  saveNewUnitFromPopover: (pick: TaxonomyResult | null) => void;
  cancelUnitNaming: () => void;
}
const UnitNamingPopover = UnitNamingPopoverUntyped as unknown as React.FC<UnitNamingPopoverProps>;

// Location Labeling Workbench — Phase 6 tracing view. Mounts the REUSED,
// unchanged `FloorplanCanvas` on a workbench drawing and wires its
// `onPolygonComplete` to the EXISTING naming popover + taxonomy picker, banking
// labels (`units` rows) under the hidden container via `useCreateWorkbenchLabel`.
// No status / schedule / sync / bulk UI is mounted anywhere here.

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
    };
  }, [sheetId, setActiveSheetId, setToolMode, clearSelectedUnits]);

  const pendingLabelPoints = useWorkbenchStore((s) => s.pendingLabelPoints);
  const setPendingLabelPoints = useWorkbenchStore((s) => s.setPendingLabelPoints);
  const isLabelNamingOpen = useWorkbenchStore((s) => s.isLabelNamingOpen);
  const setIsLabelNamingOpen = useWorkbenchStore((s) => s.setIsLabelNamingOpen);
  const labelDraftName = useWorkbenchStore((s) => s.labelDraftName);
  const setLabelDraftName = useWorkbenchStore((s) => s.setLabelDraftName);

  const { data: subtypes = [] } = useSubtypes();
  const { isFetching: isSnappingLoading } = useSnappingVectors(sheetId);
  const createLabel = useCreateWorkbenchLabel(sheetId);

  // Feed the picker the SHEET's project type (per-drawing, from the Phase-5
  // sidecar) — workbench drawings are heterogeneous, so this is not a project-level type.
  const projectType = asProjectType(drawing.workbench?.sheet_project_type);

  // A completed trace opens the naming popover (same entry point as the live flow).
  const handlePolygonComplete = useCallback(
    (points: PercentPoint[]) => {
      setPendingLabelPoints(points);
      setLabelDraftName('');
      setIsLabelNamingOpen(true);
    },
    [setPendingLabelPoints, setLabelDraftName, setIsLabelNamingOpen],
  );

  const cancelNaming = useCallback(() => {
    setIsLabelNamingOpen(false);
    setPendingLabelPoints(null);
    setLabelDraftName('');
  }, [setIsLabelNamingOpen, setPendingLabelPoints, setLabelDraftName]);

  const saveLabel = useCallback(
    async (pick: TaxonomyResult | null) => {
      const name = labelDraftName.trim();
      if (!name || !pendingLabelPoints || pendingLabelPoints.length < 3) return;
      try {
        await createLabel.mutateAsync({ name, points: pendingLabelPoints, pick, sheet: drawing });
        cancelNaming();
      } catch {
        // Surfaced inline via createLabel.error below; keep the popover open so the
        // labeler can retry without re-tracing.
      }
    },
    [labelDraftName, pendingLabelPoints, createLabel, drawing, cancelNaming],
  );

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
      />

      {isLabelNamingOpen && (
        <UnitNamingPopover
          editingUnitId={null}
          newUnitName={labelDraftName}
          setNewUnitName={setLabelDraftName}
          subtypes={subtypes}
          projectType={projectType}
          initialSubtypeId={null}
          initialUnitType={null}
          saveNewUnitFromPopover={saveLabel}
          cancelUnitNaming={cancelNaming}
        />
      )}

      {createLabel.isError && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-start gap-2 max-w-md rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-4 py-2.5 shadow-lg text-sm text-rose-600 dark:text-rose-300">
          <FileWarning size={16} className="shrink-0 mt-0.5" />
          <span>
            {createLabel.error instanceof Error ? createLabel.error.message : 'Could not save the label. Please try again.'}
          </span>
        </div>
      )}
    </div>
  );
}
