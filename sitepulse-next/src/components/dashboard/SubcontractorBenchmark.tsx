"use client";
import React, { useMemo, useState } from 'react';
import { Trophy, Users, Lock, BarChart3 } from 'lucide-react';
import { useBenchmarkDataset } from '@/hooks/useBenchmarkAnalytics';
import { useCostCodes } from '@/hooks/useCostCodes';
import { useCompanies } from '@/hooks/useCompanies';
import { benchmarkKeys, benchmarkRates, benchmarkAverageRate, type BenchmarkAxis } from '@/utils/benchmark';
import { divisionLabel } from '@/utils/costCodes';

/**
 * SubcontractorBenchmark — private, per-GC cross-project benchmarking (Scheduling
 * Analytics Slice B, Phase 6c). Compares one subcontractor (or cost code) across
 * the tenant's OWN jobs: locations completed/week per project + the average (the
 * scale-free measure — see ProductionRates). Read-only; the data is RLS-scoped to
 * the user's memberships (never another customer's work).
 *
 * The cross-project read is heavier than the per-project dashboard queries, so it
 * is opt-in: the dataset only loads once the user opens the panel (`enabled`).
 */

// Locations/week can be fractional (e.g. 1.5/wk) — show one decimal.
const fmtLoc = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

export default function SubcontractorBenchmark() {
  const [open, setOpen] = useState(false);
  const [axis, setAxis] = useState<BenchmarkAxis>('subId');
  const [selected, setSelected] = useState<string>('');

  const { data: dataset, isFetching } = useBenchmarkDataset(open);
  const { data: costCodes = [] } = useCostCodes();
  const { data: companies = [] } = useCompanies();

  const labelFor = useMemo(() => {
    const codeById = new Map(costCodes.map(c => [c.id, c]));
    const companyById = new Map(companies.map(c => [c.id, c]));
    return (key: string, ax: BenchmarkAxis): { label: string; sub: string | null } => {
      if (ax === 'costCodeId') {
        const c = codeById.get(key);
        return c ? { label: `${c.code}${c.description ? ` · ${c.description}` : ''}`, sub: divisionLabel(c.division) } : { label: 'Unknown code', sub: null };
      }
      const co = companyById.get(key);
      return co ? { label: co.name, sub: co.trade ?? null } : { label: 'Unknown sub', sub: null };
    };
  }, [costCodes, companies]);

  // Keys that appear on ≥1 activity, with how many of the user's projects each spans.
  const keyOptions = useMemo(() => {
    if (!dataset) return [] as { key: string; label: string; projectCount: number }[];
    const keys = benchmarkKeys(dataset, axis);
    return keys
      .map(key => ({ key, label: labelFor(key, axis).label, projectCount: benchmarkRates(dataset, axis, key).length }))
      .filter(o => o.projectCount > 0)
      .sort((a, b) => b.projectCount - a.projectCount || a.label.localeCompare(b.label));
  }, [dataset, axis, labelFor]);

  // Default to the first key that spans ≥2 projects (the point of benchmarking).
  const effectiveKey = useMemo(() => {
    if (selected && keyOptions.some(o => o.key === selected)) return selected;
    return keyOptions.find(o => o.projectCount >= 2)?.key ?? keyOptions[0]?.key ?? '';
  }, [selected, keyOptions]);

  const rows = useMemo(
    () => (dataset && effectiveKey ? benchmarkRates(dataset, axis, effectiveKey) : []),
    [dataset, axis, effectiveKey],
  );
  const avg = useMemo(() => benchmarkAverageRate(rows), [rows]);
  const maxRate = useMemo(() => Math.max(1, ...rows.map(r => r.rate.perWeek ?? 0)), [rows]);

  return (
    <div className="glass-panel rounded-2xl border shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200/60 dark:border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <Trophy size={20} className="text-amber-500 shrink-0" />
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Private Benchmarking</h2>
          <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-slate-400">
            <Lock size={11} /> your own jobs only · never shared across companies
          </span>
        </div>
        {open && (
          <div className="inline-flex rounded-lg border border-slate-300/70 dark:border-white/15 overflow-hidden text-xs font-semibold">
            <button
              type="button"
              onClick={() => { setAxis('subId'); setSelected(''); }}
              className={`px-3 py-1.5 inline-flex items-center gap-1 transition-colors ${axis === 'subId' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-white/60 dark:bg-black/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'}`}
            >
              <Users size={12} /> Subcontractor
            </button>
            <button
              type="button"
              onClick={() => { setAxis('costCodeId'); setSelected(''); }}
              className={`px-3 py-1.5 transition-colors ${axis === 'costCodeId' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-white/60 dark:bg-black/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'}`}
            >
              Cost code
            </button>
          </div>
        )}
      </div>

      {!open ? (
        <div className="px-5 py-6 flex flex-col items-center text-center gap-3">
          <BarChart3 size={26} className="text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500 max-w-md">
            Compare a subcontractor or cost code across all of your projects — who lays floor fastest, which job a trade is slow on.
            Loads data from your own jobs only.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-800 text-white dark:bg-white dark:text-slate-900 hover:opacity-90 transition-opacity"
          >
            Load cross-project benchmark
          </button>
        </div>
      ) : isFetching && !dataset ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">Loading your projects…</div>
      ) : keyOptions.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">
          No {axis === 'subId' ? 'subcontractors' : 'coded activities'} with completed work across your projects yet.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-slate-200/60 dark:border-white/5">
            <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              {axis === 'subId' ? 'Subcontractor' : 'Cost code'}
            </label>
            <select
              value={effectiveKey}
              onChange={(e) => setSelected(e.target.value)}
              className="flex-1 min-w-[200px] max-w-md px-3 py-1.5 text-sm rounded-lg border border-slate-300/80 dark:border-white/15 bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200"
            >
              {keyOptions.map(o => (
                <option key={o.key} value={o.key}>
                  {o.label} · {o.projectCount} {o.projectCount === 1 ? 'job' : 'jobs'}
                </option>
              ))}
            </select>
            {avg !== null && (
              <span className="text-xs text-slate-500 whitespace-nowrap">
                avg <b className="text-slate-700 dark:text-slate-200">{fmtLoc(avg)} loc/wk</b>
              </span>
            )}
          </div>

          <div className="divide-y divide-slate-200/60 dark:divide-white/5">
            {rows.map((row, idx) => {
              const rate = row.rate.perWeek;
              const pct = rate !== null ? (rate / maxRate) * 100 : 0;
              return (
                <div key={row.projectId} className="grid grid-cols-[minmax(120px,200px)_1fr_auto] items-center gap-x-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
                      {idx === 0 && rate !== null && <Trophy size={12} className="text-amber-500 shrink-0" />}
                      {row.projectName}
                    </div>
                    <div className="text-[10px] text-slate-400">{row.rate.eventCount} {row.rate.eventCount === 1 ? 'location' : 'locations'} done</div>
                  </div>
                  <div className="relative h-5">
                    <div className="absolute inset-0 rounded-md bg-slate-200/70 dark:bg-slate-700/60" />
                    {rate !== null && (
                      <div className="absolute inset-y-0 left-0 rounded-md bg-indigo-500 transition-all duration-500" style={{ width: `${Math.max(4, pct)}%` }} />
                    )}
                  </div>
                  <div className="text-right text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100 min-w-[92px]">
                    {rate !== null ? `${fmtLoc(rate)} loc/wk` : <span className="text-[10px] font-normal text-slate-400 italic">too thin to rate</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {rows.length < 2 && (
            <p className="px-5 py-2 text-[11px] text-amber-600 dark:text-amber-400 italic border-t border-slate-200/60 dark:border-white/5">
              Only one of your jobs has completed work for this selection — the benchmark grows as you run this {axis === 'subId' ? 'sub' : 'trade'} on more projects.
            </p>
          )}
          <p className="px-5 py-2 text-[10px] text-slate-400 italic border-t border-slate-200/60 dark:border-white/5">
            Locations completed/week, applicable slots only (no drawing scale needed). Thin samples show &ldquo;too thin to rate&rdquo;. Data stays within your company — never pooled across customers.
          </p>
        </>
      )}
    </div>
  );
}
