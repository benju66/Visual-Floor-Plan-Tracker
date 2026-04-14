"use client";
import React, { useMemo, useState, useEffect } from 'react';

function UpdatingRing() {
  return (
    <svg className="h-7 w-7 shrink-0 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function FieldStatusTable({
  units,
  activeStatuses,
  statusFilter,
  savingUnitId,
  onChooseStatus,
  defaultView = 'table',
}) {
  const [viewStyle, setViewStyle] = useState(defaultView);

  useEffect(() => {
    setViewStyle(defaultView);
  }, [defaultView]);

  const ranked = useMemo(() => {
    return [...units]
      .map((unit) => ({
        unit,
        log: activeStatuses.find((s) => s.unit_id === unit.id),
      }))
      .sort((a, b) => {
        const ta = a.log?.created_at ? new Date(a.log.created_at).getTime() : 0;
        const tb = b.log?.created_at ? new Date(b.log.created_at).getTime() : 0;
        if (tb !== ta) return tb - ta;
        return a.unit.unit_number.localeCompare(b.unit.unit_number);
      });
  }, [units, activeStatuses]);

  const visible = useMemo(() => {
    if (!statusFilter) return ranked;
    return ranked.filter((row) => row.log?.milestone === statusFilter);
  }, [ranked, statusFilter]);

  if (!units || units.length === 0) {
    return (
      <div
        className="p-8 text-center text-slate-600 rounded-2xl border shadow-lg backdrop-blur-md"
        style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
      >
        No locations mapped on this level yet. Switch to Map view to draw locations.
      </div>
    );
  }

  const StatusTrigger = ({ unit, currentMilestone, large }) => (
    <button
      type="button"
      onClick={() => onChooseStatus(unit)}
      disabled={savingUnitId === unit.id}
      className={`w-full text-left rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/40 dark:bg-black/15 px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 shadow-sm transition hover:bg-white/70 dark:hover:bg-black/25 disabled:opacity-50 ${large ? 'py-3 text-base' : ''}`}
    >
      {currentMilestone || 'Choose status…'}
    </button>
  );

  return (
    <div className="w-full pb-6">
      <div className="flex justify-end mb-4">
        <div className="flex rounded-lg border border-slate-300/80 dark:border-white/15 overflow-hidden shadow-sm">
          <button
            type="button"
            onClick={() => setViewStyle('table')}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              viewStyle === 'table'
                ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => setViewStyle('card')}
            className={`px-3 py-1.5 text-xs font-semibold border-l border-slate-300/80 dark:border-white/10 transition-colors ${
              viewStyle === 'card'
                ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                : 'bg-white/70 dark:bg-black/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            Cards
          </button>
        </div>
      </div>

      {viewStyle === 'card' ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:hidden">
            {visible.map(({ unit, log }, index) => {
              const currentMilestone = log?.milestone ?? '';
              const featured = index === 0 && log?.created_at;
              return (
                <div
                  key={unit.id}
                  className={`rounded-2xl border p-4 shadow-lg backdrop-blur-md flex flex-col gap-3 transition-transform ${featured ? 'ring-2 ring-blue-400/40' : ''}`}
                  style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`font-bold text-slate-900 dark:text-slate-100 ${featured ? 'text-xl' : 'text-lg'}`}>
                      Location {unit.unit_number}
                    </div>
                    {savingUnitId === unit.id && <UpdatingRing />}
                  </div>
                  <StatusTrigger unit={unit} currentMilestone={currentMilestone} large={featured} />
                </div>
              );
            })}
          </div>

          <div className="hidden md:grid md:grid-cols-4 md:gap-3">
            {visible.map(({ unit, log }, index) => {
              const currentMilestone = log?.milestone ?? '';
              const recent = log?.created_at && Date.now() - new Date(log.created_at).getTime() < 1000 * 60 * 60 * 24 * 30;
              const hero = index === 0;
              const wide = hero || (index === 1 && recent);

              let cellClass = 'md:col-span-1 md:min-h-[140px]';
              if (hero && visible.length > 1) cellClass = 'md:col-span-2 md:row-span-2 md:min-h-[280px]';
              else if (wide && !hero) cellClass = 'md:col-span-2 md:min-h-[140px]';

              return (
                <div
                  key={unit.id}
                  className={`rounded-2xl border p-4 shadow-lg backdrop-blur-md flex flex-col justify-between gap-3 transition hover:scale-[1.01] ${cellClass}`}
                  style={{
                    background: 'var(--glass-bg)',
                    borderColor: 'var(--glass-border)',
                    boxShadow: 'var(--glass-shadow)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`font-bold text-slate-900 dark:text-slate-100 ${hero ? 'text-2xl' : 'text-lg'}`}>
                      {unit.unit_number}
                    </div>
                    {savingUnitId === unit.id && <UpdatingRing />}
                  </div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Current status</p>
                  <StatusTrigger unit={unit} currentMilestone={currentMilestone} large={hero} />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/40 dark:bg-black/15 shadow-sm backdrop-blur-md">
          <table className="w-full text-left border-collapse text-sm text-slate-800 dark:text-slate-200">
            <thead className="bg-slate-100/50 dark:bg-slate-800/10 border-b border-slate-200/80 dark:border-white/10">
              <tr>
                <th className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 w-1/4">Location</th>
                <th className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 w-1/2">Current Status</th>
                <th className="px-5 py-3 font-semibold text-slate-900 dark:text-slate-100 w-1/4 text-right">Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ unit, log }) => (
                <tr key={unit.id} className="border-b border-slate-200/50 dark:border-white/5 last:border-none hover:bg-white/60 dark:hover:bg-white/5 transition-colors">
                  <td className="px-5 py-3 font-bold text-slate-900 dark:text-slate-100 align-middle">
                    <div className="flex items-center gap-2">
                       {unit.unit_number}
                       {savingUnitId === unit.id && <UpdatingRing />}
                    </div>
                  </td>
                  <td className="px-5 py-2 align-middle">
                    <StatusTrigger unit={unit} currentMilestone={log?.milestone ?? ''} large={false} />
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500 dark:text-slate-400 text-right align-middle font-medium">
                    {log?.created_at ? new Date(log.created_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {statusFilter && visible.length === 0 && (
        <p className="mt-4 text-center text-sm text-slate-500">No locations match this milestone filter.</p>
      )}
    </div>
  );
}
