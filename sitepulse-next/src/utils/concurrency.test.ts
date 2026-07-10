import { describe, it, expect, vi } from 'vitest';
import { runWithConcurrency } from './concurrency';

// A deterministic async worker gate: resolve after `ms` on the real timer queue.
// Equal delays resolve FIFO (scheduling order), so tests stay deterministic without
// the runner ever touching Date.now()/Math.random().
const tick = (ms = 1) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('runWithConcurrency', () => {
  it('returns one result per item, index-mapped, all ok on success', async () => {
    const items = ['a', 'b', 'c', 'd'];
    const processed: string[] = [];
    const results = await runWithConcurrency(items, 2, async (item) => {
      await tick();
      processed.push(item);
    });

    expect(results).toHaveLength(4);
    results.forEach((r, i) => {
      expect(r.index).toBe(i);
      expect(r.ok).toBe(true);
      expect(r.error).toBeUndefined();
    });
    // Every item was handled exactly once.
    expect([...processed].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('maps results to original indices even when items finish out of order', async () => {
    const delays = [30, 10, 20]; // index 1 (10ms) finishes first, index 0 (30ms) last
    const finishOrder: number[] = [];
    const results = await runWithConcurrency(delays, 3, async (delay, index) => {
      await tick(delay);
      finishOrder.push(index);
    });

    // Completion order is driven by the delays, not the index...
    expect(finishOrder).toEqual([1, 2, 0]);
    // ...but the returned results stay aligned to the input order.
    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('starts the first `limit` items in input order', async () => {
    const started: number[] = [];
    await runWithConcurrency([0, 1, 2, 3, 4], 5, async (item) => {
      started.push(item); // recorded synchronously on entry, before the first await
      await tick();
    });
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await runWithConcurrency(items, 3, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick();
      active--;
    });
    expect(maxActive).toBe(3);
  });

  it('one worker failure does not abort the rest', async () => {
    const items = [0, 1, 2, 3, 4];
    const processed: number[] = [];
    const results = await runWithConcurrency(items, 2, async (item) => {
      await tick();
      if (item === 2) throw new Error(`boom ${item}`);
      processed.push(item);
    });

    // Every item except the failing one still ran to completion.
    expect([...processed].sort((a, b) => a - b)).toEqual([0, 1, 3, 4]);
    expect(results[2].ok).toBe(false);
    expect(results[2].error).toBeInstanceOf(Error);
    expect(results.filter((r) => r.ok).length).toBe(4);
    expect(results.filter((r) => !r.ok).length).toBe(1);
  });

  it('returns an empty result set for empty input and never calls the worker', async () => {
    const worker = vi.fn(async () => {});
    const results = await runWithConcurrency([], 5, worker);
    expect(results).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('with limit >= length, runs every item (max concurrency = length)', async () => {
    let active = 0;
    let maxActive = 0;
    const items = [0, 1, 2, 3];
    const results = await runWithConcurrency(items, 99, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick();
      active--;
    });
    expect(maxActive).toBe(4);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('clamps a non-positive limit to serial (one at a time)', async () => {
    let active = 0;
    let maxActive = 0;
    await runWithConcurrency([0, 1, 2], 0, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await tick();
      active--;
    });
    expect(maxActive).toBe(1);
  });
});
