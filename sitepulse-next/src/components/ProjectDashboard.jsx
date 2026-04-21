import React, { useMemo, useState } from 'react';
import { Target, Activity, PauseCircle, Layers, Info } from 'lucide-react';
import { useAllProjectUnits, useAllProjectStatuses } from '@/hooks/useProjectQueries';

export default function ProjectDashboard({ units, activeStatuses, milestones, trackingMode, sheets, activeSheet }) {
  const [allSheets, setAllSheets] = useState(false);

  const sheetIds = useMemo(() => sheets?.map(s => s.id) || [], [sheets]);
  const { data: allProjectUnits = [] } = useAllProjectUnits(allSheets ? sheetIds : []);
  const allUnitIds = useMemo(() => allProjectUnits.map(u => u.id), [allProjectUnits]);
  const { data: allProjectStatuses = [] } = useAllProjectStatuses(allSheets ? allUnitIds : []);

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

      displayUnits.forEach(unit => {
        const status = currentTrackStatuses.find(s => s.unit_id === unit.id && s.milestone === milestone.name);
        
        if (!status || status.temporal_state === 'none') {
          tNotStarted++;
        } else if (status.temporal_state === 'completed') {
          tCompleted++;
        } else {
          // Captures 'ongoing' and 'planned'
          tOngoing++;
        }
      });

      return {
        ...milestone,
        completed: tCompleted,
        ongoing: tOngoing,
        notStarted: tNotStarted,
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
                  <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 flex overflow-hidden">
                    <div 
                      className="h-full transition-all duration-500" 
                      style={{ 
                        width: `${completedPct}%`, 
                        backgroundColor: bgCompletedColor 
                      }} 
                      title={`${stat.completed} Completed`}
                    />
                    <div 
                      className="h-full transition-all duration-500 pattern-diagonal-lines sm:pattern-diagonal-lines-sm" 
                      style={{ 
                        width: `${ongoingPct}%`, 
                        backgroundColor: bgOngoingColor,
                        backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(255,255,255,0.2) 5px, rgba(255,255,255,0.2) 10px)'
                      }} 
                      title={`${stat.ongoing} Ongoing/Planned`}
                    />
                  </div>
                  <div className="flex gap-4 text-xs font-medium text-slate-500">
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
