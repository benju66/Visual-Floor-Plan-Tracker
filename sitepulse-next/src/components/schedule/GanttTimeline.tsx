"use client";
import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import AnchoredMenu from '@/components/manage/AnchoredMenu';
import GanttBar from './GanttBar';
import {
  axisTicks,
  barRect,
  dateToX,
  type DateWindow,
  type GanttBarModel,
  type GanttRowModel,
  type GanttZoom,
} from '@/utils/ganttMath';

export interface RowMeta {
  color: string;
  label: string;
  kind: string;
  /** Make-ready (Phase 4): the location's bottleneck waits on an incomplete predecessor. */
  blocked?: boolean;
  /** Tooltip for the blocked indicator (e.g. "Drywall blocked on Framing"). */
  blockedLabel?: string;
}

interface GanttTimelineProps {
  rows: GanttRowModel[];
  rowMeta: Record<string, RowMeta>;
  window: DateWindow;
  zoom: GanttZoom;
  pxPerDay: number;
  today: Date;
  /** unitId → level name (only shown in all-levels scope). */
  levelByUnitId?: Record<string, string>;
  /** Persist a bar's planned dates (online). */
  onEditDates: (unitId: string, bar: GanttBarModel, start: string | null, end: string | null) => void;
  /** Row hover, for the floor-plan reference highlight (only wired when the plan panel is open). */
  onRowHover?: (unitId: string | null) => void;
}

const LEFT_W = 208;
const ROW_H = 34;
const AXIS_H = 40;

/** Small inline form rendered inside the anchored popover; owns its own input state. */
function DateEditor({
  bar,
  onSave,
  onCancel,
}: {
  bar: GanttBarModel;
  onSave: (start: string | null, end: string | null) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(bar.plannedStart ?? '');
  const [end, setEnd] = useState(bar.plannedEnd ?? '');
  const inputCls =
    'w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs';
  return (
    <div className="p-3">
      <div className="text-xs font-bold mb-2 text-slate-800 dark:text-slate-100 truncate">{bar.activityName}</div>
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">Planned start</label>
      <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5 mt-2">Planned end</label>
      <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => onSave(start || null, end || null)}
          className="flex-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold py-1.5"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 dark:border-slate-600 text-xs font-semibold py-1.5 px-3 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The Gantt grid: a sticky location column on the left, a scrollable time axis
 * on the right, one row per location with activity bars, full-height gridlines
 * and a "today" line. Behind-schedule coloring comes from `rowMeta` (computed
 * upstream via progressAnalytics — never recomputed here).
 */
export default function GanttTimeline({
  rows,
  rowMeta,
  window: win,
  zoom,
  pxPerDay,
  today,
  levelByUnitId,
  onEditDates,
  onRowHover,
}: GanttTimelineProps) {
  const [editing, setEditing] = useState<{ unitId: string; bar: GanttBarModel; rect: DOMRect } | null>(null);

  const ticks = axisTicks(win.start, win.end, zoom);
  const timelineW = dateToX(win.end, win.start, pxPerDay) + pxPerDay;
  const todayX = dateToX(today, win.start, pxPerDay);
  const showToday = todayX >= 0 && todayX <= timelineW;

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-slate-500 border rounded-xl border-slate-200 dark:border-white/10">
        No scheduled locations to show.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900">
      <div className="relative" style={{ width: LEFT_W + timelineW }}>
        {/* ── Header / time axis (sticky top) ── */}
        <div className="sticky top-0 z-20 flex bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-white/10" style={{ height: AXIS_H }}>
          <div
            className="sticky left-0 z-30 flex items-end px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-white/10"
            style={{ width: LEFT_W }}
          >
            Location
          </div>
          <div className="relative" style={{ width: timelineW }}>
            {ticks.map((t, i) => {
              const x = dateToX(t.date, win.start, pxPerDay);
              return (
                <div
                  key={i}
                  className={`absolute bottom-1 text-[10px] ${t.major ? 'font-bold text-slate-600 dark:text-slate-300' : 'text-slate-400'}`}
                  style={{ left: x + 2 }}
                >
                  {t.label}
                </div>
              );
            })}
            {showToday && (
              <div className="absolute top-0 bottom-0 flex flex-col items-center" style={{ left: todayX - 14, width: 28 }}>
                <span className="mt-0.5 text-[9px] font-bold text-red-500">Today</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex">
          {/* Left: sticky location labels */}
          <div className="sticky left-0 z-10 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-white/10" style={{ width: LEFT_W }}>
            {rows.map((r) => {
              const meta = rowMeta[r.unitId];
              return (
                <div
                  key={r.unitId}
                  className="flex items-center gap-2 px-3 border-b border-slate-100 dark:border-white/5"
                  style={{ height: ROW_H }}
                  onMouseEnter={() => onRowHover?.(r.unitId)}
                  onMouseLeave={() => onRowHover?.(null)}
                >
                  <span
                    className="shrink-0 w-2.5 h-2.5 rounded-full"
                    style={{ background: meta?.color || '#cbd5e1' }}
                    title={meta?.label || ''}
                  />
                  <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{r.unitNumber}</span>
                  {meta?.blocked && (
                    <span className="shrink-0 inline-flex" title={meta.blockedLabel || 'Blocked — waiting on a predecessor'}>
                      <Lock size={11} className="text-red-500" />
                    </span>
                  )}
                  {levelByUnitId && (
                    <span className="ml-auto truncate text-[10px] text-slate-400 max-w-[64px]">{levelByUnitId[r.unitId]}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right: timeline with gridlines, today line, bars */}
          <div className="relative" style={{ width: timelineW, height: rows.length * ROW_H }}>
            {ticks.map((t, i) => {
              const x = dateToX(t.date, win.start, pxPerDay);
              return (
                <div
                  key={i}
                  className={`absolute top-0 bottom-0 ${t.major ? 'bg-slate-200 dark:bg-white/10' : 'bg-slate-100 dark:bg-white/[0.04]'}`}
                  style={{ left: x, width: 1 }}
                />
              );
            })}
            {showToday && <div className="absolute top-0 bottom-0 bg-red-400/70" style={{ left: todayX, width: 2 }} />}

            {rows.map((r, i) => (
              <div
                key={r.unitId}
                className="absolute left-0 border-b border-slate-100 dark:border-white/5"
                style={{ top: i * ROW_H, height: ROW_H, width: timelineW }}
                onMouseEnter={() => onRowHover?.(r.unitId)}
                onMouseLeave={() => onRowHover?.(null)}
              >
                {r.bars.map((b) => {
                  const rect = barRect(b.plannedStart, b.plannedEnd, win.start, pxPerDay);
                  if (!rect) return null;
                  return (
                    <GanttBar
                      key={b.activityName}
                      bar={b}
                      x={rect.x}
                      width={rect.width}
                      rowHeight={ROW_H}
                      onOpen={(domRect) => setEditing({ unitId: r.unitId, bar: b, rect: domRect })}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <AnchoredMenu open={!!editing} anchorRect={editing?.rect ?? null} onClose={() => setEditing(null)} width={248}>
        {editing && (
          <DateEditor
            key={`${editing.unitId}_${editing.bar.activityName}`}
            bar={editing.bar}
            onSave={(start, end) => {
              onEditDates(editing.unitId, editing.bar, start, end);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </AnchoredMenu>
    </div>
  );
}
