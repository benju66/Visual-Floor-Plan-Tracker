"use client";
import React, { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Layers, GanttChartSquare, CalendarRange, Flag, Map as MapIcon, FileUp, ListPlus, Workflow } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';
import { useManageStore } from '@/store/useManageStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore, useHydratedStore } from '@/store/useSettingsStore';
import ResizableDivider from './ResizableDivider';
import { useAllProjectUnits, useAllProjectStatuses, useUpdateStatus, useBulkInsertStatusLogs } from '@/hooks/useProjectQueries';
import { useActivityDependencies } from '@/hooks/useActivityDependencies';
import ActivityManagerPanel from './ActivityManagerPanel';
import ScheduleSetupWizard from './ScheduleSetupWizard';
import SchedulePlanPanel from './SchedulePlanPanel';
import type { AppSettings } from '@/store/useSettingsStore';
import {
  buildScheduleRows,
  windowBounds,
  clampEndAfterStart,
  ZOOM_PX_PER_DAY,
  type GanttZoom,
  type GanttBarModel,
} from '@/utils/ganttMath';
import {
  orderedTrackActivities,
  computeUnitVariance,
  varianceFill,
  varianceLabel,
} from '@/utils/progressAnalytics';
import { applicableActivities, EMPTY_APPLICABILITY_INDEX, type ApplicabilityIndex } from '@/utils/applicability';
import { unitMakeReady, makeReadyLabel, slotKey } from '@/utils/activityReadiness';
import { rippleForward, buildRippleWrites, type RippleDelta, type PlannedWindow } from '@/utils/dateRipple';
import GanttTimeline, { type RowMeta } from './GanttTimeline';
import CascadePanel from './CascadePanel';
import MspImportPanel from './MspImportPanel';
import type { Sheet, Unit, Activity, StatusLog } from '@/types/domain';

interface ScheduleWorkspaceProps {
  /** Active-level units + raw per-slot statuses (from page.jsx). */
  units: Unit[];
  rawStatuses: StatusLog[];
  activities: Activity[];
  applicabilityIndex?: ApplicabilityIndex;
  sheets: Sheet[];
  activeSheetId: string;
  /** Activity-management wiring (Phase 3a) — the shared useProjectActions
   *  handlers + persisted settings, reused (not forked) from page.jsx. */
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onAddActivity?: (name: string, color: string, track: string, dictionaryId?: string | null) => void;
  onUpdateActivity?: (id: string, oldName: string, newName: string, newColor: string) => void;
  onDeleteActivity?: (id: string) => void;
}

