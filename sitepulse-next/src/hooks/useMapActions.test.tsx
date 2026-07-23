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
// The bulk path (useBulkUpdateStatus) writes via `.upsert(onConflict)`, NOT the RPC —
// intercept it so the Phase-2 bulk auto-advance assertions can read the exact rows written.
const bulkUpsert = vi.fn();

vi.mock('@/supabaseClient', () => ({
  supabase: {
    auth: { getSession: () => getSession() },
    rpc: (...args: unknown[]) => rpc(...(args as [])),
    // `select().eq()` is a benign stub for the RPC tests; `upsert` is the bulk write path.
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      upsert: (...args: unknown[]) => bulkUpsert(...(args as [])),
    }),
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
  bulkUpsert.mockReset().mockResolvedValue({ error: null });
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

  // ── Status Sequencing & Data-Integrity Fix — Phase 1 (the headline repro) ──
  // Completing an EARLIER activity must never downgrade a LATER activity that is
  // already completed. Before the fix, auto-advance blindly wrote temporal_state
  // 'planned' to the next slot — resetting a finished activity and (because the RPC
  // rewrites every column from its payload, NULLIF-ing absent fields) wiping its
  // logged_date / actual_start_date, which Undo can't recover.
  it('does NOT downgrade an already-completed later activity when auto-advancing', async () => {
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: true } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    const frame = { id: 'act-A', name: 'Frame', color: '#111111', track: 'Production', sequence_order: 1 } as unknown as Activity;
    const drywall = { id: 'act-B', name: 'Drywall', color: '#222222', track: 'Production', sequence_order: 2 } as unknown as Activity;

    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.activities('proj-1'), [frame, drywall]);
    // Drywall (the LATER activity) is ALREADY completed with real dates — exactly the
    // data auto-advance must not touch when we now complete Frame (the earlier one).
    client.setQueryData(['statuses', 's1'], [
      {
        id: 'log-B', unit_id: 'u1', activity_id: 'act-B', activityName: 'Drywall',
        track: 'Production', temporal_state: 'completed', status_color: '#222222',
        planned_start_date: null, planned_end_date: null,
        logged_date: '2026-07-01', actual_start_date: '2026-06-20',
        client_timestamp: '2026-07-01T00:00:00.000Z', created_at: '2026-07-01T00:00:00.000Z',
      },
    ]);
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMapActions(project), { wrapper: seededWrapper });

    await act(async () => {
      await result.current.commitUnitActivity(unit, frame, 'completed', false, {
        client_timestamp: '2026-07-02T00:00:00.000Z',
      });
    });

    // Only the primary write (Frame → completed) fires. Auto-advance sees Drywall is
    // already completed and does NOTHING — no second RPC, so Drywall's state + dates
    // are left exactly as they were.
    expect(rpc).toHaveBeenCalledTimes(1);
    const [, primaryArgs] = rpc.mock.calls[0] as unknown as [string, { log_data: Record<string, unknown> }];
    expect(primaryArgs.log_data.activity_id).toBe('act-A');

    const calls = rpc.mock.calls as unknown as Array<[string, { log_data: Record<string, unknown> }]>;
    const wroteToDrywall = calls.some(([, a]) => a.log_data.activity_id === 'act-B');
    expect(wroteToDrywall).toBe(false);
  });

  // The other side of the never-downgrade rule: when the next slot is genuinely Not
  // Started, auto-advance still tees it up as 'planned' — and (smell fix a) stamps it
  // with the SAME capture-time client_timestamp the primary edit carried, not a
  // sync-time "now" that would always win Last-Write-Wins.
  it('still tees up a Not-Started next activity as planned, with the capture-time timestamp', async () => {
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: true } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    const frame = { id: 'act-A', name: 'Frame', color: '#111111', track: 'Production', sequence_order: 1 } as unknown as Activity;
    const drywall = { id: 'act-B', name: 'Drywall', color: '#222222', track: 'Production', sequence_order: 2 } as unknown as Activity;

    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.activities('proj-1'), [frame, drywall]);
    // No status seeded for Drywall → it is Not Started ('none'), so advancing is safe.
    client.setQueryData(['statuses', 's1'], []);
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMapActions(project), { wrapper: seededWrapper });

    await act(async () => {
      await result.current.commitUnitActivity(unit, frame, 'completed', false, {
        client_timestamp: '2026-07-02T00:00:00.000Z',
      });
    });

    // Primary (Frame) + auto-advance (Drywall) both fire.
    expect(rpc).toHaveBeenCalledTimes(2);
    const [, advanceArgs] = rpc.mock.calls[1] as unknown as [string, { log_data: Record<string, unknown> }];
    expect(advanceArgs.log_data.activity_id).toBe('act-B');
    expect(advanceArgs.log_data.temporal_state).toBe('planned');
    expect(advanceArgs.log_data.client_timestamp).toBe('2026-07-02T00:00:00.000Z');
  });

  // ── Status Sequencing & Data-Integrity Fix — Phase 3 (date corruption) ──
  // Editing a PLANNED start/end date on an already-completed activity must NOT
  // silently re-stamp its completion date (logged_date) to today. That edit carries
  // no `loggedDate`, and the pre-fix code re-stamped today whenever the slot was
  // 'completed' and `loggedDate` was absent — clobbering the real completion date the
  // RPC then wrote (it rewrites every column from its payload). This bug fires even
  // with auto-advance OFF; the fix mirrors the sibling `actual_start_date` preservation.
  const drywallB = { id: 'act-B', name: 'Drywall', color: '#222222', track: 'Production', sequence_order: 2 } as unknown as Activity;

  it('preserves a completed activity\'s logged_date when only its planned date is edited', async () => {
    // Auto-advance OFF — this bug is independent of it, and OFF keeps the primary
    // write the ONLY RPC so the assertion reads the right call.
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: false } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.activities('proj-1'), [drywallB]);
    // Drywall is ALREADY completed with a real completion date + actual-start date —
    // exactly the data a planned-date edit must leave alone.
    client.setQueryData(['statuses', 's1'], [
      {
        id: 'log-B', unit_id: 'u1', activity_id: 'act-B', activityName: 'Drywall',
        track: 'Production', temporal_state: 'completed', status_color: '#222222',
        planned_start_date: '2026-06-10', planned_end_date: '2026-06-25',
        logged_date: '2026-07-01', actual_start_date: '2026-06-20',
      },
    ]);
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMapActions(project), { wrapper: seededWrapper });

    // Re-save the still-completed Drywall, changing ONLY its planned start date. No
    // `loggedDate` in extraProps — exactly what a planned-date edit sends.
    await act(async () => {
      await result.current.commitUnitActivity(unit, drywallB, 'completed', false, {
        startDate: '2026-06-12',
        client_timestamp: '2026-07-05T00:00:00.000Z',
      });
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0] as unknown as [string, { log_data: Record<string, unknown> }];
    expect(fnName).toBe('upsert_status_log');
    expect(args.log_data.activity_id).toBe('act-B');
    // The edited planned date lands...
    expect(args.log_data.planned_start_date).toBe('2026-06-12');
    // ...but the completion date is PRESERVED, not re-stamped to today (the bug).
    expect(args.log_data.logged_date).toBe('2026-07-01');
    // Sanity: the sibling actual_start_date preservation this mirrors still holds.
    expect(args.log_data.actual_start_date).toBe('2026-06-20');
  });

  // Post-W3 fix: a status TAP carries no dates. When the level has no schedule
  // window (activeSheet unseeded here → sheetSchedule is empty), the pre-fix code
  // sent planned_*: null and the RPC then WIPED the activity's real planned window.
  // The tap must now preserve the stored planned dates.
  it('preserves stored planned dates when a status tap carries none and the level has no schedule window', async () => {
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: false } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.activities('proj-1'), [drywallB]);
    // Drywall already carries a real planned window (e.g. set earlier or imported).
    client.setQueryData(['statuses', 's1'], [
      {
        id: 'log-B', unit_id: 'u1', activity_id: 'act-B', activityName: 'Drywall',
        track: 'Production', temporal_state: 'completed', status_color: '#222222',
        planned_start_date: '2026-06-10', planned_end_date: '2026-06-25',
        logged_date: '2026-07-01', actual_start_date: '2026-06-20',
      },
    ]);
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMapActions(project), { wrapper: seededWrapper });

    // A tap: re-commit the same state with NO startDate/endDate in extraProps.
    await act(async () => {
      await result.current.commitUnitActivity(unit, drywallB, 'completed', false, {
        client_timestamp: '2026-07-05T00:00:00.000Z',
      });
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [, args] = rpc.mock.calls[0] as unknown as [string, { log_data: Record<string, unknown> }];
    // The stored planned window survives the tap (pre-fix both were null).
    expect(args.log_data.planned_start_date).toBe('2026-06-10');
    expect(args.log_data.planned_end_date).toBe('2026-06-25');
  });

  // The other side of the rule: a genuinely-NEW completion (no prior log / no prior
  // logged_date) with no supplied loggedDate still defaults to today — normal
  // completion stamping must not regress.
  it('still stamps today for a genuinely-new completion when no loggedDate is supplied', async () => {
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: false } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.activities('proj-1'), [drywallB]);
    // No prior Drywall log → genuinely-new completion, so today is the correct stamp.
    client.setQueryData(['statuses', 's1'], []);
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMapActions(project), { wrapper: seededWrapper });

    // Same UTC formula the code uses; the act resolves within microtasks, so the date
    // can't roll between here and the write.
    const today = new Date().toISOString().split('T')[0];

    await act(async () => {
      await result.current.commitUnitActivity(unit, drywallB, 'completed', false, {
        client_timestamp: '2026-07-05T00:00:00.000Z',
      });
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [, args] = rpc.mock.calls[0] as unknown as [string, { log_data: Record<string, unknown> }];
    expect(args.log_data.logged_date).toBe(today);
  });

  // The preservation must not swallow an INTENTIONAL clear: an edit that explicitly
  // carries loggedDate: '' still resolves logged_date to null (via the
  // `extraProps.loggedDate !== undefined` branch), even when a prior date exists.
  it('still clears logged_date when an explicit clear (loggedDate: "") is supplied', async () => {
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: false } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.activities('proj-1'), [drywallB]);
    client.setQueryData(['statuses', 's1'], [
      {
        id: 'log-B', unit_id: 'u1', activity_id: 'act-B', activityName: 'Drywall',
        track: 'Production', temporal_state: 'completed', status_color: '#222222',
        logged_date: '2026-07-01',
      },
    ]);
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMapActions(project), { wrapper: seededWrapper });

    await act(async () => {
      await result.current.commitUnitActivity(unit, drywallB, 'completed', false, {
        loggedDate: '',
        client_timestamp: '2026-07-05T00:00:00.000Z',
      });
    });

    const [, args] = rpc.mock.calls[0] as unknown as [string, { log_data: Record<string, unknown> }];
    // Phase 5 contract: upsert_status_log CLEARS a field that is present-but-null (and
    // PRESERVES one whose key is absent). So an explicit clear must send logged_date
    // PRESENT as null — useUpdateStatus no longer drops it. The value must be null,
    // crucially NOT the prior '2026-07-01' (preservation didn't swallow the intentional
    // clear), and NOT undefined (an absent key would now preserve, breaking the clear).
    expect(args.log_data.logged_date).toBeNull();
  });
});

