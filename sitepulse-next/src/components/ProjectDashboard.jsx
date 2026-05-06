"use client";
import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { eachDayOfInterval, parseISO, format, startOfWeek } from 'date-fns';
import { Target, Activity, PauseCircle, Info, TrendingUp, ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAllProjectUnits, useAllProjectStatuses, useStatusHistory } from '@/hooks/useProjectQueries';

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
 *
 * @param {Date[]} allDays — full eachDayOfInterval output
 * @param {Object} byDay — { 'YYYY-MM-DD': count } map
 * @param {number} totalScope — total possible milestone completions
 */
function bucketByWeek(allDays, byDay, totalScope) {
  const weeks = {};
  allDays.forEach(d => {
    const weekStart = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const key = format(d, 'yyyy-MM-dd');
    if (!weeks[weekStart]) {
      weeks[weekStart] = { dailyVelocity: 0, label: `w/o ${format(d, 'MMM d')}` };
    }
    weeks[weekStart].dailyVelocity += byDay[key] || 0;
  });

  const sortedWeeks = Object.keys(weeks).sort();
  let cumulative = 0;
  return sortedWeeks.map(weekKey => {
    cumulative += weeks[weekKey].dailyVelocity;
    return {
      date: weekKey,
      label: weeks[weekKey].label,
      dailyVelocity: weeks[weekKey].dailyVelocity,
      cumulativeCompleted: cumulative,
      totalScope,
    };
  });
}

