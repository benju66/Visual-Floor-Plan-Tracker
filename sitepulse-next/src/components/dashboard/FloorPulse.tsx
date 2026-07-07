"use client";
import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Check, Map as MapIcon } from 'lucide-react';
import { summarizeGroup, parseDay, PLAN_TICK_MIN_COVERAGE, STALL_THRESHOLD_DAYS, SMALL_SAMPLE_SLOTS, FORECAST_WINDOW_WEEKS } from '@/utils/progressAnalytics';
import type { CompletionEvent, GroupRollup } from '@/utils/progressAnalytics';
import type { ApplicabilityIndex } from '@/utils/applicability';
import type { Sheet, Unit, Activity, StatusLog } from '@/types/domain';

/**
 * FloorPulse — per-level rollup rail at the top of the dashboard.
 * One row per sheet, stacked in building order (highest level first):
 * completion bar with a planned-by-today tick, pace vs trailing average,
 * a median-pace forecast chip, and a stalled-unit count.
 *
 * Clicking a row scopes the rest of the dashboard to that level (this rail
 * replaces the old Active Level / All Levels toggle). The map button jumps
 * straight to that level's floor plan.
 */

export interface FloorPulseProps {
  sheets: Sheet[];
  allUnits: Unit[];
  statuses: StatusLog[];
  activities: Activity[];
  track: string;
  history: CompletionEvent[];
  applicabilityIndex?: ApplicabilityIndex;
  /** 'all' or a sheet id. */
  scope: string;
  onScopeChange: (scope: string) => void;
  onOpenMap: (sheetId: string) => void;
  /**
   * Per-sheet rollups lifted to the parent so they are computed ONCE (the hero
   * card clamps against them). Keyed by sheet id. When omitted, FloorPulse
   * computes its own — keeps the component standalone + unit-testable.
   */
  levelRollups?: Record<string, GroupRollup>;
  /** All-levels rollup, lifted alongside `levelRollups`. Same fallback rule. */
  buildingRollup?: GroupRollup;
  /**
   * When the whole project is a stalled swarm, the per-level stalled chips are
   * suppressed — one project-level banner explains the stale data instead (P2).
   */
  stalledSwarm?: boolean;
}

function fmtWeek(iso: string): string {
  const d = parseDay(iso);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
}

type Pace =
  | { kind: 'up' | 'down' | 'flat'; perWeek: number; trailing: number }
  | { kind: 'idle'; weeks: number }
  | { kind: 'small' }
  | { kind: 'done' };

function paceOf(r: GroupRollup): Pace {
  if (r.totalSlots > 0 && r.completedSlots >= r.totalSlots) return { kind: 'done' };
  if (r.trailingAvg === null) return { kind: 'small' };
  // Idle = no completions in the current (partial) week or the two prior full weeks.
  // Bucket-based so it stays consistent with the weekly trend, not the rolling rate.
  const recentWeeks = r.weekly.slice(-3);
  if (recentWeeks.length >= 2 && recentWeeks.every(w => w.count === 0)) {
    return { kind: 'idle', weeks: 2 };
  }
  const kind = r.paceThisWeek > r.trailingAvg * 1.15 ? 'up'
    : r.paceThisWeek < r.trailingAvg * 0.85 ? 'down'
    : 'flat';
  return { kind, perWeek: r.paceThisWeek, trailing: r.trailingAvg };
}

function ForecastChip({ r }: { r: GroupRollup }) {
  if (r.forecastSuppressed === 'complete') {
    return <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><Check size={13} /> complete</span>;
  }
  if (r.forecastDate) {
    return (
      <span className="text-xs whitespace-nowrap">
        <span className="text-slate-400">→ </span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">~wk of {fmtWeek(r.forecastDate)}</span>
        <span className="block text-[9px] text-slate-400">at current pace</span>
      </span>
    );
  }
  return (
    <span
      className="text-xs text-slate-400 whitespace-nowrap"
      title={r.forecastSuppressed === 'small-sample'
        ? `Forecasts are suppressed (never faked) below ${SMALL_SAMPLE_SLOTS} tracked tasks.`
        : `No completions in the last ${FORECAST_WINDOW_WEEKS} weeks — no pace to project from.`}
    >
      —
      <span className="block text-[9px]">
        {r.forecastSuppressed === 'small-sample' ? 'too few tasks to project' : 'no recent pace to project'}
      </span>
    </span>
  );
}

