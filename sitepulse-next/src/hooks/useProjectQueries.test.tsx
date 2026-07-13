import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithQuery';
import type { StatusLog, Unit } from '@/types/domain';
import type { UpdateStatusVars } from '@/types/mutations';

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the data-layer spine's read + status-write hooks
// (Codebase Health Slice 0, Phase 0.2). These PIN the AGENTS.md §2 invariants as
// executable tests so the upcoming type-migration (Slice 1) and decomposition
// (Slice 2) cannot silently change HOW the app talks to the database:
//   • status writes go through `upsert_status_log` (single) / `.upsert(... onConflict:
//     'unit_id,activity_id')` (bulk) — NEVER a plain `.insert()`;
//   • the slot key is `activity_id`, never the activity NAME (the display-only
//     `activityName`/legacy `milestone` keys are stripped before the write);
//   • `client_timestamp` is capture-time — a value passed IN survives to the write,
//     and a fallback is stamped only when absent;
//   • `units.opening_edges` JSONB is narrowed to `OpeningEdge[]` on every read.
// Assert the CONTRACT, not the implementation. Mock the data layer with the Phase 0.1
// Supabase-mock recipe (no `msw`); the harness supplies the QueryClient.
// ─────────────────────────────────────────────────────────────────────────────

// Chainable Supabase stub. `rpc(...).single()` is the single-write path; the bulk
// paths chain off `from('status_logs')`; `from('units').select('*').eq(...)` is the
// read. Separate spies per verb so we can assert `.insert()` is NEVER used.
const rpcSingle = vi.fn();
const rpc = vi.fn(() => ({ single: rpcSingle }));

const upsert = vi.fn();
const insert = vi.fn();
const unitsEq = vi.fn();
const unitsSelect = vi.fn(() => ({ eq: unitsEq }));

const from = vi.fn((table: string) => {
  if (table === 'units') return { select: unitsSelect };
  // status_logs (+ any other write table): expose upsert/insert as tracked spies.
  return { upsert, insert };
});

vi.mock('@/supabaseClient', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...(args as [])),
    from: (table: string) => from(table),
  },
}));

import {
  useUnits,
  useUpdateStatus,
  useClearStatus,
  useBulkUpdateStatus,
  useBulkInsertStatusLogs,
} from './useProjectQueries';

function wrapper({ children }: { children: ReactNode }) {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpc.mockClear();
  rpcSingle.mockReset().mockResolvedValue({ data: { id: 'log-new' }, error: null });
  upsert.mockReset().mockResolvedValue({ error: null });
  insert.mockReset().mockResolvedValue({ data: null, error: null });
  unitsEq.mockReset();
  unitsSelect.mockClear();
  from.mockClear();
});

