"use client";
import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { eachDayOfInterval, parseISO, format, startOfWeek } from 'date-fns';
import { Target, CalendarClock, Info, TrendingUp, ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAllProjectUnits, useAllProjectStatuses, useStatusHistory } from '@/hooks/useProjectQueries';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { summarizeGroup, parseDay } from '@/utils/progressAnalytics';
import { isMilestoneApplicable, applicableSlotCount, EMPTY_APPLICABILITY_INDEX } from '@/utils/applicability';
import type { ApplicabilityIndex } from '@/utils/applicability';
import FloorPulse from '@/components/dashboard/FloorPulse';
import TypeScorecard from '@/components/dashboard/TypeScorecard';
import type { Unit, Milestone, StatusLog, Sheet, TrackingMode } from '@/types/domain';

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

interface ProjectDashboardProps {
  units: Unit[];
  activeStatuses: StatusLog[];
  milestones: Milestone[];
  trackingMode: TrackingMode;
  sheets?: Sheet[];
  activeSheet?: Sheet | null;
  applicabilityIndex?: ApplicabilityIndex;
}

export default function ProjectDashboard({ milestones, trackingMode, sheets = [], applicabilityIndex = EMPTY_APPLICABILITY_INDEX }: ProjectDashboardProps) {
  // Scope replaces the old Active Level / All Levels toggle: Floor Pulse rows set it.
  const [scope, setScope] = useState<string>('all');
  const [isChartExpanded, setIsChartExpanded] = useState(true);

  const setActiveSheetId = useMapStore(s => s.setActiveSheetId);
  const setViewMode = useUIStore(s => s.setViewMode);

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

  const currentTrackMilestones = useMemo(() =>
    milestones.filter(m => m.track === trackingMode),
  [milestones, trackingMode]);

  // Rollup for the scoped selection — drives the KPI cards.
  const scopeRollup = useMemo(() => summarizeGroup({
    units: displayUnits,
    statuses: allProjectStatuses,
    milestones,
    track: trackingMode,
    history: trackHistory,
    today,
    applicabilityIndex,
  }), [displayUnits, allProjectStatuses, milestones, trackingMode, trackHistory, today, applicabilityIndex]);

  const { overallProgress, milestoneStats, totalUnits, totalCompletedTasks, totalPossibleTasks } = useMemo(() => {
    if (!displayUnits || displayUnits.length === 0) {
      return { overallProgress: 0, milestoneStats: [] as any[], totalUnits: 0, totalCompletedTasks: 0, totalPossibleTasks: 0 };
    }

    const currentTrackStatuses = displayStatuses.filter(s => s.track === trackingMode);
    const totalDisplayUnits = displayUnits.length;

    const stats = currentTrackMilestones.map(milestone => {
      let tCompleted = 0;
      let tOngoing = 0;
      let tNotStarted = 0;
      const completedUnits: string[] = [];
      const ongoingUnits: string[] = [];
      const notStartedUnits: string[] = [];
      const naUnits: string[] = [];

      displayUnits.forEach(unit => {
        if (!isMilestoneApplicable(milestone, unit, applicabilityIndex)) {
          naUnits.push(unit.unit_number);
          return;
        }
        const status = currentTrackStatuses.find(s => s.unit_id === unit.id && s.milestone === milestone.name);

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
        ...milestone,
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
      milestoneStats: stats,
      totalUnits: totalDisplayUnits,
      totalCompletedTasks: completed,
      totalPossibleTasks: possible,
    };
  }, [displayUnits, displayStatuses, currentTrackMilestones, trackingMode, applicabilityIndex]);

  // ----- Velocity Chart Data Engine -----
  const chartData = useMemo(() => {
    const scopedHistory = trackHistory.filter(log => log.unit_id && displayUnitIds.has(log.unit_id as string));
    if (scopedHistory.length === 0) return [];

    const totalScope = applicableSlotCount(displayUnits, currentTrackMilestones, applicabilityIndex);
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
  }, [trackHistory, displayUnitIds, displayUnits, displayStatuses, currentTrackMilestones, trackingMode, applicabilityIndex]);

  const openMap = (sheetId: string) => {
    setActiveSheetId(sheetId);
    setViewMode('map');
  };

  if (!sheets || sheets.length === 0) {
    return (
      <div className="p-8 h-full flex items-center justify-center text-slate-500 glass-panel rounded-2xl border">
        No levels yet. Add a level and draw locations to see progress metrics.
      </div>
    );
  }

  const forecastLabel = scopeRollup.forecastDate
    ? `~wk of ${parseDay(scopeRollup.forecastDate)?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : scopeRollup.forecastSuppressed === 'complete' ? 'Complete'
    : '—';
  const forecastHint = scopeRollup.forecastDate
    ? 'At the median weekly completion pace of the last 6 weeks. A pace projection, not a commitment.'
    : scopeRollup.forecastSuppressed === 'small-sample' ? 'Too few tasks in this scope to project a finish.'
    : scopeRollup.forecastSuppressed === 'no-pace' ? 'No completions in recent weeks — no pace to project from.'
    : scopeRollup.forecastSuppressed === 'complete' ? 'All tracked tasks in this scope are complete.'
    : 'Log completions to see a projection.';

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

      {/* ── Floor Pulse — per-level rollup rail (also the dashboard's scope control) ── */}
      <FloorPulse
        sheets={sheets}
        allUnits={allProjectUnits}
        statuses={allProjectStatuses}
        milestones={milestones}
        track={trackingMode}
        history={trackHistory}
        applicabilityIndex={applicabilityIndex}
        scope={scope}
        onScopeChange={setScope}
        onOpenMap={openMap}
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
            Completed milestone tasks out of all possible tasks in this scope. Counts tasks equally — it is not a schedule percentage.
          </div>
        </div>

        <div className="glass-panel rounded-2xl border p-6 flex items-center shadow-sm relative group">
          <div className="p-4 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full mr-4">
            <CalendarClock size={28} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 cursor-help">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Projected Finish</h3>
              <Info size={14} className="text-slate-400" />
            </div>
            <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-1">{forecastLabel}</p>
            {scopeRollup.stalledUnitIds.length > 0 && (
              <p className="text-xs font-semibold text-red-500 mt-0.5">{scopeRollup.stalledUnitIds.length} stalled location{scopeRollup.stalledUnitIds.length === 1 ? '' : 's'}</p>
            )}
          </div>
          <div className="absolute left-6 bottom-full mb-3 hidden group-hover:block w-64 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 px-3 py-2 rounded-xl text-xs shadow-2xl pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20 z-50">
            {forecastHint}
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
                ? `${chartData[0].label} → ${chartData[chartData.length - 1].label} · ${chartData.length > 90 ? 'Weekly view' : 'Daily view'} · dashed = planned`
                : 'Mark milestones as Completed to see trends'}
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

      {/* ── Type Scorecard — which space type is dragging the schedule ── */}
      <TypeScorecard
        allUnits={allProjectUnits}
        statuses={allProjectStatuses}
        milestones={milestones}
        track={trackingMode}
        history={trackHistory}
        applicabilityIndex={applicabilityIndex}
      />

      <div className="glass-panel rounded-2xl border p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6">Milestone Breakdown</h2>
        <div className="space-y-6">
          {milestoneStats.length === 0 ? (
            <p className="text-slate-500">
              {totalUnits === 0
                ? 'No locations mapped in this scope yet. Switch to Map view to draw locations.'
                : `No milestones configured for ${trackingMode}.`}
            </p>
          ) : (
            milestoneStats.map(stat => {
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
