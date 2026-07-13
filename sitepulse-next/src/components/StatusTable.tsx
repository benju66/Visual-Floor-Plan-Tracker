"use client";
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, ChevronRight, ChevronDown, AlertTriangle } from 'lucide-react';
import { UpdatingRing } from '@/components/ui/FieldStatusAtoms';
import { type StatusTriggerProps } from '@/components/ui/StatusTrigger';
import LocationRow from './manage/LocationRow';
import { windowPadding, estimateRowHeight } from '@/utils/listWindow';
import { deriveSyncState } from '@/utils/syncStatus';
import { applicableActivities, type ApplicabilityIndex } from '@/utils/applicability';
import { computeUnitVariance, orderedTrackActivities, type VarianceInfo } from '@/utils/progressAnalytics';
import { lastActivityIso } from '@/utils/staleness';
import { useViewportPresence } from '@/hooks/useViewportPresence';
import type { ListDensity } from '@/store/useSettingsStore';
import type { LocationRow as LocationRowData } from '@/utils/locationFilters';
import type { TaxonomyResult } from '@/utils/subtypes';
import type { MemberLike } from './manage/assignee';
import type {
  Unit,
  StatusLog,
  Activity,
  Subtype,
  ProjectType,
  TemporalState,
  TrackingMode,
  PendingChangesMap,
  ScheduleBaselineSnapshot,
  ActivitySchedules,
} from '@/types/domain';

/**
 * A referentially STABLE wrapper around a (possibly changing, possibly undefined)
 * callback. The returned function identity never changes across renders, yet it
 * always invokes the latest `fn`. This is what lets `React.memo(LocationRow)` skip a
 * row whose own data didn't change even when the parent (page / container) hands
 * StatusTable a fresh closure on every render (List View Performance — Phase 3).
 *
 * Presence is preserved by the CALL SITE, not here: for callbacks whose presence
 * gates UI (e.g. the row-actions "Locate"/"Delete" items), pass
 * `source ? stableWrapper : undefined` so a genuinely-absent callback still reads as
 * absent. Since presence is structural (set once by the mount), that ternary's result
 * identity is itself stable across the edit path.
 */
function useStableCallback<A extends unknown[], R>(
  fn: ((...args: A) => R) | undefined,
): (...args: A) => R | undefined {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current?.(...args), []);
}

/**
 * StatusTable — the desktop data table presenter (isDesktop).
 *
 * Owns: lastClickedIndex (Shift+Click multi-select context).
 *       renderSortIcon (Q1 resolution: JSX stays in presenter, not in hook).
 *       allVisibleSelected / toggleSelectAll (derived from props, no store access).
 *       The `<table>`/`<thead>`, the `visible` map, and one `<LocationRow>` per
 *       location (List View Performance — Phase 3: each row is memoized, so an edit
 *       re-renders only the row it touched). StatusTable itself is NOT memoized — it
 *       must re-render on every edit to recompute which row's slice changed — but it
 *       hands each row STABLE callbacks + per-row primitive flags so the memo holds.
 *
 * Props:
 *   visible              — { unit, log }[] from useFieldData (LocationRow shape)
 *   pendingChanges       — object from useFieldData
 *   handleLocalUpdate    — fn from useFieldData
 *   savingUnitId         — string | null from page
 *   isApplying           — boolean from useFieldData
 *   sortColumn           — string from useFieldData
 *   sortDirection        — 'asc' | 'desc' from useFieldData
 *   handleSort           — fn from useFieldData
 *   selectedUnitIds      — string[] from useMapStore (via container)
 *   toggleSelectedUnitId — fn from useMapStore (via container)
 *   setSelectedUnitIds   — fn from useMapStore (via container)
 *   setHistoryModalUnitId — fn from useUIStore (via container)
 *   onChooseStatus       — fn from page
 */
