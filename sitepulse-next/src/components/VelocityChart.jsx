"use client";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

/**
 * VelocityChart — stateless presenter for the Burn-Up + Daily Velocity chart.
 *
 * Props:
 *   chartData — { date, label, dailyVelocity, cumulativeCompleted, totalScope }[]
 *               Pre-computed by ProjectDashboard's useMemo.
 */

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const cumulative = payload.find(p => p.dataKey === 'cumulativeCompleted')?.value ?? 0;
  const daily = payload.find(p => p.dataKey === 'dailyVelocity')?.value ?? 0;
  const planned = payload[0]?.payload?.plannedCumulative;
  const totalScope = payload[0]?.payload?.totalScope ?? 0;
  const pct = totalScope > 0 ? Math.round((cumulative / totalScope) * 100) : 0;

  return (
    <div className="bg-slate-900/95 text-white px-3 py-2.5 rounded-xl shadow-2xl text-xs border border-slate-700 min-w-[150px] pointer-events-none">
      <div className="font-bold mb-2 text-slate-300 border-b border-slate-700 pb-1.5">{label}</div>
      <div className="flex justify-between gap-4 mb-1">
        <span className="text-slate-400">Completed</span>
        <span className="font-bold text-emerald-400">{cumulative} ({pct}%)</span>
      </div>
      <div className="flex justify-between gap-4 mb-1">
        <span className="text-slate-400">{daily >= 0 ? "Day's output" : "Velocity"}</span>
        <span className="font-bold text-slate-200">+{daily}</span>
      </div>
      {typeof planned === 'number' && planned > 0 && (
        <div className="flex justify-between gap-4 mb-1">
          <span className="text-slate-400">Planned by now</span>
          <span className={`font-bold ${cumulative >= planned ? 'text-emerald-400' : 'text-red-400'}`}>{planned}</span>
        </div>
      )}
      <div className="flex justify-between gap-4">
        <span className="text-slate-400">Total scope</span>
        <span className="font-bold text-amber-400">{totalScope}</span>
      </div>
    </div>
  );
}

export default function VelocityChart({ chartData }) {
  if (!chartData || chartData.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm italic">
        No completions logged yet — mark milestones as <strong className="mx-1 font-semibold not-italic text-emerald-500">Completed</strong> to see trends.
      </div>
    );
  }

  const totalScope = chartData[chartData.length - 1]?.totalScope ?? 0;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 24, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="burnUpGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(148,163,184,0.15)"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={false}
          tickLine={false}
          domain={[0, totalScope > 0 ? Math.ceil(totalScope * 1.05) : 'auto']}
        />

        {/* Total Scope ceiling reference line */}
        {totalScope > 0 && (
          <ReferenceLine
            y={totalScope}
            stroke="#f59e0b"
            strokeDasharray="5 4"
            strokeWidth={1.5}
            label={{
              value: `Scope: ${totalScope}`,
              position: 'insideTopRight',
              fontSize: 9,
              fill: '#f59e0b',
              dy: -4,
            }}
          />
        )}

        {/* Daily velocity bars — background context layer */}
        <Bar
          dataKey="dailyVelocity"
          name="Daily Completions"
          fill="rgba(148,163,184,0.25)"
          radius={[3, 3, 0, 0]}
          maxBarSize={32}
        />

        {/* Planned cumulative — the schedule the burn-up is racing against */}
        {chartData.some(d => typeof d.plannedCumulative === 'number' && d.plannedCumulative > 0) && (
          <Line
            type="stepAfter"
            dataKey="plannedCumulative"
            name="Planned"
            stroke="#64748b"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            dot={false}
            activeDot={false}
          />
        )}

        {/* Cumulative burn-up area — primary signal */}
        <Area
          type="monotone"
          dataKey="cumulativeCompleted"
          name="Total Completed"
          stroke="#10b981"
          strokeWidth={2.5}
          fill="url(#burnUpGradient)"
          dot={false}
          activeDot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }}
        />

        <Tooltip
          content={<ChartTooltip />}
          cursor={{ fill: 'rgba(148,163,184,0.07)' }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
