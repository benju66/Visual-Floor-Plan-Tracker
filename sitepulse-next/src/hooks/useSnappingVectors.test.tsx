import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the Supabase client and the backend vector service so the three-layer
// cache (sheet_vectors table → /extract-vectors fallback → write-through upsert)
// can be asserted without a network or DB. See AGENTS.md §5.
const getSession = vi.fn();
const maybeSingle = vi.fn();
const upsert = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select, upsert }));

vi.mock('@/supabaseClient', () => ({
  supabase: {
    auth: { getSession: () => getSession() },
    from: () => from(),
  },
}));

const extractVectorsService = vi.fn();
vi.mock('@/services/api', () => ({
  extractVectorsService: (sheetId: string, token: string) => extractVectorsService(sheetId, token),
}));

import { useSnappingVectors } from './useSnappingVectors';

const SHEET = 'sheet-123';
const LINE = { start: { pctX: 0.2, pctY: 0.8 }, end: { pctX: 0.6, pctY: 0.4 } };

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  maybeSingle.mockReset();
  upsert.mockReset().mockResolvedValue({ error: null });
  extractVectorsService.mockReset();
  from.mockClear();
  select.mockClear();
  eq.mockClear();
});

describe('useSnappingVectors', () => {
  it('returns formatted vectors with bbox on a sheet_vectors cache hit (no backend call)', async () => {
    maybeSingle.mockResolvedValue({ data: { vectors: [LINE] } });

    const { result } = renderHook(() => useSnappingVectors(SHEET), { wrapper });

    await waitFor(() => expect(result.current.hasVectors).toBe(true));
    expect(result.current.vectors).toEqual([
      { minX: 0.2, minY: 0.4, maxX: 0.6, maxY: 0.8, lineData: LINE },
    ]);
    expect(extractVectorsService).not.toHaveBeenCalled();
  });

  it('falls back to the backend on a cache miss and write-throughs to sheet_vectors', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    extractVectorsService.mockResolvedValue({ vectors: [LINE] });

    const { result } = renderHook(() => useSnappingVectors(SHEET), { wrapper });

    await waitFor(() => expect(result.current.hasVectors).toBe(true));
    expect(extractVectorsService).toHaveBeenCalledWith(SHEET, 'tok');
    // Fire-and-forget write-through upsert with the slot-unique conflict target.
    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert).toHaveBeenCalledWith(
      { sheet_id: SHEET, vectors: [LINE] },
      { onConflict: 'sheet_id' },
    );
  });

  it('disables snapping (null vectors) when there is no active session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });

    const { result } = renderHook(() => useSnappingVectors(SHEET), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.vectors).toBeNull();
    expect(result.current.hasVectors).toBe(false);
    expect(extractVectorsService).not.toHaveBeenCalled();
  });
});
