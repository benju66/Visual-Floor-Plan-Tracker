import { describe, it, expect, vi } from 'vitest';
import { paginateAll } from './pagination';

/**
 * A fake paged source: returns rows [from, from + min(size, cap)) bounded by `total`,
 * modelling a server (PostgREST) that never returns more than `cap` rows per request.
 */
function pagedSource(total: number, cap: number) {
  return async (from: number, size: number): Promise<number[]> => {
    const take = Math.min(size, cap, Math.max(0, total - from));
    return Array.from({ length: take }, (_, i) => from + i);
  };
}

describe('paginateAll', () => {
  it('returns all rows when the total is a non-multiple of the page size', async () => {
    const rows = await paginateAll(pagedSource(1500, 1000), 1000);
    expect(rows).toHaveLength(1500);
    expect(rows[0]).toBe(0);
    expect(rows[1499]).toBe(1499);
  });

  it('returns all rows when the total is an exact multiple of the page size', async () => {
    const rows = await paginateAll(pagedSource(2000, 1000), 1000);
    expect(rows).toHaveLength(2000);
    expect(new Set(rows).size).toBe(2000); // no gaps, no duplicates
  });

  it('fetches a sub-page total in a single request (the common per-sheet case)', async () => {
    const fetchPage = vi.fn(pagedSource(646, 1000));
    const rows = await paginateAll(fetchPage, 1000);
    expect(rows).toHaveLength(646);
    expect(fetchPage).toHaveBeenCalledTimes(1); // short page on the first request → stop
  });

  it('stops on the first short page rather than an extra empty round-trip', async () => {
    const fetchPage = vi.fn(pagedSource(1500, 1000));
    await paginateAll(fetchPage, 1000);
    // page0 → 1000 rows (full → keep going), page1 → 500 rows (short → stop). No 3rd request.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('returns an empty array for an empty source', async () => {
    const fetchPage = vi.fn(pagedSource(0, 1000));
    expect(await paginateAll(fetchPage, 1000)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-positive page size', async () => {
    await expect(paginateAll(pagedSource(10, 10), 0)).rejects.toThrow();
  });
});
