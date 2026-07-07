"use client";
import React, { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Crosshair, Pencil, Trash2, History, Ban, RotateCcw, User, Footprints } from 'lucide-react';
import { getTemporalStateStyle } from '@/components/ui/FieldStatusAtoms';
import DatesInline from '@/components/ui/DatesInline';
import { isActivityApplicable, type ApplicabilityIndex } from '@/utils/applicability';
import { summarizeUnit } from '@/utils/unitProgress';
import { formatArea } from '@/utils/scale';
import { useUnitHistory, useProjectMembers } from '@/hooks/useProjectQueries';
import type { Activity, StatusLog, TemporalState, Unit } from '@/types/domain';
import { STATUS_DOT_CLASS } from '@/utils/statusColors';

export interface UnitInspectorProps {
  unit: Unit;
  activities: Activity[];
  trackingMode: string;
  activeStatuses: StatusLog[];
  applicabilityIndex: ApplicabilityIndex;
  savingUnitId?: string | null;
  onBack: () => void;
  onLocateUnit?: (unitId: string) => void;
  onRenameUnitInitiate: (id: string) => void;
  onDeleteUnit: (id: string) => void;
  /** Immediate commit — same path the map quick-edit uses (commitUnitActivity). */
  onCommitStatus: (unit: Unit, activity: Activity, state: TemporalState, extraProps?: Record<string, unknown>) => void;
  onToggleApplicability: (unit: Unit, activity: Activity, isApplicable: boolean, currentState?: TemporalState) => void;
  onOpenHistory: (unitId: string) => void;
}

// Stage keys → the canonical dot classes (UI Polish P2 — single status-color language).
const STAGE_DOT: Record<string, string> = {
  done: STATUS_DOT_CLASS.completed,
  completed: STATUS_DOT_CLASS.completed,
  ongoing: STATUS_DOT_CLASS.ongoing,
  planned: STATUS_DOT_CLASS.planned,
  none: STATUS_DOT_CLASS.none,
};

const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';

