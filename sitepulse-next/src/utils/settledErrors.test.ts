import { describe, it, expect } from 'vitest';
import { settledSupabaseFailures } from './settledErrors';

type Result = { error: unknown };
const fulfilled = (error: unknown): PromiseSettledResult<Result> => ({ status: 'fulfilled', value: { error } });
const rejected = (reason: unknown): PromiseSettledResult<Result> => ({ status: 'rejected', reason });

// The bug this pins (audit A2): supabase builders resolve with { error } and
// never reject on an RLS denial — so a rejected-only filter reported
// "All assignments updated successfully!" over a batch of failed writes.
describe('settledSupabaseFailures', () => {
  it('counts a fulfilled result carrying an error as a failure (the RLS-denial shape)', () => {
    const results = [fulfilled(null), fulfilled({ message: 'permission denied' })];
    expect(settledSupabaseFailures(results)).toHaveLength(1);
  });

  it('still counts genuine rejections (network-level throws)', () => {
    const results = [rejected(new Error('fetch failed')), fulfilled(null)];
    expect(settledSupabaseFailures(results)).toHaveLength(1);
  });

  it('returns empty when every write fulfilled with a null error', () => {
    expect(settledSupabaseFailures([fulfilled(null), fulfilled(null)])).toHaveLength(0);
  });
});
