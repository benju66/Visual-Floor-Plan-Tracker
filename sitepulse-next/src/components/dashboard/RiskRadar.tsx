"use client";
import React, { useMemo } from 'react';
import { Radar, Info, Lightbulb } from 'lucide-react';
import { parseDay, SMALL_SAMPLE_SLOTS, FORECAST_WINDOW_WEEKS } from '@/utils/progressAnalytics';
import { activityRisk, bandMethodSentence, FORECAST_BAND_SEED, MIN_MOVE_DAYS } from '@/utils/monteCarloForecast';
import type { ActivityRisk, PaceMove } from '@/utils/monteCarloForecast';
import type { ApplicabilityIndex } from '@/utils/applicability';
import type { StatusHistoryEvent } from '@/hooks/useProjectQueries';
import type { Unit, Activity, StatusLog, Sheet } from '@/types/domain';

/**
 * RiskRadar — the compact "so what do I do about it?" module (Schedule That
 * Thinks P3). Ranks the current scope's activities by how far their 80%
 * likely-finish range runs PAST their planned finish (P90 vs the plan), reusing
 * the Batch-1 Monte Carlo band per activity (never forking the simulation).
 *
 * Suppression honesty is inherited from the band: an activity with too little
 * pace history is listed under "not enough history yet" — never fake-ranked.
 * The module re-ranks whenever the dashboard scope changes (its `units` /
 * `statuses` / `history` are the scoped set the parent passes down).
 *
 * Risk/band text stays neutral slate; only the plan-delta chip reuses the
 * hero card's established amber-late / emerald-ahead inline coloring so the two
 * surfaces tell one story (no new palette, VARIANCE_COLORS untouched).
 */

const TOP_N = 5;

export interface RiskRadarProps {
  /** In-scope units (already scoped by the dashboard). */
  units: Unit[];
  /** All-project current-state logs (scoped internally by the `units` set). */
  statuses: StatusLog[];
  activities: Activity[];
  track: string;
  /** Track-filtered completed history (carries activity_id — see useStatusHistory). */
  history: StatusHistoryEvent[];
  applicabilityIndex?: ApplicabilityIndex;
  /** 'all' or a sheet id — the highest-impact move is cross-level, shown only at 'all'. */
  scope: string;
  /** All project sheets — used to resolve the move's level names. */
  sheets: Sheet[];
  /** Human label for the current scope ("all levels" or a level name) — subtitle only. */
  scopeLabel: string;
  /** The single highest-impact pace transplant (P4), or null when none is meaningful. */
  paceMove: PaceMove | null;
  /**
   * True when {@link bestPaceMove} actually compared ≥2 levels. Lets the module
   * tell "we checked and nothing helps" (show the muted note) apart from "not
   * enough comparable data" (stay silent) — never claiming a conclusion it
   * didn't reach.
   */
  paceMoveEvaluated: boolean;
}

const fmt = (iso: string | null): string => {
  const d = iso ? parseDay(iso) : null;
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
};

/** The plain-English one-liner under an activity's name. */
function riskSentence(r: ActivityRisk): string {
  if (r.plannedFinish && r.riskDays !== null) {
    if (r.riskDays > 0) return `80% likely-finish range ends ~${r.riskDays}d after its planned finish`;
    if (r.riskDays < 0) return `80% likely-finish range ends ~${Math.abs(r.riskDays)}d before its planned finish`;
    return `80% likely-finish range lands right on its planned finish`;
  }
  return `no planned finish set — likely-finish range spans ~${r.riskDays ?? 0}d`;
}

/** The right-hand delta chip — reuses the hero card's amber-late / emerald-ahead tones. */
function RiskChip({ r }: { r: ActivityRisk }) {
  if (r.plannedFinish && r.riskDays !== null) {
    if (r.riskDays > 0) return <span className="text-xs font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">~{r.riskDays}d late</span>;
    if (r.riskDays < 0) return <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">~{Math.abs(r.riskDays)}d ahead</span>;
    return <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">on plan</span>;
  }
  return (
    <span
      className="text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap"
      title="No planned finish to compare against — ranked instead by how wide its likely-finish range is (more uncertain = higher)."
    >
      ~{r.riskDays ?? 0}d spread
    </span>
  );
}

