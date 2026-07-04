import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { BenchmarkDataset } from '@/utils/benchmark';

// Two projects sharing one sub ('co1'), so the benchmark spans ≥2 jobs.
const { DATASET, COMPANIES, COST_CODES } = vi.hoisted(() => ({
  DATASET: {
    projects: [{ id: 'P1', name: 'Tower A' }, { id: 'P2', name: 'Tower B' }],
    sheets: [{ id: 'sh1', project_id: 'P1' }, { id: 'sh2', project_id: 'P2' }],
    activities: [
      { id: 'a1', project_id: 'P1', subcontractor_id: 'co1', dictionary_id: 'd-floor', applies_to_unit_types: null },
      { id: 'a2', project_id: 'P2', subcontractor_id: 'co1', dictionary_id: 'd-floor', applies_to_unit_types: null },
    ],
    units: [
      { id: 'u1', sheet_id: 'sh1', unit_type: 'Apartment', computed_area: 100 },
      { id: 'u2', sheet_id: 'sh1', unit_type: 'Apartment', computed_area: 100 },
      { id: 'u3', sheet_id: 'sh1', unit_type: 'Apartment', computed_area: 100 },
      { id: 'u4', sheet_id: 'sh2', unit_type: 'Apartment', computed_area: 100 },
      { id: 'u5', sheet_id: 'sh2', unit_type: 'Apartment', computed_area: 100 },
      { id: 'u6', sheet_id: 'sh2', unit_type: 'Apartment', computed_area: 100 },
    ],
    history: [
      { unit_id: 'u1', activity_id: 'a1', logged_date: '2026-06-01', temporal_state: 'completed' },
      { unit_id: 'u2', activity_id: 'a1', logged_date: '2026-06-04', temporal_state: 'completed' },
      { unit_id: 'u3', activity_id: 'a1', logged_date: '2026-06-08', temporal_state: 'completed' }, // P1: 300 SF / 7d
      { unit_id: 'u4', activity_id: 'a2', logged_date: '2026-06-01', temporal_state: 'completed' },
      { unit_id: 'u5', activity_id: 'a2', logged_date: '2026-06-08', temporal_state: 'completed' },
      { unit_id: 'u6', activity_id: 'a2', logged_date: '2026-06-15', temporal_state: 'completed' }, // P2: 300 SF / 14d
    ],
    overrides: [],
    costCodeByDict: { 'd-floor': 'cc1' },
  } as BenchmarkDataset,
  COMPANIES: [{ id: 'co1', name: 'Ace Flooring', trade: 'Flooring', status: 'active', sort_order: 10, created_by: null, created_at: null, updated_at: null }],
  COST_CODES: [{ id: 'cc1', code: '09-6500', description: 'Resilient Flooring', division: '09', code_type: null, unit_of_measure: 'SF', status: 'active', sort_order: 10, created_by: null, created_at: null, updated_at: null }],
}));

const useBenchmarkDataset = vi.fn((_enabled: boolean) => ({ data: DATASET, isFetching: false }));
vi.mock('@/hooks/useBenchmarkAnalytics', () => ({ useBenchmarkDataset: (enabled: boolean) => useBenchmarkDataset(enabled) }));
vi.mock('@/hooks/useCompanies', () => ({ useCompanies: () => ({ data: COMPANIES }) }));
vi.mock('@/hooks/useCostCodes', () => ({ useCostCodes: () => ({ data: COST_CODES }) }));

afterEach(cleanup);

import SubcontractorBenchmark from './SubcontractorBenchmark';

describe('SubcontractorBenchmark', () => {
  it('is opt-in: shows the load button before the cross-project read', () => {
    render(<SubcontractorBenchmark />);
    expect(screen.getByRole('button', { name: /load cross-project benchmark/i })).toBeTruthy();
    // The heavy read is gated behind the panel being opened (enabled=false initially).
    expect(useBenchmarkDataset).toHaveBeenCalledWith(false);
  });

  it('compares a sub across the tenant projects after loading', () => {
    render(<SubcontractorBenchmark />);
    fireEvent.click(screen.getByRole('button', { name: /load cross-project benchmark/i }));
    // Both jobs the sub worked on appear, faster job first.
    expect(screen.getByText('Tower A')).toBeTruthy();
    expect(screen.getByText('Tower B')).toBeTruthy();
    // P1 completed 3 locations in a 7-day span → 3 loc/wk (the scale-free default).
    expect(screen.getAllByText(/3 loc\/wk/).length).toBeGreaterThan(0);
  });

  it('keeps the read private — data framed as the tenant’s own jobs only', () => {
    render(<SubcontractorBenchmark />);
    expect(screen.getByText(/never shared across companies/i)).toBeTruthy();
  });
});
