/**
 * Bounded-concurrency runner (List View Performance — Phase 1, "Faster Apply").
 *
 * Runs `worker` over `items` with at most `limit` in flight at once, preserving a
 * per-item result mapping. It is the correctness core of the List's parallel Apply:
 * `handleApplyAll` overlaps several `commitUnitActivity` calls instead of one-at-a-time,
 * while a per-item IDB checkpoint (owned by the caller) still fires as each resolves.
 *
 * Deliberately pure and deterministic given a deterministic worker — NO `Date.now()`,
 * NO `Math.random()`, no I/O. One worker rejecting is recorded as a failure and never
 * aborts the rest (mirrors the offline queue's "keep unsynced work" guarantee), so the
 * returned promise never rejects.
 */

/** Per-item outcome, indexed back to the original position in `items`. */
export interface ConcurrencyResult {
  /** Index of this item in the input `items` array. */
  index: number;
  /** True if the worker resolved; false if it threw/rejected. */
  ok: boolean;
  /** The thrown value when `ok` is false; omitted otherwise. */
  error?: unknown;
}

/**
 * Run `worker(item, index)` across `items` with at most `limit` concurrent calls.
 *
 * @returns One {@link ConcurrencyResult} per input item, in input order. Resolves once
 *          every item has settled; a worker failure is captured (never re-thrown), so the
 *          returned promise itself always resolves.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<ConcurrencyResult[]> {
  const results: ConcurrencyResult[] = new Array(items.length);
  if (items.length === 0) return results;

  // Clamp: at least 1 worker, never more than there is work to do.
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));

  // Shared cursor. `nextIndex++` is atomic under the single-threaded event loop, so each
  // index is claimed by exactly one runner — the first `effectiveLimit` items also START
  // in input order, which keeps Apply's staging order stable for small batches.
  let nextIndex = 0;

  const runNext = async (): Promise<void> => {
    for (;;) {
      const current = nextIndex++;
      if (current >= items.length) return;
      try {
        await worker(items[current], current);
        results[current] = { index: current, ok: true };
      } catch (error) {
        results[current] = { index: current, ok: false, error };
      }
    }
  };

  await Promise.all(Array.from({ length: effectiveLimit }, () => runNext()));
  return results;
}
