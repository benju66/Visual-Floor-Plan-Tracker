/**
 * pdfByteCache — module-level LRU cache of downloaded original PDF bytes,
 * keyed by sheetId. Makes switching between levels instant within a session.
 *
 * Buffers stored here must never be transferred to a worker directly
 * (postMessage transfer detaches the ArrayBuffer) — callers send a copy
 * (`buffer.slice(0)`) and keep the cached original intact.
 *
 * Invalidation: `invalidatePdfBytes` is called when a sheet's original PDF is
 * re-attached or the level is wiped. Cache clears on page reload by design.
 */

const MAX_ENTRIES = 6;

const cache = new Map<string, ArrayBuffer>();

/** Get cached bytes for a sheet (bumps LRU recency). */
export function getPdfBytes(sheetId: string): ArrayBuffer | null {
  const buffer = cache.get(sheetId);
  if (!buffer) return null;
  cache.delete(sheetId);
  cache.set(sheetId, buffer);
  return buffer;
}

/** Store bytes for a sheet, evicting the least-recently-used entry past the cap. */
export function putPdfBytes(sheetId: string, buffer: ArrayBuffer): void {
  cache.delete(sheetId);
  cache.set(sheetId, buffer);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Drop a sheet's cached bytes (call after re-attaching or wiping its PDF). */
export function invalidatePdfBytes(sheetId: string): void {
  cache.delete(sheetId);
}

/** Test helper — empty the cache. */
export function clearPdfByteCache(): void {
  cache.clear();
}
