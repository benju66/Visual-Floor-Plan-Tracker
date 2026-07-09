"use client";
import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { eachDayOfInterval, parseISO, format, startOfWeek } from 'date-fns';
import { Target, CalendarClock, Info, TrendingUp, ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAllProjectUnits, useAllProjectStatuses, useStatusHistory } from '@/hooks/useProjectQueries';
import { useMapStore } from '@/store/useMapStore';
import {
  summarizeGroup, parseDay, STALL_THRESHOLD_DAYS, SMALL_SAMPLE_SLOTS, FORECAST_WINDOW_WEEKS,
  scopePlannedFinish, clampProjectForecast, planVsProjected, isStalledSwarm,
} from '@/utils/progressAnalytics';
import type { GroupRollup } from '@/utils/progressAnalytics';
import { bandForRollup, bandMethodSentence, bestPaceMove, promiseOutlook, FORECAST_BAND_SEED } from '@/utils/monteCarloForecast';
import type { ForecastBand } from '@/utils/monteCarloForecast';
import { isActivityApplicable, applicableSlotCount, EMPTY_APPLICABILITY_INDEX } from '@/utils/applicability';
import type { ApplicabilityIndex } from '@/utils/applicability';
import FloorPulse from '@/components/dashboard/FloorPulse';
import RiskRadar from '@/components/dashboard/RiskRadar';
import TypeScorecard from '@/components/dashboard/TypeScorecard';
import ProductionRates from '@/components/dashboard/ProductionRates';
import type { Unit, Activity, StatusLog, Sheet, TrackingMode } from '@/types/domain';