interface StatusTableProps {
  visible: LocationRowData[];
  pendingChanges: PendingChangesMap;
  // The status-update handler shape shared by handleLocalUpdate / handleTimelineUpdate,
  // identical to StatusTrigger's onLocalUpdate contract (both come from useFieldData).
  handleLocalUpdate: StatusTriggerProps['onLocalUpdate'];
  savingUnitId?: string | null;
  isApplying: boolean;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  handleSort: (col: string) => void;
  selectedUnitIds: string[];
  toggleSelectedUnitId: (id: string) => void;
  setSelectedUnitIds: (ids: string[]) => void;
  setHistoryModalUnitId: (id: string) => void;
  onChooseStatus?: StatusTriggerProps['onChooseStatus'];
  pendingCount: number;
  /** Staged changes that failed their last Apply — drives the FAB's red error state
   *  and Retry (Save Visibility — Phase 1). */
  failedCount: number;
  /** Unit ids with at least one failed change, for per-row marking. StatusTable feeds
   *  each row a per-row `isFailed` BOOLEAN (never this Set) to preserve the row memo. */
  failedUnitIds: Set<string>;
  handleDiscardAll: () => void;
  handleApplyAll: () => void | Promise<{ succeeded: number; failed: number }>;
  handleTimelineUpdate: StatusTriggerProps['onLocalUpdate'];
  rawStatuses: StatusLog[];
  currentActivities: Activity[];
  pendingTimelineChanges: PendingChangesMap;
  trackingMode: TrackingMode;
  applicabilityIndex?: ApplicabilityIndex;
  onToggleApplicability?: (
    unit: Unit,
    activity: Activity,
    isApplicable: boolean,
    currentState?: TemporalState | string | null
  ) => void;
  levelByUnitId?: Record<string, string>;
  subtypes: Subtype[];
  projectType: ProjectType | null;
  onRenameLocation?: (unit: Unit) => void;
  onChangeUnitType?: (unitId: string, result: TaxonomyResult) => void;
  onLocateUnit?: (unitId: string) => void;
  onDeleteLocation?: (unitId: string) => void;
  members?: MemberLike[];
  onAssignUnit?: (unitId: string, userId: string | null) => void;
  /** Row density (UI Polish plan, Phase 4). Persisted in useSettingsStore;
   *  the container reads it via useHydratedStore. Default comfortable. */
  density?: ListDensity;
  /** subcontractor_id → company name, for the Owner cell's muted sub line (Data Storytelling P3). */
  companyNameById?: Record<string, string>;
  /** Band vs Promise P4 — when true, render the read-only baseline columns + the
   *  per-activity "vs baseline" flag. Only ever true when `baselineSnapshot` exists. */
  showBaselineCols?: boolean;
  /** The current baseline's frozen plan snapshot (newest, narrowed) — the source
   *  for the baseline columns; null hides them. */
  baselineSnapshot?: ScheduleBaselineSnapshot | null;
  /** unit_id → its sheet id, so each row can read its level's baseline/current window. */
  sheetIdByUnitId?: Record<string, string>;
  /** sheet id → that sheet's live `activity_schedules` (Layer 1), for the "vs baseline" drift. */
  sheetSchedulesById?: Record<string, ActivitySchedules>;
}

