/**
 * Failure detection for `Promise.allSettled` over supabase-js builders.
 *
 * PostgREST builders RESOLVE with `{ error }` — they only reject on a thrown
 * (network-level) failure — so checking `status === 'rejected'` alone misses
 * every RLS denial and constraint violation: the save reports success while
 * nothing was written. A result is a failure when it rejected OR fulfilled
 * carrying a non-null `error`.
 */
export function settledSupabaseFailures<T extends { error: unknown }>(
  results: Array<PromiseSettledResult<T>>,
): Array<PromiseSettledResult<T>> {
  return results.filter(
    r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value?.error != null),
  );
}
