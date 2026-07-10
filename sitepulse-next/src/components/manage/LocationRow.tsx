"use client";
import React from 'react';
import { ChevronRight, ChevronDown, Ban, RotateCcw } from 'lucide-react';
import { BottleneckIndicator, UpdatingRing, getTemporalStateStyle, StatusSegments } from '@/components/ui/FieldStatusAtoms';
import StatusTrigger, { type StatusTriggerProps } from '@/components/ui/StatusTrigger';
import RowActionsMenu from './RowActionsMenu';
import AssigneeCell from './AssigneeCell';
import ExpandedActivityAudit from './ExpandedActivityAudit';
import { isActivityApplicable, type ApplicabilityIndex } from '@/utils/applicability';
import { activitySchedule, resolveActualStartIso, varianceCompletedColor, varianceFill, varianceLabel, type VarianceInfo, type AuditEventLike } from '@/utils/progressAnalytics';
import { baselineSlotWindow, baselineDelta, type BaselineDelta } from '@/utils/scheduleBaseline';
import { formatAge } from '@/utils/staleness';
import type { TaxonomyResult } from '@/utils/subtypes';
import type { LocationRow as LocationRowData } from '@/utils/locationFilters';
import type { MemberLike } from './assignee';
import type {
  Unit,
  StatusLog,
  Activity,
  Subtype,
  ProjectType,
  TemporalState,
  TrackingMode,
  PendingChange,
  PendingChangesMap,
  ScheduleBaselineSnapshot,
  ActivitySchedules,
} from '@/types/domain';

/**
 * DateInputCell — an always-visible native date box with the browser's calendar
 * picker (matching the app's other date inputs, e.g. QuickStatusModal), used for
 * the schedule grid's editable date columns (Schedule Variance Columns — owner
 * asked for real date boxes, not the quiet click-to-edit chips). Pending
 * (unapplied) edits get the amber treatment; `completedTone` tints the value
 * emerald for the Actual Completion column.
 */
function DateInputCell({
  value, pending, disabled, onChange, ariaLabel, completedTone, stopClickPropagation,
}: {
  value: string;
  pending: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  ariaLabel: string;
  completedTone?: boolean;
  stopClickPropagation?: boolean;
}) {
  return (
    <input
      type="date"
      value={value}
      onClick={stopClickPropagation ? (e) => e.stopPropagation() : undefined}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`bg-white dark:bg-black/20 border rounded-md px-2 py-1 text-xs font-medium w-[132px] outline-none transition-colors focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 ${
        pending
          ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400'
          : `border-slate-300 dark:border-white/15 hover:border-slate-400 dark:hover:border-white/25 ${
              completedTone ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'
            }`
      }`}
    />
  );
}

/** A read-only duration cell — "13d" (or "13d →" while counting to today); blank when null. */
function DurationCell({ days, ongoing }: { days: number | null; ongoing?: boolean }) {
  if (days === null) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  return <span className="tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">{days}d{ongoing ? ' →' : ''}</span>;
}

/** A read-only signed-variance cell, colored off the existing lag scale; blank when null. */
function VarianceCell({ days, pos, neg, zero }: { days: number | null; pos: string; neg: string; zero: string }) {
  if (days === null) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  const label = days > 0 ? `${days}d ${pos}` : days < 0 ? `${Math.abs(days)}d ${neg}` : zero;
  return (
    <span className="tabular-nums font-semibold whitespace-nowrap" style={{ color: varianceCompletedColor(days) }}>
      {label}
    </span>
  );
}

/** A read-only frozen baseline date — muted (it's a snapshot, not editable); blank when null. */
function BaselineDateCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  return <span className="tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap text-xs">{value}</span>;
}

/**
 * The per-activity "vs baseline" flag — reuses the MSP importer's wording
 * (`= baseline` / `new` / `±Nd`) and the existing lag palette
 * (`varianceCompletedColor`: later = the behind ramp, earlier = emerald). Blank
 * when there's nothing to compare (the activity isn't in the level plan at all).
 */
function BaselineFlagCell({ delta }: { delta: BaselineDelta | null }) {
  if (!delta) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  if (delta.kind === 'unchanged') {
    return <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">= baseline</span>;
  }
  if (delta.kind === 'new') {
    return <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400 whitespace-nowrap">new</span>;
  }
  const days = delta.endShiftDays ?? delta.startShiftDays;
  const label = days == null ? 'moved' : days > 0 ? `+${days}d` : `${days}d`;
  return (
    <span className="tabular-nums text-[11px] font-bold whitespace-nowrap" style={{ color: varianceCompletedColor(days ?? 0) }}>
      {label}
    </span>
  );
}