export default function RiskRadar({ units, statuses, activities, track, history, applicabilityIndex, scope, sheets, scopeLabel, paceMove, paceMoveEvaluated }: RiskRadarProps) {
  const today = useMemo(() => new Date(), []);

  const rows = useMemo(
    () => activityRisk({ activities, units, statuses, history, applicabilityIndex, track, today, seed: FORECAST_BAND_SEED }),
    [activities, units, statuses, history, applicabilityIndex, track, today],
  );

  // Rankable (honest, dated band) worst-first; the rest are thin-history rows.
  const ranked = useMemo(() => rows.filter(r => !r.band.suppressed && r.riskDays !== null).slice(0, TOP_N), [rows]);
  const muted = useMemo(() => rows.filter(r => r.band.suppressed === 'small-sample' || r.band.suppressed === 'no-pace'), [rows]);

  // Nothing to say when there is no rankable risk AND no thin-history group
  // (e.g. every activity is complete, or the scope has no activities).
  if (ranked.length === 0 && muted.length === 0) return null;

  const infoText =
    `Ranks activities by how far their 80% likely-finish range (P90) runs past their planned finish — or, with no planned finish, by how wide that range is. ` +
    `${bandMethodSentence()} ` +
    `Activities with fewer than ${SMALL_SAMPLE_SLOTS} tracked slots or no completions in the last ${FORECAST_WINDOW_WEEKS} weeks can't be ranked — they're listed as "not enough history yet".`;

  // The highest-impact move is cross-level, so it only makes sense at all-levels
  // scope. Resolve its level names from the sheet list (falls back gracefully).
  const sheetName = (id: string) => sheets.find(s => s.id === id)?.sheet_name || 'a level';
  const showMove = scope === 'all' && paceMove !== null;
  // Only say "nothing would help" when we actually compared levels and came up
  // empty — never when there simply wasn't enough data to look (honest silence).
  const showNoMove = scope === 'all' && paceMove === null && paceMoveEvaluated;

  return (
    <div className="glass-panel rounded-2xl border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200/60 dark:border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <Radar size={20} className="text-slate-500 dark:text-slate-400 shrink-0" />
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Risk Radar</h2>
          <span className="hidden sm:inline text-[11px] text-slate-400 truncate">ranked by finish-date risk · {scopeLabel}</span>
          <span className="relative group flex items-center cursor-help">
            <Info size={14} className="text-slate-400" />
            <span className="absolute left-0 top-full mt-2 hidden group-hover:block w-72 bg-slate-900/95 dark:bg-slate-100/95 text-white dark:text-slate-900 px-3 py-2 rounded-xl text-xs leading-relaxed shadow-2xl z-50 border border-slate-700 dark:border-white/20">
              {infoText}
            </span>
          </span>
        </div>
        {ranked.length > 0 && (
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 border border-slate-300/70 dark:border-white/15 rounded-full px-2.5 py-1 shrink-0">
            top {ranked.length}
          </span>
        )}
      </div>

      {/* ── Highest-impact move (P4) — one cross-level pace transplant, all-levels only ── */}
      {showMove && paceMove && (
        <div className="flex items-start gap-2 px-5 py-2.5 border-b border-slate-200/60 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.03]">
          <Lightbulb size={15} className="text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
              If <span className="font-bold">{sheetName(paceMove.toSheetId)}</span> matched{' '}
              <span className="font-bold">{sheetName(paceMove.fromSheetId)}</span>&apos;s pace, the projected finish moves up{' '}
              <span className="font-bold">~{paceMove.daysSaved} days</span>.
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">estimate from recent pace — not crew logistics</p>
          </div>
        </div>
      )}

      {/* Honest "we checked, nothing helps" — advertises the capability without
          firing on thin data (only when ≥2 levels were actually compared). */}
      {showNoMove && (
        <div className="flex items-start gap-2 px-5 py-2 border-b border-slate-200/60 dark:border-white/10">
          <Lightbulb size={14} className="text-slate-400 mt-0.5 shrink-0" />
          <p
            className="text-[11px] text-slate-400"
            title={`Checked every level's recent pace against the others — none would save ${MIN_MOVE_DAYS}+ days on the projected finish.`}
          >
            No single pace shift between levels would meaningfully improve the finish date.
          </p>
        </div>
      )}

      {ranked.length > 0 ? (
        <div className="divide-y divide-slate-200/60 dark:divide-white/5">
          {ranked.map((r, idx) => (
            <div
              key={r.activityId}
              className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_170px_92px] items-center gap-x-4 px-5 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 tabular-nums">#{idx + 1}</span>
                  {r.name}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {r.remainingSlots} left · {riskSentence(r)}
                </div>
              </div>

              <div className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                <div>
                  likely <span className="font-semibold text-slate-600 dark:text-slate-300">{fmt(r.band.p10)}–{fmt(r.band.p90)}</span>
                </div>
                <div className="text-[10px] text-slate-400">
                  {r.plannedFinish ? <>planned {fmt(r.plannedFinish)}</> : 'no planned finish'}
                </div>
              </div>

              <div className="justify-self-end sm:justify-self-start"><RiskChip r={r} /></div>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-5 py-3 text-xs text-slate-400 italic">
          No activity has enough pace history yet to rank — see below.
        </p>
      )}

      {muted.length > 0 && (
        <div className="px-5 py-2.5 border-t border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">not enough history yet</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            {muted.map(m => (
              <span
                key={m.activityId}
                className="text-[11px] text-slate-400"
                title={m.band.suppressed === 'small-sample'
                  ? `Fewer than ${SMALL_SAMPLE_SLOTS} tracked slots — too small a sample to project honestly.`
                  : `No completions in the last ${FORECAST_WINDOW_WEEKS} weeks — no pace to project from.`}
              >
                {m.name} — {m.band.suppressed === 'small-sample' ? 'too few tracked slots' : 'no recent pace'}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
