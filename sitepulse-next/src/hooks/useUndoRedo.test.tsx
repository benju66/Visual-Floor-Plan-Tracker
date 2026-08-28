import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithQuery';
import type { StatusLog } from '@/types/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Reproduction + contract tests for useUndoRedo's UPDATE_STATUS paths
// (Undo/Redo Data-Integrity — Phase 1). Every one of these failed against the
// pre-Phase-1 hook; each pins one confirmed defect:
//   • undoing a status set for the FIRST time wrote a four-column payload
//     ({unit_id, track, activity_id, temporal_state}) that status_logs rejects
//     outright — status_color is NOT NULL with no default — so Ctrl+Z reverted
//     the screen and nothing else (defect 1). Same shape in the auto-advance
//     side-undo (defect 2);
//   • every write result was discarded, so that failure was invisible (defect 3);
//   • a restore carried the OLD client_timestamp, which the RPC's last-write-wins
//     guard rejects (and the raw upsert let bypass the guard entirely) (defect 5).
// The Supabase client is a recording stub: every status write — whichever route it
// takes — lands in `writes`, so a payload assertion prints what was actually sent.
// ─────────────────────────────────────────────────────────────────────────────

type RecordedWrite = { via: string; payload: Record<string, unknown> };
const writes: RecordedWrite[] = [];

const rpcResult = vi.fn();
const statusUpsertResult = vi.fn();

