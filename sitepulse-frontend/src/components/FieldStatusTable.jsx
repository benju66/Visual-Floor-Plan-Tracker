import React, { useMemo } from 'react';

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
}) {
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
        No units mapped on this level yet. Switch to Map view to draw units.
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
                  Unit {unit.unit_number}
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
          const recent =
            log?.created_at && Date.now() - new Date(log.created_at).getTime() < 1000 * 60 * 60 * 24 * 30;
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

      {statusFilter && visible.length === 0 && (
        <p className="mt-4 text-center text-sm text-slate-500">No units match this milestone filter.</p>
      )}
    </div>
  );
}
