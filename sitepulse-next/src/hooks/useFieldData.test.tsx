import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithQuery';
import type { PendingChange, Unit } from '@/types/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for useFieldData (Codebase Health Slice 0, Phase 0.2). The field
// staging buffer is the front of the offline sync engine, so two invariants matter
// (AGENTS.md §2):
//   • handleLocalUpdate STAGES into local `pendingChanges` state (with a capture-time
//     `capturedAt`) — it does NOT write to the database itself;
//   • handleApplyAll FEEDS each staged change to `onApplyPendingChanges` in order (one
//     call per change) — the single seam to the IDB mutation queue — and never writes
//     status directly.
// The data layer is stubbed so the buffer's behavior is observed in isolation.
// ─────────────────────────────────────────────────────────────────────────────

// The project id comes from the route.
vi.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'proj-1' }),
}));

// IDB persistence of the buffer is real code (pendingChangesStore) over a mocked
// idb-keyval — so the staging buffer survives refresh without a real IndexedDB.
const idbGet = vi.fn();
const idbSet = vi.fn();
const idbDel = vi.fn();
vi.mock('idb-keyval', () => ({
  get: (...a: unknown[]) => idbGet(...a),
  set: (...a: unknown[]) => idbSet(...a),
  del: (...a: unknown[]) => idbDel(...a),
}));

// Universal chainable stub for the read hooks the container mounts (project /
// activities / units). Every method returns the chain; awaiting it yields an empty
// result. `from` is a spy so we can prove NO status_logs write ever happens here.
function makeChain() {
  const result = { data: [] as unknown[], error: null };
  const chain: Record<string, unknown> = {};
  for (const m of [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'order', 'range', 'limit', 'single', 'maybeSingle',
  ]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
const from = vi.fn((_table: string) => makeChain());
vi.mock('@/supabaseClient', () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'tok' } } }) },
    from: (table: string) => from(table),
  },
}));

import { useFieldData } from './useFieldData';

