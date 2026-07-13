import { describe, it, expect } from 'vitest';
import {
  deriveSyncState,
  syncStateLabel,
  syncStateTone,
  pendingItemState,
  pendingItemTone,
  pendingItemLabel,
  type SyncState,
  type PendingItemState,
} from './syncStatus';

const input = (over: Partial<Parameters<typeof deriveSyncState>[0]> = {}) => ({
  hasRehydrated: true,
  isApplying: false,
  pendingCount: 0,
  failedCount: 0,
  ...over,
});

describe('deriveSyncState — each branch', () => {
  it('loading before rehydrate (even if other counts look set)', () => {
    expect(deriveSyncState(input({ hasRehydrated: false, isApplying: true, pendingCount: 3, failedCount: 2 }))).toBe('loading');
  });

  it('syncing while applying', () => {
    expect(deriveSyncState(input({ isApplying: true, pendingCount: 3 }))).toBe('syncing');
  });

  it('error when a change failed to save', () => {
    expect(deriveSyncState(input({ pendingCount: 3, failedCount: 1 }))).toBe('error');
  });

  it('pending when changes are queued but none failed', () => {
    expect(deriveSyncState(input({ pendingCount: 3 }))).toBe('pending');
  });

  it('synced when the queue is empty', () => {
    expect(deriveSyncState(input())).toBe('synced');
  });
});

describe('deriveSyncState — precedence', () => {
  it('loading beats everything (not-rehydrated wins over applying/error/pending)', () => {
    expect(deriveSyncState(input({ hasRehydrated: false, isApplying: true, failedCount: 5 }))).toBe('loading');
  });

  it('syncing masks a prior error until the apply settles', () => {
    expect(deriveSyncState(input({ isApplying: true, failedCount: 2, pendingCount: 2 }))).toBe('syncing');
  });

  it('error beats pending', () => {
    expect(deriveSyncState(input({ pendingCount: 4, failedCount: 1 }))).toBe('error');
  });

  it('pending beats synced', () => {
    expect(deriveSyncState(input({ pendingCount: 1 }))).toBe('pending');
  });
});

describe('syncStateLabel', () => {
  it('loading', () => {
    expect(syncStateLabel('loading', { pendingCount: 0, failedCount: 0 })).toBe('Loading saved changes…');
  });
  it('syncing', () => {
    expect(syncStateLabel('syncing', { pendingCount: 3, failedCount: 0 })).toBe('Syncing…');
  });
  it('error names the failed count', () => {
    expect(syncStateLabel('error', { pendingCount: 3, failedCount: 2 })).toBe('2 failed to save');
  });
  it('pending names the pending count', () => {
    expect(syncStateLabel('pending', { pendingCount: 3, failedCount: 0 })).toBe('3 unsaved');
  });
  it('synced', () => {
    expect(syncStateLabel('synced', { pendingCount: 0, failedCount: 0 })).toBe('All changes synced');
  });
});

describe('syncStateTone', () => {
  const cases: Array<[SyncState, ReturnType<typeof syncStateTone>]> = [
    ['loading', 'amber'],
    ['syncing', 'amber'],
    ['pending', 'amber'],
    ['error', 'red'],
    ['synced', 'emerald'],
  ];
  it.each(cases)('%s → %s', (state, tone) => {
    expect(syncStateTone(state)).toBe(tone);
  });
});

describe('pendingItemState — the one predicate both drill-in surfaces use', () => {
  it('failed beats offline — a recorded failure is `failed` even while offline', () => {
    expect(pendingItemState({ isFailed: true, isOnline: false })).toBe('failed');
    expect(pendingItemState({ isFailed: true, isOnline: true })).toBe('failed');
  });
  it('waiting when offline and not failed (can only sync once reconnected)', () => {
    expect(pendingItemState({ isFailed: false, isOnline: false })).toBe('waiting');
  });
  it('queued when online and not failed (staged, just not applied yet)', () => {
    expect(pendingItemState({ isFailed: false, isOnline: true })).toBe('queued');
  });
});

describe('pendingItemTone / pendingItemLabel', () => {
  const cases: Array<[PendingItemState, ReturnType<typeof pendingItemTone>, string]> = [
    ['failed', 'red', 'Failed'],
    ['waiting', 'amber', 'Waiting'],
    ['queued', 'neutral', ''],
  ];
  it.each(cases)('%s → tone %s / label "%s"', (state, tone, label) => {
    expect(pendingItemTone(state)).toBe(tone);
    expect(pendingItemLabel(state)).toBe(label);
  });
});
