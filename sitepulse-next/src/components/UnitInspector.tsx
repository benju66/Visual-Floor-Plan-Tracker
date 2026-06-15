"use client";
import React, { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Crosshair, Pencil, Trash2, History, Ban, RotateCcw, User, Footprints } from 'lucide-react';
import { getTemporalStateStyle } from '@/components/ui/FieldStatusAtoms';
import DatesInline from '@/components/ui/DatesInline';
import { isMilestoneApplicable, type ApplicabilityIndex } from '@/utils/applicability';
import { summarizeUnit } from '@/utils/unitProgress';
import { useUnitHistory, useProjectMembers } from '@/hooks/useProjectQueries';
import type { Milestone, StatusLog, TemporalState, Unit } from '@/types/domain';

export interface UnitInspectorProps {
  unit: Unit;
  milestones: Milestone[];
  trackingMode: string;
  activeStatuses: StatusLog[];
  applicabilityIndex: ApplicabilityIndex;
  savingUnitId?: string | null;
  onBack: () => void;
  onLocateUnit?: (unitId: string) => void;
  onRenameUnitInitiate: (id: string) => void;
  onDeleteUnit: (id: string) => void;
  /** Immediate commit — same path the map quick-edit uses (commitUnitMilestone). */
  onCommitStatus: (unit: Unit, milestone: Milestone, state: TemporalState, extraProps?: Record<string, unknown>) => void;
  onToggleApplicability: (unit: Unit, milestone: Milestone, isApplicable: boolean, currentState?: TemporalState) => void;
  onOpenHistory: (unitId: string) => void;
}

const STAGE_DOT: Record<string, string> = {
  done: 'bg-emerald-500',
  completed: 'bg-emerald-500',
  ongoing: 'bg-blue-500',
  planned: 'bg-amber-500',
  none: 'bg-slate-300 dark:bg-slate-600',
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
  milestones,
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

  const trackMilestones = useMemo(
    () =>
      milestones
        .filter(m => m.track === trackingMode)
        .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0)),
    [milestones, trackingMode],
  );

  const { applicable, notApplicable } = useMemo(() => {
    const a: Milestone[] = [];
    const na: Milestone[] = [];
    for (const m of trackMilestones) {
      (isMilestoneApplicable(m, unit, applicabilityIndex) ? a : na).push(m);
    }
    return { applicable: a, notApplicable: na };
  }, [trackMilestones, unit, applicabilityIndex]);

  const summary = useMemo(
    () => summarizeUnit(unit, activeStatuses, trackMilestones, applicabilityIndex, trackingMode),
    [unit, activeStatuses, trackMilestones, applicabilityIndex, trackingMode],
  );

  const logFor = (milestoneName: string): StatusLog | undefined =>
    activeStatuses.find(s => s.unit_id === unit.id && s.track === trackingMode && s.milestone === milestoneName);

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
        {unit.computed_area != null && (
          <span className="tabular-nums">{Math.round(unit.computed_area).toLocaleString()} sq</span>
        )}
      </div>

      {/* Progress */}
      <div className="flex-shrink-0 mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Progress
          </span>
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
            {summary.totalCount === 0 ? 'No milestones apply' : `${summary.doneCount} of ${summary.totalCount} complete`}
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-200/70 dark:bg-white/10 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Scrollable body: checklist + N/A + activity */}
      <div className="overflow-y-auto flex-1 -mr-1 pr-1 min-h-0">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
          Milestones
        </h4>

        {applicable.length === 0 && notApplicable.length === 0 && (
          <p className="text-xs text-slate-500 italic">No milestones defined for this track.</p>
        )}

        <div className="flex flex-col gap-1.5">
          {applicable.map(milestone => {
            const log = logFor(milestone.name);
            const baseLog: StatusLog =
              log ||
              ({
                unit_id: unit.id,
                milestone: milestone.name,
                status_color: milestone.color,
                track: trackingMode,
                temporal_state: 'none',
                planned_start_date: null,
                planned_end_date: null,
                logged_date: null,
              } as StatusLog);
            const state = (baseLog.temporal_state as TemporalState) || 'none';

            return (
              <div
                key={milestone.id}
                className="rounded-lg border border-slate-200/70 dark:border-white/10 bg-white/40 dark:bg-black/15 p-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0 ring-1 ring-black/5"
                    style={{ background: milestone.color }}
                  />
                  <span className="flex-1 truncate text-[13px] font-medium text-slate-700 dark:text-slate-200" title={milestone.name}>
                    {milestone.name}
                  </span>
                  <select
                    value={state}
                    onChange={e => onCommitStatus(unit, milestone, e.target.value as TemporalState)}
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
                    onClick={() => onToggleApplicability(unit, milestone, false, state)}
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
                    onLocalUpdate={(u, bl, s, extra) => onCommitStatus(u, milestone, s, extra)}
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
              {notApplicable.map(milestone => (
                <div
                  key={milestone.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50/60 dark:bg-white/5 opacity-70"
                >
                  <Ban size={12} className="text-slate-400 shrink-0" />
                  <span className="flex-1 truncate text-xs text-slate-500 dark:text-slate-400 line-through" title={milestone.name}>
                    {milestone.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleApplicability(unit, milestone, true)}
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
                  <span className="truncate flex-1">{h.milestone}</span>
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
