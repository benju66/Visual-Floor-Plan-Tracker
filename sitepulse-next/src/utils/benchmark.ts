import { buildApplicabilityIndex } from '@/utils/applicability';
import {
  completedAreaEvents,
  rateForEvents,
  type ActivityIdentity,
  type CompletedAreaRow,
  type ProductionMeasure,
  type ProductionRate,
  type RateUnit,
} from '@/utils/productionRates';

/**
 * benchmark — pure per-GC (within-tenant) cross-project production-rate math for
 * Scheduling Analytics (Slice B, Phase 6c). Given a compact dataset of the user's
 * OWN projects (the RLS-scoped read lives in the hook — this file never touches
 * the network), it computes how a single subcontractor / cost code performed on
 * each job: SF/week per project, so a GC can compare a sub across their own work.
 *
 * PRIVACY: this is per-tenant by construction — the dataset only ever contains
 * projects the signed-in user is a member of (RLS). Nothing here pools across
 * customers; the util is agnostic and simply groups whatever projects it is given.
 *
 * It REUSES the single-project pipeline (`completedAreaEvents` + `rateForEvents`)
 * per project rather than re-deriving rate math — same applicability + suppression
 * honesty (N/A never in a denominator; tiny-sample / zero-span suppressed).
 */

/** A minimal cross-project scheduling dataset (assembled by the hook, RLS-scoped). */
export interface BenchmarkDataset {
  projects: { id: string; name: string | null }[];
  sheets: { id: string; project_id: string | null }[];
  activities: {
    id: string;
    project_id: string | null;
    subcontractor_id: string | null;
    dictionary_id: string | null;
    applies_to_unit_types: string[] | null;
  }[];
  units: { id: string; sheet_id: string | null; unit_type: string | null; computed_area: number | null }[];
  history: CompletedAreaRow[];
  overrides: { activity_id: string; unit_id: string; is_applicable: boolean }[];
  /** dictionary_id → cost_code_id (resolved from the global activity dictionary). */
  costCodeByDict: Record<string, string | null>;
}

/** Which identity axis to benchmark across projects. */
export type BenchmarkAxis = 'subId' | 'costCodeId';

export interface BenchmarkRow {
  projectId: string;
  projectName: string;
  rate: ProductionRate;
}

/** All distinct sub / cost-code keys that appear on ≥1 activity (for the picker). */
export function benchmarkKeys(ds: BenchmarkDataset, axis: BenchmarkAxis): string[] {
  const keys = new Set<string>();
  for (const a of ds.activities) {
    const k = axis === 'subId'
      ? a.subcontractor_id
      : (a.dictionary_id ? ds.costCodeByDict[a.dictionary_id] ?? null : null);
    if (k) keys.add(k);
  }
  return [...keys];
}

/**
 * Per-project production rate for one sub / cost code across the tenant's own
 * projects. Only projects where the key actually did applicable work appear.
 * Sorted fastest-published-rate first; suppressed (thin-sample) rows sink to the end.
 * `measure` defaults to 'locations' (needs no scale — matches the panel default).
 */
export function benchmarkRates(ds: BenchmarkDataset, axis: BenchmarkAxis, key: string, measure: ProductionMeasure = 'locations'): BenchmarkRow[] {
  if (!key) return [];
  const projectName = new Map(ds.projects.map(p => [p.id, p.name ?? 'Untitled project']));
  const projectOfSheet = new Map(ds.sheets.map(s => [s.id, s.project_id]));

  // Group the raw dataset by project once.
  const unitsByProject = new Map<string, RateUnit[]>();
  for (const u of ds.units) {
    const pid = u.sheet_id ? projectOfSheet.get(u.sheet_id) ?? null : null;
    if (!pid) continue;
    const arr = unitsByProject.get(pid);
    const ru: RateUnit = { id: u.id, unit_type: u.unit_type, computed_area: u.computed_area };
    if (arr) arr.push(ru); else unitsByProject.set(pid, [ru]);
  }

  const activitiesByProject = new Map<string, BenchmarkDataset['activities']>();
  for (const a of ds.activities) {
    if (!a.project_id) continue;
    const arr = activitiesByProject.get(a.project_id);
    if (arr) arr.push(a); else activitiesByProject.set(a.project_id, [a]);
  }

  const overridesByProjectActivity = ds.overrides; // filtered per project below via activity ids

  const rows: BenchmarkRow[] = [];
  for (const [pid, projActivities] of activitiesByProject) {
    const units = unitsByProject.get(pid) ?? [];
    if (units.length === 0) continue;

    // Identity for THIS project's activities; the ones matching the benchmarked key.
    const identity: Record<string, ActivityIdentity> = {};
    for (const a of projActivities) {
      identity[a.id] = {
        costCodeId: a.dictionary_id ? ds.costCodeByDict[a.dictionary_id] ?? null : null,
        subId: a.subcontractor_id ?? null,
      };
    }
    const activityIds = new Set(projActivities.map(a => a.id));
    const matches = projActivities.some(a => (axis === 'subId' ? identity[a.id].subId : identity[a.id].costCodeId) === key);
    if (!matches) continue;

    const index = buildApplicabilityIndex(
      projActivities.map(a => ({ id: a.id, applies_to_unit_types: a.applies_to_unit_types })),
      overridesByProjectActivity.filter(o => activityIds.has(o.activity_id)),
    );

    const unitIds = new Set(units.map(u => u.id));
    const projHistory = ds.history.filter(h => h.activity_id && activityIds.has(h.activity_id) && h.unit_id && unitIds.has(h.unit_id));

    const events = completedAreaEvents(projHistory, units, identity, index, measure).filter(e => e[axis] === key);
    const rate = rateForEvents(events, measure);
    if (rate.eventCount === 0) continue; // this key did no applicable work on this job

    rows.push({ projectId: pid, projectName: projectName.get(pid) ?? 'Untitled project', rate: { ...rate, key } });
  }

  rows.sort((a, b) => {
    const av = a.rate.perWeek, bv = b.rate.perWeek;
    if (av !== null && bv !== null) return bv - av;
    if (av !== null) return -1;
    if (bv !== null) return 1;
    return b.rate.total - a.rate.total;
  });
  return rows;
}

/** Simple average of the PUBLISHED (non-suppressed) per-project rates. Null when none. */
export function benchmarkAverageRate(rows: BenchmarkRow[]): number | null {
  const published = rows.map(r => r.rate.perWeek).filter((v): v is number => v !== null);
  if (published.length === 0) return null;
  return published.reduce((s, v) => s + v, 0) / published.length;
}
