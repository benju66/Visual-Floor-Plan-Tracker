"use client";
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { summarizeGroup, parseDay, PLAN_TICK_MIN_COVERAGE } from '@/utils/progressAnalytics';
import type { CompletionEvent, GroupRollup } from '@/utils/progressAnalytics';
import type { ApplicabilityIndex } from '@/utils/applicability';
import type { Unit, Milestone, StatusLog } from '@/types/domain';

/**
 * TypeScorecard — comparative leaderboard by unit_type, sorted worst-first,
 * always across all levels. Answers "which type is dragging the schedule?"
 * in the first row. Each row: completion vs planned tick, average bottleneck
 * variance chip, a 14-day completion sparkline (suppressed for tiny groups),
 * and a stalled count. Expanding a row reveals its burn-up (actual vs planned
 * cumulative completions).
 */

const SPARK_SUPPRESS_UNITS = 8;

export interface TypeScorecardProps {
  allUnits: Unit[];
  statuses: StatusLog[];
  milestones: Milestone[];
  track: string;
  history: CompletionEvent[];
  applicabilityIndex?: ApplicabilityIndex;
}

interface TypeRow {
  type: string;
  units: Unit[];
  rollup: GroupRollup;
}

function VarianceChip({ avg }: { avg: number | null }) {
  if (avg === null) {
    return <span className="text-[10px] text-slate-400 font-medium">no plan dates</span>;
  }
  const behind = avg > 0;
  const label = `${behind ? '−' : '+'}${Math.abs(avg).toFixed(1)}d avg`;
  const cls = avg >= 4 ? 'bg-red-600 text-white border-red-600'
    : avg >= 1 ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-400/70'
    : avg > -1 ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600'
    : 'bg-blue-500 text-white border-blue-500';
  return (
    <span className={`inline-block text-[11px] font-bold border rounded-md px-2 py-0.5 whitespace-nowrap ${cls}`} title="Average schedule variance of each location's bottleneck milestone (− = behind plan)">
      {label}
    </span>
  );
}