// ── Status Sequencing & Data-Integrity Fix — Phase 2 (bulk path) ──
// The bulk "Apply to selected → Completed" writes via useBulkUpdateStatus (.upsert on
// unit_id,activity_id), so we assert on the bulk .upsert rows, NOT the RPC. The pre-fix
// bulk auto-advance grouped EVERY selected unit by its next-index and stamped 'planned'
// with no per-unit state read — downgrading a later activity some locations had already
// completed. Phase 2 gates group membership with the SAME planAutoAdvance never-downgrade
// rule the single path uses (Phase 1), applied per unit.
describe('handleApplyBulkStatus (Status Sequencing & Data-Integrity Fix — Phase 2)', () => {
  const frame = { id: 'act-A', name: 'Frame', color: '#111111', track: 'Production', sequence_order: 1 } as unknown as Activity;
  const drywall = { id: 'act-B', name: 'Drywall', color: '#222222', track: 'Production', sequence_order: 2 } as unknown as Activity;

  type BulkRow = { unit_id: string; activity_id: string; temporal_state: string };
  // Flatten every bulk .upsert row that carries `activityId` (each call is [rows, opts]).
  const upsertRowsFor = (activityId: string): BulkRow[] =>
    (bulkUpsert.mock.calls as unknown as Array<[BulkRow[], unknown]>)
      .map(([rows]) => rows)
      .filter(rows => rows.length > 0 && rows.every(r => r.activity_id === activityId))
      .flat();

  const seedClient = (statuses: unknown[], unitIds: string[]) => {
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.activities('proj-1'), [frame, drywall]);
    client.setQueryData(
      queryKeys.units('s1'),
      unitIds.map(id => ({ id, unit_type: null, sheet_id: 's1' })) as unknown as Unit[],
    );
    client.setQueryData(['statuses', 's1'], statuses);
    return client;
  };

  it('does NOT downgrade selected locations whose next activity is already completed (the bulk repro)', async () => {
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: true } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    // u1 has Drywall ALREADY completed (with real dates); u2 & u3 have not started it.
    const client = seedClient(
      [
        {
          id: 'log-B1', unit_id: 'u1', activity_id: 'act-B', activityName: 'Drywall',
          track: 'Production', temporal_state: 'completed', status_color: '#222222',
          logged_date: '2026-07-01', actual_start_date: '2026-06-20',
        },
      ],
      ['u1', 'u2', 'u3'],
    );
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMapActions(project), { wrapper: seededWrapper });

    await act(async () => {
      await result.current.handleApplyBulkStatus({
        unitIds: ['u1', 'u2', 'u3'],
        activityName: 'Frame',
        color: '#111111',
        temporal_state: 'completed',
        track: 'Production',
        planned_start_date: null,
        planned_end_date: null,
      });
    });

    // Primary write: Frame → completed for ALL three selected locations (unchanged behavior).
    const frameRows = upsertRowsFor('act-A');
    expect(new Set(frameRows.map(r => r.unit_id))).toEqual(new Set(['u1', 'u2', 'u3']));
    expect(frameRows.every(r => r.temporal_state === 'completed')).toBe(true);

    // Auto-advance: ONLY the genuinely Not-Started next slots (u2, u3) are teed up to
    // Drywall 'planned'. u1 is EXCLUDED — its Drywall is already completed, so the
    // never-downgrade rule leaves that slot (and its logged/actual-start dates) untouched.
    const advanceRows = upsertRowsFor('act-B');
    expect(new Set(advanceRows.map(r => r.unit_id))).toEqual(new Set(['u2', 'u3']));
    expect(advanceRows.every(r => r.temporal_state === 'planned')).toBe(true);
    // The load-bearing assertion: u1's completed Drywall never received a downgrade write.
    expect(advanceRows.some(r => r.unit_id === 'u1')).toBe(false);
  });

  // The other side of the rule: when NO selected location has started the next slot,
  // normal bulk advance still tees up every one of them.
  it('still tees up every Not-Started next slot across the selected locations', async () => {
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: true } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    // No Drywall rows anywhere → every unit's next slot is Not Started ('none').
    const client = seedClient([], ['u1', 'u2', 'u3']);
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMapActions(project), { wrapper: seededWrapper });

    await act(async () => {
      await result.current.handleApplyBulkStatus({
        unitIds: ['u1', 'u2', 'u3'],
        activityName: 'Frame',
        color: '#111111',
        temporal_state: 'completed',
        track: 'Production',
        planned_start_date: null,
        planned_end_date: null,
      });
    });

    const advanceRows = upsertRowsFor('act-B');
    expect(new Set(advanceRows.map(r => r.unit_id))).toEqual(new Set(['u1', 'u2', 'u3']));
    expect(advanceRows.every(r => r.temporal_state === 'planned')).toBe(true);
  });

  // Concurrent-Apply race residual (plan §Open decisions): a near-simultaneous single
  // Apply may have already teed up a unit's next slot to 'planned'. The never-downgrade
  // rule reads that progress and SKIPS the unit, so the worst case is "bulk skips a slot
  // it might have teed up" — safe, never a destructive re-stamp/downgrade — regardless of
  // interleaving order. (A stronger ordering guard is therefore not needed for Phase 2.)
  it('leaves a next slot a concurrent Apply already teed up (planned) untouched', async () => {
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: true } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    // u1's Drywall is already 'planned' — the state a near-simultaneous single Apply's
    // auto-advance would have left. The bulk path must NOT re-stamp/downgrade it.
    const client = seedClient(
      [
        {
          id: 'log-B1', unit_id: 'u1', activity_id: 'act-B', activityName: 'Drywall',
          track: 'Production', temporal_state: 'planned', status_color: '#222222',
        },
      ],
      ['u1', 'u2'],
    );
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMapActions(project), { wrapper: seededWrapper });

    await act(async () => {
      await result.current.handleApplyBulkStatus({
        unitIds: ['u1', 'u2'],
        activityName: 'Frame',
        color: '#111111',
        temporal_state: 'completed',
        track: 'Production',
        planned_start_date: null,
        planned_end_date: null,
      });
    });

    const advanceRows = upsertRowsFor('act-B');
    // Only u2 advances; u1's already-planned slot is left alone (never-downgrade, no churn).
    expect(new Set(advanceRows.map(r => r.unit_id))).toEqual(new Set(['u2']));
    expect(advanceRows.some(r => r.unit_id === 'u1')).toBe(false);
  });
});

