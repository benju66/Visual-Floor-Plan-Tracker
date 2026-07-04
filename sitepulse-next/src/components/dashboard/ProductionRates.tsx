"use client";
import React, { useMemo, useState } from 'react';
import { Gauge, TriangleAlert, TrendingUp, TrendingDown, Check, Users } from 'lucide-react';
import { useCostCodes } from '@/hooks/useCostCodes';
import { useCompanies } from '@/hooks/useCompanies';
import { useActivityDictionary } from '@/hooks/useActivityDictionary';
import { applicableSlotCount } from '@/utils/applicability';
import type { ApplicabilityIndex } from '@/utils/applicability';
import {
  completedAreaEvents,
  openAreaSlots,
  productionRateBy,
  remainingBy,
  type ActivityIdentity,
  type ProductionMeasure,
  type ProductionRate,
  type RateKey,
  type RateUnit,
  type RemainingArea,
  type SlotStatus,
} from '@/utils/productionRates';
import { assessPace, type PaceAssessment } from '@/utils/requiredRate';
import { forecastTrend, forecastSlipDays, type SlotCompletion } from '@/utils/forecastTrend';
import { parseDay } from '@/utils/progressAnalytics';
import { divisionLabel } from '@/utils/costCodes';
import type { StatusHistoryEvent } from '@/hooks/useProjectQueries';
import type { Unit, Activity, StatusLog } from '@/types/domain';

/**
 * ProductionRates — the forward-looking production panel (Scheduling Analytics
 * Slice B, Phase 6). Reads history (never writes): how fast each cost code /
 * subcontractor is actually going, the required rate to hit each trade's planned
 * finish, the resulting staffing/date action, the building's slipping-forecast
 * trend, and the single pace-critical trade that drives the end date.
 *
 * The measure defaults to LOCATIONS per week (e.g. "8 apartments/week") — it needs
 * no drawing scale, so it works on every project. SF/week is an optional toggle for
 * area-driven trades on calibrated drawings (a location with no drawn area is
 * excluded from SF but still counts as one location).
 *
 * All math lives in the pure utils (productionRates / requiredRate /
 * forecastTrend); this component only joins identity labels + renders. Honesty is
 * inherited: N/A slots never enter a denominator, and tiny-sample / zero-span /
 * no-pace rows are suppressed with a reason, never faked.
 */

export interface ProductionRatesProps {
  allUnits: Unit[];
  statuses: StatusLog[];
  activities: Activity[];
  track: string;
  /** Track-filtered completed history (carries activity_id — see useStatusHistory). */
  history: StatusHistoryEvent[];
  applicabilityIndex: ApplicabilityIndex;
}

const fmtWeek = (iso: string | null) => {
  const d = iso ? parseDay(iso) : null;
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
};

interface RateRow {
  key: string;
  label: string;
  sublabel: string | null;
  rate: ProductionRate;
  remaining: RemainingArea | null;
  assessment: PaceAssessment;
}

function suppressionText(rate: ProductionRate): string {
  if (rate.suppressed === 'tiny-sample') return `too few completions (${rate.eventCount}) for a rate`;
  if (rate.suppressed === 'zero-span') return 'all completions on one day — no span yet';
  return 'no completions yet';
}

/** The status chip: the plain-English staffing/date action. */
function PaceChip({ a }: { a: PaceAssessment }) {
  switch (a.status) {
    case 'complete':
      return <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><Check size={13} /> complete</span>;
    case 'no-pace':
      return <span className="text-[11px] text-slate-400">no recent pace</span>;
    case 'no-target':
      return <span className="text-[11px] text-slate-400">no planned finish</span>;
    case 'ahead':
      return <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-400"><TrendingUp size={13} /> ahead {a.daysLate !== null ? `${Math.abs(a.daysLate)}d` : ''}</span>;
    case 'on-pace':
      return <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">on pace</span>;
    case 'overdue':
      return <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-400"><TriangleAlert size={13} /> past planned finish</span>;
    case 'behind': {
      const crews = a.extraCrews && a.extraCrews > 0 ? ` · +${a.extraCrews} crew${a.extraCrews === 1 ? '' : 's'}` : '';
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-400" title="At the current pace the forecast finish is later than the planned finish">
          <TrendingDown size={13} /> ~{a.daysLate}d late{crews}
        </span>
      );
    }
  }
}