function UnitInspector({
  unit,
  activities,
  trackingMode,
  activeStatuses,
  applicabilityIndex,
  savingUnitId,
  onBack,
  onLocateUnit,
  onRenameUnitInitiate,
  onDeleteUnit,
  onCommitStatus,
  onToggleApplicability,
  onOpenHistory,
}: UnitInspectorProps) {
  const params = useParams();
  const projectId = (params?.projectId as string) || '';
  const { data: members = [] } = useProjectMembers(projectId);
  const { data: history = [] } = useUnitHistory(unit.id);

  const trackActivities = useMemo(
    () =>
      activities
        .filter(m => m.track === trackingMode)
        .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0)),
    [activities, trackingMode],
  );

  const { applicable, notApplicable } = useMemo(() => {
    const a: Activity[] = [];
    const na: Activity[] = [];
    for (const m of trackActivities) {
      (isActivityApplicable(m, unit, applicabilityIndex) ? a : na).push(m);
    }
    return { applicable: a, notApplicable: na };
  }, [trackActivities, unit, applicabilityIndex]);

  const summary = useMemo(
    () => summarizeUnit(unit, activeStatuses, trackActivities, applicabilityIndex, trackingMode),
    [unit, activeStatuses, trackActivities, applicabilityIndex, trackingMode],
  );

  const logFor = (activityName: string): StatusLog | undefined =>
    activeStatuses.find(s => s.unit_id === unit.id && s.track === trackingMode && s.activityName === activityName);

  const assigneeName =
    members.find(m => m.user_id === unit.assigned_to)?.profiles?.display_name?.trim() || '';

  const isSaving = savingUnitId === unit.id;
  const pct = summary.totalCount === 0 ? 0 : Math.round((summary.doneCount / summary.totalCount) * 100);

  const actionBtn =
    'p-1.5 rounded-lg border bg-white/50 dark:bg-black/20 transition-colors';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header: back + row actions */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors"
        >
          <ArrowLeft size={15} /> All locations
        </button>
        <div className="flex items-center gap-1.5">
          {onLocateUnit && (
            <button
              type="button"
              onClick={() => onLocateUnit(unit.id)}
              className={`${actionBtn} text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 border-slate-200/80 dark:border-slate-700/50 hover:bg-blue-50 dark:hover:bg-blue-900/30`}
              title="Locate on map"
            >
              <Crosshair size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onRenameUnitInitiate(unit.id)}
            className={`${actionBtn} text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 border-slate-200/80 dark:border-slate-700/50 hover:bg-sky-50 dark:hover:bg-sky-900/30`}
            title="Rename location"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={() => onDeleteUnit(unit.id)}
            className={`${actionBtn} text-red-500 hover:text-red-700 dark:hover:text-red-400 border-red-200/80 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/40`}
            title="Delete location"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Identity */}
      <div className="flex items-baseline gap-2 flex-shrink-0">
        <h3 className="text-2xl font-bold text-slate-900 dark:text-white font-mono tracking-tight">
          {unit.unit_number}
        </h3>
        {unit.unit_type && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-white/10">
            {unit.unit_type}
          </span>
        )}
      </div>

      {/* Meta: assignee / walk order / area */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 mb-3 text-[11px] text-slate-500 dark:text-slate-400 flex-shrink-0">
        <span className="flex items-center gap-1.5">
          {assigneeName ? (
            <span className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center justify-center text-[8px] font-bold">
              {initialsOf(assigneeName)}
            </span>
          ) : (
            <User size={13} />
          )}
          {assigneeName || 'Unassigned'}
        </span>
        {unit.walk_sequence != null && (
          <span className="flex items-center gap-1">
            <Footprints size={13} /> Walk #{unit.walk_sequence}
          </span>
        )}
        {unit.computed_area != null && Number.isFinite(unit.computed_area) && (
          <span className="tabular-nums font-semibold text-slate-600 dark:text-slate-300">
            {formatArea(unit.computed_area)}
          </span>
        )}
      </div>

      {/* Progress */}
      <div className="flex-shrink-0 mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Progress
          </span>
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
            {summary.totalCount === 0 ? 'No activities apply' : `${summary.doneCount} of ${summary.totalCount} complete`}
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-200/70 dark:bg-white/10 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Scrollable body: checklist + N/A + activity */}
      <div className="overflow-y-auto flex-1 -mr-1 pr-1 min-h-0">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
          Activities
        </h4>

        {applicable.length === 0 && notApplicable.length === 0 && (
          <p className="text-xs text-slate-500 italic">No activities defined for this track.</p>
        )}

        <div className="flex flex-col gap-1.5">
          {applicable.map(activity => {
            const log = logFor(activity.name);
            const baseLog: StatusLog =
              log ||
              ({
                unit_id: unit.id,
                activityName: activity.name,
                status_color: activity.color,
                track: trackingMode,
                temporal_state: 'none',
                planned_start_date: null,
                planned_end_date: null,
                logged_date: null,
              } as StatusLog);
            const state = (baseLog.temporal_state as TemporalState) || 'none';

            return (
              <div
                key={activity.id}
                className="rounded-lg border border-slate-200/70 dark:border-white/10 bg-white/40 dark:bg-black/15 p-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0 ring-1 ring-black/5"
                    style={{ background: activity.color }}
                  />
                  <span className="flex-1 truncate text-[13px] font-medium text-slate-700 dark:text-slate-200" title={activity.name}>
                    {activity.name}
                  </span>
                  <select
                    value={state}
                    onChange={e => onCommitStatus(unit, activity, e.target.value as TemporalState)}
                    disabled={isSaving}
                    className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide shadow-sm outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer disabled:opacity-50 ${getTemporalStateStyle(state)}`}
                  >
                    <option value="none">Not set</option>
                    <option value="planned">Planned</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="completed">Completed</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => onToggleApplicability(unit, activity, false, state)}
                    disabled={isSaving}
                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-md transition-colors disabled:opacity-50"
                    title="Mark Not Applicable for this location"
                  >
                    <Ban size={13} />
                  </button>
                </div>

                {state !== 'none' && (
                  <DatesInline
                    unit={unit}
                    baseLog={baseLog}
                    onLocalUpdate={(u, bl, s, extra) => onCommitStatus(u, activity, s, extra)}
                    isApplying={isSaving}
                  />
                )}
              </div>
            );
          })}
        </div>

        {notApplicable.length > 0 && (
          <div className="mt-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
              Not applicable ({notApplicable.length})
            </h4>
            <div className="flex flex-col gap-1">
              {notApplicable.map(activity => (
                <div
                  key={activity.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50/60 dark:bg-white/5 opacity-70"
                >
                  <Ban size={12} className="text-slate-400 shrink-0" />
                  <span className="flex-1 truncate text-xs text-slate-500 dark:text-slate-400 line-through" title={activity.name}>
                    {activity.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleApplicability(unit, activity, true)}
                    disabled={isSaving}
                    className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-md transition-colors disabled:opacity-50"
                    title="Restore — mark applicable for this location"
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent activity */}
        <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-white/10">
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <History size={13} /> Recent activity
            </h4>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenHistory(unit.id)}
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 transition-colors"
              >
                View all
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">No status changes recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {history.slice(0, 5).map((h, i) => (
                <li key={h.id || i} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="font-mono text-slate-400 dark:text-slate-500 min-w-[46px]">
                    {shortDate((h as StatusLog & { changed_at?: string }).changed_at ?? h.created_at)}
                  </span>
                  <span className="truncate flex-1">{h.activityName}</span>
                  <span className={`inline-flex items-center gap-1 ${getTemporalStateStyle((h.temporal_state as TemporalState) || 'none')} rounded px-1.5 py-0.5 text-[9px] font-bold uppercase`}>
                    {h.temporal_state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default UnitInspector;