// ── Status Sequencing & Data-Integrity Fix — Phase 4 (undo reverses an auto-advance) ──
// Completing an activity auto-advances the NEXT slot to 'planned'. Before Phase 4 the undo
// entry captured only the PRIMARY slot, so a single Undo reversed the completion but left
// the teed-up next slot stranded at 'planned' — a half-reverted schedule. Phase 4 captures
// the auto-advance side-write in the SAME undo entry, so ONE Undo reverses BOTH slots and
// ONE Redo re-applies BOTH. Undo/redo write via supabase.from('status_logs').upsert(...),
// which the harness maps to `bulkUpsert` (the RPC path is only the forward commit).
describe('commitUnitActivity undo/redo — Phase 4: one Undo reverses BOTH the completion and its auto-advance', () => {
  const unit = { id: 'u1', unit_number: '101', sheet_id: 's1', polygon_coordinates: [], opening_edges: [] } as unknown as Unit;
  const frame = { id: 'act-A', name: 'Frame', color: '#111111', track: 'Production', sequence_order: 1 } as unknown as Activity;
  const drywall = { id: 'act-B', name: 'Drywall', color: '#222222', track: 'Production', sequence_order: 2 } as unknown as Activity;

  type Row = { unit_id?: string; activity_id?: string; temporal_state?: string };
  // Every status_logs row an undo/redo upsert wrote for a given activity_id (each bulkUpsert
  // call is [rows, opts]).
  const upsertRowsForActivity = (activityId: string): Row[] =>
    (bulkUpsert.mock.calls as unknown as Array<[Row[], unknown]>)
      .flatMap(([rows]) => rows ?? [])
      .filter(r => r.activity_id === activityId);

  beforeEach(() => {
    // Make the forward commit's status write echo back its row (as the real upsert_status_log
    // RPC does) so the captured primary + secondary `newLog`s carry activity_id/track/
    // temporal_state — otherwise the shared harness stub returns a fixed `{ id: 'log-new' }`
    // that strips them and leaves the undo/redo writes unassertable. `single()` fires right
    // after `.rpc(...)`, so the newest recorded `rpc` call IS this write's log_data. The
    // top-level beforeEach re-resets `rpcSingle` each test, so this override can't leak.
    rpcSingle.mockImplementation(() => {
      const lastCall = rpc.mock.calls[rpc.mock.calls.length - 1] as unknown as [string, { log_data?: Record<string, unknown> }] | undefined;
      const logData = lastCall?.[1]?.log_data ?? {};
      return Promise.resolve({ data: { id: 'log-new', ...logData }, error: null });
    });
  });

  // A client where completing Frame genuinely tees up Drywall (Drywall is Not Started).
  const freshCompletionWrapper = () => {
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.activities('proj-1'), [frame, drywall]);
    client.setQueryData(['statuses', 's1'], []);
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };

  it('one Undo restores BOTH slots — the completed activity AND the auto-advanced next slot', async () => {
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: true } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    const { result } = renderHook(() => useMapActions(project), { wrapper: freshCompletionWrapper() });

    // Complete Frame → auto-advance tees Drywall up to 'planned' (both writes fire via the RPC).
    await act(async () => {
      await result.current.commitUnitActivity(unit, frame, 'completed', false, {
        client_timestamp: '2026-07-02T00:00:00.000Z',
      });
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    // The forward commit uses the RPC path only — no undo/redo writes yet.
    expect(bulkUpsert).not.toHaveBeenCalled();

    // ONE Undo.
    await act(async () => {
      await result.current.triggerUndo();
    });

    // Primary slot reverts: Frame → Not Started (existing single-slot behavior, unchanged).
    const frameUndo = upsertRowsForActivity('act-A');
    expect(frameUndo.length).toBeGreaterThan(0);
    expect(frameUndo.every(r => r.temporal_state === 'none')).toBe(true);

    // The load-bearing Phase-4 assertion: the auto-advanced slot ALSO reverts — Drywall →
    // Not Started. Before the fix NOTHING was written for act-B here (the half-revert bug).
    const drywallUndo = upsertRowsForActivity('act-B');
    expect(drywallUndo.length).toBeGreaterThan(0);
    expect(drywallUndo.every(r => r.temporal_state === 'none')).toBe(true);
  });

  it('one Redo re-applies BOTH slots — the completion AND the auto-advance', async () => {
    useSettingsStore.setState({ settings: { auto_advance_tracks: { Production: true } } as never });
    useMapStore.setState({ activeSheetId: 's1' });

    const { result } = renderHook(() => useMapActions(project), { wrapper: freshCompletionWrapper() });

    await act(async () => {
      await result.current.commitUnitActivity(unit, frame, 'completed', false, {
        client_timestamp: '2026-07-02T00:00:00.000Z',
      });
    });
    await act(async () => {
      await result.current.triggerUndo();
    });

    // Isolate the writes made by Redo alone.
    bulkUpsert.mockClear();

    await act(async () => {
      await result.current.triggerRedo();
    });

    // Primary re-applies: Frame → completed again.
    const frameRedo = upsertRowsForActivity('act-A');
    expect(frameRedo.length).toBeGreaterThan(0);
    expect(frameRedo.every(r => r.temporal_state === 'completed')).toBe(true);

    // The auto-advance re-applies too: Drywall → planned. Before the fix the secondary was
    // never captured, so Redo left it Not Started.
    const drywallRedo = upsertRowsForActivity('act-B');
    expect(drywallRedo.length).toBeGreaterThan(0);
    expect(drywallRedo.every(r => r.temporal_state === 'planned')).toBe(true);
  });
});
