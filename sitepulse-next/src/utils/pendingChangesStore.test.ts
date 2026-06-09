import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock idb-keyval so these tests assert key/value behavior without a real
// IndexedDB. The critical invariant (AGENTS.md §2): keys are project-scoped so
// pending changes never leak across projects, and an empty map deletes the key
// rather than persisting `{}`.
const get = vi.fn();
const set = vi.fn();
const del = vi.fn();
vi.mock('idb-keyval', () => ({
  get: (...args: unknown[]) => get(...args),
  set: (...args: unknown[]) => set(...args),
  del: (...args: unknown[]) => del(...args),
}));

import {
  persistPendingChanges,
  persistCurrentQueue,
  loadPendingChanges,
  clearPersistedPendingChanges,
} from './pendingChangesStore';
import type { PendingChange, PendingChangesMap } from '@/types/domain';

const fakeChange = { capturedAt: '2026-06-09T00:00:00.000Z' } as unknown as PendingChange;
const nonEmpty: PendingChangesMap = { 'unit-1': fakeChange };

beforeEach(() => {
  get.mockReset();
  set.mockReset();
  del.mockReset();
});

describe('persistPendingChanges', () => {
  it('writes under a project-scoped key', async () => {
    await persistPendingChanges('proj-abc', nonEmpty);
    expect(set).toHaveBeenCalledWith('sitepulse-pending-changes-proj-abc', nonEmpty);
  });

  it('scopes different projects to different keys', async () => {
    await persistPendingChanges('proj-1', nonEmpty);
    await persistPendingChanges('proj-2', nonEmpty);
    const keys = set.mock.calls.map((c) => c[0]);
    expect(keys).toEqual(['sitepulse-pending-changes-proj-1', 'sitepulse-pending-changes-proj-2']);
  });

  it('deletes the key instead of persisting an empty map', async () => {
    await persistPendingChanges('proj-abc', {});
    expect(set).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('sitepulse-pending-changes-proj-abc');
  });

  it('degrades silently when IndexedDB throws', async () => {
    set.mockRejectedValueOnce(new Error('QuotaExceeded'));
    await expect(persistPendingChanges('proj-abc', nonEmpty)).resolves.toBeUndefined();
  });
});

describe('persistCurrentQueue — per-item sync checkpoint', () => {
  it('checkpoints both the pending and timeline maps', async () => {
    await persistCurrentQueue('proj-x', nonEmpty, nonEmpty);
    expect(set).toHaveBeenCalledWith('sitepulse-pending-changes-proj-x', nonEmpty);
    expect(set).toHaveBeenCalledWith('sitepulse-pending-timeline-changes-proj-x', nonEmpty);
  });

  it('deletes whichever map is empty', async () => {
    await persistCurrentQueue('proj-x', {}, nonEmpty);
    expect(del).toHaveBeenCalledWith('sitepulse-pending-changes-proj-x');
    expect(set).toHaveBeenCalledWith('sitepulse-pending-timeline-changes-proj-x', nonEmpty);
  });
});

describe('loadPendingChanges', () => {
  it('returns the stored map', async () => {
    get.mockResolvedValueOnce(nonEmpty);
    await expect(loadPendingChanges('proj-abc')).resolves.toEqual(nonEmpty);
  });

  it('returns an empty map when nothing is stored', async () => {
    get.mockResolvedValueOnce(undefined);
    await expect(loadPendingChanges('proj-abc')).resolves.toEqual({});
  });

  it('returns an empty map when IndexedDB is unavailable', async () => {
    get.mockRejectedValueOnce(new Error('no idb'));
    await expect(loadPendingChanges('proj-abc')).resolves.toEqual({});
  });
});

describe('clearPersistedPendingChanges', () => {
  it('deletes both the pending and timeline keys', async () => {
    await clearPersistedPendingChanges('proj-abc');
    expect(del).toHaveBeenCalledWith('sitepulse-pending-changes-proj-abc');
    expect(del).toHaveBeenCalledWith('sitepulse-pending-timeline-changes-proj-abc');
  });
});
