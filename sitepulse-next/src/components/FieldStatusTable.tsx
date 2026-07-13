"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Layers, Flag } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore, useHydratedStore, type ListDensity } from '@/store/useSettingsStore';
import { useManageStore } from '@/store/useManageStore';
import { useFieldData } from '@/hooks/useFieldData';
import { useActivities, useAllProjectUnits, useAllProjectStatuses, useUpdateUnitFields, useProjectMembers, useProject } from '@/hooks/useProjectQueries';
import { useScheduleBaselines } from '@/hooks/useScheduleBaselines';
import { resolveCurrentBaseline, projectDriftSinceBaseline } from '@/utils/scheduleBaseline';
import { varianceCompletedColor } from '@/utils/progressAnalytics';
import { useCompanies } from '@/hooks/useCompanies';
import { useSubtypes, useProposePendingSubtype } from '@/hooks/useSubtypes';
import { taxonomyResultToUnitFields, type TaxonomyResult } from '@/utils/subtypes';
import WalkSequenceModal from './WalkSequenceModal';
import dynamic from 'next/dynamic';
import ManageToolbar from './manage/ManageToolbar';
import BulkStatusBar, { CURRENT_ACTIVITY, type BulkApplyArgs } from './manage/BulkStatusBar';
import RenameLocationModal from './manage/RenameLocationModal';
import { filterLocations, pivotRowsToActivity, type LocationRow } from '@/utils/locationFilters';
import { buildBulkStatusChanges } from '@/utils/bulkStatus';
import { deriveBottleneckStatuses } from '@/utils/bottleneck';
import type { Sheet, Unit, Activity, TemporalState, PendingChangesMap, StatusLog, ProjectType, ActivitySchedules } from '@/types/domain';
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
  onChooseStatus?: (unit: Unit, onSelect: (m: Partial<Activity>) => void) => void;
  onApplyPendingChanges?: (changes: import('@/types/domain').PendingChange[]) => Promise<void>;
  sheets?: Sheet[];
  activeSheetId: string;
  setActiveSheetId: (id: string) => void;
  applicabilityIndex?: ApplicabilityIndex;
  onToggleApplicability?: (unit: Unit, activity: Activity, isApplicable: boolean, currentState?: TemporalState | string | null) => void;
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
  const statusFilter = useSettingsStore((s) => s.filterActivity);
  // Persisted row density (UI Polish P4) — hydrated read to avoid SSR mismatch.
  const listDensity = useHydratedStore<ListDensity>((s) => s.listDensity, 'comfortable');
  const setListDensity = useSettingsStore((s) => s.setListDensity);
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
  const { data: allActivities = [] } = useActivities(projectId);
  const { data: allUnits = [] } = useAllProjectUnits(scope === 'all' ? sheetIds : []);
  const allUnitIds = useMemo(() => allUnits.map((u) => u.id), [allUnits]);
  const { data: allStatuses = [] } = useAllProjectStatuses(scope === 'all' ? allUnitIds : []);

  const allBottleneck = useMemo(
    () =>
      scope === 'all'
        ? deriveBottleneckStatuses({ units: allUnits, statuses: allStatuses, activities: allActivities, trackingMode, applicabilityIndex })
        : [],
    [scope, allUnits, allStatuses, allActivities, trackingMode, applicabilityIndex]
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
    currentActivities,
    ranked,
    visible,
    sortColumn,
    sortDirection,
    handleSort,
    typeFilter,
    setTypeFilter,
    pendingChanges,
    pendingTimelineChanges,
    pendingCount,
    failedCount,
    failedUnitIds,
    failedKeys,
    setPendingChanges,
    setPendingTimelineChanges,
    isApplying,
    handleLocalUpdate,
    handleTimelineUpdate,
    handleRemovePendingItem,
    handleRetryItem,
    handleDiscardAll,
    handleApplyAll,
  } = useFieldData({ activeStatuses: effectiveActiveStatuses, onApplyPendingChanges, unitsOverride });

  // --- Activity focus (pivot) ---
  // Picking an activity in the toolbar no longer hides rows by their *current* (bottleneck)
  // activity. Instead the table pivots EVERY applicable location to that one activity's status
  // — answering "where does everyone stand on <activity>?". Each row's `log` is swapped to the
  // chosen activity's current-state row (or a synthetic "not started" log when none exists yet),
  // so the inline status control, date cells, the N/A toggle, and the edit/commit path all follow
  // automatically. Locations for which the activity is Not Applicable are dropped — it isn't part
  // of their scope. The state-facet chips then apply to the chosen activity, not the bottleneck.
  const focusedActivity = useMemo(
    () => (filters.activities[0] ? currentActivities.find((m) => m.name === filters.activities[0]) ?? null : null),
    [filters.activities, currentActivities]
  );

  // unit_id → that unit's existing current-state row for the focused activity, on the active track.
  const focusedLogByUnit = useMemo(() => {
    if (!focusedActivity) return null;
    const map = new Map<string, StatusLog>();
    for (const log of effectiveRawStatuses as StatusLog[]) {
      if (log.activityName === focusedActivity.name && log.track === trackingMode) map.set(log.unit_id as string, log);
    }
    return map;
  }, [focusedActivity, effectiveRawStatuses, trackingMode]);

  // --- Manage workspace: layer the rich filters over the base (sorted) list ---
  // Build from `ranked` (the full sorted list), NOT `visible` — `visible` has the Map view's
  // activity filter and the mobile type filter already applied, which would silently narrow
  // this desktop table (and, in focus mode, drop the completed locations we want to show). The
  // manage toolbar owns the desktop filters, so they are applied below via `filterLocations`.
  const baseRows: LocationRow[] = useMemo(
    () =>
      ranked.map((r) => ({
        unit: r.unit,
        log: r.log as LocationRow['log'],
        isBehind: Array.isArray((r.log as any)?.outOfSequence) && (r.log as any).outOfSequence.length > 0,
      })),
    [ranked]
  );
  const rows: LocationRow[] = useMemo(
    () =>
      focusedActivity
        ? pivotRowsToActivity(baseRows, focusedActivity, focusedLogByUnit!, trackingMode, applicabilityIndex)
        : baseRows,
    [baseRows, focusedActivity, focusedLogByUnit, trackingMode, applicabilityIndex]
  );

  // In focus mode every remapped row already carries the chosen activity, so the activity facet
  // in `filterLocations` is a no-op — drop it so it can't re-filter the pivot. Other facets stand.
  const manageFilters = useMemo(
    () => (focusedActivity ? { ...filters, activities: [] } : filters),
    [focusedActivity, filters]
  );
  const manageVisible = useMemo(() => filterLocations(rows, manageFilters), [rows, manageFilters]);

  // ── Band vs Promise P4: baseline overlay (display-only) ───────────────────
  // The current baseline (newest, narrowed) + a "Show baseline" overlay toggle.
  // Reuses the shared resolver so the "which baseline?" rule lives in one place.
  const { data: baselines = [] } = useScheduleBaselines(projectId);
  const currentBaseline = useMemo(() => resolveCurrentBaseline(baselines), [baselines]);
  const hasBaseline = !!currentBaseline;
  const [showBaseline, setShowBaseline] = useState(false);
  const showBaselineCols = hasBaseline && showBaseline;

  // Each unit → its sheet id, so a row can read its level's baseline/current
  // window. All-levels scope reads sheet_id off the cross-sheet units; a single
  // sheet's rows all belong to the active sheet.
  const sheetIdByUnitId = useMemo(() => {
    const map: Record<string, string> = {};
    if (scope === 'all') {
      for (const u of allUnits) if (u.sheet_id) map[u.id] = u.sheet_id;
    } else {
      for (const u of units) map[u.id] = activeSheetId;
    }
    return map;
  }, [scope, allUnits, units, activeSheetId]);

  // sheet id → its live Layer-1 windows (`activity_schedules`), so the per-activity
  // "vs baseline" flag compares the level's CURRENT window to its baseline window
  // — the same level-plan-vs-level-plan comparison the MSP importer makes.
  const sheetSchedulesById = useMemo(() => {
    const map: Record<string, ActivitySchedules> = {};
    for (const s of sheets) {
      const sched = s.activity_schedules as ActivitySchedules | null;
      if (sched) map[s.id] = sched;
    }
    return map;
  }, [sheets]);

  // Whole-project current planned finish (Layer 1 — the latest end across every
  // sheet's activity_schedules), paired with the baseline's Layer-1 finish so the
  // top-line drift reads one basis. Fetch-free + scope-independent.
  const currentLevelFinish = useMemo(() => {
    let max: string | null = null;
    for (const s of sheets) {
      const sched = s.activity_schedules as ActivitySchedules | null;
      if (!sched) continue;
      for (const win of Object.values(sched)) {
        const end = win?.end_date ?? null;
        if (end && (max === null || end > max)) max = end;
      }
    }
    return max;
  }, [sheets]);

  const drift = useMemo(
    () => (currentBaseline ? projectDriftSinceBaseline(currentBaseline.snapshot, currentLevelFinish) : { days: null }),
    [currentBaseline, currentLevelFinish]
  );

  // --- Per-location management (rename / change type) via the existing field mutation ---
  const updateUnitFields = useUpdateUnitFields(activeSheetId);
  const { data: members = [] } = useProjectMembers(projectId);
  const { data: companies = [] } = useCompanies();
  // subcontractor_id → company name, for the Owner cell's muted sub line (P3).
  const companyNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of companies) map[c.id] = c.name;
    return map;
  }, [companies]);
  const { data: subtypes = [] } = useSubtypes();
  const { data: project } = useProject(projectId);
  const projectType = (project?.project_type as ProjectType | null) ?? null;
  const proposePending = useProposePendingSubtype();
  const [renameUnit, setRenameUnit] = useState<Unit | null>(null);
  // Resolve the taxonomy pick (existing sub-type or an "Other (pending)" proposal)
  // into role/sub-type/unit_type, then persist online via useUpdateUnitFields.
  // These are online-only writes with no toast surface in the List view; the hook
  // rolls its optimistic edit back on failure, and this per-call onError is the
  // matching message so a visibly-reverting row never fails silently.
  const alertSaveFailed = (what: string) => (err: Error) =>
    window.alert(`Couldn't save the ${what}: ${err.message}. The change was not applied.`);
  const onChangeUnitType = async (unitId: string, result: TaxonomyResult) => {
    const updates = await taxonomyResultToUnitFields(result, (vars) => proposePending.mutateAsync(vars));
    updateUnitFields.mutate({ unitId, updates }, { onError: alertSaveFailed('location type') });
  };
  const onAssignUnit = (unitId: string, userId: string | null) =>
    updateUnitFields.mutate({ unitId, updates: { assigned_to: userId } }, { onError: alertSaveFailed('assignment') });
  const onBulkAssign = (userId: string | null) => {
    selectedUnitIds.forEach((id) => updateUnitFields.mutate({ unitId: id, updates: { assigned_to: userId } }, { onError: alertSaveFailed('assignment') }));
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

    if (args.activityName === CURRENT_ACTIVITY) {
      // Group selected units by their own current (bottleneck) activity, then reuse the builder.
      const groups = new Map<string, { activity: { id: string; name: string; color: string; track: string }; ids: string[] }>();
      selectedUnitIds.forEach((id) => {
        const cur = (effectiveActiveStatuses as any[]).find((s) => s.unit_id === id && s.track === trackingMode);
        const aName: string | undefined = cur?.activityName;
        if (!aName) return;
        if (!groups.has(aName)) {
          groups.set(aName, { activity: { id: cur.activity_id, name: aName, color: cur.status_color || '', track: trackingMode }, ids: [] });
        }
        groups.get(aName)!.ids.push(id);
      });
      groups.forEach(({ activity, ids }) => {
        Object.assign(
          changes,
          buildBulkStatusChanges({ unitIds: ids, units, currentLogs: effectiveRawStatuses, activity, state: args.state, capturedAt, ...dateProps })
        );
      });
    } else {
      const m = currentActivities.find((mm) => mm.name === args.activityName);
      if (!m) return;
      changes = buildBulkStatusChanges({
        unitIds: selectedUnitIds,
        units,
        currentLogs: effectiveRawStatuses,
        activity: { id: m.id, name: m.name, color: m.color || '', track: trackingMode },
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
  // Desktop keeps the ManageToolbar (incl. the This-level/All-levels scope switch) above the
  // message — an empty level must still let you widen scope. Mobile keeps the bare message.
  const isEmpty = !units || units.length === 0;
  const emptyState = isEmpty ? (
    <div
      className="p-8 text-center text-slate-600 rounded-2xl border shadow-lg backdrop-blur-md"
      style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
    >
      {scope === 'all'
        ? 'Loading all levels…'
        : 'No locations mapped on this level yet. Switch to Map view to draw locations.'}
    </div>
  ) : null;
  if (isEmpty && !isDesktop) return emptyState;

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
      {isDesktop && scope === 'all' && !isEmpty && (
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
          activities={currentActivities}
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
          density={listDensity}
          setDensity={setListDensity}
        />
      )}

      {/* Empty level: message below the still-reachable toolbar */}
      {isDesktop && emptyState}

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
          failedCount={failedCount}
          failedKeys={failedKeys}
          handleRetryItem={handleRetryItem}
          onChooseStatus={onChooseStatus}
          savingUnitId={savingUnitId}
          currentActivities={currentActivities}
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

      {/* ── Baseline overlay strip (Band vs Promise P4) — the toggle + the top-line
             "plan drifted ~N days since baseline" read; honest empty state when none ── */}
      {isDesktop && !isEmpty && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
          {hasBaseline ? (
            <>
              <button
                type="button"
                onClick={() => setShowBaseline((v) => !v)}
                aria-pressed={showBaseline}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-semibold transition-colors ${
                  showBaseline
                    ? 'border-slate-700 bg-slate-800 text-white dark:border-white dark:bg-white dark:text-slate-900'
                    : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                }`}
              >
                <Flag size={12} /> {showBaseline ? 'Hide baseline' : 'Show baseline'}
              </button>
              <span className="text-slate-500 dark:text-slate-400">
                Baseline <b className="text-slate-600 dark:text-slate-300">{currentBaseline!.row.name}</b> · captured{' '}
                {new Date(currentBaseline!.row.created_at).toLocaleDateString()}
              </span>
              {showBaseline && drift.days !== null && (
                <span className="font-semibold whitespace-nowrap" style={{ color: varianceCompletedColor(drift.days) }}>
                  ·{' '}
                  {drift.days > 0
                    ? `plan drifted ~${drift.days}d later since baseline`
                    : drift.days < 0
                      ? `plan pulled in ~${Math.abs(drift.days)}d since baseline`
                      : 'plan unchanged since baseline'}
                </span>
              )}
              {showBaseline && drift.days === null && (
                <span className="text-slate-400 dark:text-slate-500">· plan-drift needs level dates on both the baseline and the current plan</span>
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
              <Flag size={12} /> No baseline captured yet — capture one in the Schedule view to compare the plan against its target.
            </span>
          )}
        </div>
      )}

      {isDesktop && !isEmpty && (
        <div className="flex-1 min-h-0 overflow-y-auto pb-6">
          <StatusTable
            visible={manageVisible}
            pendingChanges={pendingChanges}
            handleLocalUpdate={handleLocalUpdate}
            savingUnitId={savingUnitId}
            isApplying={isApplying}
            pendingCount={pendingCount}
            failedCount={failedCount}
            failedUnitIds={failedUnitIds}
            failedKeys={failedKeys}
            handleRetryItem={handleRetryItem}
            handleRemovePendingItem={handleRemovePendingItem}
            handleDiscardAll={handleDiscardAll}
            handleApplyAll={handleApplyAll}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            handleSort={handleSort}
            handleTimelineUpdate={handleTimelineUpdate}
            rawStatuses={effectiveRawStatuses}
            currentActivities={currentActivities}
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
            density={listDensity}
            companyNameById={companyNameById}
            showBaselineCols={showBaselineCols}
            baselineSnapshot={currentBaseline?.snapshot ?? null}
            sheetIdByUnitId={sheetIdByUnitId}
            sheetSchedulesById={sheetSchedulesById}
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
          No locations match this activity filter.
        </p>
      )}

      {/* ── Bulk status bar (desktop) ── */}
      {isDesktop && !isEmpty && (
        <BulkStatusBar
          selectedCount={selectedUnitIds.length}
          matchingCount={manageVisible.length}
          activities={currentActivities}
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
            updateUnitFields.mutate({ unitId: renameUnit.id, updates: { unit_number: newName } }, { onError: alertSaveFailed('new name') });
            setRenameUnit(null);
          }}
        />
      )}
    </div>
  );
}