function PaceCell({ pace }: { pace: Pace }) {
  if (pace.kind === 'done') return <span className="text-emerald-500"><Check size={15} /></span>;
  if (pace.kind === 'small') {
    return (
      <span className="text-xs text-slate-400" title={`Pace trends are suppressed (never faked) below ${SMALL_SAMPLE_SLOTS} tracked tasks.`}>
        — <span className="block text-[9px]">too few tasks for a trend</span>
      </span>
    );
  }
  if (pace.kind === 'idle') {
    return <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">— flat <span className="block text-[9px] font-normal text-slate-400">no movement {pace.weeks} wks</span></span>;
  }
  const color = pace.kind === 'up' ? 'text-emerald-600 dark:text-emerald-400' : pace.kind === 'down' ? 'text-red-600 dark:text-red-400' : 'text-slate-500';
  return (
    <span className={`text-xs font-bold ${color} flex items-center gap-1 whitespace-nowrap`}>
      {pace.kind === 'up' ? <TrendingUp size={13} /> : pace.kind === 'down' ? <TrendingDown size={13} /> : null}
      {pace.perWeek}/wk
      <span className="block text-[9px] font-normal text-slate-400">vs {pace.trailing.toFixed(1)} avg</span>
    </span>
  );
}

export default function FloorPulse({
  sheets, allUnits, statuses, activities, track, history, applicabilityIndex,
  scope, onScopeChange, onOpenMap, levelRollups, buildingRollup, stalledSwarm = false,
}: FloorPulseProps) {
  const today = useMemo(() => new Date(), []);

  const rows = useMemo(() => {
    const ordered = [...sheets].sort((a, b) => (b.sequence_order || 0) - (a.sequence_order || 0));
    return ordered.map(sheet => {
      // Prefer the parent-computed rollup (computed once); fall back to our own
      // so FloorPulse stays a self-contained, testable component.
      const rollup = levelRollups?.[sheet.id]
        ?? summarizeGroup({ units: allUnits.filter(u => u.sheet_id === sheet.id), statuses, activities, track, history, today, applicabilityIndex });
      return { sheet, rollup, pace: paceOf(rollup) };
    });
  }, [sheets, allUnits, statuses, activities, track, history, today, applicabilityIndex, levelRollups]);

  // Only compute the all-levels rollup when the parent didn't hand one down —
  // avoids double-computing it in the real dashboard (the memo short-circuits).
  const computedBuilding = useMemo(
    () => (buildingRollup ? null : summarizeGroup({ units: allUnits, statuses, activities, track, history, today, applicabilityIndex })),
    [buildingRollup, allUnits, statuses, activities, track, history, today, applicabilityIndex],
  );
  const building = buildingRollup ?? computedBuilding!;

  if (sheets.length === 0) return null;

  return (
    <div className="glass-panel rounded-2xl border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200/60 dark:border-white/10">
        <div className="flex items-baseline gap-3 min-w-0">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Floor Pulse</h2>
          <span className="hidden sm:inline text-[11px] text-slate-400 truncate">building order · click a level to scope the dashboard</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {building.forecastDate && (
            <span className="text-xs text-slate-500 whitespace-nowrap">
              building → <b className="text-slate-700 dark:text-slate-200">~wk of {fmtWeek(building.forecastDate)}</b>
            </span>
          )}
          <button
            type="button"
            onClick={() => onScopeChange('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              scope === 'all'
                ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white'
                : 'bg-white/60 dark:bg-black/20 text-slate-600 dark:text-slate-300 border-slate-300/80 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            All levels
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-200/60 dark:divide-white/5">
        {rows.map(({ sheet, rollup, pace }) => {
          const isScoped = scope === sheet.id;
          const completedPct = rollup.completionPct;
          const ongoingPct = rollup.totalSlots > 0 ? (rollup.ongoingSlots / rollup.totalSlots) * 100 : 0;
          // Only trust the plan tick (and the gap signals derived from it) once a
          // meaningful share of slots actually carry plan dates — a tick built from
          // 1-of-18 dated slots reads as "wildly ahead" and misleads.
          const hasPlan = rollup.plannedByTodayPct !== null && rollup.plannedCoverage >= PLAN_TICK_MIN_COVERAGE;
          const planPct = hasPlan ? rollup.plannedByTodayPct : null;
          const gap = planPct !== null ? Math.round(planPct - completedPct) : null;
          const isDone = rollup.totalSlots > 0 && rollup.completedSlots >= rollup.totalSlots;
          const riskEdge = gap !== null && gap >= 15 ? 'bg-red-500'
            : (gap !== null && gap >= 8) || pace.kind === 'idle' ? 'bg-amber-500'
            : null;

          return (
            <div
              key={sheet.id}
              role="button"
              tabIndex={0}
              onClick={() => onScopeChange(isScoped ? 'all' : sheet.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') onScopeChange(isScoped ? 'all' : sheet.id); }}
              className={`relative grid grid-cols-[minmax(90px,140px)_1fr_auto] sm:grid-cols-[minmax(110px,150px)_1fr_110px_150px_88px_36px] items-center gap-x-4 px-5 py-3 cursor-pointer transition-colors group ${
                isScoped ? 'bg-blue-50/70 dark:bg-blue-500/10' : 'hover:bg-slate-100/60 dark:hover:bg-white/5'
              } ${isDone ? 'opacity-60' : ''}`}
            >
              {riskEdge && <span className={`absolute left-0 top-0 bottom-0 w-1 ${riskEdge}`} />}

              <div className="min-w-0">
                <div className={`text-sm font-bold truncate ${isScoped ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-100'}`}>
                  {sheet.sheet_name}
                </div>
                <div className="text-[10px] text-slate-400 font-medium tracking-wide">
                  {rollup.unitCount} {rollup.unitCount === 1 ? 'LOCATION' : 'LOCATIONS'}
                </div>
              </div>

              <div className="relative h-5 self-center">
                <div className="absolute inset-0 rounded-md overflow-hidden flex bg-slate-200/80 dark:bg-slate-700/70 border border-slate-300/60 dark:border-white/10">
                  <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${completedPct}%` }} />
                  <div
                    className="h-full bg-amber-400/80 transition-all duration-500"
                    style={{
                      width: `${ongoingPct}%`,
                      backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.35) 4px, rgba(255,255,255,0.35) 8px)',
                    }}
                  />
                </div>
                {planPct !== null && !isDone && (
                  <div
                    className="absolute -top-1 -bottom-1 w-0.5 bg-slate-800 dark:bg-white z-10"
                    style={{ left: `${Math.min(99.5, planPct)}%` }}
                    title={`Planned to be ~${Math.round(planPct)}% by today`}
                  />
                )}
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white drop-shadow-sm">
                  {Math.round(completedPct)}%
                </span>
                {gap !== null && gap >= 8 && (
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-red-100 bg-red-600/85 px-1 rounded">
                    −{gap}pts vs plan
                  </span>
                )}
              </div>

              <div className="hidden sm:block"><PaceCell pace={pace} /></div>

              <div className="hidden sm:block"><ForecastChip r={rollup} /></div>

              <div className="hidden sm:block">
                {stalledSwarm ? (
                  // The project-wide swarm banner already explains the stall.
                  <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>
                ) : rollup.stalledUnitIds.length > 0 ? (
                  <span
                    className="inline-block text-[10px] font-bold text-amber-600 dark:text-amber-400 border border-amber-400/70 rounded-full px-2 py-0.5"
                    title={`No movement in ${STALL_THRESHOLD_DAYS}+ days on started locations. Needs attention — distinct from "behind plan" (red).`}
                  >
                    {rollup.stalledUnitIds.length} stalled
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400">{isDone ? '—' : '0 stalled'}</span>
                )}
              </div>

              <button
                type="button"
                title={`Open ${sheet.sheet_name} on the map`}
                onClick={(e) => { e.stopPropagation(); onOpenMap(sheet.id); }}
                className="hidden sm:flex p-1.5 rounded-lg text-slate-400 opacity-0 group-hover:opacity-100 hover:text-blue-600 hover:bg-blue-100/70 dark:hover:bg-blue-500/15 transition-all justify-self-end"
              >
                <MapIcon size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