// ── Read hook: JSONB narrowing at the boundary (AGENTS.md §6) ────────────────
describe('useUnits — narrowed shape contract', () => {
  it('narrows units.opening_edges to a valid OpeningEdge[] on every read', async () => {
    // The DB/cache can hand back rows whose opening_edges is missing (row cached
    // before the column existed), null, or junk. The hook must hand callers a
    // guaranteed array so a consumer reading `.opening_edges.length` never crashes.
    unitsEq.mockResolvedValue({
      data: [
        { id: 'u1', opening_edges: [{ edgeIndex: 0, type: 'door' }] }, // valid → preserved
        { id: 'u2', opening_edges: null }, // null → []
        { id: 'u3' }, // missing → []
        { id: 'u4', opening_edges: [{ nope: true }] }, // junk → []
      ],
      error: null,
    });

    const { result } = renderHook(() => useUnits('sheet-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const byId = Object.fromEntries((result.current.data ?? []).map((u) => [u.id, u]));
    expect(byId.u1.opening_edges).toEqual([{ edgeIndex: 0, type: 'door' }]);
    expect(byId.u2.opening_edges).toEqual([]);
    expect(byId.u3.opening_edges).toEqual([]);
    expect(byId.u4.opening_edges).toEqual([]);
    // No `Json`/undefined leaks into props — every row is a real array.
    for (const u of result.current.data ?? []) {
      expect(Array.isArray(u.opening_edges)).toBe(true);
    }
  });
});

// ── Single status write: the upsert_status_log RPC path (AGENTS.md §2) ───────
describe('useUpdateStatus — single write contract', () => {
  const baseVars: UpdateStatusVars & { milestone: string } = {
    unit_id: 'u1',
    activity_id: 'act-42',
    status_color: '#3366aa',
    temporal_state: 'completed',
    track: 'Production',
    activityName: 'Drywall', // display-only — must be stripped
    milestone: 'Drywall', // legacy pre-rename key — must be stripped
    client_timestamp: '2026-06-09T00:00:00.000Z',
  };

  it('fires the upsert_status_log RPC keyed by activity_id, never .insert()', async () => {
    const { result } = renderHook(() => useUpdateStatus('sheet-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(baseVars);
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0] as unknown as [string, { log_data: Record<string, unknown> }];
    expect(fnName).toBe('upsert_status_log');
    // Slot key is the stable activity_id — not the name.
    expect(args.log_data.activity_id).toBe('act-42');
    // The display-only / legacy name keys never reach the write.
    expect(args.log_data).not.toHaveProperty('activityName');
    expect(args.log_data).not.toHaveProperty('milestone');
    // Never a plain insert — that would violate the UNIQUE(unit_id, activity_id) path.
    expect(insert).not.toHaveBeenCalled();
  });

  it('threads a capture-time client_timestamp through untouched', async () => {
    const { result } = renderHook(() => useUpdateStatus('sheet-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(baseVars);
    });

    const [, args] = rpc.mock.calls[0] as unknown as [string, { log_data: Record<string, unknown> }];
    // The offline-capture timestamp survives to the write (history reflects field time).
    expect(args.log_data.client_timestamp).toBe('2026-06-09T00:00:00.000Z');
  });

  it('stamps a fallback client_timestamp only when one was not captured', async () => {
    const { result } = renderHook(() => useUpdateStatus('sheet-1'), { wrapper });

    const { client_timestamp: _omit, ...noTimestamp } = baseVars;
    void _omit;
    await act(async () => {
      await result.current.mutateAsync(noTimestamp);
    });

    const [, args] = rpc.mock.calls[0] as unknown as [string, { log_data: Record<string, unknown> }];
    expect(typeof args.log_data.client_timestamp).toBe('string');
    expect(args.log_data.client_timestamp).not.toBe('');
  });
});

// ── Clear-to-Not-Started: explicit-empty reset (Status Sequencing Phase 5) ────
// upsert_status_log now PRESERVES an omitted field, so "clear to Not Started" must
// send its color + every date PRESENT-but-empty to stay a FULL reset. A regression
// here (dropping a field) would silently leave a stale completion/planned date on a
// slot the user cleared — the exact class of bug Phase 5 exists to prevent. SQL isn't
// exercised in Vitest, so this caller-contract assertion is the guard for the RPC flip.
describe('useClearStatus — full-reset clear contract (Phase 5)', () => {
  it('sends status_color + all four dates present-but-empty so the RPC clears them', async () => {
    const { result } = renderHook(() => useClearStatus('sheet-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        unitId: 'u1', track: 'Production', activityId: 'act-42', activityName: 'Drywall',
      });
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0] as unknown as [string, { log_data: Record<string, unknown> }];
    expect(fnName).toBe('upsert_status_log');
    expect(args.log_data.temporal_state).toBe('none');
    // Every preservable field is PRESENT (key exists) and empty — so the RPC's
    // `log_data ? 'field'` is true and it CLEARS to NULL, rather than preserving a
    // stale value now that omission means "keep".
    for (const field of ['status_color', 'planned_start_date', 'planned_end_date', 'logged_date', 'actual_start_date']) {
      expect(args.log_data).toHaveProperty(field);
      expect(args.log_data[field]).toBe('');
    }
    // The stable slot key rides through; still never a plain insert.
    expect(args.log_data.activity_id).toBe('act-42');
    expect(insert).not.toHaveBeenCalled();
  });
});

// ── Bulk apply: .upsert with the slot-unique conflict target (AGENTS.md §2) ──
describe('useBulkUpdateStatus — bulk write contract', () => {
  it('upserts with onConflict unit_id,activity_id (keyed by activity_id), never .insert()', async () => {
    const { result } = renderHook(() => useBulkUpdateStatus('sheet-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        unitIds: ['u1', 'u2'],
        activityName: 'Drywall',
        activity_id: 'act-42',
        color: '#3366aa',
        temporal_state: 'completed',
        track: 'Production',
      });
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, options] = upsert.mock.calls[0] as [
      Array<Record<string, unknown>>,
      { onConflict: string },
    ];
    expect(options).toEqual({ onConflict: 'unit_id,activity_id' });
    // One row per unit, each carrying the stable slot key + a client_timestamp; the
    // display-only name is not a column and must not ride the write.
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.activity_id).toBe('act-42');
      expect(row).not.toHaveProperty('activityName');
      expect(typeof row.client_timestamp).toBe('string');
    }
    expect(insert).not.toHaveBeenCalled();
  });
});