/**
 * The baseline overlay for one level × activity slot (Band vs Promise P4): the
 * frozen level window it shows + how the CURRENT level window has drifted from
 * it. Level-plan-vs-level-plan (Layer 1) via the shared `baselineSlotWindow` /
 * `baselineDelta` math — the same comparison the importer makes, so it never
 * cries wolf on subdivided plans. Returns null (→ blank cells) when the activity
 * isn't in the level plan on either the baseline or the current side.
 */
function computeBaselineForSlot(
  snapshot: ScheduleBaselineSnapshot,
  sheetId: string | undefined,
  activityName: string | null | undefined,
  levelSchedule: ActivitySchedules | undefined
): { win: { start: string | null; end: string | null } | null; delta: BaselineDelta } | null {
  if (!sheetId || !activityName) return null;
  const win = baselineSlotWindow(snapshot, sheetId, activityName);
  const cur = levelSchedule?.[activityName];
  const hasCur = !!(cur && (cur.start_date || cur.end_date));
  if (!win && !hasCur) return null;
  const delta = baselineDelta(snapshot, sheetId, activityName, cur?.start_date ?? null, cur?.end_date ?? null);
  return { win, delta };
}

/**
 * The per-activity schedule story for one row (Planned/Actual Duration + the three
 * signed variances), from pending-aware dates + the trusted actual-start. `events`
 * (a location's audit rows) supply the "ongoing" actual-start fallback on expanded
 * rows; the location row passes none, so it uses the ENTERED actual-start only (no
 * level-wide audit prefetch). Finish variance is gated on completion; ongoing actual
 * duration counts to `todayIso`. Reuses the pure progressAnalytics helpers.
 */
function deriveSchedule(opts: {
  plannedStart: string | null;
  plannedEnd: string | null;
  enteredStart: string | null;
  loggedDate: string | null;
  state: string;
  events?: AuditEventLike[];
  todayIso: string;
}) {
  const actualStartIso = resolveActualStartIso(opts.events || [], { enteredStart: opts.enteredStart });
  const actualEndIso = opts.state === 'completed'
    ? opts.loggedDate
    : opts.state === 'ongoing' && actualStartIso ? opts.todayIso : null;
  const m = activitySchedule({
    plannedStart: opts.plannedStart,
    plannedEnd: opts.plannedEnd,
    actualStart: actualStartIso,
    actualEnd: actualEndIso,
  });
  return {
    plannedDuration: m.plannedDuration,
    actualDuration: m.actualDuration,
    varianceStart: m.varianceStart,
    varianceDuration: m.varianceDuration,
    // Finish variance only reads once the slot is actually completed (an ongoing
    // slot's end is today, which must not surface as "finished N late").
    varianceCompleted: opts.state === 'completed' ? m.varianceCompleted : null,
    ongoing: opts.state === 'ongoing',
    actualStartIso,
  };
}

/**
 * LocationRow — one location's `<tbody>` block (the parent grid row + its expanded
 * per-activity children incl. the viewport-gated `ExpandedActivityAudit`), extracted
 * from `StatusTable` and wrapped in `React.memo` (List View Performance — Phase 3).
 *
 * The whole point is re-render scope: an edit to one row (or a status/date keystroke)
 * updates only that row's `pendingChange` / `pendingTimelineForUnit` slice, so a
 * memoized row whose own slice + inputs are referentially unchanged skips re-render
 * entirely. That is what makes editing feel instant at hundreds of rows. For the memo
 * to hold, `StatusTable` must feed this row STABLE callback identities and per-row
 * PRIMITIVE flags (never the whole `pendingChanges`/`selectedUnitIds`/`nearIds`
 * objects, which change identity on every edit/scroll and would re-render all rows):
 *   • `isSelected` / `isExpanded` / `isSaving` — derived booleans, not the shared sets
 *   • `auditEnabled` — the per-row Phase-2 near-viewport boolean (NOT the `nearIds` Set)
 *   • `pendingChange` / `pendingTimelineForUnit` — this unit's slices only
 *   • `observeRef` — the stable per-id ref callback from `useViewportPresence`
 *
 * Presentation only — no business logic, no store access (Container/Presenter split,
 * AGENTS.md §3). It renders exactly what `StatusTable` used to render inline; this is
 * a re-render-scope refactor, not a visual change.
 */