/** Small line sparkline of the projected finish over the last vantage weeks. */
function ForecastTrendMini({ units, activities, track, history, applicabilityIndex, today }: {
  units: RateUnit[]; activities: Activity[]; track: string; history: StatusHistoryEvent[];
  applicabilityIndex: ApplicabilityIndex; today: Date;
}) {
  const { points, slip } = useMemo(() => {
    const trackActs = activities.filter(a => a.track === track);
    const totalSlots = applicableSlotCount(units, trackActs, applicabilityIndex);
    const completions: SlotCompletion[] = history
      .filter(h => h.unit_id && h.activity_id && h.logged_date)
      .map(h => ({ slotKey: `${h.unit_id}_${h.activity_id}`, date: (h.logged_date as string).slice(0, 10) }));
    const pts = forecastTrend({ totalSlots, completions, today, vantageWeeks: 8 });
    return { points: pts, slip: forecastSlipDays(pts) };
  }, [units, activities, track, history, applicabilityIndex, today]);

  const dated = points.filter(p => p.forecastDate);
  if (dated.length < 2) return null;

  // Plot each forecastDate on a shared time axis.
  const times = dated.map(p => (parseDay(p.forecastDate) as Date).getTime());
  const min = Math.min(...times), max = Math.max(...times);
  const span = Math.max(1, max - min);
  const W = 96, H = 22;
  const step = W / Math.max(1, dated.length - 1);
  const pointsAttr = dated
    .map((p, i) => `${(i * step).toFixed(1)},${(H - 3 - ((parseDay(p.forecastDate) as Date).getTime() - min) / span * (H - 6)).toFixed(1)}`)
    .join(' ');
  const slipping = (slip ?? 0) > 6;

  return (
    <span className="flex items-center gap-2" title="Projected building finish as of each of the last 8 weeks — rising = the finish is sliding later">
      <svg width={W} height={H} className="overflow-visible">
        <polyline points={pointsAttr} fill="none" stroke={slipping ? '#dc2626' : '#059669'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className={`text-[11px] font-semibold whitespace-nowrap ${slipping ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
        {slip !== null && slip > 0 ? `finish slipped ~${slip}d` : slip !== null && slip < 0 ? `finish pulled in ~${Math.abs(slip)}d` : 'finish steady'}
      </span>
    </span>
  );
}

export default function ProductionRates({ allUnits, statuses, activities, track, history, applicabilityIndex }: ProductionRatesProps) {
  const today = useMemo(() => new Date(), []);
  const [axis, setAxis] = useState<Extract<RateKey, 'costCodeId' | 'subId'>>('costCodeId');
  // Locations/week is the default — it needs no drawing scale. SF is opt-in.
  const [measure, setMeasure] = useState<ProductionMeasure>('locations');

  const unitShort = measure === 'sf' ? 'SF' : 'loc';
  const unitLong = measure === 'sf' ? 'SF' : 'locations';
  // SF is whole numbers; a location rate can be fractional (e.g. 1.5/wk).
  const fmtQty = (n: number) => measure === 'sf' ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toLocaleString();

  const { data: costCodes = [] } = useCostCodes();
  const { data: companies = [] } = useCompanies();
  const { data: dictionary = [] } = useActivityDictionary();

  // activity_id → { costCodeId (via dictionary), subId (direct on the activity) }
  const identity = useMemo<Record<string, ActivityIdentity>>(() => {
    const costByDict = new Map(dictionary.map(d => [d.id, d.cost_code_id]));
    const out: Record<string, ActivityIdentity> = {};
    for (const a of activities) {
      out[a.id] = {
        costCodeId: a.dictionary_id ? (costByDict.get(a.dictionary_id) ?? null) : null,
        subId: a.subcontractor_id ?? null,
      };
    }
    return out;
  }, [activities, dictionary]);

  const trackActivities = useMemo(() => activities.filter(a => a.track === track), [activities, track]);

  // Actual production events + open backlog, both applicability-filtered in the util.
  const events = useMemo(
    () => completedAreaEvents(history, allUnits, identity, applicabilityIndex, measure),
    [history, allUnits, identity, applicabilityIndex, measure],
  );

  const openSlots = useMemo(() => {
    const statusBySlot = new Map<string, SlotStatus>();
    for (const s of statuses) {
      if (s.track !== track || !s.unit_id || !s.activity_id) continue;
      statusBySlot.set(`${s.unit_id}_${s.activity_id}`, { temporal_state: s.temporal_state, planned_end_date: s.planned_end_date });
    }
    return openAreaSlots(allUnits, trackActivities, identity, statusBySlot, applicabilityIndex, measure);
  }, [statuses, track, allUnits, trackActivities, identity, applicabilityIndex, measure]);

  // Label resolvers per axis.
  const labelFor = useMemo(() => {
    const codeById = new Map(costCodes.map(c => [c.id, c]));
    const companyById = new Map(companies.map(c => [c.id, c]));
    return (key: string, ax: 'costCodeId' | 'subId'): { label: string; sublabel: string | null } => {
      if (ax === 'costCodeId') {
        const c = codeById.get(key);
        return c ? { label: `${c.code}${c.description ? ` · ${c.description}` : ''}`, sublabel: divisionLabel(c.division) } : { label: 'Unknown code', sublabel: null };
      }
      const co = companyById.get(key);
      return co ? { label: co.name, sublabel: co.trade ?? null } : { label: 'Unknown sub', sublabel: null };
    };
  }, [costCodes, companies]);

  const rows = useMemo<RateRow[]>(() => {
    const rates = productionRateBy(events, axis, measure);
    const remaining = remainingBy(openSlots, axis, measure);
    const rateByKey = new Map(rates.map(r => [r.key, r]));
    const remByKey = new Map(remaining.map(r => [r.key, r]));
    const keys = new Set<string>([...rateByKey.keys(), ...remByKey.keys()]);

    const out: RateRow[] = [];
    for (const key of keys) {
      const rate = rateByKey.get(key) ?? { key, measure, total: 0, eventCount: 0, firstDate: null, lastDate: null, spanDays: 0, perWeek: null, suppressed: 'tiny-sample' as const };
      const rem = remByKey.get(key) ?? null;
      const assessment = assessPace({
        remaining: rem?.remaining ?? 0,
        actualPerWeek: rate.perWeek,
        today,
        targetDate: rem?.targetDate ? parseDay(rem.targetDate) : null,
      });
      const { label, sublabel } = labelFor(key, axis);
      out.push({ key, label, sublabel, rate, remaining: rem, assessment });
    }

    // Worst-first: overdue/behind (by days late) → then most remaining work.
    const severity = (a: PaceAssessment) => a.status === 'overdue' ? 3 : a.status === 'behind' ? 2 : a.status === 'no-pace' && a.remaining > 0 ? 1 : 0;
    out.sort((x, y) => {
      const sv = severity(y.assessment) - severity(x.assessment);
      if (sv !== 0) return sv;
      const dl = (y.assessment.daysLate ?? -Infinity) - (x.assessment.daysLate ?? -Infinity);
      if (dl !== 0 && Number.isFinite(dl)) return dl;
      return y.assessment.remaining - x.assessment.remaining;
    });
    return out;
  }, [events, openSlots, axis, measure, today, labelFor]);

  // The pace-critical trade: the latest forecast finish among rows that have one.
  const critical = useMemo(() => {
    let best: RateRow | null = null;
    for (const r of rows) {
      if (!r.assessment.forecastDate) continue;
      if (!best || (r.assessment.forecastDate as string) > (best.assessment.forecastDate as string)) best = r;
    }
    return best;
  }, [rows]);

  // Nothing to show until at least one activity carries a cost code / sub.
  const hasIdentity = useMemo(() => Object.values(identity).some(i => i.costCodeId || i.subId), [identity]);
  if (!hasIdentity || rows.length === 0) return null;

  const measureBtn = (m: ProductionMeasure, label: string) => (
    <button
      type="button"
      onClick={() => setMeasure(m)}
      className={`px-3 py-1.5 transition-colors ${measure === m ? 'bg-indigo-600 text-white' : 'bg-white/60 dark:bg-black/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="glass-panel rounded-2xl border shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200/60 dark:border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <Gauge size={20} className="text-indigo-500 shrink-0" />
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Production Rates</h2>
          <span className="hidden md:inline text-[11px] text-slate-400 truncate">
            {measure === 'sf' ? 'SF/week from drawn areas' : 'locations completed/week'} · required vs. actual · all levels
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ForecastTrendMini units={allUnits} activities={activities} track={track} history={history} applicabilityIndex={applicabilityIndex} today={today} />
          <div className="inline-flex rounded-lg border border-slate-300/70 dark:border-white/15 overflow-hidden text-xs font-semibold" title="Locations = count of units completed (no scale needed) · SF = square feet (needs a calibrated drawing)">
            {measureBtn('locations', 'Locations')}
            {measureBtn('sf', 'SF')}
          </div>
          <div className="inline-flex rounded-lg border border-slate-300/70 dark:border-white/15 overflow-hidden text-xs font-semibold">
            <button
              type="button"
              onClick={() => setAxis('costCodeId')}
              className={`px-3 py-1.5 transition-colors ${axis === 'costCodeId' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-white/60 dark:bg-black/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'}`}
            >
              Cost code
            </button>
            <button
              type="button"
              onClick={() => setAxis('subId')}
              className={`px-3 py-1.5 inline-flex items-center gap-1 transition-colors ${axis === 'subId' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-white/60 dark:bg-black/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'}`}
            >
              <Users size={12} /> Subcontractor
            </button>
          </div>
        </div>
      </div>

      {critical && (critical.assessment.status === 'behind' || critical.assessment.status === 'overdue') && (
        <div className="flex items-start gap-2 px-5 py-2.5 bg-red-50/70 dark:bg-red-900/10 border-b border-red-200/60 dark:border-red-500/15">
          <TriangleAlert size={15} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
            <span className="font-bold">Pace-critical: {critical.label}</span> — projected to finish{' '}
            <b>~{fmtWeek(critical.assessment.forecastDate)}</b>, the latest of any {axis === 'costCodeId' ? 'trade' : 'sub'} in this scope.
            {critical.assessment.daysLate !== null && critical.assessment.daysLate > 0 && <> That&apos;s <b>~{critical.assessment.daysLate}d</b> past its planned finish</>}
            {critical.assessment.extraCrews && critical.assessment.extraCrews > 0
              ? <> — adding <b>~{critical.assessment.extraCrews} crew{critical.assessment.extraCrews === 1 ? '' : 's'}</b> here moves the end date in the most.</>
              : <>. This trade drives the end date.</>}
          </p>
        </div>
      )}

      <div className="hidden sm:grid grid-cols-[1fr_120px_110px_110px_150px] gap-x-4 px-5 py-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-200/60 dark:border-white/5">
        <span>{axis === 'costCodeId' ? 'Cost code' : 'Subcontractor'}</span>
        <span className="text-right">Actual {unitShort}/wk</span>
        <span className="text-right">Remaining {unitShort}</span>
        <span className="text-right">Needed {unitShort}/wk</span>
        <span>Pace</span>
      </div>

      <div className="divide-y divide-slate-200/60 dark:divide-white/5">
        {rows.map(row => (
          <div key={row.key} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_110px_110px_150px] items-center gap-x-4 px-5 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{row.label}</div>
              <div className="text-[10px] text-slate-400 truncate">
                {row.sublabel ? `${row.sublabel} · ` : ''}
                {row.rate.eventCount > 0
                  ? `${row.rate.eventCount} ${row.rate.eventCount === 1 ? 'location' : 'locations'} done${measure === 'sf' ? ` · ${fmtQty(row.rate.total)} SF` : ''}`
                  : 'not started'}
              </div>
            </div>

            <div className="hidden sm:block text-right">
              {row.rate.perWeek !== null ? (
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">{fmtQty(row.rate.perWeek)}</span>
              ) : (
                <span className="text-[10px] text-slate-400 italic" title={suppressionText(row.rate)}>—</span>
              )}
            </div>

            <div className="hidden sm:block text-right text-sm text-slate-600 dark:text-slate-300 tabular-nums">
              {row.assessment.remaining > 0 ? fmtQty(row.assessment.remaining) : <span className="text-slate-400">0</span>}
            </div>

            <div className="hidden sm:block text-right text-sm text-slate-600 dark:text-slate-300 tabular-nums">
              {row.assessment.requiredPerWeek && row.assessment.requiredPerWeek > 0
                ? fmtQty(row.assessment.requiredPerWeek)
                : <span className="text-slate-400">—</span>}
            </div>

            <div className="justify-self-end sm:justify-self-start"><PaceChip a={row.assessment} /></div>
          </div>
        ))}
      </div>

      <p className="px-5 py-2 text-[10px] text-slate-400 italic border-t border-slate-200/60 dark:border-white/5">
        {measure === 'sf'
          ? 'SF from each location’s drawn area — only trustworthy on calibrated drawings (area-less locations are excluded).'
          : 'Counts each completed location as one — works without a drawing scale.'}
        {' '}Rates need ≥{3} completions over &gt;0 days — thinner samples show &ldquo;—&rdquo;. Required rate = remaining {unitLong} ÷ weeks to the latest planned finish; crews assume the current pace ≈ one crew. Read-only.
      </p>
    </div>
  );
}