function Sparkline({ weekly, suppressed }: { weekly: { weekStart: string; count: number }[]; suppressed: boolean }) {
  if (suppressed) {
    return <span className="text-[10px] text-slate-400">— trend suppressed (small group)</span>;
  }
  const max = Math.max(1, ...weekly.map(w => w.count));
  const w = 72, h = 22;
  const step = w / Math.max(1, weekly.length - 1);
  const points = weekly.map((wk, i) => `${(i * step).toFixed(1)},${(h - 3 - (wk.count / max) * (h - 6)).toFixed(1)}`).join(' ');
  const first = weekly.slice(0, Math.ceil(weekly.length / 2)).reduce((s, x) => s + x.count, 0);
  const second = weekly.slice(Math.ceil(weekly.length / 2)).reduce((s, x) => s + x.count, 0);
  const trend = second > first ? '▲' : second < first ? '▼' : '—';
  const trendCls = second > first ? 'text-emerald-600 dark:text-emerald-400' : second < first ? 'text-red-600 dark:text-red-400' : 'text-slate-400';
  return (
    <span className="flex items-center gap-2">
      <svg width={w} height={h} className="overflow-visible">
        <polyline points={points} fill="none" stroke={second < first ? '#dc2626' : '#059669'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className={`text-xs font-bold ${trendCls}`}>{trend}</span>
    </span>
  );
}

function BurnUp({ row, statuses, track, history, today }: {
  row: TypeRow; statuses: StatusLog[]; track: string; history: CompletionEvent[]; today: Date;
}) {
  const data = useMemo(() => {
    const idSet = new Set(row.units.map(u => u.id));
    const actualDates = history
      .filter(h => h.unit_id && idSet.has(h.unit_id) && h.logged_date)
      .map(h => parseDay(h.logged_date)!.getTime())
      .sort((a, b) => a - b);
    const plannedDates = statuses
      .filter(s => s.track === track && s.unit_id && idSet.has(s.unit_id) && s.planned_end_date)
      .map(s => parseDay(s.planned_end_date)!.getTime())
      .sort((a, b) => a - b);
    if (actualDates.length === 0 && plannedDates.length === 0) return null;

    const all = [...actualDates, ...plannedDates, today.getTime()];
    const min = Math.min(...all), max = Math.max(...all);
    const span = Math.max(1, max - min);
    const W = 560, H = 72;
    const x = (t: number) => ((t - min) / span) * W;
    const yMax = Math.max(actualDates.length, plannedDates.length, 1);
    const y = (n: number) => H - 4 - (n / yMax) * (H - 10);

    const stepPoints = (dates: number[], clampTo?: number) => {
      const pts: string[] = [`${x(min).toFixed(1)},${y(0).toFixed(1)}`];
      dates.forEach((t, i) => {
        if (clampTo !== undefined && t > clampTo) return;
        pts.push(`${x(t).toFixed(1)},${y(i).toFixed(1)}`);
        pts.push(`${x(t).toFixed(1)},${y(i + 1).toFixed(1)}`);
      });
      return pts.join(' ');
    };

    return {
      W, H,
      actual: stepPoints(actualDates, today.getTime()),
      planned: stepPoints(plannedDates),
      todayX: x(today.getTime()),
      actualCount: actualDates.filter(t => t <= today.getTime()).length,
      plannedByNow: plannedDates.filter(t => t <= today.getTime()).length,
    };
  }, [row, statuses, track, history, today]);

  if (!data) {
    return <p className="text-xs text-slate-400 italic px-1 py-2">No completions or planned dates yet for this type.</p>;
  }

  return (
    <div className="mt-1 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/70 dark:bg-slate-800/40 p-3">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
        {row.type} · burn-up — actual vs planned completions
      </div>
      <svg viewBox={`0 0 ${data.W} ${data.H}`} className="w-full" preserveAspectRatio="none" style={{ height: 72 }}>
        <polyline points={data.planned} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4" />
        <polyline points={data.actual} fill="none" stroke={data.actualCount < data.plannedByNow ? '#dc2626' : '#059669'} strokeWidth="2" />
        <line x1={data.todayX} y1="0" x2={data.todayX} y2={data.H} stroke="#f97316" strokeWidth="1.5" />
      </svg>
      <div className="flex items-center gap-4 text-[10px] text-slate-500 mt-1">
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-emerald-600" /> actual ({data.actualCount})</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed border-slate-400" /> planned ({data.plannedByNow} due by now)</span>
        {data.actualCount < data.plannedByNow && (
          <span className="ml-auto font-semibold text-red-600 dark:text-red-400">
            {data.plannedByNow - data.actualCount} completions behind plan
          </span>
        )}
      </div>
    </div>
  );
}

export default function TypeScorecard({ allUnits, statuses, milestones, track, history, applicabilityIndex }: TypeScorecardProps) {
  const today = useMemo(() => new Date(), []);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo<TypeRow[]>(() => {
    const byType = new Map<string, Unit[]>();
    for (const u of allUnits) {
      const type = u.unit_type || 'Unspecified';
      const arr = byType.get(type);
      if (arr) arr.push(u);
      else byType.set(type, [u]);
    }
    const out: TypeRow[] = [];
    for (const [type, units] of byType) {
      out.push({ type, units, rollup: summarizeGroup({ units, statuses, milestones, track, history, today, applicabilityIndex }) });
    }
    // Worst first: most behind on average, then most stalled, then least complete.
    out.sort((a, b) => {
      const av = a.rollup.avgBehindDays, bv = b.rollup.avgBehindDays;
      if (av !== null || bv !== null) {
        if (av === null) return 1;
        if (bv === null) return -1;
        if (bv !== av) return bv - av;
      }
      if (b.rollup.stalledUnitIds.length !== a.rollup.stalledUnitIds.length) {
        return b.rollup.stalledUnitIds.length - a.rollup.stalledUnitIds.length;
      }
      return a.rollup.completionPct - b.rollup.completionPct;
    });
    return out;
  }, [allUnits, statuses, milestones, track, history, today, applicabilityIndex]);

  if (rows.length <= 1) return null; // a single type has nothing to compare

  return (
    <div className="glass-panel rounded-2xl border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200/60 dark:border-white/10">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">By Space Type</h2>
          <span className="text-[11px] text-slate-400">all levels</span>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 border border-slate-300/70 dark:border-white/15 rounded-full px-2.5 py-1">
          sorted by <span className="text-red-500">schedule risk</span>
        </span>
      </div>

      <div className="hidden sm:grid grid-cols-[minmax(120px,170px)_1fr_104px_130px_90px_28px] gap-x-4 px-5 py-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-200/60 dark:border-white/5">
        <span>Type</span><span>Completion vs plan</span><span>Variance</span><span>Trend</span><span>Stalled</span><span />
      </div>

      <div className="divide-y divide-slate-200/60 dark:divide-white/5">
        {rows.map((row, idx) => {
          const r = row.rollup;
          const completedPct = r.completionPct;
          const ongoingPct = r.totalSlots > 0 ? (r.ongoingSlots / r.totalSlots) * 100 : 0;
          const isExpanded = expanded === row.type;
          const suppressSpark = row.units.length < SPARK_SUPPRESS_UNITS;
          return (
            <div key={row.type} className={idx === 0 && (r.avgBehindDays ?? 0) >= 1 ? 'bg-red-50/40 dark:bg-red-900/5' : ''}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(isExpanded ? null : row.type)}
                onKeyDown={(e) => { if (e.key === 'Enter') setExpanded(isExpanded ? null : row.type); }}
                className="grid grid-cols-[minmax(100px,150px)_1fr_auto] sm:grid-cols-[minmax(120px,170px)_1fr_104px_130px_90px_28px] items-center gap-x-4 px-5 py-3 cursor-pointer hover:bg-slate-100/60 dark:hover:bg-white/5 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate flex items-center gap-2">
                    {row.type}
                    {idx === 0 && (r.avgBehindDays ?? 0) >= 1 && (
                      <span className="text-[8px] font-bold text-red-600 border border-red-400 rounded px-1 py-px tracking-widest shrink-0">RISK 1</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium tracking-wide">{row.units.length} LOCATIONS</div>
                </div>

                <div className="relative h-5 self-center">
                  <div className="absolute inset-0 rounded-md overflow-hidden flex bg-slate-200/80 dark:bg-slate-700/70 border border-slate-300/60 dark:border-white/10">
                    <div className="h-full bg-emerald-500" style={{ width: `${completedPct}%` }} />
                    <div
                      className="h-full bg-amber-400/80"
                      style={{
                        width: `${ongoingPct}%`,
                        backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.35) 4px, rgba(255,255,255,0.35) 8px)',
                      }}
                    />
                  </div>
                  {r.plannedByTodayPct !== null && r.plannedCoverage >= PLAN_TICK_MIN_COVERAGE && (
                    <div
                      className="absolute -top-1 -bottom-1 w-0.5 bg-slate-800 dark:bg-white z-10"
                      style={{ left: `${Math.min(99.5, r.plannedByTodayPct)}%` }}
                      title={`Planned to be ~${Math.round(r.plannedByTodayPct)}% by today`}
                    />
                  )}
                  <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white drop-shadow-sm">
                    {Math.round(completedPct)}%
                  </span>
                </div>

                <div className="hidden sm:block"><VarianceChip avg={r.avgBehindDays} /></div>
                <div className="hidden sm:block"><Sparkline weekly={r.weekly} suppressed={suppressSpark} /></div>
                <div className="hidden sm:block">
                  {r.stalledUnitIds.length > 0 ? (
                    <span className="inline-block text-[10px] font-bold text-red-600 dark:text-red-400 border border-red-400/70 rounded-full px-2 py-0.5">
                      {r.stalledUnitIds.length} stalled
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">0 stalled</span>
                  )}
                </div>
                <span className="text-slate-400 justify-self-end">{isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
              </div>

              {isExpanded && (
                <div className="px-5 pb-3">
                  <BurnUp row={row} statuses={statuses} track={track} history={history} today={today} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-5 py-2 text-[10px] text-slate-400 italic border-t border-slate-200/60 dark:border-white/5">
        click a row to expand its burn-up · variance averages each location&apos;s bottleneck milestone vs plan
      </p>
    </div>
  );
}
