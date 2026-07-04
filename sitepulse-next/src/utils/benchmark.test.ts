import { describe, it, expect } from 'vitest';
import { benchmarkKeys, benchmarkRates, benchmarkAverageRate, type BenchmarkDataset } from './benchmark';

// Two projects, one shared sub 'sub-A' (flooring), benchmarked across both.
// P1: 3 completions over a 7-day span, 300 SF each → 900 SF (3 locations), ~900 SF/wk or 3 loc/wk.
// P2: 3 completions over a 14-day span, 200 SF each → 600 SF (3 locations), ~300 SF/wk or 1.5 loc/wk.
const ds: BenchmarkDataset = {
  projects: [{ id: 'P1', name: 'Tower A' }, { id: 'P2', name: 'Tower B' }],
  sheets: [
    { id: 'sh1', project_id: 'P1' },
    { id: 'sh2', project_id: 'P2' },
  ],
  activities: [
    { id: 'a1', project_id: 'P1', subcontractor_id: 'sub-A', dictionary_id: 'd-floor', applies_to_unit_types: null },
    { id: 'a2', project_id: 'P2', subcontractor_id: 'sub-A', dictionary_id: 'd-floor', applies_to_unit_types: ['Apartment'] },
    { id: 'a3', project_id: 'P2', subcontractor_id: 'sub-B', dictionary_id: null, applies_to_unit_types: null },
  ],
  units: [
    { id: 'u1', sheet_id: 'sh1', unit_type: 'Apartment', computed_area: 300 },
    { id: 'u2', sheet_id: 'sh1', unit_type: 'Apartment', computed_area: 300 },
    { id: 'u3', sheet_id: 'sh1', unit_type: 'Apartment', computed_area: 300 },
    { id: 'u4', sheet_id: 'sh2', unit_type: 'Apartment', computed_area: 200 },
    { id: 'u5', sheet_id: 'sh2', unit_type: 'Apartment', computed_area: 200 },
    { id: 'u6', sheet_id: 'sh2', unit_type: 'Apartment', computed_area: 200 },
    { id: 'u7', sheet_id: 'sh2', unit_type: 'Corridor', computed_area: 999 }, // N/A for a2 (Apartment-only)
  ],
  history: [
    { unit_id: 'u1', activity_id: 'a1', logged_date: '2026-06-01', temporal_state: 'completed' },
    { unit_id: 'u2', activity_id: 'a1', logged_date: '2026-06-04', temporal_state: 'completed' },
    { unit_id: 'u3', activity_id: 'a1', logged_date: '2026-06-08', temporal_state: 'completed' },
    { unit_id: 'u4', activity_id: 'a2', logged_date: '2026-06-01', temporal_state: 'completed' },
    { unit_id: 'u5', activity_id: 'a2', logged_date: '2026-06-08', temporal_state: 'completed' },
    { unit_id: 'u6', activity_id: 'a2', logged_date: '2026-06-15', temporal_state: 'completed' },
    { unit_id: 'u7', activity_id: 'a2', logged_date: '2026-06-02', temporal_state: 'completed' }, // N/A — must be excluded
  ],
  overrides: [],
  costCodeByDict: { 'd-floor': 'cc-floor' },
};

describe('benchmarkKeys', () => {
  it('lists distinct subs across all the tenant projects', () => {
    expect(benchmarkKeys(ds, 'subId').sort()).toEqual(['sub-A', 'sub-B']);
  });
  it('lists distinct cost codes (resolved via the dictionary map)', () => {
    expect(benchmarkKeys(ds, 'costCodeId')).toEqual(['cc-floor']);
  });
});

describe('benchmarkRates (default = locations)', () => {
  it('compares one sub across projects in locations/week, fastest first', () => {
    const rows = benchmarkRates(ds, 'subId', 'sub-A');
    expect(rows.map(r => r.projectId)).toEqual(['P1', 'P2']);
    expect(rows[0].rate.measure).toBe('locations');
    expect(rows[0].rate.perWeek).toBeCloseTo(3, 6);   // 3 locations / 7-day span
    expect(rows[1].rate.perWeek).toBeCloseTo(1.5, 6);  // 3 locations / 14-day span
    expect(rows[0].projectName).toBe('Tower A');
  });

  it('averages only the published per-project location rates', () => {
    const rows = benchmarkRates(ds, 'subId', 'sub-A');
    expect(benchmarkAverageRate(rows)).toBeCloseTo(2.25, 6); // (3 + 1.5) / 2
  });

  it('returns nothing for a sub that did no work', () => {
    expect(benchmarkRates(ds, 'subId', 'sub-ghost')).toEqual([]);
  });

  it('benchmarks by cost code too', () => {
    const rows = benchmarkRates(ds, 'costCodeId', 'cc-floor');
    expect(rows.map(r => r.projectId).sort()).toEqual(['P1', 'P2']);
  });
});

describe('benchmarkRates (SF measure)', () => {
  it('compares one sub in SF/week', () => {
    const rows = benchmarkRates(ds, 'subId', 'sub-A', 'sf');
    expect(rows[0].rate.perWeek).toBeCloseTo(900, 6);
    expect(rows[1].rate.perWeek).toBeCloseTo(300, 6);
    expect(benchmarkAverageRate(rows)).toBeCloseTo(600, 6);
  });

  it('excludes N/A slots (Corridor completion on an Apartment-only activity)', () => {
    const rows = benchmarkRates(ds, 'subId', 'sub-A', 'sf');
    const p2 = rows.find(r => r.projectId === 'P2')!;
    expect(p2.rate.total).toBe(600); // 3 Apartments × 200; the 999-SF Corridor dropped
  });
});

describe('benchmark suppression', () => {
  it('keeps a thin-sample project in the list but with no published rate', () => {
    const thin: BenchmarkDataset = {
      ...ds,
      history: [{ unit_id: 'u1', activity_id: 'a1', logged_date: '2026-06-01', temporal_state: 'completed' }],
    };
    const rows = benchmarkRates(thin, 'subId', 'sub-A');
    const p1 = rows.find(r => r.projectId === 'P1')!;
    expect(p1.rate.suppressed).toBe('tiny-sample');
    expect(p1.rate.perWeek).toBeNull();
    expect(benchmarkAverageRate(rows.filter(r => r.projectId === 'P1'))).toBeNull();
  });
});