export interface LocationRowProps {
  unit: Unit;
  log: LocationRowData['log'];
  index: number;
  /** This unit's primary staged edit (`pendingChanges[unit.id]`), or undefined. */
  pendingChange?: PendingChange;
  /** This unit's staged per-activity edits, keyed `${unit.id}_${activityName}` — its
   *  slice of `pendingTimelineChanges` (undefined when the unit has none). */
  pendingTimelineForUnit?: PendingChangesMap;
  isSelected: boolean;
  isExpanded: boolean;
  isSaving: boolean;
  /** Phase-2 near-viewport gate for this row's audit fetch (fail-open when the
   *  parent's IntersectionObserver is unavailable). A boolean, so a scroll that
   *  flips one row's near-state re-renders only that row, not the whole table. */
  auditEnabled: boolean;
  isApplying: boolean;

  // Shared, referentially-stable table context (memoized / primitive in StatusTable).
  currentActivities: Activity[];
  trackingMode: TrackingMode;
  logMap: Map<string, StatusLog>;
  todayIso: string;
  applicabilityIndex?: ApplicabilityIndex;
  variance?: VarianceInfo;
  lastIso: string | null;
  levelLabel?: string;
  companyNameById?: Record<string, string>;
  subtypes: Subtype[];
  projectType: ProjectType | null;
  members?: MemberLike[];

  // Baseline overlay (Band vs Promise P4) — resolved per row in StatusTable.
  baseCols: boolean;
  baselineSnapshot?: ScheduleBaselineSnapshot | null;
  rowSheetId?: string;
  rowLevelSchedule?: ActivitySchedules;

  // Layout — measured header height (for the expanded row's sticky pin) + density.
  headerH: number;
  cellPad: string;
  cellPadTight: string;
  frozenCheckClass: string;
  frozenLocClass: string;

  // Stable ref callback (from useViewportPresence) — safe through memo.
  observeRef: (id: string) => (el: HTMLElement | null) => void;

  // Stable callbacks (identity fixed across renders by StatusTable).
  onRowClick: (e: React.MouseEvent, unitId: string, index: number) => void;
  onToggleExpanded: (e: React.MouseEvent, unitId: string) => void;
  handleLocalUpdate: StatusTriggerProps['onLocalUpdate'];
  handleTimelineUpdate: StatusTriggerProps['onLocalUpdate'];
  onChooseStatus?: StatusTriggerProps['onChooseStatus'];
  onToggleApplicability?: (
    unit: Unit,
    activity: Activity,
    isApplicable: boolean,
    currentState?: TemporalState | string | null
  ) => void;
  onRenameLocation?: (unit: Unit) => void;
  onChangeUnitType?: (unitId: string, result: TaxonomyResult) => void;
  onLocateUnit?: (unitId: string) => void;
  onDeleteLocation?: (unitId: string) => void;
  onAssignUnit?: (unitId: string, userId: string | null) => void;
  setHistoryModalUnitId: (id: string) => void;
}