// Lazy-load recharts via next/dynamic — prevents SSR hydration crash
// (recharts uses ResizeObserver and window which don't exist server-side)
const VelocityChart = dynamic(() => import('./VelocityChart'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

/**
 * ChartSkeleton — animated placeholder shown while history data loads.
 */
function ChartSkeleton() {
  return (
    <div className="h-[240px] flex flex-col justify-end gap-1 px-2 pt-4 animate-pulse" aria-hidden="true">
      <div className="flex items-end gap-1 h-full">
        {[35, 55, 25, 70, 45, 85, 40, 65, 30, 80, 50, 75, 42, 60, 90].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-slate-200 dark:bg-slate-700"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="h-3 w-full bg-slate-200 dark:bg-slate-700 rounded mt-2" />
    </div>
  );
}

/**
 * bucketByWeek — reduces daily data points into weekly buckets.
 * Used automatically when a project spans > 90 days to prevent
 * rendering 365+ SVG nodes and degrading chart performance.
 */
function bucketByWeek(
  allDays: Date[],
  byDay: Record<string, number>,
  totalScope: number,
  plannedEnds: number[],
) {
  const weeks: Record<string, { dailyVelocity: number; label: string; lastDay: string }> = {};
  allDays.forEach(d => {
    const weekStart = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const key = format(d, 'yyyy-MM-dd');
    if (!weeks[weekStart]) {
      weeks[weekStart] = { dailyVelocity: 0, label: `w/o ${format(d, 'MMM d')}`, lastDay: key };
    }
    weeks[weekStart].dailyVelocity += byDay[key] || 0;
    if (key > weeks[weekStart].lastDay) weeks[weekStart].lastDay = key;
  });

  const sortedWeeks = Object.keys(weeks).sort();
  let cumulative = 0;
  return sortedWeeks.map(weekKey => {
    cumulative += weeks[weekKey].dailyVelocity;
    const cutoff = parseDay(weeks[weekKey].lastDay)?.getTime() ?? 0;
    return {
      date: weekKey,
      label: weeks[weekKey].label,
      dailyVelocity: weeks[weekKey].dailyVelocity,
      cumulativeCompleted: cumulative,
      plannedCumulative: plannedEnds.filter(t => t <= cutoff).length,
      totalScope,
    };
  });
}

/** One-word promise verdict → its label + temporal color (Band vs Promise P2). */
const PROMISE_VERDICT_DISPLAY: Record<'on-track' | 'at-risk' | 'likely-miss', { label: string; cls: string }> = {
  'on-track': { label: 'on track', cls: 'text-emerald-600 dark:text-emerald-400' },
  'at-risk': { label: 'at risk', cls: 'text-amber-600 dark:text-amber-400' },
  'likely-miss': { label: 'likely to miss', cls: 'text-red-600 dark:text-red-400' },
};

/** Plain-English signed median delta vs the promised date (Band vs Promise P2). */
function promiseDeltaText(days: number): string {
  if (days > 0) return `~${days}d past the promised date`;
  if (days < 0) return `~${Math.abs(days)}d ahead of the promised date`;
  return 'on the promised date';
}

interface ProjectDashboardProps {
  units: Unit[];
  activeStatuses: StatusLog[];
  activities: Activity[];
  trackingMode: TrackingMode;
  sheets?: Sheet[];
  activeSheet?: Sheet | null;
  applicabilityIndex?: ApplicabilityIndex;
  /** The project's owner-entered contract completion date (ISO 'YYYY-MM-DD') or null. */
  contractCompletionDate?: string | null;
  /** URL-first view switch from the page (pushes `?view=` + mirrors the UI store). */
  navigateToView: (mode: string) => void;
}

export default function ProjectDashboard({ activities, trackingMode, sheets = [], applicabilityIndex = EMPTY_APPLICABILITY_INDEX, contractCompletionDate = null, navigateToView }: ProjectDashboardProps) {
  // Scope replaces the old Active Level / All Levels toggle: Floor Pulse rows set it.
  const [scope, setScope] = useState<string>('all');
  const [isChartExpanded, setIsChartExpanded] = useState(true);

  const setActiveSheetId = useMapStore(s => s.setActiveSheetId);

  const sheetIds = useMemo(() => sheets.map(s => s.id), [sheets]);
  const { data: allProjectUnits = [] } = useAllProjectUnits(sheetIds);
  const allUnitIds = useMemo(() => allProjectUnits.map(u => u.id), [allProjectUnits]);
  const { data: allProjectStatuses = [] } = useAllProjectStatuses(allUnitIds);
  const { data: rawHistory = [] } = useStatusHistory(allUnitIds);

  const today = useMemo(() => new Date(), []);
  const trackHistory = useMemo(
    () => rawHistory.filter((log) => log.track === trackingMode),
    [rawHistory, trackingMode]
  );

  const scopedSheet = scope === 'all' ? null : sheets.find(s => s.id === scope) || null;
  const displayUnits = useMemo(
    () => scope === 'all' ? allProjectUnits : allProjectUnits.filter(u => u.sheet_id === scope),
    [scope, allProjectUnits]
  );
  const displayUnitIds = useMemo(() => new Set(displayUnits.map(u => u.id)), [displayUnits]);
  const displayStatuses = useMemo(
    () => allProjectStatuses.filter(s => s.unit_id && displayUnitIds.has(s.unit_id)),
    [allProjectStatuses, displayUnitIds]
  );

  const currentTrackActivities = useMemo(() =>
    activities.filter(m => m.track === trackingMode),
  [activities, trackingMode]);

  // Rollup for the scoped selection — drives the KPI cards.
  const scopeRollup = useMemo(() => summarizeGroup({
    units: displayUnits,
    statuses: allProjectStatuses,
    activities,
    track: trackingMode,
    history: trackHistory,
    today,
    applicabilityIndex,
  }), [displayUnits, allProjectStatuses, activities, trackingMode, trackHistory, today, applicabilityIndex]);

  // Per-level + all-levels rollups, computed ONCE here and threaded down to
  // FloorPulse (which no longer recomputes them). The hero card clamps its
  // aggregate forecast against these level forecasts so it can never contradict
  // its own slowest level (Data Storytelling P1).
  const levelRollups = useMemo(() => {
    const map: Record<string, GroupRollup> = {};
    for (const sheet of sheets) {
      const sheetUnits = allProjectUnits.filter(u => u.sheet_id === sheet.id);
      map[sheet.id] = summarizeGroup({
        units: sheetUnits, statuses: allProjectStatuses, activities,
        track: trackingMode, history: trackHistory, today, applicabilityIndex,
      });
    }
    return map;
  }, [sheets, allProjectUnits, allProjectStatuses, activities, trackingMode, trackHistory, today, applicabilityIndex]);

  const buildingRollup = useMemo(() => summarizeGroup({
    units: allProjectUnits, statuses: allProjectStatuses, activities,
    track: trackingMode, history: trackHistory, today, applicabilityIndex,
  }), [allProjectUnits, allProjectStatuses, activities, trackingMode, trackHistory, today, applicabilityIndex]);

  // Stalled "swarm": when most of the whole project has had no logged movement in
  // 2+ weeks, the data itself is likely stale — collapse the per-level stalled
  // chips + the hero stalled line into ONE honest banner (Data Storytelling P2).
  const stalledSwarm = useMemo(
    () => isStalledSwarm(buildingRollup.stalledUnitIds.length, buildingRollup.unitCount),
    [buildingRollup.stalledUnitIds.length, buildingRollup.unitCount],
  );

  // Planned finish for the current scope (latest planned_end_date), and the hero
  // projection clamped to no earlier than the slowest in-scope level forecast.
  const plannedFinish = useMemo(
    () => scopePlannedFinish(displayStatuses, trackingMode),
    [displayStatuses, trackingMode],
  );
  const clampedForecast = useMemo(() => {
    const scopedLevelForecasts = (scope === 'all' ? sheets.map(s => s.id) : [scope])
      .map(id => levelRollups[id]?.forecastDate ?? null);
    return clampProjectForecast(scopeRollup.forecastDate, scopedLevelForecasts);
  }, [scope, sheets, levelRollups, scopeRollup.forecastDate]);
  const planDelta = useMemo(
    () => planVsProjected(plannedFinish, clampedForecast.date),
    [plannedFinish, clampedForecast.date],
  );

  // ── Confidence bands (Schedule That Thinks P1/P2) ──
  // The honest spread around each projected finish, computed ONCE here (fixed
  // seed → stable numbers) and threaded down. Additive: the point forecasts
  // above are untouched; a suppressed forecast carries a suppressed band.
  const scopeBand = useMemo(
    () => bandForRollup(scopeRollup, today, FORECAST_BAND_SEED),
    [scopeRollup, today],
  );
  const levelBands = useMemo(() => {
    const map: Record<string, ForecastBand> = {};
    for (const sheet of sheets) {
      const rollup = levelRollups[sheet.id];
      if (rollup) map[sheet.id] = bandForRollup(rollup, today, FORECAST_BAND_SEED);
    }
    return map;
  }, [sheets, levelRollups, today]);
  // Basis rule (consistency): the hero band matches whatever basis the clamp
  // chose. When the clamp pinned the hero to a level's forecast, show THAT
  // level's band (the pinning level is the one with the latest level forecast —
  // by construction the date the clamp landed on); otherwise the scope band.
  // One basis, one story — never two contradictory ranges.
  const heroBand = useMemo(() => {
    if (clampedForecast.clampedToLevel) {
      const scopedIds = scope === 'all' ? sheets.map(s => s.id) : [scope];
      let pinId: string | null = null;
      let latest: string | null = null;
      for (const id of scopedIds) {
        const f = levelRollups[id]?.forecastDate ?? null;
        if (f && (latest === null || f > latest)) { latest = f; pinId = id; }
      }
      if (pinId && levelBands[pinId]) return levelBands[pinId];
    }
    return scopeBand;
  }, [clampedForecast.clampedToLevel, scope, sheets, levelRollups, levelBands, scopeBand]);

  // ── Highest-impact move (Schedule That Thinks P4) ──
  // The single cross-level pace transplant that pulls the PROJECT finish in the
  // most, from the lifted level rollups (no new query). Null when nothing
  // meaningful. Surfaced only at all-levels scope (it's inherently cross-level).
  const bestMove = useMemo(
    () => bestPaceMove({ levelRollups, today, seed: FORECAST_BAND_SEED }),
    [levelRollups, today],
  );

  const { overallProgress, activityStats, totalUnits, totalCompletedTasks, totalPossibleTasks } = useMemo(() => {
    if (!displayUnits || displayUnits.length === 0) {
      return { overallProgress: 0, activityStats: [] as any[], totalUnits: 0, totalCompletedTasks: 0, totalPossibleTasks: 0 };
    }

    const currentTrackStatuses = displayStatuses.filter(s => s.track === trackingMode);
    const totalDisplayUnits = displayUnits.length;

    const stats = currentTrackActivities.map(activity => {
      let tCompleted = 0;
      let tOngoing = 0;
      let tNotStarted = 0;
      const completedUnits: string[] = [];
      const ongoingUnits: string[] = [];
      const notStartedUnits: string[] = [];
      const naUnits: string[] = [];

      displayUnits.forEach(unit => {
        if (!isActivityApplicable(activity, unit, applicabilityIndex)) {
          naUnits.push(unit.unit_number);
          return;
        }
        const status = currentTrackStatuses.find(s => s.unit_id === unit.id && s.activityName === activity.name);

        if (!status || status.temporal_state === 'none') {
          tNotStarted++;
          notStartedUnits.push(unit.unit_number);
        } else if (status.temporal_state === 'completed') {
          tCompleted++;
          completedUnits.push(unit.unit_number);
        } else {
          // Captures 'ongoing' and 'planned'
          tOngoing++;
          ongoingUnits.push(unit.unit_number);
        }
      });

      return {
        ...activity,
        completed: tCompleted,
        completedUnits,
        ongoing: tOngoing,
        ongoingUnits,
        notStarted: tNotStarted,
        notStartedUnits,
        naCount: naUnits.length,
        naUnits,
        // N/A slots leave the denominator — the bar represents work that exists
        total: totalDisplayUnits - naUnits.length
      };
    });

    // Applicability-aware denominator: stat.total already excludes N/A units.
    const possible = stats.reduce((sum, stat) => sum + stat.total, 0);
    const completed = stats.reduce((sum, stat) => sum + stat.completed, 0);
    const progress = possible > 0 ? Math.round((completed / possible) * 100) : 0;

    return {
      overallProgress: progress,
      activityStats: stats,
      totalUnits: totalDisplayUnits,
      totalCompletedTasks: completed,
      totalPossibleTasks: possible,
    };
  }, [displayUnits, displayStatuses, currentTrackActivities, trackingMode, applicabilityIndex]);

  // ----- Velocity Chart Data Engine -----
  const chartData = useMemo(() => {
    const scopedHistory = trackHistory.filter(log => log.unit_id && displayUnitIds.has(log.unit_id as string));
    if (scopedHistory.length === 0) return [];

    const totalScope = applicableSlotCount(displayUnits, currentTrackActivities, applicabilityIndex);
    if (totalScope === 0) return [];

    // Planned cumulative line: how many slots were planned to finish by each date.
    const plannedEnds = displayStatuses
      .filter(s => s.track === trackingMode && s.planned_end_date)
      .map(s => parseDay(s.planned_end_date)!.getTime())
      .sort((a, b) => a - b);

    const byDay: Record<string, number> = {};
    scopedHistory.forEach((log: any) => {
      byDay[log.logged_date] = (byDay[log.logged_date] || 0) + 1;
    });

    const sortedDays = Object.keys(byDay).sort();
    if (sortedDays.length === 0) return [];

    const allDays = eachDayOfInterval({
      start: parseISO(sortedDays[0]),
      end: new Date(),
    });

    if (allDays.length > 90) {
      return bucketByWeek(allDays, byDay, totalScope, plannedEnds);
    }

    let cumulative = 0;
    return allDays.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      const daily = byDay[key] || 0;
      cumulative += daily;
      const cutoff = parseDay(key)?.getTime() ?? 0;
      return {
        date: key,
        label: format(d, 'MMM d'),
        dailyVelocity: daily,
        cumulativeCompleted: cumulative,
        plannedCumulative: plannedEnds.filter(t => t <= cutoff).length,
        totalScope,
      };
    });
  }, [trackHistory, displayUnitIds, displayUnits, displayStatuses, currentTrackActivities, trackingMode, applicabilityIndex]);

  const openMap = (sheetId: string) => {
    setActiveSheetId(sheetId);
    navigateToView('map');
  };

  if (!sheets || sheets.length === 0) {
    return (
      <div className="p-8 h-full flex items-center justify-center text-slate-500 glass-panel rounded-2xl border">
        No levels yet. Add a level and draw locations to see progress metrics.
      </div>
    );
  }

  const fmtFinish = (iso: string) => parseDay(iso)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // Projected finish = the CLAMPED aggregate (never earlier than the slowest in-scope level).
  const projectedDate = clampedForecast.date;
  const forecastLabel = projectedDate
    ? `~wk of ${fmtFinish(projectedDate)}`
    : scopeRollup.forecastSuppressed === 'complete' ? 'Complete'
    : '—';
  const forecastHint = projectedDate
    ? (clampedForecast.clampedToLevel
        ? `Pinned to the slowest level's pace — an all-levels projection can't finish before its slowest level. Based on the median weekly completion pace of the last ${FORECAST_WINDOW_WEEKS} weeks; a pace projection, not a commitment.`
        : `At the median weekly completion pace of the last ${FORECAST_WINDOW_WEEKS} weeks. A pace projection, not a commitment.`)
    : scopeRollup.forecastSuppressed === 'small-sample' ? `Too few tasks in this scope to project a finish — forecasts need at least ${SMALL_SAMPLE_SLOTS} tracked tasks.`
    : scopeRollup.forecastSuppressed === 'no-pace' ? `No completions in the last ${FORECAST_WINDOW_WEEKS} weeks — no pace to project from.`
    : scopeRollup.forecastSuppressed === 'complete' ? 'All tracked tasks in this scope are complete.'
    : 'Log completions to see a projection.';
  // The honest '—' (suppressed, never faked): muted dash + its reason caption.
  const forecastSuppressedCaption =
    scopeRollup.forecastSuppressed === 'small-sample' ? 'too few tasks to project'
    : scopeRollup.forecastSuppressed === 'no-pace' ? 'no recent pace'
    : null;
  // Planned vs Projected: whole-day delta wording (positive = projected late).
  const planComparison =
    planDelta === null ? null
    : planDelta > 0 ? { text: `${planDelta}d late`, cls: 'text-amber-600 dark:text-amber-400' }
    : planDelta < 0 ? { text: `${Math.abs(planDelta)}d ahead`, cls: 'text-emerald-600 dark:text-emerald-400' }
    : { text: 'on plan', cls: 'text-slate-500 dark:text-slate-400' };
  // The confidence range under the projected date — shown ONLY when there is a
  // point date and the band isn't suppressed (no band where there's no date).
  const heroBandRange =
    projectedDate && !heroBand.suppressed && heroBand.p10 && heroBand.p90
      ? { text: `${fmtFinish(heroBand.p10)}–${fmtFinish(heroBand.p90)}`, p50: heroBand.p50 }
      : null;
  // ── Band vs Promise (Phase 2) ──
  // "Are we going to keep our word?" — the hero band measured against the
  // owner-entered contract completion date. Non-null ONLY when a real date is set
  // AND the band is unsuppressed/dated; never a fabricated promise (AGENTS.md §3).
  const outlook = promiseOutlook({ promise: contractCompletionDate, band: heroBand });
  const promiseVerdict = outlook?.verdict ? PROMISE_VERDICT_DISPLAY[outlook.verdict] : null;

  return (
    <div className="w-full pb-6 space-y-6 overflow-y-auto h-full pr-2 p-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 glass-panel rounded-2xl border p-4 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Project Dashboard</h2>
          <p className="text-sm text-slate-500 font-medium mt-1">
            {scope === 'all'
              ? `Tracking ${totalUnits} locations across all levels.`
              : `Scoped to "${scopedSheet?.sheet_name || 'Level'}" — ${totalUnits} locations.`}
          </p>
        </div>
        {scope !== 'all' && (
          <button
            type="button"
            onClick={() => setScope('all')}
            className="self-start sm:self-auto px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/60 dark:bg-black/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            ← Back to all levels
          </button>
        )}
      </div>

      {/* ── Stalled swarm: one honest "data may be stale" banner instead of a
          shout of per-level chips (Data Storytelling P2) ── */}
      {stalledSwarm && (
        <div
          className="flex items-start gap-3 glass-panel rounded-2xl border border-amber-300/70 dark:border-amber-500/40 bg-amber-50/80 dark:bg-amber-900/20 p-4 shadow-sm"
          title={`"Stalled" = a started location with no logged status change in ${STALL_THRESHOLD_DAYS}+ days. When most of the project is stalled, the tracker data itself is likely out of date.`}
        >
          <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              No work logged in 2+ weeks across most of this project — the data may be out of date.
            </p>
            <p className="text-xs text-amber-700/90 dark:text-amber-300/80 mt-0.5">
              {buildingRollup.stalledUnitIds.length} of {buildingRollup.unitCount} locations have no status update in {STALL_THRESHOLD_DAYS}+ days. Log recent progress to restore an accurate forecast.
            </p>
          </div>
        </div>
      )}

      {/* ── Floor Pulse — per-level rollup rail (also the dashboard's scope control) ── */}
      <FloorPulse
        sheets={sheets}
        allUnits={allProjectUnits}
        statuses={allProjectStatuses}
        activities={activities}
        track={trackingMode}
        history={trackHistory}
        applicabilityIndex={applicabilityIndex}
        scope={scope}
        onScopeChange={setScope}
        onOpenMap={openMap}
        levelRollups={levelRollups}
        levelBands={levelBands}
        buildingRollup={buildingRollup}
        stalledSwarm={stalledSwarm}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel rounded-2xl border p-6 flex items-center shadow-sm relative group">
          <div className="p-4 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full mr-4">
            <Target size={28} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 cursor-help">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Tasks Complete</h3>
              <Info size={14} className="text-slate-400" />
            </div>
            <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-1">
              {overallProgress}%
              <span className="text-sm font-semibold text-slate-400 ml-2">{totalCompletedTasks}/{totalPossibleTasks}</span>
            </p>
          </div>
          <div className="absolute left-6 bottom-full mb-3 hidden group-hover:block w-64 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 px-3 py-2 rounded-xl text-xs shadow-2xl pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20 z-50">
            Completed activity tasks out of all possible tasks in this scope. Counts tasks equally — it is not a schedule percentage.
          </div>
        </div>

        <div className="glass-panel rounded-2xl border p-6 flex items-center shadow-sm relative group">
          <div className="p-4 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full mr-4">
            <CalendarClock size={28} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 cursor-help">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Planned vs Projected</h3>
              <Info size={14} className="text-slate-400" />
            </div>
            <p
              className={`text-3xl font-bold mt-1 ${forecastSuppressedCaption ? 'text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'}`}
              title={forecastHint}
            >
              {forecastLabel}
              <span className="text-xs font-medium text-slate-400 ml-2">projected</span>
            </p>
            {heroBandRange && (
              <p
                className="text-xs text-slate-500 dark:text-slate-400 mt-0.5"
                title={`Likely finish ${heroBandRange.text}${heroBandRange.p50 ? ` · median ${fmtFinish(heroBandRange.p50)}` : ''}. ${bandMethodSentence()}`}
              >
                likely <span className="font-semibold text-slate-600 dark:text-slate-300">{heroBandRange.text}</span>
              </p>
            )}
            {forecastSuppressedCaption && (
              <p className="text-[10px] text-slate-400 mt-0.5" title={forecastHint}>{forecastSuppressedCaption}</p>
            )}
            {clampedForecast.clampedToLevel && projectedDate && (
              <p className="text-[10px] text-slate-400 mt-0.5" title={forecastHint}>pinned to a level&apos;s pace</p>
            )}
            {/* ── Band vs Promise (P2): the payoff — "are we keeping our word?".
                Leads over the demoted "vs planned" line when a contract completion
                date is set; renders nothing with no real date or a suppressed band. ── */}
            {outlook && promiseVerdict && contractCompletionDate && (
              <p
                className="text-xs font-medium text-slate-600 dark:text-slate-300 mt-1"
                title={`Your 80% likely finish measured against the contract completion date (${fmtFinish(contractCompletionDate)})${heroBandRange ? ` — likely ${heroBandRange.text}` : ''}. ${bandMethodSentence()}`}
              >
                vs promised <span className="font-semibold text-slate-700 dark:text-slate-200">{fmtFinish(contractCompletionDate)}</span>
                {' · '}<span className={`font-bold ${promiseVerdict.cls}`}>{promiseVerdict.label}</span>
                {outlook.medianDeltaDays !== null && outlook.medianDeltaDays !== 0 && (
                  <span className="text-slate-500 dark:text-slate-400"> · {promiseDeltaText(outlook.medianDeltaDays)}</span>
                )}
              </p>
            )}
            {/* No promise set, but there IS an honest band to measure it against — nudge. */}
            {!contractCompletionDate && !heroBand.suppressed && !!heroBand.p50 && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-snug">
                Set a contract completion date in <span className="font-medium">Settings → Project Info</span> to track the promise.
              </p>
            )}
            {plannedFinish ? (
              <p className={`mt-1 ${outlook ? 'text-[11px] text-slate-400 dark:text-slate-500' : 'text-xs font-medium text-slate-500 dark:text-slate-400'}`}>
                vs planned <span className={outlook ? 'font-medium' : 'font-semibold text-slate-700 dark:text-slate-200'}>{fmtFinish(plannedFinish)}</span>
                {planComparison && <> · <span className={`font-bold ${planComparison.cls}`}>{planComparison.text}</span></>}
              </p>
            ) : (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-snug">
                Set planned dates (Schedule → <span className="font-medium">Level dates</span> or <span className="font-medium">Import</span>) to see plan vs actual.
              </p>
            )}
            {/* Suppressed when the swarm banner already explains the stall project-wide. */}
            {!stalledSwarm && scopeRollup.stalledUnitIds.length > 0 && (
              <p
                className="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-0.5"
                title={`No movement in ${STALL_THRESHOLD_DAYS}+ days on started locations. Needs attention — distinct from "behind plan" (red).`}
              >
                {scopeRollup.stalledUnitIds.length} stalled location{scopeRollup.stalledUnitIds.length === 1 ? '' : 's'}
              </p>
            )}
          </div>
          <div className="absolute left-6 bottom-full mb-3 hidden group-hover:block w-64 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 px-3 py-2 rounded-xl text-xs shadow-2xl pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20 z-50">
            {forecastHint} Planned finish is the latest planned end date across this scope.
          </div>
        </div>
      </div>

      {/* ── Completion Velocity Chart ── */}
      <div className="glass-panel rounded-2xl border p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <TrendingUp size={20} className="text-emerald-500" />
              Completion Velocity
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {chartData.length > 0
                ? `${chartData[0].label} → ${chartData[chartData.length - 1].label} · ${chartData.length > 90 ? 'Weekly view' : 'Daily view'} · ${plannedFinish ? 'dashed = planned' : 'set planned dates to see the planned line'}`
                : 'Mark activities as Completed to see trends'}
            </p>
          </div>
          {chartData.length > 0 && (
            <div className="flex items-center gap-4 shrink-0">
              <div className="text-right">
                <div className="text-xs text-slate-400 mb-0.5">Progress</div>
                <div className="text-lg font-bold text-emerald-500">{overallProgress}%</div>
              </div>
              <button
                onClick={() => setIsChartExpanded(!isChartExpanded)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                title={isChartExpanded ? "Collapse chart" : "Expand chart"}
              >
                {isChartExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            </div>
          )}
        </div>
        <AnimatePresence initial={false}>
          {isChartExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="pt-2">
                <VelocityChart chartData={chartData} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Risk Radar — activities whose 80% finish range runs latest past plan ── */}
      <RiskRadar
        units={displayUnits}
        statuses={allProjectStatuses}
        activities={activities}
        track={trackingMode}
        history={trackHistory}
        applicabilityIndex={applicabilityIndex}
        scope={scope}
        sheets={sheets}
        scopeLabel={scope === 'all' ? 'all levels' : (scopedSheet?.sheet_name || 'level')}
        paceMove={bestMove.move}
        paceMoveEvaluated={bestMove.evaluated}
      />

      {/* ── Type Scorecard — which space type is dragging the schedule ── */}
      <TypeScorecard
        allUnits={allProjectUnits}
        statuses={allProjectStatuses}
        activities={activities}
        track={trackingMode}
        history={trackHistory}
        applicabilityIndex={applicabilityIndex}
      />

      {/* ── Production Rates — SF/week per cost code / sub, required-rate-vs-actual,
          the pace-critical trade, and the slipping-forecast trend (read-only) ── */}
      <ProductionRates
        allUnits={allProjectUnits}
        statuses={allProjectStatuses}
        activities={activities}
        track={trackingMode}
        history={trackHistory}
        applicabilityIndex={applicabilityIndex}
      />

      <div className="glass-panel rounded-2xl border p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6">Activity Breakdown</h2>
        <div className="space-y-6">
          {activityStats.length === 0 ? (
            <p className="text-slate-500">
              {totalUnits === 0
                ? 'No locations mapped in this scope yet. Switch to Map view to draw locations.'
                : `No activities configured for ${trackingMode}.`}
            </p>
          ) : (
            activityStats.map(stat => {
              const bgOngoingColor = stat.color ? `${stat.color}80` : '#94a3b8'; // 50% opacity for ongoing
              const bgCompletedColor = stat.color || '#3b82f6';
              const completedPct = (stat.completed / stat.total) * 100 || 0;
              const ongoingPct = (stat.ongoing / stat.total) * 100 || 0;

              return (
                <div key={stat.id} className="space-y-2">
                  <div className="flex justify-between text-sm font-medium">
                    <span className="text-slate-700 dark:text-slate-200">{stat.name}</span>
                    <span className="text-slate-500">
                      {stat.completed} / {stat.total}
                      {stat.naCount > 0 && (
                        <span className="ml-2 text-xs text-slate-400 italic">N/A: {stat.naCount}</span>
                      )}
                    </span>
                  </div>
                  <div className="relative w-full h-3 flex rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="absolute inset-0 rounded-full overflow-hidden flex">
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${completedPct}%`,
                          backgroundColor: bgCompletedColor
                        }}
                      />
                      <div
                        className="h-full transition-all duration-500 pattern-diagonal-lines sm:pattern-diagonal-lines-sm"
                        style={{
                          width: `${ongoingPct}%`,
                          backgroundColor: bgOngoingColor,
                          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.2) 5px, rgba(255,255,255,0.2) 10px)'
                        }}
                      />
                    </div>

                    {/* Transparent hover targets layered over the bars */}
                    <div className="absolute inset-0 flex rounded-full">
                      <div className="group relative h-full" style={{ width: `${completedPct}%` }}>
                        <div className="hidden group-hover:flex absolute bottom-full left-0 mb-3 w-48 flex-col bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 p-3 rounded-xl shadow-2xl z-50 pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20">
                          <div className="absolute -bottom-1.5 left-6 w-3 h-3 bg-slate-900/95 dark:bg-slate-100/95 rotate-45 border-r border-b border-slate-700 dark:border-white/20" />
                          <div className="font-bold text-[10px] uppercase tracking-widest opacity-80 mb-1 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: bgCompletedColor }} /> Completed ({stat.completed})</div>
                          <div className="text-xs font-medium leading-relaxed">
                            {stat.completedUnits.length > 0 ? (stat.completedUnits.length > 20 ? stat.completedUnits.slice(0, 20).join(', ') + ` ...and ${stat.completedUnits.length - 20} more` : stat.completedUnits.join(', ')) : 'None'}
                          </div>
                        </div>
                      </div>
                      <div className="group relative h-full" style={{ width: `${ongoingPct}%` }}>
                        <div className="hidden group-hover:flex absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-48 flex-col bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 p-3 rounded-xl shadow-2xl z-50 pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20">
                          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900/95 dark:bg-slate-100/95 rotate-45 border-r border-b border-slate-700 dark:border-white/20" />
                          <div className="font-bold text-[10px] uppercase tracking-widest opacity-80 mb-1 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: bgOngoingColor }} /> Ongoing ({stat.ongoing})</div>
                          <div className="text-xs font-medium leading-relaxed">
                            {stat.ongoingUnits.length > 0 ? (stat.ongoingUnits.length > 20 ? stat.ongoingUnits.slice(0, 20).join(', ') + ` ...and ${stat.ongoingUnits.length - 20} more` : stat.ongoingUnits.join(', ')) : 'None'}
                          </div>
                        </div>
                      </div>
                      <div className="group relative h-full flex-1">
                        <div className="hidden group-hover:flex absolute bottom-full right-0 mb-3 w-48 flex-col bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 p-3 rounded-xl shadow-2xl z-50 pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20">
                          <div className="absolute -bottom-1.5 right-6 w-3 h-3 bg-slate-900/95 dark:bg-slate-100/95 rotate-45 border-r border-b border-slate-700 dark:border-white/20" />
                          <div className="font-bold text-[10px] uppercase tracking-widest opacity-80 mb-1 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600" /> Not Started ({stat.notStarted})</div>
                          <div className="text-xs font-medium leading-relaxed">
                            {stat.notStartedUnits.length > 0 ? (stat.notStartedUnits.length > 20 ? stat.notStartedUnits.slice(0, 20).join(', ') + ` ...and ${stat.notStartedUnits.length - 20} more` : stat.notStartedUnits.join(', ')) : 'None'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs font-medium text-slate-500 mt-2">
                    <span className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: bgCompletedColor }} />
                      Completed ({stat.completed})
                    </span>
                    <span className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: bgOngoingColor }} />
                      Ongoing ({stat.ongoing})
                    </span>
                    <span className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                      Not Started ({stat.notStarted})
                    </span>
                    {stat.naCount > 0 && (
                      <span className="flex items-center gap-1 italic text-slate-400" title={stat.naUnits.slice(0, 20).join(', ')}>
                        <div className="w-2 h-2 rounded-full border border-dashed border-slate-400 dark:border-slate-500" />
                        N/A ({stat.naCount})
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
