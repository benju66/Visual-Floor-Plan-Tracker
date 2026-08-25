import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithQuery';

// ─────────────────────────────────────────────────────────────────────────────
// useSheetDeleteImpact feeds the level-delete confirmation. The delete cascade is
// irreversible, so the contract that matters is EXACTNESS: it must count every row,
// including past PostgREST's 1000-row cap, and it must FAIL rather than report a low
// number — an undercount would talk someone into a destructive action ("only 3
// records? fine") when the true figure would have stopped them.
// ─────────────────────────────────────────────────────────────────────────────

interface MockState {
  unitCount: number | null;
  unitIds: string[];
  unitCountError: { message: string } | null;
  statusError: { message: string } | null;
}
const state: MockState = { unitCount: 0, unitIds: [], unitCountError: null, statusError: null };

/** Every `.in('unit_id', …)` chunk the status count issued, in order. */
let statusChunks: string[][] = [];
/** Every `[from, size]` page the unit-id read requested, in order. */
let unitPages: Array<[number, number]> = [];

vi.mock('@/supabaseClient', () => ({
  supabase: {
    from(table: string) {
      return {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          const isCount = !!opts?.head;

          // 1. exact unit count — .select('id', {count,head}).eq('sheet_id', …)
          if (table === 'units' && isCount) {
            return {
              eq: () => Promise.resolve({ count: state.unitCount, error: state.unitCountError }),
            };
          }

          // 2. unit ids via fetchAllIn — .select('id').in(...).order('id').range(f, t)
          if (table === 'units') {
            return {
              in: () => ({
                order: () => ({
                  range: (from: number, to: number) => {
                    const size = to - from + 1;
                    unitPages.push([from, size]);
                    return Promise.resolve({
                      data: state.unitIds.slice(from, from + size).map((id) => ({ id })),
                      error: null,
                    });
                  },
                }),
              }),
            };
          }

          // 3. chunked status count — .select('id', {count,head}).in('unit_id', chunk)
          if (table === 'status_logs' && isCount) {
            return {
              in: (_col: string, ids: string[]) => {
                statusChunks.push(ids);
                if (state.statusError) return Promise.resolve({ count: null, error: state.statusError });
                // 2 status records per unit — makes the summed total checkable.
                return Promise.resolve({ count: ids.length * 2, error: null });
              },
            };
          }

          throw new Error(`unexpected query: ${table}`);
        },
      };
    },
  },
}));

import { useSheetDeleteImpact } from './useProjectQueries';

function wrapper({ children }: { children: ReactNode }) {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.unitCount = 0;
  state.unitIds = [];
  state.unitCountError = null;
  state.statusError = null;
  statusChunks = [];
  unitPages = [];
});

describe('useSheetDeleteImpact', () => {
  it('does not query at all until a confirm is actually open', async () => {
    state.unitCount = 40;
    const { result } = renderHook(() => useSheetDeleteImpact('sheet-1', false), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(statusChunks).toEqual([]);
  });

  it('reports the exact location and status counts', async () => {
    state.unitCount = 3;
    state.unitIds = ['u1', 'u2', 'u3'];
    const { result } = renderHook(() => useSheetDeleteImpact('sheet-1', true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ units: 3, statuses: 6 });
  });

  it('short-circuits an empty level without touching status_logs', async () => {
    state.unitCount = 0;
    const { result } = renderHook(() => useSheetDeleteImpact('sheet-1', true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ units: 0, statuses: 0 });
    expect(statusChunks).toEqual([]);
  });

  it('counts past the 1000-row cap and chunks the id list — no silent undercount', async () => {
    // 1,250 locations: more than one page of ids AND more than one .in(...) chunk.
    state.unitCount = 1250;
    state.unitIds = Array.from({ length: 1250 }, (_, i) => `u${i}`);

    const { result } = renderHook(() => useSheetDeleteImpact('sheet-1', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Every id was read — a single unpaged select would have stopped at 1000 and the
    // confirmation would have understated the loss by a fifth.
    expect(unitPages.length).toBeGreaterThan(1);
    // Chunked at 200 so the .in(...) URL cannot 414 (matches fetchAllIn's bound).
    expect(statusChunks).toHaveLength(Math.ceil(1250 / 200));
    expect(Math.max(...statusChunks.map((c) => c.length))).toBeLessThanOrEqual(200);
    expect(statusChunks.flat()).toHaveLength(1250);
    // Summed across chunks, not just the last one.
    expect(result.current.data).toEqual({ units: 1250, statuses: 2500 });
  });

  it('FAILS rather than reporting a low number when the unit count errors', async () => {
    state.unitCountError = { message: 'network' };
    const { result } = renderHook(() => useSheetDeleteImpact('sheet-1', true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // No data means the confirmation shows its generic warning instead of "0".
    expect(result.current.data).toBeUndefined();
  });

  it('FAILS rather than reporting a low number when a status chunk errors', async () => {
    state.unitCount = 3;
    state.unitIds = ['u1', 'u2', 'u3'];
    state.statusError = { message: 'timeout' };

    const { result } = renderHook(() => useSheetDeleteImpact('sheet-1', true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