function wrapper({ children }: { children: ReactNode }) {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const unit = (id: string) => ({ id, unit_number: id }) as unknown as Unit;
const activityObj = (id: string, name: string) => ({ id, name, color: '#123456', track: 'Production' });

beforeEach(() => {
  from.mockClear();
  idbGet.mockReset().mockResolvedValue(undefined); // nothing persisted → empty buffer
  idbSet.mockReset().mockResolvedValue(undefined);
  idbDel.mockReset().mockResolvedValue(undefined);
});

async function mountFieldData(onApplyPendingChanges: (changes: PendingChange[]) => Promise<void>) {
  const view = renderHook(
    () => useFieldData({ activeStatuses: [], onApplyPendingChanges, unitsOverride: [] }),
    { wrapper },
  );
  // Let the IDB rehydrate settle so the persist effects are armed.
  await waitFor(() => expect(view.result.current.hasRehydrated).toBe(true));
  return view;
}

describe('handleLocalUpdate — stages locally, does not write', () => {
  it('records a pending change in local state with a capture-time timestamp', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const { result } = await mountFieldData(onApply);

    act(() => {
      result.current.handleLocalUpdate(unit('u1'), null, 'completed', {
        activityObj: activityObj('act-1', 'Drywall'),
      });
    });

    const staged = result.current.pendingChanges['u1'];
    expect(staged).toBeDefined();
    expect(staged.state).toBe('completed');
    expect(staged.unit.id).toBe('u1');
    // capturedAt is stamped at staging time — the offline-capture moment (AGENTS.md §2).
    expect(typeof staged.capturedAt).toBe('string');
    expect(staged.capturedAt.length).toBeGreaterThan(0);
    expect(result.current.pendingCount).toBe(1);
    // Staging is local — nothing is applied to the sync engine yet.
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('handleApplyAll — feeds onApplyPendingChanges in order', () => {
  it('calls the apply seam once per staged change, in staging order, and never writes status directly', async () => {
    const applyOrder: string[] = [];
    const onApply = vi.fn(async (changes: PendingChange[]) => {
      applyOrder.push(changes[0].unit.id);
    });
    const { result } = await mountFieldData(onApply);

    act(() => {
      result.current.handleLocalUpdate(unit('u1'), null, 'completed', {
        activityObj: activityObj('act-1', 'Drywall'),
      });
      result.current.handleLocalUpdate(unit('u2'), null, 'ongoing', {
        activityObj: activityObj('act-2', 'Paint'),
      });
    });
    expect(result.current.pendingCount).toBe(2);

    let outcome: { succeeded: number; failed: number } | undefined;
    await act(async () => {
      outcome = await result.current.handleApplyAll();
    });

    // One call per change — never a single batched write of both.
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onApply.mock.calls[0][0]).toHaveLength(1);
    expect(onApply.mock.calls[1][0]).toHaveLength(1);
    // Applied in the order they were staged.
    expect(applyOrder).toEqual(['u1', 'u2']);
    expect(outcome).toEqual({ succeeded: 2, failed: 0 });
    // The buffer drains after a clean apply.
    expect(result.current.pendingCount).toBe(0);
    // The apply seam is the ONLY write path — useFieldData never touches status_logs.
    expect(from).not.toHaveBeenCalledWith('status_logs');
  });

  it('reports failures without draining the failed item (the sync engine keeps unsynced work)', async () => {
    const onApply = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = await mountFieldData(onApply);

    act(() => {
      result.current.handleLocalUpdate(unit('u1'), null, 'completed', {
        activityObj: activityObj('act-1', 'Drywall'),
      });
    });

    let outcome: { succeeded: number; failed: number } | undefined;
    await act(async () => {
      outcome = await result.current.handleApplyAll();
    });

    expect(outcome).toEqual({ succeeded: 0, failed: 1 });
    // The unsynced change is still staged for a later retry.
    expect(result.current.pendingChanges['u1']).toBeDefined();
  });
});

describe('handleRetryItem — single-item retry (Save Visibility Phase 2)', () => {
  it('re-sends ONE change: success drops just that item + clears its failed flag, others untouched', async () => {
    // u1 fails its Apply, u2 succeeds → u1 stays queued + flagged; u2 drains.
    let failU1 = true;
    const onApply = vi.fn(async (changes: PendingChange[]) => {
      if (failU1 && changes[0].unit.id === 'u1') throw new Error('offline');
    });
    const { result } = await mountFieldData(onApply);

    act(() => {
      result.current.handleLocalUpdate(unit('u1'), null, 'completed', { activityObj: activityObj('a1', 'A1') });
      result.current.handleLocalUpdate(unit('u2'), null, 'ongoing', { activityObj: activityObj('a2', 'A2') });
    });

    await act(async () => { await result.current.handleApplyAll(); });

    // After Apply: u1 failed (still queued + flagged), u2 succeeded (drained).
    expect(result.current.pendingChanges['u1']).toBeDefined();
    expect(result.current.pendingChanges['u2']).toBeUndefined();
    expect(result.current.failedCount).toBe(1);
    expect(result.current.failedKeys.has('u1_A1')).toBe(true);

    // Retry u1 with the write now succeeding.
    failU1 = false;
    const u1Change = result.current.pendingChanges['u1'];
    onApply.mockClear();
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.handleRetryItem(u1Change); });

    // The retry re-used the same seam with a ONE-item array…
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toHaveLength(1);
    expect(onApply.mock.calls[0][0][0].unit.id).toBe('u1');
    // …and on success the item leaves the queue, its flag clears, the queue empties.
    expect(ok).toBe(true);
    expect(result.current.pendingChanges['u1']).toBeUndefined();
    expect(result.current.failedCount).toBe(0);
    expect(result.current.pendingCount).toBe(0);
  });

  it('a still-failing retry keeps the item queued AND flagged (returns false)', async () => {
    const onApply = vi.fn().mockRejectedValue(new Error('offline'));
    const { result } = await mountFieldData(onApply);

    act(() => {
      result.current.handleLocalUpdate(unit('u1'), null, 'completed', { activityObj: activityObj('a1', 'A1') });
    });
    await act(async () => { await result.current.handleApplyAll(); });
    expect(result.current.failedCount).toBe(1);

    const u1Change = result.current.pendingChanges['u1'];
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.handleRetryItem(u1Change); });

    expect(ok).toBe(false);
    // The unsynced change survives for another retry, and stays flagged red.
    expect(result.current.pendingChanges['u1']).toBeDefined();
    expect(result.current.failedCount).toBe(1);
    expect(result.current.failedKeys.has('u1_A1')).toBe(true);
  });

  it('retrying one activity does NOT drop a different queued activity on the same unit', async () => {
    // u1 has a PRIMARY edit on activity A and a TIMELINE edit on activity B — different slots.
    const onApply = vi.fn().mockResolvedValue(undefined);
    const { result } = await mountFieldData(onApply);

    act(() => {
      result.current.handleLocalUpdate(unit('u1'), null, 'completed', { activityObj: activityObj('a', 'A') });
      result.current.handleTimelineUpdate(unit('u1'), null, 'ongoing', { activityObj: activityObj('b', 'B') });
    });
    expect(result.current.pendingCount).toBe(2);

    // Retry ONLY the timeline B slot.
    const bChange = result.current.pendingTimelineChanges['u1_B'];
    await act(async () => { await result.current.handleRetryItem(bChange); });

    // B is gone; the unrelated primary A on the same unit is preserved (precise removal).
    expect(result.current.pendingTimelineChanges['u1_B']).toBeUndefined();
    expect(result.current.pendingChanges['u1']).toBeDefined();
    expect(result.current.pendingCount).toBe(1);
  });
});

