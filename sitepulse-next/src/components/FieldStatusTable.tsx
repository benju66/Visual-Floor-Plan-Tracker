"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Layers } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useManageStore } from '@/store/useManageStore';
import { useFieldData } from '@/hooks/useFieldData';
import { useMilestones, useAllProjectUnits, useAllProjectStatuses, useUpdateUnitFields, useProjectMembers, useProject } from '@/hooks/useProjectQueries';
import { useSubtypes, useProposePendingSubtype } from '@/hooks/useSubtypes';
import { taxonomyResultToUnitFields, type TaxonomyResult } from '@/utils/subtypes';
import WalkSequenceModal from './WalkSequenceModal';
import dynamic from 'next/dynamic';
import ManageToolbar from './manage/ManageToolbar';
import BulkStatusBar, { CURRENT_MILESTONE, type BulkApplyArgs } from './manage/BulkStatusBar';
import RenameLocationModal from './manage/RenameLocationModal';
import { filterLocations, type LocationRow } from '@/utils/locationFilters';
import { buildBulkStatusChanges } from '@/utils/bulkStatus';
import { deriveBottleneckStatuses } from '@/utils/bottleneck';
import type { Sheet, Unit, Milestone, TemporalState, PendingChangesMap, StatusLog, ProjectType } from '@/types/domain';
import type { ApplicabilityIndex } from '@/utils/applicability';

const MobileSwipeDeck = dynamic(() => import('./MobileSwipeDeck'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-slate-300 border-t-sky-500 rounded-full animate-spin" />
    </div>
  ),
});
import StatusTable from './StatusTable';

// Re-export BottleneckIndicator so any existing consumers of the named export
// from this file don't break during the transition period.
export { BottleneckIndicator } from '@/components/ui/FieldStatusAtoms';

interface FieldStatusTableProps {
  activeStatuses?: any[];
  rawStatuses?: any[];
  savingUnitId?: string | null;
  onChooseStatus?: (unitId: string, milestoneName: string, state: string, track: string) => void;
  onApplyPendingChanges?: (changes: import('@/types/domain').PendingChange[]) => Promise<void>;
  sheets?: Sheet[];
  activeSheetId: string;
  setActiveSheetId: (id: string) => void;
  applicabilityIndex?: ApplicabilityIndex;
  onToggleApplicability?: (unit: Unit, milestone: Milestone, isApplicable: boolean, currentState?: TemporalState | string | null) => void;
  onLocateUnit?: (unitId: string) => void;
  onDeleteUnit?: (unitId: string) => void;
  onDeleteUnits?: (ids: string[]) => void;
}

