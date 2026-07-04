import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithQuery';
import type { PercentPoint } from '@/types/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the workbench write mutations (Codebase Health Slice 0,
// Phase 0.2). Each SLIM `units` write must fire the right Supabase call with the
// right payload targeting the row by id:
//   • geometry save writes ONLY `polygon_coordinates` = the new points;
//   • label edit maps name → normalized `unit_number` (+ confirms review status);
//   • opening-edge edit writes ONLY the normalized `opening_edges`.
// These are online-first `units.update(...).eq('id', ...)` writes — NOT status_logs,
// NOT the offline queue (AGENTS.md §2). We assert the payload + target, not the
// implementation. `recordTraceEvent` (the best-effort corpus log) is stubbed so the
// test observes only the load-bearing unit write.
// ─────────────────────────────────────────────────────────────────────────────

// A chainable `units.update(payload).eq('id', unitId).select().single()` stub whose
// terminal `single()` resolves the updated row. Separate spies for update/eq let us
// assert both the payload and the id it targets.
const single = vi.fn();
const select = vi.fn(() => ({ single }));
const eq = vi.fn((_col: string, _val: unknown) => ({ select }));
const update = vi.fn((_payload: Record<string, unknown>) => ({ eq }));
const from = vi.fn((_table: string) => ({ update }));

vi.mock('@/supabaseClient', () => ({
  supabase: {
    from: (table: string) => from(table),
  },
}));

// Stub the best-effort immutable trace log so it never touches Supabase; keep the
// pure helpers real (they only read/derive, no I/O).
vi.mock('@/utils/traceCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/traceCapture')>();
  return { ...actual, recordTraceEvent: vi.fn().mockResolvedValue(undefined) };
});

import {
  useUpdateWorkbenchGeometry,
  useUpdateWorkbenchLabel,
  useUpdateWorkbenchOpeningEdges,
} from './useWorkbenchActions';

const SHEET = 'wb-sheet-1';

function wrapper({ children }: { children: ReactNode }) {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  single.mockReset();
  select.mockClear();
  eq.mockClear();
  update.mockClear();
  from.mockClear();
});

describe('useUpdateWorkbenchGeometry — node-move save', () => {
  it('writes only polygon_coordinates (the new points) for the targeted unit', async () => {
    const points: PercentPoint[] = [
      { pctX: 0.1, pctY: 0.1 },
      { pctX: 0.5, pctY: 0.1 },
      { pctX: 0.5, pctY: 0.5 },
    ];
    single.mockResolvedValue({
      data: { id: 'u1', polygon_coordinates: points, opening_edges: [] },
      error: null,
    });

    const { result } = renderHook(() => useUpdateWorkbenchGeometry(SHEET), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ unitId: 'u1', points });
    });

    expect(from).toHaveBeenCalledWith('units');
    // Carries the moved vertices — the whole point of the fix that made node drags persist.
    expect(update).toHaveBeenCalledWith({ polygon_coordinates: points });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
  });
});

describe('useUpdateWorkbenchLabel — rename / re-type', () => {
  it('maps name → normalized unit_number and confirms the review status', async () => {
    single.mockResolvedValue({
      data: { id: 'u1', unit_number: 'Kitchen', opening_edges: [] },
      error: null,
    });

    const { result } = renderHook(() => useUpdateWorkbenchLabel(SHEET), { wrapper });
    await act(async () => {
      // Extra whitespace proves the normalize (trim + collapse) runs at the boundary.
      await result.current.mutateAsync({ unitId: 'u1', name: '  Kitchen   ' });
    });

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.unit_number).toBe('Kitchen');
    // A human touching the row confirms it (the correction signal, AGENTS.md §4).
    expect(payload.review_status).toBe('confirmed');
    expect(eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('rejects a blank name before any write', async () => {
    const { result } = renderHook(() => useUpdateWorkbenchLabel(SHEET), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ unitId: 'u1', name: '   ' })).rejects.toThrow();
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('useUpdateWorkbenchOpeningEdges — edit-after tagging', () => {
  it('writes only the normalized opening_edges for the targeted unit', async () => {
    const edges = [{ edgeIndex: 0, type: 'door' as const }];
    single.mockResolvedValue({
      data: { id: 'u1', opening_edges: edges },
      error: null,
    });

    const { result } = renderHook(() => useUpdateWorkbenchOpeningEdges(SHEET), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ unitId: 'u1', openingEdges: edges, polygonLength: 4 });
    });

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0] as Record<string, unknown>;
    // Opening tags are the ONLY column touched — name/type/geometry stay put.
    expect(Object.keys(payload)).toEqual(['opening_edges']);
    expect(payload.opening_edges).toEqual(edges);
    expect(eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('drops an out-of-range tag against the polygon before writing', async () => {
    single.mockResolvedValue({ data: { id: 'u1', opening_edges: [] }, error: null });

    const { result } = renderHook(() => useUpdateWorkbenchOpeningEdges(SHEET), { wrapper });
    await act(async () => {
      // edgeIndex 9 does not exist on a 4-vertex polygon → normalized out.
      await result.current.mutateAsync({
        unitId: 'u1',
        openingEdges: [{ edgeIndex: 9, type: 'door' }],
        polygonLength: 4,
      });
    });

    const payload = update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.opening_edges).toEqual([]);
  });
});
