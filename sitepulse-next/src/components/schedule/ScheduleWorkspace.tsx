"use client";
import React, { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Layers, GanttChartSquare, CalendarRange, Flag, Map as MapIcon, FileUp } from 'lucide-react';
import { useMapStore } from '@/store/useMapStore';
import { useManageStore } from '@/store/useManageStore';
import { useSettingsStore, useHydratedStore } from '@/store/useSettingsStore';
import ResizableDivider from './ResizableDivider';
import { useAllProjectUnits, useAllProjectStatuses, useUpdateStatus } from '@/hooks/useProjectQueries';
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
  orderedTrackMilestones,
  computeUnitVariance,
  varianceFill,
  varianceLabel,
} from '@/utils/progressAnalytics';
import { applicableMilestones, EMPTY_APPLICABILITY_INDEX, type ApplicabilityIndex } from '@/utils/applicability';
import GanttTimeline, { type RowMeta } from './GanttTimeline';
import CascadePanel from './CascadePanel';
import MspImportPanel from './MspImportPanel';
import type { Sheet, Unit, Milestone, StatusLog } from '@/types/domain';

interface ScheduleWorkspaceProps {
  /** Active-level units + raw per-slot statuses (from page.jsx). */
  units: Unit[];
  rawStatuses: StatusLog[];
  milestones: Milestone[];
  applicabilityIndex?: ApplicabilityIndex;
  sheets: Sheet[];
  activeSheetId: string;
  /** Activity-management wiring (Phase 3a) — the shared useProjectActions
   *  handlers + persisted settings, reused (not forked) from page.jsx. */
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  onAddMilestone?: (name: string, color: string, track: string, dictionaryId?: string | null) => void;
  onUpdateMilestone?: (id: string, oldName: string, newName: string, newColor: string) => void;
  onDeleteMilestone?: (id: string) => void;
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
  milestones,
  applicabilityIndex = EMPTY_APPLICABILITY_INDEX,
  sheets,
  activeSheetId,
  settings,
  onUpdateSettings,
  onAddMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
}: ScheduleWorkspaceProps) {
  const params = useParams();
  const projectId = params?.projectId as string;
  const trackingMode = useMapStore((s) => s.trackingMode);
  const scope = useManageStore((s) => s.scope);
  const setScope = useManageStore((s) => s.setScope);

  const [zoom, setZoom] = useState<GanttZoom>('week');
  const [cascadeOpen, setCascadeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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

  // --- Rows (pure geometry) ---
  const rows = useMemo(
    () => buildScheduleRows({ units: effUnits, statuses: effStatuses, milestones, track: trackingMode, today, applicabilityIndex }),
    [effUnits, effStatuses, milestones, trackingMode, today, applicabilityIndex]
  );

  // --- Per-row behind-schedule color (from progressAnalytics) ---
  const rowMeta = useMemo(() => {
    const trackMs = orderedTrackMilestones(milestones, trackingMode);
    const byUnit = new Map<string, StatusLog[]>();
    for (const s of effStatuses) {
      if (s.track !== trackingMode || !s.unit_id) continue;
      const arr = byUnit.get(s.unit_id);
      if (arr) arr.push(s);
      else byUnit.set(s.unit_id, [s]);
    }
    const map: Record<string, RowMeta> = {};
    for (const u of effUnits) {
      const appMs = applicableMilestones(trackMs, u, applicabilityIndex);
      const info = computeUnitVariance(byUnit.get(u.id) || [], appMs, today);
      map[u.id] = { color: varianceFill(info), label: varianceLabel(info), kind: info.kind };
    }
    return map;
  }, [effUnits, effStatuses, milestones, trackingMode, today, applicabilityIndex]);

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
      milestone: bar.milestone,
      status_color: bar.color,
      temporal_state: bar.temporalState,
      planned_start_date: clamped.start,
      planned_end_date: clamped.end,
      logged_date: bar.loggedDate,
    });
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
                milestones={milestones}
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                onAddMilestone={onAddMilestone}
                onUpdateMilestone={onUpdateMilestone}
                onDeleteMilestone={onDeleteMilestone}
                initialTrack={trackingMode}
                onClose={() => setActivitiesOpen(false)}
              />
            </div>
            <ResizableDivider ariaLabel="Resize activities panel" onResize={resizeActivities} />
          </>
        )}

        {milestones.length === 0 && !wizardDismissed ? (
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
        milestones={milestones}
        applicabilityIndex={applicabilityIndex}
        activeSheetId={activeSheetId}
        onAddMilestone={onAddMilestone}
      />

      <CascadePanel
        open={cascadeOpen}
        onClose={() => setCascadeOpen(false)}
        sheet={activeSheet}
        milestones={milestones}
        track={trackingMode}
        units={units}
        existing={rawStatuses}
        applicabilityIndex={applicabilityIndex}
        projectId={projectId}
      />
    </div>
  );
}