// ── Bulk insert (schedule import / restore): same upsert-only path ───────────
describe('useBulkInsertStatusLogs — bulk upsert contract', () => {
  it('upserts chunks with onConflict unit_id,activity_id and strips the display name', async () => {
    const { result } = renderHook(() => useBulkInsertStatusLogs('sheet-1'), { wrapper });

    const logs = [
      {
        unit_id: 'u1',
        activity_id: 'act-42',
        activityName: 'Drywall', // synthesized display name — not a column
        status_color: '#3366aa',
        temporal_state: 'completed',
        track: 'Production',
      },
    ] as unknown as StatusLog[];

    await act(async () => {
      await result.current.mutateAsync(logs);
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, options] = upsert.mock.calls[0] as [
      Array<Record<string, unknown>>,
      { onConflict: string },
    ];
    expect(options).toEqual({ onConflict: 'unit_id,activity_id' });
    expect(rows[0].activity_id).toBe('act-42');
    expect(rows[0]).not.toHaveProperty('activityName');
    expect(rows[0]).not.toHaveProperty('milestone');
    expect(insert).not.toHaveBeenCalled();
  });
});

// ── Bulk date integrity (Bulk Date-Clobber Fix) ──────────────────────────────
// The bulk paths used to stamp `logged_date = today` on EVERY row whose date was
// null — fabricating completion dates on planned/ongoing work that then survived
// forever (commitUnitActivity preserves a prior logged_date on completion) — and
// BulkActionDock sent untouched date inputs as explicit nulls, wiping stored
// planned windows. These pin the corrected contract: today is stamped ONLY for a
// completion missing its date, and an undefined planned date is OMITTED from the
// payload so the conflict-update preserves the stored window (the same
// omit-preserves / present-clears rule the Phase-5 RPC enforces on the single path).
describe('useBulkUpdateStatus — bulk date-integrity contract', () => {
  const today = new Date().toISOString().split('T')[0];
  const applyVars = {
    unitIds: ['u1', 'u2'],
    activityName: 'Drywall',
    activity_id: 'act-42',
    color: '#3366aa',
    track: 'Production',
  };

  const upsertedRows = (): Array<Record<string, unknown>> =>
    (upsert.mock.calls[0] as [Array<Record<string, unknown>>])[0];

  it('never fabricates a completion date on a non-completed bulk apply', async () => {
    const { result } = renderHook(() => useBulkUpdateStatus('sheet-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ...applyVars, temporal_state: 'planned' });
    });
    for (const row of upsertedRows()) {
      // Present-but-null (clears any stale completion date) — never today's date.
      expect(row).toHaveProperty('logged_date');
      expect(row.logged_date).toBeNull();
    }
  });

  it('still defaults a dateless completion to today', async () => {
    const { result } = renderHook(() => useBulkUpdateStatus('sheet-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ...applyVars, temporal_state: 'completed' });
    });
    for (const row of upsertedRows()) {
      expect(row.logged_date).toBe(today);
    }
  });

  it('omits untouched planned dates so the upsert preserves stored windows', async () => {
    const { result } = renderHook(() => useBulkUpdateStatus('sheet-1'), { wrapper });
    await act(async () => {
      // No planned dates in the vars — the dock's "date inputs left empty" shape.
      await result.current.mutateAsync({ ...applyVars, temporal_state: 'ongoing' });
    });
    for (const row of upsertedRows()) {
      expect(row).not.toHaveProperty('planned_start_date');
      expect(row).not.toHaveProperty('planned_end_date');
    }
  });

  it('sends an explicit planned date through (set) and an empty one as null (clear)', async () => {
    const { result } = renderHook(() => useBulkUpdateStatus('sheet-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        ...applyVars,
        temporal_state: 'planned',
        planned_start_date: '2026-07-20',
        planned_end_date: null,
      });
    });
    for (const row of upsertedRows()) {
      expect(row.planned_start_date).toBe('2026-07-20');
      // Present-but-null → the write clears the stored end date (caller's explicit choice).
      expect(row).toHaveProperty('planned_end_date');
      expect(row.planned_end_date).toBeNull();
    }
  });

  it("keep-existing preserves each slot's stored dates on a non-completed state change", async () => {
    const { result } = renderHook(() => useBulkUpdateStatus('sheet-1'), { wrapper });
    const bottleneck = {
      unit_id: 'u1', activity_id: 'act-7', status_color: '#111111',
      temporal_state: 'planned', track: 'Production',
      planned_start_date: '2026-07-01', planned_end_date: '2026-07-05', logged_date: null,
    } as unknown as StatusLog;

    await act(async () => {
      await result.current.mutateAsync({
        unitIds: ['u1'], activityName: '__KEEP_EXISTING__', color: '',
        temporal_state: 'ongoing', track: 'Production', bottlenecks: [bottleneck],
      });
    });

    const [row] = upsertedRows();
    expect(row.temporal_state).toBe('ongoing');
    // The slot's stored planned window rides through untouched…
    expect(row.planned_start_date).toBe('2026-07-01');
    expect(row.planned_end_date).toBe('2026-07-05');
    // …and its never-completed logged_date stays null instead of becoming "today".
    expect(row.logged_date).toBeNull();
  });

  it('keep-existing completion with no stored date stamps today (genuinely-new completion)', async () => {
    const { result } = renderHook(() => useBulkUpdateStatus('sheet-1'), { wrapper });
    const bottleneck = {
      unit_id: 'u1', activity_id: 'act-7', status_color: '#111111',
      temporal_state: 'ongoing', track: 'Production',
      planned_start_date: null, planned_end_date: null, logged_date: null,
    } as unknown as StatusLog;

    await act(async () => {
      await result.current.mutateAsync({
        unitIds: ['u1'], activityName: '__KEEP_EXISTING__', color: '',
        temporal_state: 'completed', track: 'Production', bottlenecks: [bottleneck],
      });
    });

    const [row] = upsertedRows();
    expect(row.logged_date).toBe(today);
  });
});

