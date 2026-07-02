/**
 * Accumulate every row from a paged data source.
 *
 * Supabase's PostgREST API returns at most a fixed number of rows per request
 * (1000 by default). A single unbounded `.select().in(...)` therefore silently
 * truncates once a table grows past that cap — in the all-levels views this made
 * completed activities on the dropped rows read back as "not started".
 *
 * `fetchPage(from, size)` must return the slice `[from, from + size)` under a
 * STABLE order (the caller adds `.order('id')`). It stops once a page comes back
 * shorter than `pageSize` (a partial/empty page means no more rows). This assumes
 * `pageSize <=` the server's per-request cap — pass `pageSize = 1000` to match
 * PostgREST's default so a full page never hides further rows.
 */
export async function paginateAll<T>(
  fetchPage: (from: number, size: number) => Promise<T[]>,
  pageSize = 1000
): Promise<T[]> {
  if (pageSize <= 0) throw new Error('paginateAll: pageSize must be > 0');
  const out: T[] = [];
  let from = 0;
  // Upper bound on iterations guards against a fetcher that always returns a full
  // page (e.g. one that ignores `from`). 10k pages ≫ any real dataset here.
  for (let safety = 0; safety < 10_000; safety++) {
    const rows = await fetchPage(from, pageSize);
    out.push(...rows);
    if (rows.length < pageSize) break; // short (or empty) page → no more rows
    from += rows.length;
  }
  return out;
}