export default function StatusTable({
  visible,
  pendingChanges,
  handleLocalUpdate,
  savingUnitId,
  isApplying,
  sortColumn,
  sortDirection,
  handleSort,
  selectedUnitIds,
  toggleSelectedUnitId,
  setSelectedUnitIds,
  setHistoryModalUnitId,
  onChooseStatus,
  pendingCount,
  failedCount,
  failedUnitIds,
  handleDiscardAll,
  handleApplyAll,
  handleTimelineUpdate,
  rawStatuses,
  currentActivities,
  pendingTimelineChanges,
  trackingMode,
  applicabilityIndex,
  onToggleApplicability,
  levelByUnitId,
  subtypes,
  projectType,
  onRenameLocation,
  onChangeUnitType,
  onLocateUnit,
  onDeleteLocation,
  members,
  onAssignUnit,
  density = 'comfortable',
  companyNameById,
  showBaselineCols = false,
  baselineSnapshot = null,
  sheetIdByUnitId,
  sheetSchedulesById,
}: StatusTableProps) {
  // The baseline overlay is only live when the toggle is on AND a baseline exists.
  const baseCols = showBaselineCols && !!baselineSnapshot;
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [expandedUnitIds, setExpandedUnitIds] = useState<Set<string>>(new Set());

  // Viewport-only audit fetching (List View Performance — Phase 2): each expanded
  // location's row is observed, and only those on/near the screen actually run their
  // `useUnitHistory` query. This turns "expand all" from N-simultaneous history
  // requests (the freeze) into a viewport-bounded handful. When IntersectionObserver
  // is unavailable, `supported` is false and every expanded row fetches as before.
  // Phase 3 passes each row a per-row `auditEnabled` boolean derived from this (NOT
  // the `nearIds` Set), so a scroll that flips one row's near-state re-renders only
  // that row — keeping the memo granular.
  const { observeRef, nearIds, supported: viewportSupported } = useViewportPresence();

  // Density-conditional paddings (comfortable keeps today's exact metrics).
  const isCompact = density === 'compact';
  const headPad = isCompact ? 'px-5 py-2' : 'px-5 py-3';
  const cellPad = isCompact ? 'px-5 py-1.5' : 'px-5 py-3';
  const cellPadTight = isCompact ? 'px-5 py-1' : 'px-5 py-2';
  // Frozen identity columns (checkbox + Location) stay put while the wide schedule
  // grid scrolls sideways. Fixed checkbox width (w-12 / !px-3) keeps the Location
  // sticky offset (left-12) aligned; the column backgrounds are passed per row so the
  // frozen cells stay opaque over the scrolling content. Header frozen cells sit above.
  const FZ_CHECK = '!px-3 w-12 sticky left-0';
  const FZ_LOC = 'sticky left-12';

  // Clear expansions when activities change (e.g., track changes)
  useEffect(() => {
    setExpandedUnitIds(new Set());
  }, [currentActivities]);

  // The vertical scroll parent for BOTH the sticky header and the row
  // virtualizer (List View Performance — Phase 4). This presenter's own
  // overflow-auto div is the definite scroll element the sticky <thead> already
  // pins to; react-virtual measures/observes it via getScrollElement.
  const scrollRef = useRef<HTMLDivElement>(null);

  // Measure the sticky header so an expanded location's row can pin flush
  // *underneath* it (top: headerH), not behind it. Measured (not hardcoded) so
  // it stays correct across font-size / browser-zoom changes.
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useLayoutEffect(() => {
    const el = theadRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const logMap = useMemo(() => {
    const map = new Map<string, StatusLog>();
    if (rawStatuses) {
      rawStatuses.forEach(log => {
        map.set(`${log.unit_id}_${log.activityName}`, log);
      });
    }
    return map;
  }, [rawStatuses]);

  // Display-only "now" — stable for this mount so the age + variance derivations
  // memoize (no Date.now() in the pure utils; this is presentation chrome).
  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => today.toISOString(), [today]);

  // Per-unit last-activity ISO (max client_timestamp across ALL the unit's rows,
  // any track) → drives the age chip. Uses already-loaded rawStatuses, no query.
  const staleByUnitId = useMemo(() => {
    const byUnit = new Map<string, StatusLog[]>();
    for (const s of rawStatuses || []) {
      if (!s.unit_id) continue;
      const arr = byUnit.get(s.unit_id);
      if (arr) arr.push(s);
      else byUnit.set(s.unit_id, [s]);
    }
    const out = new Map<string, string | null>();
    byUnit.forEach((logs, uid) => out.set(uid, lastActivityIso(logs)));
    return out;
  }, [rawStatuses]);

  // Per-unit schedule variance (bottleneck-based, applicability-respecting) →
  // drives the days-behind number. Reuses the single-source-of-truth pace math.
  const varianceByUnitId = useMemo(() => {
    const trackActs = orderedTrackActivities(currentActivities || [], trackingMode);
    const byUnit = new Map<string, StatusLog[]>();
    for (const s of rawStatuses || []) {
      if (!s.unit_id || s.track !== trackingMode) continue;
      const arr = byUnit.get(s.unit_id);
      if (arr) arr.push(s);
      else byUnit.set(s.unit_id, [s]);
    }
    const out = new Map<string, VarianceInfo>();
    for (const { unit } of visible) {
      if (out.has(unit.id)) continue;
      const appActs = applicabilityIndex
        ? applicableActivities(trackActs, unit, applicabilityIndex)
        : trackActs;
      out.set(unit.id, computeUnitVariance(byUnit.get(unit.id) || [], appActs, today));
    }
    return out;
  }, [visible, rawStatuses, currentActivities, trackingMode, applicabilityIndex, today]);

  // Each unit's slice of `pendingTimelineChanges` (keys `${unit.id}_${activityName}`),
  // so a memoized row receives only ITS staged per-activity edits — not the whole map,
  // whose identity changes on every timeline edit and would re-render all rows. Units
  // with no staged timeline edits get `undefined` here (a stable value every render),
  // so collapsed/unstaged rows never re-render on someone else's child edit. (Unit ids
  // are UUIDs with no `_`, so splitting on the first `_` matches how the key is built —
  // the same convention handleRemovePendingItem uses.)
  const pendingTimelineByUnit = useMemo(() => {
    const map = new Map<string, PendingChangesMap>();
    for (const key of Object.keys(pendingTimelineChanges)) {
      const sep = key.indexOf('_');
      const unitId = sep >= 0 ? key.slice(0, sep) : key;
      let slice = map.get(unitId);
      if (!slice) { slice = {}; map.set(unitId, slice); }
      slice[key] = pendingTimelineChanges[key];
    }
    return map;
  }, [pendingTimelineChanges]);

  const isAllExpanded = expandedUnitIds.size === visible.length && visible.length > 0;

  const toggleExpandAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAllExpanded) {
      setExpandedUnitIds(new Set());
    } else {
      const allIds = new Set(visible.map(r => r.unit.id));
      setExpandedUnitIds(allIds);
    }
  };

  // Stable per-row expand toggle (functional setState → no dependency on current
  // state), safe to pass through the memoized row.
  const onToggleExpanded = useCallback((e: React.MouseEvent, unitId: string) => {
    e.stopPropagation();
    setExpandedUnitIds(prev => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }, []);

  // Q1 resolution: renderSortIcon lives here, not in the hook (no JSX from hooks)
  const renderSortIcon = (col: string) => {
    if (sortColumn !== col) return null;
    return sortDirection === 'asc'
      ? <ArrowUp size={14} className="inline-block ml-1" />
      : <ArrowDown size={14} className="inline-block ml-1" />;
  };

  // Row-click (incl. Shift+Click range) needs the LIVE selection / list / anchor, but
  // must keep a stable identity so it doesn't defeat the row memo. Read the volatile
  // bits from a ref that's refreshed each render; the setters are stable.
  const rowClickCtx = useRef<{ selectedUnitIds: string[]; visible: LocationRowData[]; lastClickedIndex: number | null }>({
    selectedUnitIds, visible, lastClickedIndex,
  });
  rowClickCtx.current = { selectedUnitIds, visible, lastClickedIndex };

  const onRowClick = useCallback((e: React.MouseEvent, unitId: string, index: number) => {
    const { selectedUnitIds, visible, lastClickedIndex } = rowClickCtx.current;
    if (e.shiftKey && lastClickedIndex !== null) {
      const start = Math.min(lastClickedIndex, index);
      const end = Math.max(lastClickedIndex, index);
      const idsToSelect = visible.slice(start, end + 1).map((r) => r.unit.id);
      const newSelected = new Set(selectedUnitIds);
      idsToSelect.forEach((id) => newSelected.add(id));
      setSelectedUnitIds(Array.from(newSelected));
    } else {
      toggleSelectedUnitId(unitId);
    }
    setLastClickedIndex(index);
  }, [setSelectedUnitIds, toggleSelectedUnitId]);

  const allVisibleSelected =
    visible.length > 0 && visible.every((r) => selectedUnitIds.includes(r.unit.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedUnitIds(selectedUnitIds.filter((id) => !visible.find((r) => r.unit.id === id)));
    } else {
      const newSelected = new Set(selectedUnitIds);
      visible.forEach((r) => newSelected.add(r.unit.id));
      setSelectedUnitIds(Array.from(newSelected));
    }
  };

  // Stabilize the callbacks that flow into every memoized row. Identity is fixed for
  // the component's life; each wrapper always calls the latest prop. Presence-gated
  // ones (Locate / Delete / N/A toggle) keep their "is it provided?" signal via the
  // `source ? … : undefined` guard so absent callbacks still read as absent.
  const stableChooseStatus = useStableCallback(onChooseStatus);
  const stableRename = useStableCallback(onRenameLocation);
  const stableChangeType = useStableCallback(onChangeUnitType);
  const stableAssign = useStableCallback(onAssignUnit);
  const stableToggleApplicability = useStableCallback(onToggleApplicability);
  const stableLocate = useStableCallback(onLocateUnit);
  const stableDelete = useStableCallback(onDeleteLocation);
  const rowToggleApplicability = onToggleApplicability ? stableToggleApplicability : undefined;
  const rowLocate = onLocateUnit ? stableLocate : undefined;
  const rowDelete = onDeleteLocation ? stableDelete : undefined;

  // ── Row virtualization (List View Performance — Phase 4) ──────────────────
  // Only the location <tbody> blocks near the viewport mount; two empty spacer
  // <tbody>s size the scroll range for the off-screen blocks. Route (a): keep
  // the real <table>, sticky <thead>, and frozen sticky-left columns exactly as
  // they are. Each block is VARIABLE height (1 row collapsed → 1 + N expanded),
  // so we let react-virtual measure each mounted block (measureElement) rather
  // than assume a fixed height — the estimate only seeds first paint. getItemKey
  // keys measurements by unit.id so they follow a row through sort/filter.
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight(isCompact ? 'compact' : 'comfortable'),
    getItemKey: (index) => visible[index]?.unit.id ?? index,
    overscan: 8,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const { paddingTop, paddingBottom } = windowPadding(virtualItems, rowVirtualizer.getTotalSize());
  // Stable wrapper around the virtualizer's measure ref-callback so a memoized
  // LocationRow never re-renders just because we hand it the measurer; the
  // wrapper still forwards the element (with its data-index) for measurement.
  const measureRow = useStableCallback(rowVirtualizer.measureElement);
  // Column count for the spacer rows' colSpan (baseline overlay adds 3 columns).
  const colCount = baseCols ? 17 : 14;

  // The pending FAB's sync state (Save Visibility — Phase 1). The FAB only mounts when
  // something is queued (pendingCount > 0), and a failed item stays queued, so
  // failedCount > 0 ⟹ pendingCount > 0 — the bar is always present to surface it, and
  // hasRehydrated is implicitly true by the time this desktop table renders rows.
  const fabState = deriveSyncState({ hasRehydrated: true, isApplying, pendingCount, failedCount });
  const hasFailed = fabState === 'error';

  return (
    <>
      <div ref={scrollRef} className="w-full h-full overflow-auto rounded-xl border border-slate-300 dark:border-white/10 bg-white dark:bg-black/15 shadow-sm relative">
      <table className={`w-full text-left border-collapse ${isCompact ? 'text-xs' : 'text-sm'} text-slate-800 dark:text-slate-200 relative`}>
        <thead ref={theadRef} className="sticky top-0 z-20 bg-white dark:bg-slate-900 shadow-sm after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-slate-300 dark:after:border-white/10">
          <tr>
            <th className={`${headPad} ${FZ_CHECK} z-30 bg-white dark:bg-slate-900`}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
              />
            </th>
            <th
              onClick={() => handleSort('unit')}
              className={`${headPad} ${FZ_LOC} z-30 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-white/10 font-semibold text-slate-900 dark:text-slate-100 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleExpandAll}
                  className="p-0.5 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  {isAllExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                Location {renderSortIcon('unit')}
              </div>
            </th>
            <th
              onClick={() => handleSort('unit_type')}
              className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors`}
            >
              Type / Assignee {renderSortIcon('unit_type')}
            </th>
            <th
              onClick={() => handleSort('status')}
              className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 min-w-[200px] cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors`}
            >
              Activity &amp; Status {renderSortIcon('status')}
            </th>
            <th className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap`}>Planned Start</th>
            <th className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap`}>Planned Completion</th>
            {baseCols && (
              <>
                <th className={`${headPad} font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap bg-slate-50 dark:bg-white/[0.03]`} title="The planned start this activity's level had when the baseline was captured">Baseline Start</th>
                <th className={`${headPad} font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap bg-slate-50 dark:bg-white/[0.03]`} title="The planned finish this activity's level had when the baseline was captured">Baseline End</th>
                <th className={`${headPad} font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap text-right bg-slate-50 dark:bg-white/[0.03]`} title="How the current level plan for this activity has drifted since the baseline">vs Baseline</th>
              </>
            )}
            <th className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap text-right`}>Planned Duration</th>
            <th className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap`}>Actual Start</th>
            <th
              onClick={() => handleSort('updated')}
              className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 select-none transition-colors`}
            >
              Actual Completion {renderSortIcon('updated')}
            </th>
            <th className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap text-right`}>Actual Duration</th>
            <th className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap text-right`}>Start Var.</th>
            <th className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap text-right`}>Finish Var.</th>
            <th className={`${headPad} font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap text-right`}>Duration Var.</th>
            <th className={`${headPad} w-10`} />
          </tr>
        </thead>
        {/* Top spacer — the collapsed height of every block scrolled off the top,
            so the scrollbar/geometry match the full list (route (a): the real
            <table> is preserved; only on-screen <tbody> blocks mount). */}
        <tbody aria-hidden="true">
          <tr><td colSpan={colCount} style={{ height: paddingTop, padding: 0, border: 0 }} /></tr>
        </tbody>
        {virtualItems.map((vItem) => {
          const rowData = visible[vItem.index];
          if (!rowData) return null;
          const { unit, log } = rowData;
          // Per-row derivations are cheap lookups; the expensive cell rendering lives
          // inside the memoized <LocationRow>, which skips re-render when these props
          // are referentially unchanged. Pass per-row PRIMITIVES / SLICES (never the
          // shared pendingChanges / selectedUnitIds / nearIds objects) so an edit,
          // selection, scroll, or save re-renders only the row it actually touched.
          // `index` is the absolute position in `visible` (vItem.index) so Shift+Click
          // range selection still spans blocks that are currently off-screen.
          const rowSheetId = sheetIdByUnitId?.[unit.id];
          const rowLevelSchedule = rowSheetId ? sheetSchedulesById?.[rowSheetId] : undefined;
          return (
            <LocationRow
              key={unit.id}
              unit={unit}
              log={log}
              index={vItem.index}
              measureRef={measureRow}
              pendingChange={pendingChanges[unit.id]}
              pendingTimelineForUnit={pendingTimelineByUnit.get(unit.id)}
              isSelected={selectedUnitIds.includes(unit.id)}
              isExpanded={expandedUnitIds.has(unit.id)}
              isSaving={savingUnitId === unit.id}
              isFailed={failedUnitIds.has(unit.id)}
              auditEnabled={!viewportSupported || nearIds.has(unit.id)}
              isApplying={isApplying}
              currentActivities={currentActivities}
              trackingMode={trackingMode}
              logMap={logMap}
              todayIso={todayIso}
              applicabilityIndex={applicabilityIndex}
              variance={varianceByUnitId.get(unit.id)}
              lastIso={staleByUnitId.get(unit.id) ?? null}
              levelLabel={levelByUnitId?.[unit.id]}
              companyNameById={companyNameById}
              subtypes={subtypes}
              projectType={projectType}
              members={members}
              baseCols={baseCols}
              baselineSnapshot={baselineSnapshot}
              rowSheetId={rowSheetId}
              rowLevelSchedule={rowLevelSchedule}
              headerH={headerH}
              cellPad={cellPad}
              cellPadTight={cellPadTight}
              frozenCheckClass={FZ_CHECK}
              frozenLocClass={FZ_LOC}
              observeRef={observeRef}
              onRowClick={onRowClick}
              onToggleExpanded={onToggleExpanded}
              handleLocalUpdate={handleLocalUpdate}
              handleTimelineUpdate={handleTimelineUpdate}
              onChooseStatus={stableChooseStatus}
              onToggleApplicability={rowToggleApplicability}
              onRenameLocation={stableRename}
              onChangeUnitType={stableChangeType}
              onLocateUnit={rowLocate}
              onDeleteLocation={rowDelete}
              onAssignUnit={stableAssign}
              setHistoryModalUnitId={setHistoryModalUnitId}
            />
          );
        })}
        {/* Bottom spacer — the collapsed height of every block below the window. */}
        <tbody aria-hidden="true">
          <tr><td colSpan={colCount} style={{ height: paddingBottom, padding: 0, border: 0 }} /></tr>
        </tbody>
      </table>
      </div>

      {/* Desktop FAB for Pending Changes — turns red + relabels to Retry when a save
          failed (Save Visibility — Phase 1), so a failure is never hidden inside the
          plain "N pending" count. Retry re-runs Apply over everything still queued. */}
      <AnimatePresence>
        {pendingCount > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-6 right-6 z-50 flex justify-center pointer-events-none"
          >
            <div
              className={`p-3 rounded-full shadow-2xl flex items-center gap-4 pointer-events-auto border text-white ${
                hasFailed
                  ? 'bg-red-600 dark:bg-red-700 border-red-500 dark:border-red-600'
                  : 'bg-slate-900 dark:bg-slate-800 border-slate-700 dark:border-slate-600'
              }`}
            >
              <span className="text-sm font-bold ml-2 flex items-center gap-2">
                {hasFailed ? (
                  <>
                    <AlertTriangle size={16} className="shrink-0" />
                    {failedCount} failed to save
                  </>
                ) : (
                  `${pendingCount} pending`
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDiscardAll}
                  disabled={isApplying}
                  className={`px-4 py-2 text-xs font-bold rounded-full transition-colors disabled:opacity-50 ${
                    hasFailed
                      ? 'text-red-100 hover:text-white hover:bg-red-700 dark:hover:bg-red-800'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-700'
                  }`}
                >
                  Discard
                </button>
                <button
                  onClick={() => { handleApplyAll(); }}
                  disabled={isApplying}
                  className={`px-5 py-2 text-xs font-bold rounded-full transition-colors shadow-md disabled:opacity-50 flex items-center gap-2 ${
                    hasFailed
                      ? 'bg-white text-red-700 hover:bg-red-50'
                      : 'bg-amber-500 hover:bg-amber-400 text-amber-950'
                  }`}
                >
                  {isApplying ? <UpdatingRing /> : hasFailed ? 'Retry' : 'Apply'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