describe('useBulkInsertStatusLogs — never fabricates progress (schedule-write contract)', () => {
  const today = new Date().toISOString().split('T')[0];

  it('preserves an explicit null logged_date on a non-completed row', async () => {
    const { result } = renderHook(() => useBulkInsertStatusLogs('sheet-1'), { wrapper });
    // The shape buildImportWrites / buildRippleWrites emit for a slot with no prior
    // progress: planned window set, `logged_date: prior?.logged_date ?? null`.
    const logs = [{
      unit_id: 'u1', activity_id: 'act-42', temporal_state: 'planned',
      track: 'Production', status_color: '#3366aa',
      planned_start_date: '2026-07-20', planned_end_date: '2026-07-24', logged_date: null,
    }] as unknown as StatusLog[];

    await act(async () => {
      await result.current.mutateAsync(logs);
    });

    const [rows] = upsert.mock.calls[0] as [Array<Record<string, unknown>>];
    // An import must never mark work "completed today" — the null rides through.
    expect(rows[0].logged_date).toBeNull();
  });

  it('stamps today only for a completed row missing its date', async () => {
    const { result } = renderHook(() => useBulkInsertStatusLogs('sheet-1'), { wrapper });
    const logs = [
      { unit_id: 'u1', activity_id: 'act-42', temporal_state: 'completed', track: 'Production', status_color: '#3366aa', logged_date: null },
      { unit_id: 'u2', activity_id: 'act-42', temporal_state: 'completed', track: 'Production', status_color: '#3366aa', logged_date: '2026-06-15' },
    ] as unknown as StatusLog[];

    await act(async () => {
      await result.current.mutateAsync(logs);
    });

    const [rows] = upsert.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(rows[0].logged_date).toBe(today); // dateless completion → backstopped
    expect(rows[1].logged_date).toBe('2026-06-15'); // real date preserved, never re-stamped
  });
});