export default function ProjectDashboard({ units, activeStatuses, milestones, trackingMode, sheets, activeSheet }) {
  const [allSheets, setAllSheets] = useState(false);
  const [isChartExpanded, setIsChartExpanded] = useState(true);

  const sheetIds = useMemo(() => sheets?.map(s => s.id) || [], [sheets]);
  const { data: allProjectUnits = [] } = useAllProjectUnits(allSheets ? sheetIds : []);
  const allUnitIds = useMemo(() => allProjectUnits.map(u => u.id), [allProjectUnits]);
  const { data: allProjectStatuses = [] } = useAllProjectStatuses(allSheets ? allUnitIds : []);

  // Chart data: same unit ID scope as the allSheets toggle so KPIs and chart always match
  const chartUnitIds = useMemo(
    () => allSheets ? allUnitIds : units.map(u => u.id),
    [allSheets, allUnitIds, units]
  );
  const { data: rawHistory = [], isLoading: historyLoading } = useStatusHistory(chartUnitIds);

  const displayUnits = allSheets ? allProjectUnits : units;
  const displayStatuses = allSheets ? allProjectStatuses : activeStatuses;

  const currentTrackMilestones = useMemo(() => 
    milestones.filter(m => m.track === trackingMode), 
  [milestones, trackingMode]);

  const { overallProgress, activeLocations, notStarted, milestoneStats, totalUnits } = useMemo(() => {
    if (!displayUnits || displayUnits.length === 0) {
      return { overallProgress: 0, activeLocations: 0, notStarted: 0, milestoneStats: [], totalUnits: 0 };
    }

    const currentTrackStatuses = displayStatuses.filter(s => s.track === trackingMode);
    
    let completedCount = 0;
    let ongoingCount = 0;
    let notStartedCount = 0;

    displayUnits.forEach(unit => {
      const unitStatuses = currentTrackStatuses.filter(s => s.unit_id === unit.id);
      if (unitStatuses.length === 0) {
        notStartedCount++;
      } else {
        // Evaluate unit-level operational state
        const isFullyCompleted = currentTrackMilestones.every(m => {
           const log = unitStatuses.find(s => s.milestone === m.name);
           return log && log.temporal_state === 'completed';
        });
        
        if (isFullyCompleted) {
           completedCount++;
        } else {
           // It's actively being worked on but not 100% finished
           const hasActiveWork = unitStatuses.some(s => s.temporal_state !== 'none');
           if (hasActiveWork) {
             ongoingCount++;
           } else {
             notStartedCount++;
           }
        }
      }
    });

    const totalDisplayUnits = displayUnits.length;

    const stats = currentTrackMilestones.map(milestone => {
      let tCompleted = 0;
      let tOngoing = 0;
      let tNotStarted = 0;
      let completedUnits = [];
      let ongoingUnits = [];
      let notStartedUnits = [];

      displayUnits.forEach(unit => {
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
        total: totalDisplayUnits
      };
    });

    const totalPossibleTasks = totalDisplayUnits * currentTrackMilestones.length;
    const totalCompletedTasks = stats.reduce((sum, stat) => sum + stat.completed, 0);
    const totalNotStartedTasks = stats.reduce((sum, stat) => sum + stat.notStarted, 0);
    const progress = totalPossibleTasks > 0 ? Math.round((totalCompletedTasks / totalPossibleTasks) * 100) : 0;

    return {
      overallProgress: progress,
      activeLocations: ongoingCount,
      notStarted: totalNotStartedTasks,
      milestoneStats: stats,
      totalUnits: totalDisplayUnits
    };
  }, [displayUnits, displayStatuses, currentTrackMilestones, trackingMode]);

  // ----- Velocity Chart Data Engine -----
  const chartData = useMemo(() => {
    const trackHistory = rawHistory.filter(log => log.track === trackingMode);
    if (trackHistory.length === 0) return [];

    const totalScope = displayUnits.length * currentTrackMilestones.length;
    if (totalScope === 0) return [];

    const byDay = {};
    trackHistory.forEach(log => {
      byDay[log.logged_date] = (byDay[log.logged_date] || 0) + 1;
    });

    const sortedDays = Object.keys(byDay).sort();
    if (sortedDays.length === 0) return [];

    const allDays = eachDayOfInterval({
      start: parseISO(sortedDays[0]),
      end: new Date(),
    });

    if (allDays.length > 90) {
      return bucketByWeek(allDays, byDay, totalScope);
    }

    let cumulative = 0;
    return allDays.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      const daily = byDay[key] || 0;
      cumulative += daily;
      return {
        date: key,
        label: format(d, 'MMM d'),
        dailyVelocity: daily,
        cumulativeCompleted: cumulative,
        totalScope,
      };
    });
  }, [rawHistory, trackingMode, displayUnits, currentTrackMilestones]);

  if (!units || units.length === 0) {
    return (
      <div className="p-8 h-full flex flex-col items-center justify-center text-slate-500 glass-panel rounded-2xl border gap-4">
        <span>No locations mapped on this level yet. Switch to Map view to draw locations to see metrics.</span>
        {sheets?.length > 1 && !allSheets && (
           <button onClick={() => setAllSheets(true)} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow font-medium transition-colors">
              View All Levels
           </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full pb-6 space-y-6 overflow-y-auto h-full pr-2 p-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel rounded-2xl border p-4 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            Project Dashboard
          </h2>
          <p className="text-sm text-slate-500 font-medium mt-1">
            {allSheets ? `Tracking all ${totalUnits} locations across all levels.` : `Tracking ${totalUnits} locations on level "${activeSheet?.sheet_name || 'Active'}".`}
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm bg-white/50 dark:bg-black/20">
          <button
            type="button"
            onClick={() => setAllSheets(false)}
            className={`px-4 py-2 text-sm font-semibold transition-colors ${
              !allSheets
                ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            Active Level
          </button>
          <button
            type="button"
            onClick={() => setAllSheets(true)}
            className={`px-4 py-2 text-sm font-semibold border-l border-slate-300/80 dark:border-white/10 transition-colors ${
              allSheets
                ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            All Levels
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel rounded-2xl border p-6 flex items-center shadow-sm relative group">
          <div className="p-4 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full mr-4">
            <Target size={28} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 cursor-help">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Overall Progress</h3>
              <Info size={14} className="text-slate-400" />
            </div>
            <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-1">{overallProgress}%</p>
          </div>
          <div className="absolute left-6 bottom-full mb-3 hidden group-hover:block w-64 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 px-3 py-2 rounded-xl text-xs shadow-2xl pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20 z-50">
            Percentage of all possible milestones completed across all tracked locations.
          </div>
        </div>

        <div className="glass-panel rounded-2xl border p-6 flex items-center shadow-sm relative group">
          <div className="p-4 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full mr-4">
            <Activity size={28} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 cursor-help">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Active Locations</h3>
              <Info size={14} className="text-slate-400" />
            </div>
            <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-1">{activeLocations}</p>
          </div>
          <div className="absolute left-6 bottom-full mb-3 hidden group-hover:block w-64 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 px-3 py-2 rounded-xl text-xs shadow-2xl pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20 z-50">
            Total number of locations currently marked as "Ongoing" or "Planned".
          </div>
        </div>

        <div className="glass-panel rounded-2xl border p-6 flex items-center shadow-sm relative group">
          <div className="p-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-full mr-4">
            <PauseCircle size={28} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 cursor-help">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Not Started Tasks</h3>
              <Info size={14} className="text-slate-400" />
            </div>
            <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 mt-1">{notStarted}</p>
          </div>
          <div className="absolute left-6 bottom-full mb-3 hidden group-hover:block w-64 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 px-3 py-2 rounded-xl text-xs shadow-2xl pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20 z-50">
            Total number of milestone tasks across all locations that remain unstarted.
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
                ? `${chartData[0].label} → ${chartData[chartData.length - 1].label} · ${chartData.length > 90 ? 'Weekly view' : 'Daily view'}`
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

      <div className="glass-panel rounded-2xl border p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6">Milestone Breakdown</h2>
        <div className="space-y-6">
          {milestoneStats.length === 0 ? (
            <p className="text-slate-500">No milestones configured for {trackingMode}.</p>
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
                    <span className="group relative flex items-center gap-1 cursor-default">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: bgCompletedColor }} />
                      Completed ({stat.completed})
                      
                      <div className="hidden group-hover:flex absolute bottom-full left-0 mb-2 w-48 flex-col bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 p-3 rounded-xl shadow-2xl z-50 pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20">
                        <div className="absolute -bottom-1.5 left-6 w-3 h-3 bg-slate-900/95 dark:bg-slate-100/95 rotate-45 border-r border-b border-slate-700 dark:border-white/20" />
                        <div className="font-bold text-[10px] uppercase tracking-widest opacity-80 mb-1 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: bgCompletedColor }} /> Completed ({stat.completed})</div>
                        <div className="text-xs font-medium leading-relaxed normal-case tracking-normal">
                          {stat.completedUnits.length > 0 ? (stat.completedUnits.length > 20 ? stat.completedUnits.slice(0, 20).join(', ') + ` ...and ${stat.completedUnits.length - 20} more` : stat.completedUnits.join(', ')) : 'None'}
                        </div>
                      </div>
                    </span>
                    <span className="group relative flex items-center gap-1 cursor-default">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: bgOngoingColor }} />
                      Ongoing ({stat.ongoing})
                      
                      <div className="hidden group-hover:flex absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 flex-col bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 p-3 rounded-xl shadow-2xl z-50 pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20">
                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900/95 dark:bg-slate-100/95 rotate-45 border-r border-b border-slate-700 dark:border-white/20" />
                        <div className="font-bold text-[10px] uppercase tracking-widest opacity-80 mb-1 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: bgOngoingColor }} /> Ongoing ({stat.ongoing})</div>
                        <div className="text-xs font-medium leading-relaxed normal-case tracking-normal">
                          {stat.ongoingUnits.length > 0 ? (stat.ongoingUnits.length > 20 ? stat.ongoingUnits.slice(0, 20).join(', ') + ` ...and ${stat.ongoingUnits.length - 20} more` : stat.ongoingUnits.join(', ')) : 'None'}
                        </div>
                      </div>
                    </span>
                    <span className="group relative flex items-center gap-1 cursor-default">
                      <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                      Not Started ({stat.notStarted})
                      
                      <div className="hidden group-hover:flex absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 flex-col bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 p-3 rounded-xl shadow-2xl z-50 pointer-events-none animate-in fade-in zoom-in-95 duration-150 border border-slate-700 dark:border-white/20">
                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900/95 dark:bg-slate-100/95 rotate-45 border-r border-b border-slate-700 dark:border-white/20" />
                        <div className="font-bold text-[10px] uppercase tracking-widest opacity-80 mb-1 flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600" /> Not Started ({stat.notStarted})</div>
                        <div className="text-xs font-medium leading-relaxed normal-case tracking-normal">
                          {stat.notStartedUnits.length > 0 ? (stat.notStartedUnits.length > 20 ? stat.notStartedUnits.slice(0, 20).join(', ') + ` ...and ${stat.notStartedUnits.length - 20} more` : stat.notStartedUnits.join(', ')) : 'None'}
                        </div>
                      </div>
                    </span>
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
