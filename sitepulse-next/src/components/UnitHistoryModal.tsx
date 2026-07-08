"use client";
import React, { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { X, Clock, HelpCircle } from 'lucide-react';
import { useUnitHistory, useProjectMembers } from '@/hooks/useProjectQueries';
import {
  computeUnitVariance,
  varianceFill,
  varianceLabel,
  orderedTrackActivities,
  parseDay,
  dayDiff,
  firstOngoingIso,
} from '@/utils/progressAnalytics';
import { applicableActivities } from '@/utils/applicability';
import type { ApplicabilityIndex } from '@/utils/applicability';
import type { Activity, StatusLog } from '@/types/domain';

/** Audit rows come back through useUnitHistory typed as StatusLog but carry changed_at. */
type AuditRow = StatusLog & { changed_at?: string | null; user_id?: string | null };

interface UnitHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  unitId: string | null;
  unitNumber?: string | null;
  activities?: Activity[];
  trackingMode?: string;
  /** Current-state logs (status_logs) for the active sheet — supplies planned windows. */
  currentStatuses?: StatusLog[];
  /** Unit type + applicability index drop N/A activities from the journey. */
  unitType?: string | null;
  applicabilityIndex?: ApplicabilityIndex;
}

interface JourneyRow {
  activity: Activity;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null; // null while ongoing
  state: string;          // current temporal state ('none' if no log)
  idleFrom: Date | null;  // gap between previous activity finishing and this one starting
  idleTo: Date | null;
}

const DAY_MS = 86_400_000;
const IDLE_LABEL_THRESHOLD = 5;

function tsDay(stamp: string | null | undefined): Date | null {
  if (!stamp) return null;
  const t = Date.parse(stamp);
  return Number.isNaN(t) ? null : new Date(t);
}