vi.mock('@/supabaseClient', () => ({
  supabase: {
    rpc: (fn: string, args: { log_data: Record<string, unknown> }) => {
      writes.push({ via: `rpc:${fn}`, payload: args.log_data });
      return Promise.resolve(rpcResult());
    },
    from: (table: string) => ({
      upsert: (rows: Record<string, unknown>[]) => {
        for (const row of rows) writes.push({ via: `upsert:${table}`, payload: row });
        return Promise.resolve(statusUpsertResult());
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

import { useUndoRedo, type UndoAction } from './useUndoRedo';

function wrapper({ children }: { children: ReactNode }) {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A stored status_logs row as the read hooks hand it back (synthesized activityName included). */
function storedLog(over: Partial<StatusLog> = {}): StatusLog {
  return {
    id: 'log-1',
    unit_id: 'unit-1',
    activity_id: 'act-1',
    activityName: 'Drywall',
    track: 'Production',
    status_color: '#3366aa',
    temporal_state: 'completed',
    planned_start_date: '2026-01-05',
    planned_end_date: '2026-01-09',
    logged_date: '2026-01-08',
    actual_start_date: '2026-01-06',
    client_timestamp: '2026-01-08T10:00:00.000Z',
    created_at: '2026-01-08T10:00:00.000Z',
    ...over,
  } as StatusLog;
}

/** Drive the real hook: seed one action, then undo (or redo) it. */
async function run(action: UndoAction, direction: 'undo' | 'redo' = 'undo') {
  const { result } = renderHook(() => useUndoRedo({ toolMode: 'pan', sheetId: 'sheet-1' }), { wrapper });
  act(() => {
    if (direction === 'undo') result.current.setUndoStack([action]);
    else result.current.setRedoStack([action]);
  });
  let thrown: unknown = null;
  await act(async () => {
    const trigger = direction === 'undo' ? result.current.triggerUndo : result.current.triggerRedo;
    await trigger().catch((e: unknown) => { thrown = e; });
  });
  return { result, thrown };
}

const isoAfter = (t: number) => (value: unknown) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) >= t;

beforeEach(() => {
  writes.length = 0;
  rpcResult.mockReset().mockReturnValue({ data: null, error: null });
  statusUpsertResult.mockReset().mockReturnValue({ error: null });
});

describe('UPDATE_STATUS undo', () => {
  it('writes a full "Not Started" reset through upsert_status_log when the slot had no prior status (defect 1)', async () => {
    const before = Date.now();
    await run({
      actionType: 'UPDATE_STATUS',
      unitId: 'unit-1',
      oldLog: null,
      newLog: storedLog({ client_timestamp: '2026-01-08T10:00:00.000Z' }),
    });

    // The pre-fix hook sent {unit_id, track, activity_id, temporal_state} via a raw
    // upsert — four columns, no status_color, so Postgres raised 23502 and nothing
    // was reverted. A reset must send its cleared fields PRESENT-and-empty ('' is the
    // RPC's clear): omitting them PRESERVES the stored value (AGENTS §2).
    // One combined assertion so a failure prints BOTH the route taken and the exact
    // payload sent (vitest swallows console.log here).
    expect(writes).toEqual([{
      via: 'rpc:upsert_status_log',
      payload: {
        unit_id: 'unit-1',
        activity_id: 'act-1',
        track: 'Production',
        temporal_state: 'none',
        status_color: '',
        planned_start_date: '',
        planned_end_date: '',
        logged_date: '',
        actual_start_date: '',
        client_timestamp: expect.any(String),
      },
    }]);
    expect({ freshTimestamp: isoAfter(before)(writes[0].payload.client_timestamp) })
      .toEqual({ freshTimestamp: true });
  });

  it('restores the previous status with a FRESH client_timestamp, not the stored one (defect 5)', async () => {
    const before = Date.now();
    const oldLog = storedLog({ client_timestamp: '2026-01-08T10:00:00.000Z' });
    await run({
      actionType: 'UPDATE_STATUS',
      unitId: 'unit-1',
      oldLog,
      newLog: storedLog({ temporal_state: 'completed', client_timestamp: '2026-02-01T09:00:00.000Z' }),
    });

    expect(writes.map(w => w.via)).toEqual(['rpc:upsert_status_log']);
    const payload = writes[0].payload;
    // The old snapshot's own timestamp would LOSE the RPC's last-write-wins compare
    // against the value being undone (or, on the raw upsert, bypass the guard entirely).
    expect({
      carriedStaleTimestamp: payload.client_timestamp === oldLog.client_timestamp,
      freshTimestamp: isoAfter(before)(payload.client_timestamp),
    }).toEqual({ carriedStaleTimestamp: false, freshTimestamp: true });
    // The rest of the snapshot is restored verbatim, minus the DB-owned/synthesized keys.
    expect({ ...payload, client_timestamp: undefined }).toEqual({
      unit_id: 'unit-1',
      activity_id: 'act-1',
      track: 'Production',
      status_color: '#3366aa',
      temporal_state: 'completed',
      planned_start_date: '2026-01-05',
      planned_end_date: '2026-01-09',
      logged_date: '2026-01-08',
      actual_start_date: '2026-01-06',
      client_timestamp: undefined,
    });
  });

  it('resets the auto-advance side-slot with the same full payload (defect 2)', async () => {
    await run({
      actionType: 'UPDATE_STATUS',
      unitId: 'unit-1',
      oldLog: storedLog(),
      newLog: storedLog(),
      secondary: {
        unitId: 'unit-1',
        newLog: storedLog({ id: 'log-2', activity_id: 'act-2', activityName: 'Paint', temporal_state: 'planned' }),
      },
    });

    expect(writes.map(w => w.via)).toEqual(['rpc:upsert_status_log', 'rpc:upsert_status_log']);
    expect({ ...writes[1].payload, client_timestamp: undefined }).toEqual({
      unit_id: 'unit-1',
      activity_id: 'act-2',
      track: 'Production',
      temporal_state: 'none',
      status_color: '',
      planned_start_date: '',
      planned_end_date: '',
      logged_date: '',
      actual_start_date: '',
      client_timestamp: undefined,
    });
  });

  it('throws when the write fails instead of silently reporting success (defect 3)', async () => {
    rpcResult.mockReturnValue({ data: null, error: { message: 'not-null violation' } });
    statusUpsertResult.mockReturnValue({ error: { message: 'not-null violation' } });

    const { thrown } = await run({
      actionType: 'UPDATE_STATUS',
      unitId: 'unit-1',
      oldLog: null,
      newLog: storedLog(),
    });

    expect({ threw: thrown !== null }).toEqual({ threw: true });
  });
});

describe('UPDATE_STATUS redo', () => {
  it('re-applies the new status through upsert_status_log with a fresh client_timestamp', async () => {
    const before = Date.now();
    const newLog = storedLog({ client_timestamp: '2026-02-01T09:00:00.000Z' });
    await run({ actionType: 'UPDATE_STATUS', unitId: 'unit-1', oldLog: null, newLog }, 'redo');

    expect(writes.map(w => w.via)).toEqual(['rpc:upsert_status_log']);
    expect({
      carriedStaleTimestamp: writes[0].payload.client_timestamp === newLog.client_timestamp,
      freshTimestamp: isoAfter(before)(writes[0].payload.client_timestamp),
      temporal_state: writes[0].payload.temporal_state,
    }).toEqual({ carriedStaleTimestamp: false, freshTimestamp: true, temporal_state: 'completed' });
  });

  it('re-clears the slot when the undone action was a Clear Status (no newLog)', async () => {
    // Clear Status pushes {oldLog, newLog: null}. Redoing it must re-clear the slot in
    // the database; the pre-fix hook only dropped the row from the cache, so a refresh
    // brought the status back.
    await run({ actionType: 'UPDATE_STATUS', unitId: 'unit-1', oldLog: storedLog(), newLog: null }, 'redo');

    expect(writes.map(w => w.via)).toEqual(['rpc:upsert_status_log']);
    expect({ ...writes[0].payload, client_timestamp: undefined }).toEqual({
      unit_id: 'unit-1',
      activity_id: 'act-1',
      track: 'Production',
      temporal_state: 'none',
      status_color: '',
      planned_start_date: '',
      planned_end_date: '',
      logged_date: '',
      actual_start_date: '',
      client_timestamp: undefined,
    });
  });

  it('re-applies the auto-advance side-slot too, and throws if that write fails', async () => {
    const secondary = {
      unitId: 'unit-1',
      newLog: storedLog({ id: 'log-2', activity_id: 'act-2', activityName: 'Paint', temporal_state: 'planned' }),
    };
    await run({ actionType: 'UPDATE_STATUS', unitId: 'unit-1', oldLog: null, newLog: storedLog(), secondary }, 'redo');
    expect(writes.map(w => `${w.via}:${w.payload.activity_id}`))
      .toEqual(['rpc:upsert_status_log:act-1', 'rpc:upsert_status_log:act-2']);

    writes.length = 0;
    rpcResult.mockReturnValue({ data: null, error: { message: 'boom' } });
    statusUpsertResult.mockReturnValue({ error: { message: 'boom' } });
    const { thrown } = await run(
      { actionType: 'UPDATE_STATUS', unitId: 'unit-1', oldLog: null, newLog: storedLog(), secondary },
      'redo',
    );
    expect({ threw: thrown !== null }).toEqual({ threw: true });
  });
});
