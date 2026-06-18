'use client';

import React from 'react';
import { Activity, Layers, Tags, ClipboardCheck, ScanLine, ChevronDown } from 'lucide-react';
import {
  REVIEW_STATES,
  REVIEW_STATE_LABELS,
  REVIEW_STATE_BADGE,
} from '@/utils/workbench';
import { roleLabel, type TopLevelRole, CANONICAL_ROLES } from '@/utils/locationTaxonomy';
import { UNSPECIFIED, type CorpusSummary } from '@/utils/workbenchStats';

// Drawing Library Management — Phase 8a corpus-health strip. A read-only, at-a-glance
// cockpit at the top of `/workbench`: the review funnel, corpus size, Definition-of-Done
// readiness, taxonomy coverage, and data-quality signals for the drawings in the hidden
// `kind='workbench'` container. Purely presentational — all math is done by the pure,
// unit-tested `summarizeCorpus`. This is the corpus-building cockpit and MUST never
// appear on the live Projects Dashboard or flow through `progressAnalytics`.

interface WorkbenchHealthStripProps {
  summary: CorpusSummary;
  /** Whether the strip body is hidden (header-only). Owned by `useWorkbenchStore`. */
  collapsed: boolean;
  onToggle: () => void;
}

/** Drop a one-decimal place only when there is a fractional part ("8" not "8.0"). */
function formatAvg(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Record entries sorted by count desc, with the `Unspecified` bucket pinned last. */
function rankedEntries(record: Record<string, number>): [string, number][] {
  return Object.entries(record)
    .filter(([, count]) => count > 0)
    .sort((a, b) => {
      if (a[0] === UNSPECIFIED) return 1;
      if (b[0] === UNSPECIFIED) return -1;
      return b[1] - a[1];
    });
}

export default function WorkbenchHealthStrip({
  summary,
  collapsed,
  onToggle,
}: WorkbenchHealthStripProps) {
  const {
    totalDrawings,
    totalLabels,
    avgLabelsPerDrawing,
    dodReadyCount,
    reviewFunnel,
    byRole,
    distinctSubtypes,
    untypedOrPendingCount,
    vectorQuality,
    byProjectType,
  } = summary;

  const roleEntries = (CANONICAL_ROLES as readonly TopLevelRole[])
    .map((role) => [roleLabel(role), byRole[role]] as [string, number])
    .filter(([, count]) => count > 0);
  if (byRole.unspecified > 0) roleEntries.push([UNSPECIFIED, byRole.unspecified]);

  const projectTypeEntries = rankedEntries(byProjectType);

  return (
    <section
      aria-label="Corpus health"
      className="mb-8 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/50 shadow-sm overflow-hidden"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls="corpus-health-body"
        className="w-full flex items-center gap-2 px-6 py-4 text-left hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
      >
        <Activity size={18} className="text-violet-500 shrink-0" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200 shrink-0">
          Corpus health
        </h2>
        {collapsed ? (
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
            {totalDrawings} {totalDrawings === 1 ? 'drawing' : 'drawings'} · {totalLabels} labels ·{' '}
            {dodReadyCount}/{totalDrawings} review-ready
          </span>
        ) : (
          <span className="hidden sm:inline text-xs font-medium text-slate-400 dark:text-slate-500 truncate">
            this library only · never on your live dashboard
          </span>
        )}
        <ChevronDown
          size={18}
          className={`ml-auto shrink-0 text-slate-400 transition-transform ${collapsed ? '' : 'rotate-180'}`}
        />
      </button>

      {!collapsed && (
        <div id="corpus-health-body" className="border-t border-slate-100 dark:border-white/5">
          {/* Top-line corpus size */}
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100 dark:divide-white/5">
            <StatTile label="Drawings" value={totalDrawings} />
            <StatTile label="Labels banked" value={totalLabels} />
            <StatTile label="Avg labels / drawing" value={formatAvg(avgLabelsPerDrawing)} />
            <StatTile
              label="Review-ready"
              value={`${dodReadyCount} / ${totalDrawings}`}
              hint="pass the Definition of Done"
              icon={<ClipboardCheck size={14} className="text-emerald-500" />}
            />
          </div>

          <div className="px-6 py-5 space-y-5 border-t border-slate-100 dark:border-white/5">
            {/* Review funnel */}
            <Row icon={<Layers size={14} className="text-slate-400" />} title="Review funnel">
              {REVIEW_STATES.map((state) => (
                <span
                  key={state}
                  className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border ${REVIEW_STATE_BADGE[state]}`}
                >
                  {REVIEW_STATE_LABELS[state]}
                  <span className="tabular-nums opacity-80">{reviewFunnel[state]}</span>
                </span>
              ))}
            </Row>

            {/* Taxonomy coverage */}
            <Row icon={<Tags size={14} className="text-slate-400" />} title="Taxonomy coverage">
              {totalLabels === 0 ? (
                <MutedNote>No labels banked yet.</MutedNote>
              ) : (
                <>
                  {roleEntries.map(([label, count]) => (
                    <CountChip key={label} label={label} count={count} />
                  ))}
                  <CountChip label="Sub-types used" count={distinctSubtypes} />
                  {untypedOrPendingCount > 0 && (
                    <CountChip
                      label="Awaiting a sub-type"
                      count={untypedOrPendingCount}
                      tone="amber"
                    />
                  )}
                </>
              )}
            </Row>

            {/* Data quality */}
            <Row icon={<ScanLine size={14} className="text-slate-400" />} title="Source quality">
              <CountChip label="Clean vectors" count={vectorQuality.clean} tone="emerald" />
              <CountChip label="Scanned" count={vectorQuality.scanned} tone="amber" />
              {vectorQuality.unknown > 0 && (
                <CountChip label="Unknown" count={vectorQuality.unknown} />
              )}
              <span className="mx-1 w-px self-stretch bg-slate-200 dark:bg-white/10" aria-hidden />
              {projectTypeEntries.map(([label, count]) => (
                <CountChip key={label} label={label} count={count} />
              ))}
            </Row>
          </div>
        </div>
      )}
    </section>
  );
}

function StatTile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-1.5 text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
        {icon}
        {value}
      </div>
      <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      {hint && <div className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  );
}

function Row({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
      <div className="flex items-center gap-1.5 shrink-0 w-40 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 pt-1">
        {icon}
        {title}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

const CHIP_TONES = {
  slate: 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300',
  emerald:
    'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
  amber:
    'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300',
} as const;

function CountChip({
  label,
  count,
  tone = 'slate',
}: {
  label: string;
  count: number;
  tone?: keyof typeof CHIP_TONES;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${CHIP_TONES[tone]}`}
    >
      {label}
      <span className="tabular-nums font-bold">{count}</span>
    </span>
  );
}

function MutedNote({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-slate-400 dark:text-slate-500">{children}</span>;
}