describe('handleApplyAll — per-item checkpoint stays crash-safe under concurrency', () => {
  // List View Performance Phase 1: Apply now overlaps several saves at once (bounded
  // concurrency). The load-bearing invariant is that the per-item IDB checkpoint
  // (persistCurrentQueue) still drains ONE item at a time and never "resurrects" an
  // already-synced item — so a crash mid-sync leaves only unsynced work (AGENTS.md §2).
  it('drains the IDB checkpoint monotonically when several changes apply at once', async () => {
    const PENDING_KEY = 'sitepulse-pending-changes-proj-1';

    // Resolve each apply after a per-unit delay so completions arrive OUT of staging order,
    // stressing the serialized checkpoint against scrambled overlap.
    const delayByUnit: Record<string, number> = { u1: 8, u2: 2, u3: 6, u4: 1 };
    const onApply = vi.fn(async (changes: PendingChange[]) => {
      await new Promise((r) => setTimeout(r, delayByUnit[changes[0].unit.id] ?? 1));
    });
    const { result } = await mountFieldData(onApply);

    act(() => {
      result.current.handleLocalUpdate(unit('u1'), null, 'completed', { activityObj: activityObj('a1', 'A1') });
      result.current.handleLocalUpdate(unit('u2'), null, 'completed', { activityObj: activityObj('a2', 'A2') });
      result.current.handleLocalUpdate(unit('u3'), null, 'completed', { activityObj: activityObj('a3', 'A3') });
      result.current.handleLocalUpdate(unit('u4'), null, 'completed', { activityObj: activityObj('a4', 'A4') });
    });
    expect(result.current.pendingCount).toBe(4);

    // Capture the KEY SET persisted at each checkpoint (snapshotted at call time — the live
    // map is mutated in place, so a stored reference would read empty after the fact).
    const checkpointKeySets: string[][] = [];
    idbSet.mockImplementation((k: unknown, v: unknown) => {
      if (k === PENDING_KEY) checkpointKeySets.push(Object.keys(v as Record<string, unknown>));
      return Promise.resolve();
    });

    await act(async () => {
      await result.current.handleApplyAll();
    });

    // Effects are quiesced during the run (isSyncingRef), so these are exactly the per-item
    // checkpoints: each successful save removes one unit → 3, 2, 1 remaining (0 → del, not set).
    expect(checkpointKeySets.map((s) => s.length)).toEqual([3, 2, 1]);

    // Anti-resurrection: once a unit leaves a checkpoint it never reappears in a later one.
    for (let i = 1; i < checkpointKeySets.length; i++) {
      const previous = new Set(checkpointKeySets[i - 1]);
      for (const key of checkpointKeySets[i]) {
        expect(previous.has(key)).toBe(true); // later checkpoint ⊆ earlier checkpoint
      }
    }

    // The buffer fully drains after a clean concurrent apply.
    expect(result.current.pendingCount).toBe(0);
  });
});