const ZOOMS: { key: GanttZoom; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

/**
 * The consolidated Schedule view (Scheduling Foundation Slice A, Phase 3) —
 * the SINGLE home for activity management. Left panel: the activity manager
 * (moved out of Settings in 3a — scopes, auto-advance, dictionary add, reorder,
 * applicability, FS dependencies). Center: the Gantt with online date edits and
 * the level→location cascade. Right (toggleable): a floor-plan reference so
 * space-bound sequencing keeps its context. First-run: a light "start from
 * your dictionary" wizard. Reuses the List's scope (`useManageStore`) and the
 * all-project data hooks. Behind-schedule coloring comes from
 * `progressAnalytics` (single source of truth — never forked here).
 */
export default function ScheduleWorkspace({
  units,
  rawStatuses,
  activities,
  applicabilityIndex = EMPTY_APPLICABILITY_INDEX,
  sheets,
  activeSheetId,
  settings,
  onUpdateSettings,
  onAddActivity,
  onUpdateActivity,
  onDeleteActivity,
}: ScheduleWorkspaceProps) {
  const params = useParams();
  const projectId = params?.projectId as string;
  const trackingMode = useMapStore((s) => s.trackingMode);
  const scope = useManageStore((s) => s.scope);
  const setScope = useManageStore((s) => s.setScope);

  const [zoom, setZoom] = useState<GanttZoom>('week');
  const [cascadeOpen, setCascadeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [activitiesOpen, setActivitiesOpen] = useState(true);
  const [planOpen, setPlanOpen] = useState(false);
  // "Start blank" dismisses the first-run wizard without seeding activities.
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const [hoverUnitId, setHoverUnitId] = useState<string | null>(null);
  const pxPerDay = ZOOM_PX_PER_DAY[zoom];

  // Resizable panel widths (VS Code-style), persisted in settings. Read hydration-safe.
  // The divider reports cumulative movement from drag start; because these handlers
  // capture the width at drag start, newWidth = startWidth + delta stays correct as the
  // store updates mid-drag. Each move commits the clamped width (persisted for next time).
  const setMapSettings = useSettingsStore((s) => s.setMapSettings);
  const activitiesWidth = useHydratedStore((s) => s.mapSettings.scheduleActivitiesWidth ?? 360, 360);
  const planWidth = useHydratedStore((s) => s.mapSettings.schedulePlanWidth ?? 380, 380);
  const clampPanel = (w: number) => Math.max(260, Math.min(720, Math.round(w)));
  const resizeActivities = (delta: number) => setMapSettings({ scheduleActivitiesWidth: clampPanel(activitiesWidth + delta) });
  // The plan panel is on the RIGHT (divider on its left), so moving right shrinks it.
  const resizePlan = (delta: number) => setMapSettings({ schedulePlanWidth: clampPanel(planWidth - delta) });

  // UTC-noon of the local calendar day — matches ganttMath / progressAnalytics parsing.
  const today = useMemo(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12));
  }, []);

  // --- All-levels scope: fetch cross-sheet data (mirrors FieldStatusTable) ---
  const sheetIds = useMemo(() => sheets.map((s) => s.id), [sheets]);
  const { data: allUnits = [] } = useAllProjectUnits(scope === 'all' ? sheetIds : []);
  const allUnitIds = useMemo(() => allUnits.map((u) => u.id), [allUnits]);
  const { data: allStatuses = [] } = useAllProjectStatuses(scope === 'all' ? allUnitIds : []);

  const effUnits = scope === 'all' ? allUnits : units;
  const effStatuses = scope === 'all' ? allStatuses : rawStatuses;

  const updateStatusMutation = useUpdateStatus(activeSheetId);
  const bulkInsert = useBulkInsertStatusLogs(activeSheetId);
  const queryClient = useQueryClient();
  const setToast = useUIStore((s) => s.setToast);
  const { data: dependencies = [] } = useActivityDependencies(projectId);

  // Date-ripple (Phase 4): pending downstream shifts awaiting the count-confirm.
  const [ripple, setRipple] = useState<{ unitId: string; unitLabel: string; track: string; deltas: RippleDelta[] } | null>(null);
  const [rippleBusy, setRippleBusy] = useState(false);

  const nameById = useMemo(() => new Map(activities.map((a) => [a.id, a.name])), [activities]);
  const colorByActivityId = useMemo(() => new Map(activities.map((a) => [a.id, a.color])), [activities]);

  // --- Rows (pure geometry) ---
  const rows = useMemo(
    () => buildScheduleRows({ units: effUnits, statuses: effStatuses, activities, track: trackingMode, today, applicabilityIndex }),
    [effUnits, effStatuses, activities, trackingMode, today, applicabilityIndex]
  );

  // --- Per-row behind-schedule color (progressAnalytics) + make-ready blocked flag ---
  const rowMeta = useMemo(() => {
    const trackMs = orderedTrackActivities(activities, trackingMode);
    const byUnit = new Map<string, StatusLog[]>();
    for (const s of effStatuses) {
      if (s.track !== trackingMode || !s.unit_id) continue;
      const arr = byUnit.get(s.unit_id);
      if (arr) arr.push(s);
      else byUnit.set(s.unit_id, [s]);
    }
    // Make-ready inputs: completed + applicable slot-key sets (N/A respected, §3).
    const completed = new Set<string>();
    for (const s of effStatuses) {
      if (s.track === trackingMode && s.unit_id && s.activity_id && s.temporal_state === 'completed') {
        completed.add(slotKey(s.unit_id, s.activity_id));
      }
    }
    const applicable = new Set<string>();
    for (const u of effUnits) for (const a of trackMs) {
      if (applicableActivities([a], u, applicabilityIndex).length > 0) applicable.add(slotKey(u.id, a.id));
    }
    const map: Record<string, RowMeta> = {};
    for (const u of effUnits) {
      const appMs = applicableActivities(trackMs, u, applicabilityIndex);
      const info = computeUnitVariance(byUnit.get(u.id) || [], appMs, today);
      const mr = unitMakeReady(u.id, appMs, dependencies, completed, applicable);
      map[u.id] = {
        color: varianceFill(info),
        label: varianceLabel(info),
        kind: info.kind,
        blocked: mr.kind === 'blocked',
        blockedLabel: mr.kind === 'blocked' ? makeReadyLabel(mr, nameById) : undefined,
      };
    }
    return map;
  }, [effUnits, effStatuses, activities, trackingMode, today, applicabilityIndex, dependencies, nameById]);

  // --- Visible date window ---
  const activeSheet = useMemo(() => sheets.find((s) => s.id === activeSheetId), [sheets, activeSheetId]);
  const dateWindow = useMemo(() => {
    const ds: (string | null)[] = [];
    for (const r of rows) for (const b of r.bars) ds.push(b.plannedStart, b.plannedEnd);
    const sched = (activeSheet?.activity_schedules as Record<string, { start_date?: string | null; end_date?: string | null }> | null) || {};
    for (const k in sched) ds.push(sched[k]?.start_date ?? null, sched[k]?.end_date ?? null);
    return windowBounds(ds, today);
  }, [rows, activeSheet, today]);

  // --- Level labels (all-levels scope) ---
  const levelByUnitId = useMemo(() => {
    if (scope !== 'all') return undefined;
    const nameById = new Map(sheets.map((s) => [s.id, s.sheet_name]));
    const map: Record<string, string> = {};
    for (const u of allUnits) map[u.id] = (nameById.get(u.sheet_id as string) as string) || '';
    return map;
  }, [scope, allUnits, sheets]);

  const handleEditDates = (unitId: string, bar: GanttBarModel, start: string | null, end: string | null) => {
    const clamped = clampEndAfterStart(start, end);
    updateStatusMutation.mutate({
      unit_id: unitId,
      track: bar.track,
      activity_id: bar.activity_id,
      activityName: bar.activityName,
      status_color: bar.color,
      temporal_state: bar.temporalState,
      planned_start_date: clamped.start,
      planned_end_date: clamped.end,
      logged_date: bar.loggedDate,
    });

    // Date-ripple: if this activity's new finish pushes any downstream activity's
    // planned start past the FS+lag limit (on THIS location), offer to shift them.
    // rippleForward is push-only, so a same-day or earlier edit returns nothing.
    if (!clamped.end) return;
    const plannedDates = new Map<string, PlannedWindow>();
    for (const s of effStatuses) {
      if (s.unit_id !== unitId || s.track !== bar.track || !s.activity_id) continue;
      plannedDates.set(s.activity_id, { start: s.planned_start_date, end: s.planned_end_date });
    }
    const deltas = rippleForward(dependencies, plannedDates, bar.activity_id, clamped.end);
    if (deltas.length === 0) return;
    const unitLabel = effUnits.find((u) => u.id === unitId)?.unit_number || 'this location';
    setRipple({ unitId, unitLabel, track: bar.track, deltas });
  };

  const applyRipple = async () => {
    if (!ripple) return;
    setRippleBusy(true);
    try {
      const writes = buildRippleWrites({
        unitId: ripple.unitId,
        track: ripple.track,
        deltas: ripple.deltas,
        existing: effStatuses,
        colorByActivityId,
      });
      await bulkInsert.mutateAsync(writes as unknown as StatusLog[]);
      // The unit may live on another sheet (all-levels scope) — refresh every
      // per-sheet status cache, not just the active one the hook invalidates.
      queryClient.invalidateQueries({ queryKey: ['statuses'] });
      setToast({
        message: `Shifted ${writes.length} downstream date${writes.length === 1 ? '' : 's'} on ${ripple.unitLabel}.`,
        type: 'success',
      });
      setRipple(null);
    } catch (err) {
      setToast({ message: (err as Error)?.message || 'Could not shift downstream dates.', type: 'error' });
    } finally {
      setRippleBusy(false);
    }
  };

  const scopedLocationCount = scope === 'all' ? allUnits.length : units.length;

  return (
    <div className="w-full h-full flex flex-col pb-2 md:pb-6">
      {/* ── Toolbar ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-auto">
          <GanttChartSquare size={18} className="text-sky-500" />
          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Schedule</span>
          <span className="text-xs text-slate-400">· {trackingMode} · {scopedLocationCount} locations</span>
        </div>

        {/* Activity manager panel toggle */}
        <button
          type="button"
          onClick={() => setActivitiesOpen((v) => !v)}
          title="Manage this project's activities — add, rename, reorder, sequence"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
            activitiesOpen
              ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white'
              : 'border-slate-300/80 dark:border-white/15 bg-white/70 dark:bg-black/20 hover:bg-slate-100 dark:hover:bg-white/10'
          }`}
        >
          <Flag size={14} /> Activities
        </button>

        {/* Floor-plan reference toggle */}
        <button
          type="button"
          onClick={() => setPlanOpen((v) => !v)}
          title="Show the level's floor plan beside the schedule"
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
            planOpen
              ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white'
              : 'border-slate-300/80 dark:border-white/15 bg-white/70 dark:bg-black/20 hover:bg-slate-100 dark:hover:bg-white/10'
          }`}
        >
          <MapIcon size={14} /> Plan
        </button>

        {/* Level dates / cascade */}
        <button
          type="button"
          onClick={() => setCascadeOpen(true)}
          title="Set this level's default dates and apply them to its locations"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/70 dark:bg-black/20 px-3 py-1.5 text-xs font-semibold shadow-sm hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
        >
          <CalendarRange size={14} /> Level dates
        </button>

        {/* Add activities from the dictionary / a playbook, any time (append) */}
        {activities.length > 0 && (
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            title="Add activities from your dictionary or a playbook (appended to what you have)"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/70 dark:bg-black/20 px-3 py-1.5 text-xs font-semibold shadow-sm hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            <ListPlus size={14} /> Add activities
          </button>
        )}

        {/* MS Project import (Phase 4) */}
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          title="Import an MS Project schedule (.xml) and populate planned dates"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/70 dark:bg-black/20 px-3 py-1.5 text-xs font-semibold shadow-sm hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
        >
          <FileUp size={14} /> Import
        </button>

        {/* Scope toggle (shared with the List via useManageStore) */}
        <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm">
          {(['level', 'all'] as const).map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => setScope(sc)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                scope === sc
                  ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              } ${sc === 'all' ? 'border-l border-slate-300/80 dark:border-white/10' : ''}`}
            >
              {sc === 'level' ? 'This level' : 'All levels'}
            </button>
          ))}
        </div>

        {/* Zoom toggle */}
        <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm">
          {ZOOMS.map((z, i) => (
            <button
              key={z.key}
              type="button"
              onClick={() => setZoom(z.key)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                zoom === z.key
                  ? 'bg-sky-600 text-white'
                  : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
              } ${i > 0 ? 'border-l border-slate-300/80 dark:border-white/10' : ''}`}
            >
              {z.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── All-levels banner ── */}
      {scope === 'all' && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-500/60 px-3.5 py-2 text-amber-800 dark:text-amber-200 text-sm font-bold shadow-sm">
          <Layers size={16} className="shrink-0" />
          Viewing ALL LEVELS — {sheets.length} levels · {allUnits.length} locations.
        </div>
      )}

      <div className="flex-1 min-h-0 flex items-stretch">
        {activitiesOpen && (
          <>
            <div style={{ width: activitiesWidth }} className="shrink-0 min-h-0 flex">
              <ActivityManagerPanel
                projectId={projectId}
                activities={activities}
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                onAddActivity={onAddActivity}
                onUpdateActivity={onUpdateActivity}
                onDeleteActivity={onDeleteActivity}
                initialTrack={trackingMode}
                onClose={() => setActivitiesOpen(false)}
              />
            </div>
            <ResizableDivider ariaLabel="Resize activities panel" onResize={resizeActivities} />
          </>
        )}

        {activities.length === 0 && !wizardDismissed ? (
          <ScheduleSetupWizard
            projectId={projectId}
            onStartBlank={() => { setWizardDismissed(true); setActivitiesOpen(true); }}
          />
        ) : (
          <GanttTimeline
            rows={rows}
            rowMeta={rowMeta}
            window={dateWindow}
            zoom={zoom}
            pxPerDay={pxPerDay}
            today={today}
            levelByUnitId={levelByUnitId}
            onEditDates={handleEditDates}
            onRowHover={planOpen ? setHoverUnitId : undefined}
          />
        )}

        {planOpen && (
          <>
            <ResizableDivider ariaLabel="Resize floor-plan panel" onResize={resizePlan} />
            <div style={{ width: planWidth }} className="shrink-0 min-h-0 flex">
              <SchedulePlanPanel
                sheet={activeSheet}
                units={units}
                highlightUnitId={hoverUnitId}
                onClose={() => setPlanOpen(false)}
              />
            </div>
          </>
        )}
      </div>

      <MspImportPanel
        open={importOpen}
        onClose={() => setImportOpen(false)}
        sheets={sheets}
        activities={activities}
        applicabilityIndex={applicabilityIndex}
        activeSheetId={activeSheetId}
        onAddActivity={onAddActivity}
      />

      <CascadePanel
        open={cascadeOpen}
        onClose={() => setCascadeOpen(false)}
        sheet={activeSheet}
        activities={activities}
        track={trackingMode}
        units={units}
        existing={rawStatuses}
        applicabilityIndex={applicabilityIndex}
        projectId={projectId}
      />

      {/* Date-ripple confirmation (Phase 4) — count-confirm before the bulk write */}
      {ripple && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" role="presentation" onClick={() => !rippleBusy && setRipple(null)}>
          <div className="w-full max-w-md rounded-2xl border p-6 shadow-2xl glass-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Workflow size={18} className="text-sky-500" />
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Shift downstream dates?</h3>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              That change pushes {ripple.deltas.length} dependent {ripple.deltas.length === 1 ? 'activity' : 'activities'} on <b>{ripple.unitLabel}</b>. Their planned dates move to keep the sequence valid.
            </p>
            <ul className="max-h-56 overflow-auto rounded-lg border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5 mb-4">
              {ripple.deltas.map((d) => (
                <li key={d.activityId} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{nameById.get(d.activityId) || 'Activity'}</span>
                  <span className="text-slate-500 shrink-0">{d.start} → {d.end} <span className="text-amber-600 dark:text-amber-400">(+{d.shiftedDays}d)</span></span>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={rippleBusy}
                onClick={applyRipple}
                className="rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold py-1.5 px-3.5 disabled:opacity-60"
              >
                {rippleBusy ? 'Shifting…' : `Shift ${ripple.deltas.length} date${ripple.deltas.length === 1 ? '' : 's'}`}
              </button>
              <button
                type="button"
                disabled={rippleBusy}
                onClick={() => setRipple(null)}
                className="rounded-md border border-slate-300 dark:border-slate-600 text-xs font-semibold py-1.5 px-3 disabled:opacity-60"
              >
                Skip
              </button>
              <span className="text-[11px] text-slate-400 ml-auto">The predecessor edit is already saved.</span>
            </div>
          </div>
        </div>
      )}

      {/* Reopenable "add activities" (appends from dictionary/playbook) */}
      {setupOpen && (
        <ScheduleSetupWizard
          projectId={projectId}
          asModal
          onClose={() => setSetupOpen(false)}
          existingActivities={activities}
          onStartBlank={() => setSetupOpen(false)}
        />
      )}
    </div>
  );
}
