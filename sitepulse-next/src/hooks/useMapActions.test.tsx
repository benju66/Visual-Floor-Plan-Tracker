import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithQuery';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { queryKeys } from '@/types/queryKeys';
import type { Activity, PercentPoint, Project, Unit } from '@/types/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for useMapActions (Codebase Health Slice 0, Phase 0.2). Two
// load-bearing behaviors:
//   • handlePolygonComplete SETS pendingPolygonPoints — the value the 2026-06-29
//     bug dropped, which left a freshly-traced room unsaveable;
//   • commitUnitActivity THREADS a capture-time client_timestamp through to the
//     status write (AGENTS.md §2 — capture-time, not sync-time), keyed by activity_id.
// The peripheral naming hooks (subtypes / sheet text / learned vocabulary) are
// mocked to empty so the ONLY data-layer interaction is the status RPC we assert.
// ─────────────────────────────────────────────────────────────────────────────

const rpcSingle = vi.fn();
const rpc = vi.fn(() => ({ single: rpcSingle }));
const getSession = vi.fn();

vi.mock('@/supabaseClient', () => ({
  supabase: {
    auth: { getSession: () => getSession() },
    rpc: (...args: unknown[]) => rpc(...(args as [])),
    // No query hook fires here (they're mocked below), but keep a benign stub.
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}));

vi.mock('@/hooks/useSubtypes', () => ({
  useSubtypes: () => ({ data: [] }),
  useProposePendingSubtype: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/useSheetText', () => ({
  useSheetText: () => ({ words: [] }),
}));
vi.mock('@/hooks/useNamingVocabulary', () => ({
  useNamingVocabulary: () => ({ vocabulary: { nameTokenCounts: {}, nameToSubtype: {} } }),
}));

import { useMapActions } from './useMapActions';

const project = { id: 'proj-1' } as unknown as Project;

function wrapper({ children }: { children: ReactNode }) {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpc.mockClear();
  rpcSingle.mockReset().mockResolvedValue({ data: { id: 'log-new' }, error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'user-1' } } } });
  // Reset the shared Zustand singletons so state never bleeds between tests.
  useMapStore.setState({
    pendingPolygonPoints: null,
    editingUnitId: null,
    savingUnitId: null,
    mapLabelSuggestion: null,
    activeSheetId: '',
  });
  useUIStore.setState({ unitNamingOpen: false, newUnitName: '' });
});

describe('handlePolygonComplete', () => {
  it('sets pendingPolygonPoints to the finished trace (the value the 2026-06-29 bug dropped)', () => {
    const points: PercentPoint[] = [
      { pctX: 0.1, pctY: 0.1 },
      { pctX: 0.4, pctY: 0.1 },
      { pctX: 0.4, pctY: 0.4 },
    ];

    const { result } = renderHook(() => useMapActions(project), { wrapper });
    expect(result.current.pendingPolygonPoints).toBeNull();

    act(() => {
      result.current.handlePolygonComplete(points);
    });

    // Without this the naming popover opens with nothing to save (the regression).
    expect(result.current.pendingPolygonPoints).toEqual(points);
    expect(result.current.unitNamingOpen).toBe(true);
  });
});

describe('commitUnitActivity', () => {
  const unit = {
    id: 'u1',
    unit_number: '101',
    sheet_id: 's1',
    polygon_coordinates: [],
    opening_edges: [],
  } as unknown as Unit;

  const activity: Partial<Activity> = {
    id: 'act-42',
    name: 'Drywall',
    color: '#3366aa',
    track: 'Production',
  };

  it('threads the capture-time client_timestamp through to the upsert_status_log RPC', async () => {
    const { result } = renderHook(() => useMapActions(project), { wrapper });

    await act(async () => {
      await result.current.commitUnitActivity(unit, activity, 'completed', false, {
        client_timestamp: '2026-06-09T00:00:00.000Z',
      });
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0] as unknown as [string, { log_data: Record<string, unknown> }];
    expect(fnName).toBe('upsert_status_log');
    // Capture-time timestamp survives — NOT overwritten with a sync-time stamp.
    expect(args.log_data.client_timestamp).toBe('2026-06-09T00:00:00.000Z');
    // Slot key is the stable activity_id.
    expect(args.log_data.activity_id).toBe('act-42');
    expect(args.log_data.unit_id).toBe('u1');
  });

  // List View Performance Phase 1 follow-on: commitUnitActivity swallows + toasts its own
  // errors, so it must REPORT success/failure to the caller. Apply's runner relies on this
  // to keep a failed save queued for retry instead of silently dropping it (AGENTS.md §2).
  it('returns ok:true when the status write succeeds', async () => {
    const { result } = renderHook(() => useMapActions(project), { wrapper });

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.commitUnitActivity(unit, activity, 'completed', false, {
        client_timestamp: '2026-06-09T00:00:00.000Z',
      });
    });

    expect(outcome).toEqual({ ok: true });
  });

  it('returns ok:false when the status write fails (so a batched Apply keeps the item queued)', async () => {
    // The upsert RPC rejects — the mutation rejects — commitUnitActivity catches + toasts,
    // and must surface ok:false rather than resolving as a silent success.
    rpcSingle.mockReset().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useMapActions(project), { wrapper });

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.commitUnitActivity(unit, activity, 'completed', false, {
        client_timestamp: '2026-06-09T00:00:00.000Z',
      });
    });

    expect(outcome).toEqual({ ok: false });
  });

  // Auto-advance (teeing up the next activity as "planned") is a convenience side-effect,
  // isolated from the primary write: if the follow-on write fails but the change you staged
  // saved, the item must NOT be re-queued as a failure.
  it('keeps ok:true when the primary save succeeds but auto-advance fails', async () => {
    // Enable auto-advance for the track and seed a next activity so the follow-on write fires.
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: true } } as never });
    const drywall = { id: 'act-42', name: 'Drywall', color: '#3366aa', track: 'Production', sequence_order: 1 } as unknown as Activity;
    const paint = { id: 'act-43', name: 'Paint', color: '#aa3366', track: 'Production', sequence_order: 2 } as unknown as Activity;

    // A client we can seed with the activities cache the auto-advance sequence reads.
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.activities('proj-1'), [drywall, paint]);
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    // Primary (Drywall) write succeeds; the auto-advance (Paint) write rejects.
    rpcSingle
      .mockReset()
      .mockResolvedValueOnce({ data: { id: 'log-new' }, error: null })
      .mockRejectedValueOnce(new Error('advance failed'));

    const { result } = renderHook(() => useMapActions(project), { wrapper: seededWrapper });

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.commitUnitActivity(unit, drywall, 'completed', false, {
        client_timestamp: '2026-06-09T00:00:00.000Z',
      });
    });

    // Both writes were attempted (auto-advance fired)...
    expect(rpc).toHaveBeenCalledTimes(2);
    // ...but the failed follow-on does NOT flip the succeeded primary to a failure.
    expect(outcome).toEqual({ ok: true });
  });
});