function fmt(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function UnitHistoryModal({
  isOpen,
  onClose,
  unitId,
  unitNumber,
  activities = [],
  trackingMode = '',
  currentStatuses = [],
  unitType = null,
  applicabilityIndex,
}: UnitHistoryModalProps) {
  const { data: rawLogs, isPending } = useUnitHistory(unitId || '');
  const [tab, setTab] = useState<'journey' | 'log'>('journey');

  // "By whom" (P3): the audit rows carry user_id but no profile join, so resolve
  // display names client-side via the already-cached project members map.
  const params = useParams();
  const projectId = (params?.projectId as string) || '';
  const { data: members = [] } = useProjectMembers(projectId);
  const nameByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      const label = m.profiles?.display_name || m.profiles?.email || null;
      if (m.user_id && label) map.set(m.user_id, label);
    }
    return map;
  }, [members]);

  // --- Log tab: dedupe identical consecutive audit entries (existing behavior) ---
  const logs = useMemo(() => {
    if (!rawLogs) return [] as AuditRow[];
    const deduped: AuditRow[] = [];
    (rawLogs as AuditRow[]).forEach((log, index) => {
      const prevLog = (rawLogs as AuditRow[])[index + 1];
      if (prevLog &&
          log.temporal_state === prevLog.temporal_state &&
          log.activityName === prevLog.activityName &&
          log.track === prevLog.track &&
          log.planned_start_date === prevLog.planned_start_date &&
          log.planned_end_date === prevLog.planned_end_date &&
          log.logged_date === prevLog.logged_date) {
        return;
      }
      deduped.push(log);
    });
    return deduped;
  }, [rawLogs]);

  // --- Journey tab: one swimlane per applicable activity in sequence order ---
  const today = useMemo(() => new Date(), []);
  const trackActivities = useMemo(() => {
    const ordered = orderedTrackActivities(activities, trackingMode);
    if (!unitId || !applicabilityIndex) return ordered;
    return applicableActivities(ordered, { id: unitId, unit_type: unitType }, applicabilityIndex);
  }, [activities, trackingMode, unitId, unitType, applicabilityIndex]);
  const unitCurrentLogs = useMemo(
    () => currentStatuses.filter(s => s.unit_id === unitId && s.track === trackingMode),
    [currentStatuses, unitId, trackingMode]
  );
  const variance = useMemo(
    () => computeUnitVariance(unitCurrentLogs, trackActivities, today),
    [unitCurrentLogs, trackActivities, today]
  );

  const journey = useMemo(() => {
    const audit = ([...(rawLogs as AuditRow[] | undefined) || []])
      .filter(l => l.track === trackingMode)
      .sort((a, b) => Date.parse(a.changed_at || a.created_at || '') - Date.parse(b.changed_at || b.created_at || ''));

    const rows: JourneyRow[] = [];
    let prevEnd: Date | null = null;

    for (const m of trackActivities) {
      const current = unitCurrentLogs.find(s => s.activityName === m.name);
      const events = audit.filter(l => l.activityName === m.name);
      const state = current?.temporal_state || 'none';

      const completions = events.filter(e => e.temporal_state === 'completed');
      const lastCompletion = completions.length > 0 ? completions[completions.length - 1] : undefined;

      const completionDay = state === 'completed'
        ? (parseDay(current?.logged_date) || parseDay(lastCompletion?.logged_date) || tsDay(lastCompletion?.changed_at))
        : null;

      // Actual start = the single shared definition (progressAnalytics.firstOngoingIso).
      let actualStart = tsDay(firstOngoingIso(events));
      if (!actualStart && completionDay) actualStart = completionDay; // jumped straight to complete
      if (actualStart && completionDay && actualStart > completionDay) actualStart = completionDay;

      const actualEnd = state === 'completed'
        ? completionDay
        : state === 'ongoing' && actualStart ? today : null;

      let idleFrom: Date | null = null;
      let idleTo: Date | null = null;
      if (prevEnd && actualStart && dayDiff(prevEnd, actualStart) >= 1) {
        idleFrom = prevEnd;
        idleTo = actualStart;
      }

      rows.push({
        activity: m,
        plannedStart: parseDay(current?.planned_start_date),
        plannedEnd: parseDay(current?.planned_end_date),
        actualStart,
        actualEnd,
        state,
        idleFrom,
        idleTo,
      });

      if (actualEnd && state === 'completed') prevEnd = actualEnd;
      else if (state === 'ongoing') prevEnd = null; // an open bar absorbs the gap downstream
    }

    // Time scale across everything visible (+ today), padded.
    const dates: Date[] = [today];
    rows.forEach(r => {
      [r.plannedStart, r.plannedEnd, r.actualStart, r.actualEnd].forEach(d => { if (d) dates.push(d); });
    });
    let min = new Date(Math.min(...dates.map(d => d.getTime())) - 4 * DAY_MS);
    let max = new Date(Math.max(...dates.map(d => d.getTime())) + 4 * DAY_MS);
    if (max.getTime() - min.getTime() < 21 * DAY_MS) {
      // Keep at least three weeks of scale so single-event journeys don't zoom absurdly.
      const mid = (max.getTime() + min.getTime()) / 2;
      min = new Date(mid - 10.5 * DAY_MS);
      max = new Date(mid + 10.5 * DAY_MS);
    }
    const span = max.getTime() - min.getTime();
    const pct = (d: Date) => ((d.getTime() - min.getTime()) / span) * 100;

    // Month ticks
    const ticks: { label: string; pct: number }[] = [];
    const cursor = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1, 12));
    while (cursor <= max) {
      if (cursor >= min) {
        ticks.push({
          label: cursor.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
          pct: pct(cursor),
        });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    const hasAnyDates = rows.some(r => r.plannedStart || r.plannedEnd || r.actualStart);
    return { rows, pct, ticks, todayPct: pct(today), hasAnyDates };
  }, [rawLogs, trackingMode, trackActivities, unitCurrentLogs, today]);

  if (!isOpen) return null;

  const verdictColor = varianceFill(variance);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-4xl flex flex-col max-h-[85vh] rounded-2xl border shadow-2xl relative"
        style={{
          background: 'var(--glass-bg, rgba(255, 255, 255, 0.9))',
          borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.8))',
        }}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200/50 dark:border-slate-700/50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg shrink-0">
              <Clock size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-800 dark:text-white truncate">Location {unitNumber}</h2>
              <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: verdictColor }} />
                <span>{varianceLabel(variance)}</span>
                {variance.bottleneck && <span className="opacity-60">· bottleneck: {variance.bottleneck}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm text-xs font-semibold">
              <button
                type="button"
                onClick={() => setTab('journey')}
                className={`px-3 py-1.5 transition-colors ${tab === 'journey' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'}`}
              >
                Journey
              </button>
              <button
                type="button"
                onClick={() => setTab('log')}
                className={`px-3 py-1.5 border-l border-slate-300/80 dark:border-white/10 transition-colors ${tab === 'log' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'}`}
              >
                Log
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50 dark:bg-slate-900/20">
          {isPending ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500">
              <svg className="h-8 w-8 animate-spin text-blue-600 mb-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span>Loading history...</span>
            </div>
          ) : tab === 'journey' ? (
            trackActivities.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-500">
                <HelpCircle size={32} className="opacity-50 mb-3" />
                <p>No activities configured for this track.</p>
              </div>
            ) : (
              <div className="select-none">
                {/* Month axis */}
                <div className="relative h-5 ml-[150px] mr-2">
                  {journey.ticks.map(t => (
                    <span
                      key={t.label + t.pct}
                      className="absolute -translate-x-1/2 text-[10px] font-semibold tracking-widest text-slate-400"
                      style={{ left: `${t.pct}%` }}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>

                {/* Swimlanes */}
                <div className="relative">
                  {/* month gridlines */}
                  <div className="absolute inset-y-0 left-[150px] right-2 pointer-events-none">
                    {journey.ticks.map(t => (
                      <div key={`g-${t.pct}`} className="absolute inset-y-0 w-px bg-slate-200 dark:bg-slate-700/60" style={{ left: `${t.pct}%` }} />
                    ))}
                    {/* today line */}
                    <div className="absolute inset-y-0 w-0.5 bg-orange-500 z-10" style={{ left: `${journey.todayPct}%` }}>
                      <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full text-[9px] font-bold tracking-widest bg-orange-500 text-white px-1.5 py-px rounded whitespace-nowrap">
                        TODAY
                      </span>
                    </div>
                  </div>

                  {journey.rows.map((r, idx) => {
                    const dur = r.actualStart && r.actualEnd ? Math.max(1, dayDiff(r.actualStart, r.actualEnd)) : null;
                    const plannedDur = r.plannedStart && r.plannedEnd ? Math.max(1, dayDiff(r.plannedStart, r.plannedEnd)) : null;
                    const idleDays = r.idleFrom && r.idleTo ? dayDiff(r.idleFrom, r.idleTo) : 0;
                    const isOpen = r.state === 'ongoing';
                    return (
                      <div key={r.activity.id} className={`flex items-center h-12 ${idx % 2 === 1 ? 'bg-slate-900/[0.03] dark:bg-white/[0.03]' : ''}`}>
                        <div className="w-[150px] shrink-0 pr-3 text-right">
                          <div className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 truncate">{r.activity.name}</div>
                          <div className="text-[9px] tracking-widest text-slate-400 font-medium">
                            {r.state === 'none' ? 'NOT STARTED' : r.state.toUpperCase()}
                            {isOpen && dur !== null && ` · ${dur}D IN${plannedDur ? ` / ${plannedDur}D PLANNED` : ''}`}
                          </div>
                        </div>
                        <div className="relative flex-1 h-full mr-2">
                          {/* planned ghost window */}
                          {r.plannedStart && r.plannedEnd && r.plannedEnd > r.plannedStart && (
                            <div
                              className="absolute top-[30px] h-2 rounded border border-dashed border-slate-400/70 bg-slate-400/10"
                              style={{ left: `${journey.pct(r.plannedStart)}%`, width: `${Math.max(0.5, journey.pct(r.plannedEnd) - journey.pct(r.plannedStart))}%` }}
                              title={`Planned ${fmt(r.plannedStart)} – ${fmt(r.plannedEnd)}`}
                            />
                          )}
                          {/* idle gap */}
                          {r.idleFrom && r.idleTo && idleDays >= 1 && (
                            <div
                              className="absolute top-[19px] h-1.5"
                              style={{
                                left: `${journey.pct(r.idleFrom)}%`,
                                width: `${Math.max(0.5, journey.pct(r.idleTo) - journey.pct(r.idleFrom))}%`,
                                backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 4px, rgba(220,38,38,.55) 4px 7px)',
                              }}
                              title={`Idle ${idleDays} days`}
                            >
                              {idleDays >= IDLE_LABEL_THRESHOLD && (
                                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-red-600 whitespace-nowrap">
                                  idle {idleDays}d
                                </span>
                              )}
                            </div>
                          )}
                          {/* actual bar */}
                          {r.actualStart && r.actualEnd && (
                            <div
                              className="absolute top-[12px] h-4 rounded border border-slate-700/50 dark:border-white/40 flex items-center"
                              style={{
                                left: `${journey.pct(r.actualStart)}%`,
                                width: `${Math.max(0.8, journey.pct(r.actualEnd) - journey.pct(r.actualStart))}%`,
                                backgroundColor: r.activity.color || '#64748b',
                                backgroundImage: isOpen
                                  ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 5px, transparent 5px 10px)'
                                  : undefined,
                              }}
                              title={`${r.activity.name}: ${fmt(r.actualStart)}${r.actualEnd ? ` – ${isOpen ? 'today' : fmt(r.actualEnd)}` : ''}`}
                            >
                              {dur !== null && dur >= 2 && (
                                <span className="text-[9px] font-bold text-white pl-1.5 drop-shadow whitespace-nowrap">
                                  {dur}d{isOpen ? ' →' : ''}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!journey.hasAnyDates && (
                  <p className="mt-4 text-center text-sm text-slate-500">
                    No dates recorded yet — log work or add planned dates to see this location&apos;s journey.
                  </p>
                )}

                <div className="mt-4 pt-3 border-t border-dashed border-slate-300 dark:border-slate-700 flex items-center gap-5 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-2 rounded-sm bg-slate-500" /> actual</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-2 rounded-sm border border-dashed border-slate-400 bg-slate-400/10" /> planned window</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-1" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 4px, rgba(220,38,38,.55) 4px 7px)' }} /> idle gap</span>
                  <span className="ml-auto font-medium tracking-wide uppercase text-[9px]">Source: audit log · {logs.length} entries</span>
                </div>
              </div>
            )
          ) : !logs || logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500">
              <HelpCircle size={32} className="opacity-50 mb-3" />
              <p>No activity recorded for this location yet.</p>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Activity</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Status</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Planned Start</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Planned Finish</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300">Actual Completion</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 text-right">Date Logged</th>
                    <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-300 text-right">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {logs.map((log) => {
                    const date = new Date(log.changed_at || log.created_at || 0);
                    const isCompleted = log.temporal_state === 'completed';
                    const isOngoing = log.temporal_state === 'ongoing';
                    return (
                      <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-4 py-3 font-medium flex items-center gap-2 text-slate-800 dark:text-slate-200">
                          <span className="w-3 h-3 rounded-full shadow-sm shrink-0" style={{ backgroundColor: log.status_color || '#cbd5e1' }} />
                          {log.activityName || 'Unknown'} {log.track && <span className="text-[10px] text-slate-400 font-normal">({log.track})</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider
                            ${isCompleted ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                              isOngoing ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                              'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}
                          >
                            {log.temporal_state}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {log.planned_start_date ? new Date(log.planned_start_date + 'T12:00:00Z').toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {log.planned_end_date ? new Date(log.planned_end_date + 'T12:00:00Z').toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {log.logged_date ? new Date(log.logged_date + 'T12:00:00Z').toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400 font-medium">
                          {date.toLocaleDateString()} <span className="text-xs ml-1 opacity-60">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">
                          {log.user_id ? (nameByUserId.get(log.user_id) || 'Unknown') : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