export default function FieldStatusTable({
  activeStatuses = [],
  rawStatuses = [],
  savingUnitId,
  onChooseStatus,
  onApplyPendingChanges,
  sheets = [],
  activeSheetId,
  setActiveSheetId,
  applicabilityIndex,
  onToggleApplicability,
  onLocateUnit,
  onDeleteUnit,
  onDeleteUnits,
}: FieldStatusTableProps) {
  // --- Zustand store subscriptions (global state — stays in container) ---
  const selectedUnitIds = useMapStore((s) => s.selectedUnitIds);
  const toggleSelectedUnitId = useMapStore((s) => s.toggleSelectedUnitId);
  const setSelectedUnitIds = useMapStore((s) => s.setSelectedUnitIds);
  const clearSelectedUnits = useMapStore((s) => s.clearSelectedUnits);
  const trackingMode = useMapStore((s) => s.trackingMode);
  const setHistoryModalUnitId = useUIStore((s) => s.setHistoryModalUnitId);
  const statusFilter = useSettingsStore((s) => s.filterMilestone);
  const filters = useManageStore((s) => s.filters);
  const setFilters = useManageStore((s) => s.setFilters);
  const scope = useManageStore((s) => s.scope);
  const setScope = useManageStore((s) => s.setScope);

  const params = useParams();
  const projectId = params?.projectId as string;

  // --- Viewport state ---
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Container-level UI state ---
  const [isSequenceModalOpen, setIsSequenceModalOpen] = useState(false);

  // --- All-levels scope: fetch cross-sheet data and derive each unit's current status ---
  const sheetIds = useMemo(() => sheets.map((s) => s.id), [sheets]);
  const { data: allMilestones = [] } = useMilestones(projectId);
  const { data: allUnits = [] } = useAllProjectUnits(scope === 'all' ? sheetIds : []);
  const allUnitIds = useMemo(() => allUnits.map((u) => u.id), [allUnits]);
  const { data: allStatuses = [] } = useAllProjectStatuses(scope === 'all' ? allUnitIds : []);

  const allBottleneck = useMemo(
    () =>
      scope === 'all'
        ? deriveBottleneckStatuses({ units: allUnits, statuses: allStatuses, milestones: allMilestones, trackingMode, applicabilityIndex })
        : [],
    [scope, allUnits, allStatuses, allMilestones, trackingMode, applicabilityIndex]
  );

  // Level scope uses the props from page.jsx (active sheet); all-levels uses the cross-sheet data.
  const effectiveActiveStatuses = scope === 'all' ? (allBottleneck as StatusLog[]) : activeStatuses;
  const effectiveRawStatuses = scope === 'all' ? allStatuses : rawStatuses;
  const unitsOverride = scope === 'all' ? allUnits : undefined;

  const levelByUnitId = useMemo(() => {
    if (scope !== 'all') return undefined;
    const nameById = new Map(sheets.map((s) => [s.id, s.sheet_name]));
    const map: Record<string, string> = {};
    for (const u of allUnits) map[u.id] = (nameById.get(u.sheet_id as string) as string) || '';
    return map;
  }, [scope, allUnits, sheets]);

  // --- Business logic hook ---
  const {
    units,
    projectUnitTypes,
    hasRehydrated,
    currentMilestones,
    visible,
    sortColumn,
    sortDirection,
    handleSort,
    typeFilter,
    setTypeFilter,
    pendingChanges,
    pendingTimelineChanges,
    pendingCount,
    setPendingChanges,
    setPendingTimelineChanges,
    isApplying,
    handleLocalUpdate,
    handleTimelineUpdate,
    handleRemovePendingItem,
    handleDiscardAll,
    handleApplyAll,
  } = useFieldData({ activeStatuses: effectiveActiveStatuses, onApplyPendingChanges, unitsOverride });

  // --- Manage workspace: layer the rich filters over the base (sorted, globally-filtered) list ---
  const rows: LocationRow[] = useMemo(
    () =>
      visible.map((r) => ({
        unit: r.unit,
        log: r.log as LocationRow['log'],
        isBehind: Array.isArray((r.log as any)?.outOfSequence) && (r.log as any).outOfSequence.length > 0,
      })),
    [visible]
  );
  const manageVisible = useMemo(() => filterLocations(rows, filters), [rows, filters]);

  // --- Per-location management (rename / change type) via the existing field mutation ---
  const updateUnitFields = useUpdateUnitFields(activeSheetId);
  const { data: members = [] } = useProjectMembers(projectId);
  const { data: subtypes = [] } = useSubtypes();
  const { data: project } = useProject(projectId);
  const projectType = (project?.project_type as ProjectType | null) ?? null;
  const proposePending = useProposePendingSubtype();
  const [renameUnit, setRenameUnit] = useState<Unit | null>(null);
  // Resolve the taxonomy pick (existing sub-type or an "Other (pending)" proposal)
  // into role/sub-type/unit_type, then persist online via useUpdateUnitFields.
  const onChangeUnitType = async (unitId: string, result: TaxonomyResult) => {
    const updates = await taxonomyResultToUnitFields(result, (vars) => proposePending.mutateAsync(vars));
    updateUnitFields.mutate({ unitId, updates });
  };
  const onAssignUnit = (unitId: string, userId: string | null) =>
    updateUnitFields.mutate({ unitId, updates: { assigned_to: userId } });
  const onBulkAssign = (userId: string | null) => {
    selectedUnitIds.forEach((id) => updateUnitFields.mutate({ unitId: id, updates: { assigned_to: userId } }));
    clearSelectedUnits();
  };
  const onBulkDelete = () => {
    if (selectedUnitIds.length > 0) onDeleteUnits?.(selectedUnitIds);
  };

  // --- Bulk status: stage selected locations through the offline-durable timeline buffer ---
  const handleBulkApply = (args: BulkApplyArgs) => {
    const capturedAt = new Date().toISOString();
    const dateProps = {
      startDate: args.startDate ?? undefined,
      endDate: args.endDate ?? undefined,
      loggedDate: args.loggedDate ?? undefined,
    };
    let changes: PendingChangesMap = {};

    if (args.milestoneName === CURRENT_MILESTONE) {
      // Group selected units by their own current (bottleneck) milestone, then reuse the builder.
      const groups = new Map<string, { milestone: { name: string; color: string; track: string }; ids: string[] }>();
      selectedUnitIds.forEach((id) => {
        const cur = (effectiveActiveStatuses as any[]).find((s) => s.unit_id === id && s.track === trackingMode);
        const mName: string | undefined = cur?.milestone;
        if (!mName) return;
        if (!groups.has(mName)) {
          groups.set(mName, { milestone: { name: mName, color: cur.status_color || '', track: trackingMode }, ids: [] });
        }
        groups.get(mName)!.ids.push(id);
      });
      groups.forEach(({ milestone, ids }) => {
        Object.assign(
          changes,
          buildBulkStatusChanges({ unitIds: ids, units, currentLogs: effectiveRawStatuses, milestone, state: args.state, capturedAt, ...dateProps })
        );
      });
    } else {
      const m = currentMilestones.find((mm) => mm.name === args.milestoneName);
      if (!m) return;
      changes = buildBulkStatusChanges({
        unitIds: selectedUnitIds,
        units,
        currentLogs: effectiveRawStatuses,
        milestone: { name: m.name, color: m.color || '', track: trackingMode },
        state: args.state,
        capturedAt,
        ...dateProps,
      });
    }

    if (Object.keys(changes).length === 0) return;
    setPendingTimelineChanges((prev) => ({ ...prev, ...changes }));
    clearSelectedUnits();
  };

  // --- Empty state guard ---
  if (!units || units.length === 0) {
    return (
      <div
        className="p-8 text-center text-slate-600 rounded-2xl border shadow-lg backdrop-blur-md"
        style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
      >
        {scope === 'all'
          ? 'Loading all levels…'
          : 'No locations mapped on this level yet. Switch to Map view to draw locations.'}
      </div>
    );
  }

  // --- Shared presenter props ---
  const sharedSelectionProps = {
    selectedUnitIds,
    toggleSelectedUnitId,
    setSelectedUnitIds,
    setHistoryModalUnitId,
    onChooseStatus,
  };

  const handleRouteSort = () => {
    if (sortColumn === 'walk_sequence') {
      if (sortDirection === 'asc') handleSort('walk_sequence');
      else handleSort('unit');
    } else handleSort('walk_sequence');
  };

  return (
    <div className="w-full h-full flex flex-col pb-2 md:pb-6">
      {/* ── All-levels banner (unmistakable, so building-wide edits are never accidental) ── */}
      {isDesktop && scope === 'all' && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-500/60 px-3.5 py-2 text-amber-800 dark:text-amber-200 text-sm font-bold shadow-sm">
          <Layers size={16} className="shrink-0" />
          Editing ALL LEVELS — {sheets.length} levels · {allUnits.length} locations. Bulk changes apply across every floor.
        </div>
      )}

      {/* ── Manage toolbar (desktop) ── */}
      {isDesktop && (
        <ManageToolbar
          filters={filters}
          setFilters={setFilters}
          projectUnitTypes={projectUnitTypes}
          milestones={currentMilestones}
          totalCount={rows.length}
          matchingCount={manageVisible.length}
          selectedCount={selectedUnitIds.length}
          onSelectAllMatching={() => setSelectedUnitIds(manageVisible.map((r) => r.unit.id))}
          scope={scope}
          setScope={setScope}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onRouteSort={handleRouteSort}
          onEditRoute={() => setIsSequenceModalOpen(true)}
        />
      )}

      {/* ── View routing ── */}
      {!isDesktop && (
        <MobileSwipeDeck
          visible={visible}
          pendingChanges={pendingChanges}
          pendingTimelineChanges={pendingTimelineChanges}
          setPendingChanges={setPendingChanges}
          setPendingTimelineChanges={setPendingTimelineChanges}
          handleLocalUpdate={handleLocalUpdate}
          handleTimelineUpdate={handleTimelineUpdate}
          handleRemovePendingItem={handleRemovePendingItem}
          handleDiscardAll={handleDiscardAll}
          handleApplyAll={handleApplyAll}
          pendingCount={pendingCount}
          onChooseStatus={onChooseStatus}
          savingUnitId={savingUnitId}
          currentMilestones={currentMilestones}
          rawStatuses={rawStatuses}
          isApplying={isApplying}
          hasRehydrated={hasRehydrated}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          projectUnitTypes={projectUnitTypes}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          handleSort={handleSort}
          onEditRoute={() => setIsSequenceModalOpen(true)}
          sheets={sheets}
          activeSheetId={activeSheetId}
          setActiveSheetId={setActiveSheetId}
          applicabilityIndex={applicabilityIndex}
          onToggleApplicability={onToggleApplicability}
        />
      )}

      {isDesktop && (
        <div className="flex-1 min-h-0 overflow-y-auto pb-6">
          <StatusTable
            visible={manageVisible}
            pendingChanges={pendingChanges}
            handleLocalUpdate={handleLocalUpdate}
            savingUnitId={savingUnitId}
            isApplying={isApplying}
            pendingCount={pendingCount}
            handleDiscardAll={handleDiscardAll}
            handleApplyAll={handleApplyAll}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            handleSort={handleSort}
            handleTimelineUpdate={handleTimelineUpdate}
            rawStatuses={effectiveRawStatuses}
            currentMilestones={currentMilestones}
            pendingTimelineChanges={pendingTimelineChanges}
            trackingMode={trackingMode}
            applicabilityIndex={applicabilityIndex}
            onToggleApplicability={onToggleApplicability}
            levelByUnitId={levelByUnitId}
            subtypes={subtypes}
            projectType={projectType}
            onRenameLocation={(u: Unit) => setRenameUnit(u)}
            onChangeUnitType={onChangeUnitType}
            onLocateUnit={onLocateUnit}
            onDeleteLocation={onDeleteUnit}
            members={members}
            onAssignUnit={onAssignUnit}
            {...sharedSelectionProps}
          />
        </div>
      )}

      {/* Empty filter state */}
      {isDesktop && rows.length > 0 && manageVisible.length === 0 && (
        <p className="mt-4 text-center text-sm text-slate-500">
          No locations match the current filters.
        </p>
      )}
      {!isDesktop && statusFilter && visible.length === 0 && (
        <p className="mt-4 text-center text-sm text-slate-500">
          No locations match this milestone filter.
        </p>
      )}

      {/* ── Bulk status bar (desktop) ── */}
      {isDesktop && (
        <BulkStatusBar
          selectedCount={selectedUnitIds.length}
          matchingCount={manageVisible.length}
          milestones={currentMilestones}
          onApply={handleBulkApply}
          onSelectAllMatching={() => setSelectedUnitIds(manageVisible.map((r) => r.unit.id))}
          onClear={clearSelectedUnits}
          members={members}
          onBulkAssign={onBulkAssign}
          onBulkDelete={onDeleteUnits ? onBulkDelete : undefined}
        />
      )}

      {isSequenceModalOpen && (
        <WalkSequenceModal
          units={units}
          sheetId={activeSheetId}
          onClose={() => setIsSequenceModalOpen(false)}
        />
      )}

      {renameUnit && (
        <RenameLocationModal
          unitNumber={renameUnit.unit_number}
          onClose={() => setRenameUnit(null)}
          onSave={(newName) => {
            updateUnitFields.mutate({ unitId: renameUnit.id, updates: { unit_number: newName } });
            setRenameUnit(null);
          }}
        />
      )}
    </div>
  );
}