function LocationRowInner({
  unit,
  log,
  index,
  pendingChange,
  pendingTimelineForUnit,
  isSelected,
  isExpanded,
  isSaving,
  auditEnabled,
  isApplying,
  currentActivities,
  trackingMode,
  logMap,
  todayIso,
  applicabilityIndex,
  variance,
  lastIso,
  levelLabel,
  companyNameById,
  subtypes,
  projectType,
  members,
  baseCols,
  baselineSnapshot = null,
  rowSheetId,
  rowLevelSchedule,
  headerH,
  cellPad,
  cellPadTight,
  frozenCheckClass: FZ_CHECK,
  frozenLocClass: FZ_LOC,
  observeRef,
  onRowClick,
  onToggleExpanded,
  handleLocalUpdate,
  handleTimelineUpdate,
  onChooseStatus,
  onToggleApplicability,
  onRenameLocation,
  onChangeUnitType,
  onLocateUnit,
  onDeleteLocation,
  onAssignUnit,
  setHistoryModalUnitId,
}: LocationRowProps) {
  const pending = pendingChange;
  // Spreading a possibly-null `log` yields optional props, so annotate the result:
  // when `log` is null the branch is a partial `{ temporal_state }`, which StatusTrigger
  // tolerates (it re-spreads baseLog) — same runtime shape as the original .jsx.
  const dLog: StatusLog | null = pending ? ({ ...log, temporal_state: pending.state } as StatusLog) : log;
  // The location's active/current activity is shown inline in this row (it is skipped
  // in the expanded child list below), so its N/A toggle has to live here too — otherwise
  // the current task is the one activity that can never be marked Not Applicable from
  // the table. Resolve the activity object so onToggleApplicability gets its id.
  const activeActivity = log?.activityName
    ? currentActivities?.find((m) => m.name === log.activityName)
    : null;

  // Data Storytelling P3 — the three at-a-glance accountability cues.
  const showVariance = !!variance && (variance.kind === 'behind' || variance.kind === 'ahead');
  const age = formatAge(lastIso, todayIso);
  const subId = activeActivity?.subcontractor_id ?? null;
  const subName = subId ? companyNameById?.[subId] : undefined;

  // Schedule grid (owner's per-activity columns) for the location's CURRENT
  // activity — pending-aware date values + derived durations/variances. Actual
  // start uses the ENTERED value only here (no per-row audit prefetch); the
  // "ongoing" fallback appears on the expanded rows, which load the audit.
  const rState = (pending?.state || log?.temporal_state || 'none') as string;
  const rStart = pending?.extraProps?.startDate !== undefined ? (pending.extraProps.startDate ?? '') : (log?.planned_start_date || '');
  const rEnd = pending?.extraProps?.endDate !== undefined ? (pending.extraProps.endDate ?? '') : (log?.planned_end_date || '');
  const rLogged = pending?.extraProps?.loggedDate !== undefined ? (pending.extraProps.loggedDate ?? '') : (log?.logged_date || '');
  const rActualStart = pending?.extraProps?.actualStartDate !== undefined ? (pending.extraProps.actualStartDate ?? '') : (log?.actual_start_date || '');
  const rSched = deriveSchedule({
    plannedStart: rStart || null, plannedEnd: rEnd || null, enteredStart: rActualStart || null,
    loggedDate: rLogged || null, state: rState, todayIso,
  });
  const frozenBg = isSelected ? 'bg-purple-50 dark:bg-purple-950' : 'bg-white dark:bg-slate-900';

  // Band vs Promise P4 — the baseline overlay for this row's current activity.
  const rowBaseline = baseCols && baselineSnapshot
    ? computeBaselineForSlot(baselineSnapshot, rowSheetId, log?.activityName, rowLevelSchedule)
    : null;

  return (
    // Each location is its own <tbody> so an expanded row's sticky pin is
    // bounded to *its* activity group — it releases the moment the group
    // scrolls past, and the next location takes over. While expanded, the
    // <tbody> is observed for near-viewport presence so only on-screen
    // expansions run their audit query (Phase 2); collapsed rows aren't
    // observed (nothing to fetch), keeping re-renders off the scroll path.
    <tbody ref={isExpanded ? observeRef(unit.id) : null}>
    <tr
      onClick={(e) => onRowClick(e, unit.id, index)}
      style={isExpanded ? { top: headerH } : undefined}
      className={`border-b border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors cursor-pointer ${
        isExpanded
          // z-[15]: above the child rows' sticky-left frozen cells (z-[11]) so
          // the pinned location/checkbox columns stay on top as the group
          // scrolls under them; still below the header (thead z-20 / th z-30).
          ? `sticky z-[15] shadow-[0_2px_4px_-2px_rgba(0,0,0,0.18)] ${
              isSelected ? 'bg-purple-50 dark:bg-purple-950' : 'bg-white dark:bg-slate-900'
            }`
          : isSelected
            ? 'bg-purple-50 dark:bg-purple-900/10'
            : ''
      }`}
    >
      <td className={`${cellPad} ${FZ_CHECK} z-[11] ${frozenBg} align-middle text-center`}>
        <input
          type="checkbox"
          checked={isSelected}
          readOnly
          className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
        />
      </td>
      <td className={`${cellPad} ${FZ_LOC} z-[11] ${frozenBg} border-r border-slate-200 dark:border-white/10 font-bold text-slate-900 dark:text-slate-100 align-middle`}>
        <div className="flex items-start gap-2 relative">
          <button
            type="button"
            onClick={(e) => onToggleExpanded(e, unit.id)}
            className="mt-0.5 p-0.5 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2">
              {unit.unit_number}
              {levelLabel && (
                <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 whitespace-nowrap">· {levelLabel}</span>
              )}
              <BottleneckIndicator
                unit={unit}
                outOfSequence={log?.outOfSequence as unknown as React.ComponentProps<typeof BottleneckIndicator>['outOfSequence']}
                onUpdateStatus={handleTimelineUpdate as unknown as React.ComponentProps<typeof BottleneckIndicator>['onUpdateStatus']}
              />
              {isSaving && <UpdatingRing />}
            </div>
            {(showVariance || age !== '—') && (
              <div className="flex items-center gap-2 text-[10px] font-medium">
                {showVariance && variance && (
                  <span
                    className="inline-flex items-center gap-1 whitespace-nowrap"
                    style={{ color: varianceFill(variance) }}
                    title={varianceLabel(variance)}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: varianceFill(variance) }} />
                    {variance.days}d {variance.kind === 'behind' ? 'late' : 'early'}
                  </span>
                )}
                {age !== '—' && (
                  <span
                    className="ml-auto text-slate-400 dark:text-slate-500 font-normal whitespace-nowrap"
                    title={lastIso ? `Last update ${new Date(lastIso).toLocaleString()}` : undefined}
                  >
                    {age}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className={`${cellPadTight} align-middle text-slate-600 dark:text-slate-400`} onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-1.5 items-start">
          <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
            {unit.unit_type || 'Unknown'}
          </span>
          <AssigneeCell
            assignedTo={unit.assigned_to}
            members={members || []}
            onAssign={(userId) => onAssignUnit?.(unit.id, userId)}
          />
          {subName && (
            <span
              className="max-w-[150px] truncate text-[10px] text-slate-400 dark:text-slate-500 pl-1.5"
              title={`Subcontractor on ${activeActivity?.name ?? 'current activity'}: ${subName}`}
            >
              {subName}
            </span>
          )}
        </div>
      </td>
      <td className={`${cellPadTight} align-middle`}>
        <StatusTrigger
          unit={unit}
          baseLog={dLog}
          pendingChange={pending}
          onChooseStatus={onChooseStatus}
          onLocalUpdate={handleLocalUpdate}
          isApplying={isApplying}
          savingUnitId={isSaving ? unit.id : null}
          large={false}
          statusTrailing={
            onToggleApplicability && activeActivity ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleApplicability(unit, activeActivity, false, dLog?.temporal_state); }}
                disabled={isSaving || isApplying}
                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                title="Mark current activity Not Applicable for this location"
                aria-label={`Mark ${log?.activityName} not applicable for this location`}
              >
                <Ban size={14} />
              </button>
            ) : null
          }
        />
      </td>
      <td className={`${cellPadTight} align-middle`} onClick={(e) => e.stopPropagation()}>
        {log ? (
          <DateInputCell
            value={rStart}
            pending={pending?.extraProps?.startDate !== undefined}
            onChange={(val) =>
              handleLocalUpdate(unit, log || ({} as StatusLog), pending?.state || (log.temporal_state as TemporalState) || 'none', {
                startDate: val, endDate: log.planned_end_date,
              })
            }
            disabled={isApplying}
            ariaLabel={`Planned start — ${unit.unit_number}`}
          />
        ) : (
          <span className="text-slate-400 text-xs italic">—</span>
        )}
      </td>
      <td className={`${cellPadTight} align-middle`} onClick={(e) => e.stopPropagation()}>
        {log ? (
          <DateInputCell
            value={rEnd}
            pending={pending?.extraProps?.endDate !== undefined}
            onChange={(val) =>
              handleLocalUpdate(unit, log || ({} as StatusLog), pending?.state || (log.temporal_state as TemporalState) || 'none', {
                startDate: log.planned_start_date, endDate: val,
              })
            }
            disabled={isApplying}
            ariaLabel={`Planned completion — ${unit.unit_number}`}
          />
        ) : (
          <span className="text-slate-400 text-xs italic">—</span>
        )}
      </td>
      {baseCols && (
        <>
          <td className={`${cellPad} align-middle bg-slate-50 dark:bg-white/[0.03]`}><BaselineDateCell value={rowBaseline?.win?.start ?? null} /></td>
          <td className={`${cellPad} align-middle bg-slate-50 dark:bg-white/[0.03]`}><BaselineDateCell value={rowBaseline?.win?.end ?? null} /></td>
          <td className={`${cellPad} text-right align-middle bg-slate-50 dark:bg-white/[0.03]`}><BaselineFlagCell delta={rowBaseline?.delta ?? null} /></td>
        </>
      )}
      <td className={`${cellPad} text-right align-middle`}>
        <DurationCell days={rSched.plannedDuration} />
      </td>
      <td className={`${cellPadTight} align-middle`} onClick={(e) => e.stopPropagation()}>
        {log ? (
          <DateInputCell
            value={rActualStart}
            pending={pending?.extraProps?.actualStartDate !== undefined}
            onChange={(val) =>
              handleLocalUpdate(unit, log || ({} as StatusLog), pending?.state || (log.temporal_state as TemporalState) || 'none', {
                startDate: log.planned_start_date, endDate: log.planned_end_date, loggedDate: log.logged_date, actualStartDate: val,
              })
            }
            disabled={isApplying}
            ariaLabel={`Actual start — ${unit.unit_number}`}
          />
        ) : (
          <span className="text-slate-400 text-xs italic">—</span>
        )}
      </td>
      <td className={`${cellPadTight} align-middle`} onClick={(e) => e.stopPropagation()}>
        {(pending?.state || log?.temporal_state) === 'completed' ? (
          <DateInputCell
            value={rLogged}
            pending={pending?.extraProps?.loggedDate !== undefined}
            onChange={(val) =>
              handleLocalUpdate(unit, log || ({} as StatusLog), pending?.state || (log!.temporal_state as TemporalState) || 'none', {
                startDate: log!.planned_start_date, endDate: log!.planned_end_date, loggedDate: val,
              })
            }
            disabled={isApplying}
            ariaLabel={`Actual completion — ${unit.unit_number}`}
            completedTone
            stopClickPropagation
          />
        ) : (
          <span className="text-slate-400 text-xs italic">—</span>
        )}
      </td>
      <td className={`${cellPad} text-right align-middle`}>
        <DurationCell days={rSched.actualDuration} ongoing={rSched.ongoing} />
      </td>
      <td className={`${cellPad} text-right align-middle`}>
        <VarianceCell days={rSched.varianceStart} pos="late" neg="early" zero="on time" />
      </td>
      <td className={`${cellPad} text-right align-middle`}>
        <VarianceCell days={rSched.varianceCompleted} pos="late" neg="early" zero="on time" />
      </td>
      <td className={`${cellPad} text-right align-middle`}>
        <VarianceCell days={rSched.varianceDuration} pos="over" neg="under" zero="on plan" />
      </td>
      <td className={`${cellPad} align-middle text-right`} onClick={(e) => e.stopPropagation()}>
        <RowActionsMenu
          unitNumber={unit.unit_number}
          currentSubtypeId={unit.subtype_id}
          subtypes={subtypes || []}
          projectType={projectType}
          onRename={() => onRenameLocation?.(unit)}
          onChangeType={(result) => onChangeUnitType?.(unit.id, result)}
          onLocate={onLocateUnit ? () => onLocateUnit(unit.id) : undefined}
          onDelete={onDeleteLocation ? () => onDeleteLocation(unit.id) : undefined}
          onHistory={() => setHistoryModalUnitId(unit.id)}
        />
      </td>
    </tr>
    {isExpanded && (
    // Only fetch this location's audit when its row is on/near screen — or
    // whenever viewport tracking is unavailable, so nothing regresses to
    // "never loads" (List View Performance — Phase 2).
    <ExpandedActivityAudit
      unitId={unit.id}
      track={trackingMode}
      enabled={auditEnabled}
    >
    {(auditByActivity) => {
      // Item 11 — the activities flagged out-of-sequence on the parent row.
      // The specific offenders are already computed upstream (deriveBottleneck-
      // Statuses); we highlight the matching child rows below with a red ring.
      const outOfSeqNames = new Set(
        ((log?.outOfSequence as Array<{ activityName?: string | null }> | undefined) ?? [])
          .map((o) => o.activityName)
          .filter((n): n is string => !!n),
      );
      return currentActivities?.map(activity => {
      // Item 12 — the current/bottleneck activity now renders here too (marked
      // "Current" + accented below) rather than being skipped, so the expanded
      // list reads as a complete, in-order timeline. It stays fully editable.
      const isCurrentActivity = activity.name === log?.activityName;
      const isOutOfSeq = outOfSeqNames.has(activity.name);

      const notApplicable = applicabilityIndex && !isActivityApplicable(activity, unit, applicabilityIndex);
      if (notApplicable) {
        return (
          <tr key={`${unit.id}_${activity.name}`} className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5 opacity-60">
            <td className={`${cellPadTight} ${FZ_CHECK} z-[11] bg-slate-50 dark:bg-slate-900`}></td>
            <td className={`${cellPadTight} ${FZ_LOC} z-[11] bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-white/10 font-medium text-slate-500 dark:text-slate-400 align-middle pl-10`}>
              <div className="flex items-center gap-2 italic">
                <span className="text-slate-400 font-bold">↳</span>
                {activity.name}
              </div>
            </td>
            <td className={cellPadTight}></td>
            <td className={`${cellPadTight} align-middle`}>
              <div className="flex items-center gap-2">
                <span className={`inline-block rounded-lg border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider italic ${getTemporalStateStyle('none')}`}>
                  N/A
                </span>
                {onToggleApplicability && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleApplicability(unit, activity, true); }}
                    disabled={isSaving || isApplying}
                    className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                    title="Restore — mark this activity applicable for this location"
                    aria-label={`Restore ${activity.name} for this location`}
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>
            </td>
            {Array.from({ length: 9 }).map((_, i) => (
              <React.Fragment key={i}>
                <td className={`${cellPad} ${i >= 2 && i !== 3 ? 'text-right' : ''} align-middle`}>
                  <span className="text-slate-300 dark:text-slate-600">—</span>
                </td>
                {baseCols && i === 1 && (
                  <>
                    <td className={`${cellPad} align-middle bg-slate-50 dark:bg-white/[0.03]`}><span className="text-slate-300 dark:text-slate-600">—</span></td>
                    <td className={`${cellPad} align-middle bg-slate-50 dark:bg-white/[0.03]`}><span className="text-slate-300 dark:text-slate-600">—</span></td>
                    <td className={`${cellPad} text-right align-middle bg-slate-50 dark:bg-white/[0.03]`}><span className="text-slate-300 dark:text-slate-600">—</span></td>
                  </>
                )}
              </React.Fragment>
            ))}
            <td className={`${cellPad} align-middle text-right`}></td>
          </tr>
        );
      }

      const childLog =
        logMap.get(`${unit.id}_${activity.name}`) ||
        ({
          unit_id: unit.id,
          activityName: activity.name,
          status_color: activity.color,
          track: trackingMode,
          temporal_state: 'none',
        } as unknown as StatusLog);
      const childPending = pendingTimelineForUnit?.[`${unit.id}_${activity.name}`];
      const dChildLog = childPending ? { ...childLog, temporal_state: childPending.state } : childLog;

      // Schedule grid (owner's per-activity columns) for this activity.
      const childState = (childLog.temporal_state as string) || 'none';
      // Pending-aware effective date values for the editable date boxes.
      const cStart = childPending?.extraProps?.startDate !== undefined ? (childPending.extraProps.startDate ?? '') : (childLog.planned_start_date || '');
      const cEnd = childPending?.extraProps?.endDate !== undefined ? (childPending.extraProps.endDate ?? '') : (childLog.planned_end_date || '');
      const cLogged = childPending?.extraProps?.loggedDate !== undefined ? (childPending.extraProps.loggedDate ?? '') : (childLog.logged_date || '');
      const cActualStart = childPending?.extraProps?.actualStartDate !== undefined ? (childPending.extraProps.actualStartDate ?? '') : (childLog.actual_start_date || '');
      // The per-activity schedule story. Manually-entered actual-start WINS;
      // else a genuine "ongoing" mark from the loaded audit; else blank (no
      // misleading completion-day guess). Reflects pending edits.
      const cSched = deriveSchedule({
        plannedStart: cStart || null, plannedEnd: cEnd || null, enteredStart: cActualStart || null,
        loggedDate: cLogged || null, state: childState,
        events: auditByActivity.get(activity.name) || [], todayIso,
      });

      // Band vs Promise P4 — the baseline overlay for this activity slot.
      const childBaseline = baseCols && baselineSnapshot
        ? computeBaselineForSlot(baselineSnapshot, rowSheetId, activity.name, rowLevelSchedule)
        : null;

      return (
        <tr key={`${unit.id}_${activity.name}`} className={`border-b border-slate-200 dark:border-white/5 ${isCurrentActivity ? 'bg-sky-50/70 dark:bg-sky-500/[0.12]' : 'bg-slate-50 dark:bg-white/5'} ${isOutOfSeq ? 'ring-1 ring-inset ring-red-400/70 dark:ring-red-500/60' : ''}`}>
          <td className={`${cellPadTight} ${FZ_CHECK} z-[11] ${isCurrentActivity ? 'bg-sky-50 dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-900'}`}></td>
          <td className={`${cellPadTight} ${FZ_LOC} z-[11] border-l-2 ${isCurrentActivity ? 'bg-sky-50 dark:bg-sky-950/60 border-l-sky-400 dark:border-l-sky-500' : 'bg-slate-50 dark:bg-slate-900 border-l-transparent'} border-r border-slate-200 dark:border-white/10 font-medium text-slate-700 dark:text-slate-300 align-middle pl-10`}>
            <div className="flex items-center gap-2">
              <span className={`font-bold ${isCurrentActivity ? 'text-sky-500' : 'text-slate-400'}`}>↳</span>
              <span className={isCurrentActivity ? 'font-semibold text-sky-800 dark:text-sky-200' : undefined}>{activity.name}</span>
              {isCurrentActivity && (
                <span className="shrink-0 rounded-full bg-sky-100 dark:bg-sky-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-200">
                  Current
                </span>
              )}
            </div>
          </td>
          <td className={cellPadTight}></td>
          <td className={`${cellPadTight} align-middle`}>
            <div className="flex items-center gap-2">
              <StatusSegments
                value={(dChildLog.temporal_state as TemporalState) || 'none'}
                onChange={(s) => handleTimelineUpdate(unit, childLog, s, { activityObj: activity })}
                disabled={isSaving || isApplying}
                pending={!!(childPending?.state && childPending.state !== childLog.temporal_state)}
                ariaLabel={`Status for ${activity.name}`}
                size="sm"
              />
              {onToggleApplicability && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggleApplicability(unit, activity, false, dChildLog.temporal_state); }}
                  disabled={isSaving || isApplying}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  title="Mark Not Applicable for this location"
                  aria-label={`Mark ${activity.name} not applicable for this location`}
                >
                  <Ban size={14} />
                </button>
              )}
            </div>
          </td>
          <td className={`${cellPadTight} align-middle`}>
            <DateInputCell
              value={cStart}
              pending={childPending?.extraProps?.startDate !== undefined}
              onChange={(val) =>
                handleTimelineUpdate(unit, childLog, childPending?.state || (childLog.temporal_state as TemporalState) || 'none', {
                  startDate: val, endDate: childLog.planned_end_date, activityObj: activity,
                })
              }
              disabled={isApplying}
              ariaLabel={`Planned start — ${activity.name}, ${unit.unit_number}`}
            />
          </td>
          <td className={`${cellPadTight} align-middle`}>
            <DateInputCell
              value={cEnd}
              pending={childPending?.extraProps?.endDate !== undefined}
              onChange={(val) =>
                handleTimelineUpdate(unit, childLog, childPending?.state || (childLog.temporal_state as TemporalState) || 'none', {
                  startDate: childLog.planned_start_date, endDate: val, activityObj: activity,
                })
              }
              disabled={isApplying}
              ariaLabel={`Planned completion — ${activity.name}, ${unit.unit_number}`}
            />
          </td>
          {baseCols && (
            <>
              <td className={`${cellPad} align-middle bg-slate-50 dark:bg-white/[0.03]`}><BaselineDateCell value={childBaseline?.win?.start ?? null} /></td>
              <td className={`${cellPad} align-middle bg-slate-50 dark:bg-white/[0.03]`}><BaselineDateCell value={childBaseline?.win?.end ?? null} /></td>
              <td className={`${cellPad} text-right align-middle bg-slate-50 dark:bg-white/[0.03]`}><BaselineFlagCell delta={childBaseline?.delta ?? null} /></td>
            </>
          )}
          <td className={`${cellPad} text-right align-middle`}>
            <DurationCell days={cSched.plannedDuration} />
          </td>
          <td className={`${cellPadTight} align-middle`}>
            <DateInputCell
              value={(cSched.actualStartIso || '').slice(0, 10)}
              pending={childPending?.extraProps?.actualStartDate !== undefined}
              onChange={(val) =>
                handleTimelineUpdate(unit, childLog, childPending?.state || (childLog.temporal_state as TemporalState) || 'none', {
                  startDate: childLog.planned_start_date, endDate: childLog.planned_end_date, loggedDate: childLog.logged_date, actualStartDate: val, activityObj: activity,
                })
              }
              disabled={isApplying}
              ariaLabel={`Actual start — ${activity.name}, ${unit.unit_number}`}
            />
          </td>
          <td className={`${cellPadTight} align-middle`}>
            {(childPending?.state || childLog.temporal_state) === 'completed' ? (
              <DateInputCell
                value={cLogged}
                pending={childPending?.extraProps?.loggedDate !== undefined}
                onChange={(val) =>
                  handleTimelineUpdate(unit, childLog, childPending?.state || (childLog.temporal_state as TemporalState) || 'none', {
                    startDate: childLog.planned_start_date, endDate: childLog.planned_end_date, loggedDate: val, activityObj: activity,
                  })
                }
                disabled={isApplying}
                ariaLabel={`Actual completion — ${activity.name}, ${unit.unit_number}`}
                completedTone
                stopClickPropagation
              />
            ) : (
              <span className="text-slate-400 text-xs italic">—</span>
            )}
          </td>
          <td className={`${cellPad} text-right align-middle`}>
            <DurationCell days={cSched.actualDuration} ongoing={cSched.ongoing} />
          </td>
          <td className={`${cellPad} text-right align-middle`}>
            <VarianceCell days={cSched.varianceStart} pos="late" neg="early" zero="on time" />
          </td>
          <td className={`${cellPad} text-right align-middle`}>
            <VarianceCell days={cSched.varianceCompleted} pos="late" neg="early" zero="on time" />
          </td>
          <td className={`${cellPad} text-right align-middle`}>
            <VarianceCell days={cSched.varianceDuration} pos="over" neg="under" zero="on plan" />
          </td>
          <td className={`${cellPad} align-middle text-right`}></td>
        </tr>
      );
    });
    }}
    </ExpandedActivityAudit>
    )}
    </tbody>
  );
}

/**
 * Memoized so a re-render of `StatusTable` (which happens on every edit, because the
 * pending-changes state lives above it) skips every row whose own props are
 * referentially unchanged. Default shallow prop comparison is sufficient *because*
 * StatusTable feeds stable callbacks + per-row primitive flags + per-unit slices.
 */
const LocationRow = React.memo(LocationRowInner);
export default LocationRow;
