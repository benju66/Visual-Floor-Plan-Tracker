import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

// Unit-CRUD write chains (the rollback contract tests): one switchable failure
// simulates the server rejecting the write. Verbs resolve supabase-style
// ({ data, error }) — builders never throw, the hooks check `error`.
let unitsWriteError: { message: string } | null = null;
const unitsWriteResult = () => Promise.resolve(
  unitsWriteError
    ? { data: null, error: unitsWriteError }
    : { data: { id: 'u-new', unit_number: 'Saved' }, error: null },
);
const unitsInsert = vi.fn(() => ({ select: () => ({ single: unitsWriteResult }) }));
// useUpdateUnitFields chains .eq().select().single(); useRecalculateSheetAreas
// awaits .eq() directly — so the eq() result is BOTH chainable and thenable.
const unitsUpdateEq = {
  select: () => ({ single: unitsWriteResult }),
  then: (
    onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => unitsWriteResult().then(onFulfilled, onRejected),
};
// update().in(ids) is the danger-zone bulk clear path; record its chunks.
let unitsUpdateInCalls: string[][] = [];
const unitsUpdate = vi.fn(() => ({
  eq: () => unitsUpdateEq,
  in: (_col: string, ids: string[]) => { unitsUpdateInCalls.push(ids); return unitsWriteResult(); },
}));
const unitsDelete = vi.fn(() => ({ eq: () => unitsWriteResult() }));
const statusLogsDelete = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));

// Paginated-read stub for the fetchAllIn / inlined-paginateAll chains:
// select().in(ids)[.eq().not()].order().range(from, to) resolves a slice of
// `pagedRows[table]` filtered to the requested ids — a tiny PostgREST. The mock
// enforces the same contract the server does (id filter + range window) and
// records every window in `rangeCalls` so tests can assert chunking/pagination.
type RangeCall = { table: string; ids: string[]; from: number; to: number };
let rangeCalls: RangeCall[] = [];
let pagedRows: Record<string, Array<Record<string, unknown>>> = {};

type PagedChain = {
  select: (cols?: string) => PagedChain;
  in: (col: string, values: string[]) => PagedChain;
  eq: (col: string, v: unknown) => PagedChain;
  not: (col: string, op: string, v: unknown) => PagedChain;
  order: (col: string, opts?: { ascending: boolean }) => PagedChain;
  range: (from: number, to: number) => Promise<{ data: Array<Record<string, unknown>>; error: null }>;
};

function pagedChain(table: string): PagedChain {
  let ids: string[] = [];
  const chain: PagedChain = {
    select: () => chain,
    in: (_col, values) => { ids = values; return chain; },
    eq: () => chain,
    not: () => chain,
    order: () => chain,
    range: (from, to) => {
      rangeCalls.push({ table, ids: [...ids], from, to });
      const matches = (pagedRows[table] ?? []).filter(r => ids.includes(r.unit_id as string));
      return Promise.resolve({ data: matches.slice(from, to + 1), error: null });
    },
  };
  return chain;
}

const from = vi.fn((table: string) => {
  if (table === 'units') return { select: unitsSelect, insert: unitsInsert, update: unitsUpdate, delete: unitsDelete };
  if (table === 'status_audit_log') return pagedChain(table);
  // status_logs (+ any other write table): tracked write spies, plus the paged
  // read chain for the bulk keep-existing readback (fetchAllIn).
  return { upsert, insert, delete: statusLogsDelete, select: pagedChain(table).select };
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
  useStatusHistory,
  useCreateUnit,
  useUpdateUnitFields,
  useDeleteUnit,
  useClearProjectUnitTypes,
} from './useProjectQueries';
import { queryKeys } from '@/types/queryKeys';

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
  unitsInsert.mockClear();
  unitsUpdate.mockClear();
  unitsDelete.mockClear();
  statusLogsDelete.mockClear();
  unitsWriteError = null;
  unitsUpdateInCalls = [];
  from.mockClear();
  rangeCalls = [];
  pagedRows = {};
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

// ── Pagination sweep (supabase-1000-row-cap): dashboard history ──────────────
// The dashboard calls useStatusHistory with EVERY unit id in the project. A
// single unchunked `.in(...)` hard-fails past ~200 ids (request-URL limit) and
// silently truncates at PostgREST's 1000-row cap — pace / weekly velocity /
// Monte Carlo quietly undercount. Pin the fetchAllIn-style contract: ≤200 ids
// per request, `.range()` pagination past a full page, nothing dropped.
describe('useStatusHistory — chunked + paginated dashboard history', () => {
  it('keeps every request ≤200 ids, paginates past 1000 rows, and drops nothing', async () => {
    const unitIds = Array.from({ length: 250 }, (_, i) => `u${i}`);
    pagedRows['status_audit_log'] = [
      // 1005 completions on u0 → the first id-chunk needs a second page…
      ...Array.from({ length: 1005 }, (_, i) => ({
        unit_id: 'u0', activity_id: `a${i}`, activity_name: 'Frame', track: 'Production',
        logged_date: '2026-01-02', client_timestamp: null, user_id: null,
      })),
      // …and one earlier completion lives in the SECOND id-chunk (u249).
      {
        unit_id: 'u249', activity_id: 'aX', activity_name: 'Drywall', track: 'Production',
        logged_date: '2025-12-31', client_timestamp: null, user_id: null,
      },
    ];

    const { result } = renderHook(() => useStatusHistory(unitIds), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Every request's id list stays under the URL-limit chunk size…
    expect(rangeCalls.length).toBeGreaterThan(0);
    expect(rangeCalls.every(c => c.ids.length <= 200)).toBe(true);
    // …the chunks jointly cover all 250 ids…
    expect(new Set(rangeCalls.flatMap(c => c.ids)).size).toBe(250);
    // …and the 1005-row chunk requested a second page instead of truncating.
    expect(rangeCalls.some(c => c.from === 1000)).toBe(true);

    // Nothing dropped, audit column mapped to activityName, sorted by date.
    expect(result.current.data).toHaveLength(1006);
    expect(result.current.data?.[0].activityName).toBe('Drywall'); // earliest logged_date first
  });
});

// ── Pagination sweep: bulk keep-existing readback ────────────────────────────
// The select fallback (no bottlenecks passed — the map dock's default) used a
// single `.in(unit_id, <up to 800 ids>)`: past the row cap, slots vanished from
// the readback and those units were silently skipped by the bulk update. Pin
// that it now reads through the paginated helper and rewrites the right slots.
describe('useBulkUpdateStatus — keep-existing readback is paginated', () => {
  it('reads existing slots via range-paginated requests and filters track client-side', async () => {
    pagedRows['status_logs'] = [
      {
        id: 'l1', unit_id: 'u1', activity_id: 'act-1', track: 'Production',
        temporal_state: 'planned', status_color: '#111111',
        planned_start_date: '2026-07-01', planned_end_date: '2026-07-05',
        logged_date: null, created_at: '2026-07-01T00:00:00Z',
      },
      { // other-track slot for the same unit — must NOT be rewritten
        id: 'l2', unit_id: 'u1', activity_id: 'act-2', track: 'Inspection',
        temporal_state: 'planned', status_color: '#222222',
        planned_start_date: null, planned_end_date: null,
        logged_date: null, created_at: '2026-07-01T00:00:00Z',
      },
    ];

    const { result } = renderHook(() => useBulkUpdateStatus('sheet-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        unitIds: ['u1'], activityName: '__KEEP_EXISTING__', color: '',
        temporal_state: 'ongoing', track: 'Production',
      });
    });

    // The readback went through the chunked/paginated path (never a bare .in()).
    expect(rangeCalls.some(c => c.table === 'status_logs')).toBe(true);

    // Only the requested track's slot is rewritten, with its dates intact and
    // no fabricated completion date (the bulk date-integrity contract).
    const [rows] = upsert.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(rows).toHaveLength(1);
    expect(rows[0].activity_id).toBe('act-1');
    expect(rows[0].temporal_state).toBe('ongoing');
    expect(rows[0].planned_start_date).toBe('2026-07-01');
    expect(rows[0].logged_date).toBeNull();
  });
});

// ── Unit CRUD: optimistic rollback on failure (audit Group A1) ───────────────
// These mutations are ONLINE-ONLY (never the offline queue), so a failure is
// final. Before the fix each hook had an empty onError: a failed create left a
// phantom, unsaveable location on the canvas; a failed delete hid a location
// that still exists. Pin the contract: on failure the units cache is restored
// to EXACTLY its pre-mutation state (never left mutated, never over-restored).
describe('unit CRUD mutations — optimistic rollback on failure', () => {
  const seeded = () => {
    // The harness default gcTime: 0 would garbage-collect the seeded (observer-
    // less) units query between the mutation and the assertion — keep the cache
    // alive so the tests read what the CANVAS would actually see.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
      },
    });
    const existing = [
      { id: 'u1', unit_number: 'Room 101', computed_area: 50 },
    ] as unknown as Unit[];
    client.setQueryData(queryKeys.units('sheet-1'), existing);
    const seededWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { client, seededWrapper };
  };
  const unitIds = (client: QueryClient) =>
    (client.getQueryData<Unit[]>(queryKeys.units('sheet-1')) ?? []).map(u => u.id);

  it('a failed create removes the phantom temp unit from the cache', async () => {
    unitsWriteError = { message: 'insert denied' };
    const { client, seededWrapper } = seeded();
    const { result } = renderHook(() => useCreateUnit('sheet-1'), { wrapper: seededWrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ sheet_id: 'sheet-1', unit_number: 'New Room' }),
      ).rejects.toMatchObject({ message: 'insert denied' });
    });

    // The optimistic temp_ unit is gone; the cache is exactly the pre-save state.
    expect(unitIds(client)).toEqual(['u1']);
  });

  it('a successful create keeps the optimistic unit (rollback only fires on error)', async () => {
    const { client, seededWrapper } = seeded();
    const { result } = renderHook(() => useCreateUnit('sheet-1'), { wrapper: seededWrapper });

    await act(async () => {
      await result.current.mutateAsync({ sheet_id: 'sheet-1', unit_number: 'New Room' });
    });

    expect(unitIds(client)).toHaveLength(2); // u1 + the optimistic add
  });

  it('a failed field update restores the previous values', async () => {
    unitsWriteError = { message: 'update denied' };
    const { client, seededWrapper } = seeded();
    const { result } = renderHook(() => useUpdateUnitFields('sheet-1'), { wrapper: seededWrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ unitId: 'u1', updates: { unit_number: 'Renamed' } }),
      ).rejects.toMatchObject({ message: 'update denied' });
    });

    const [u1] = client.getQueryData<Unit[]>(queryKeys.units('sheet-1')) ?? [];
    expect(u1.unit_number).toBe('Room 101'); // not left showing the failed rename
  });

  it('a failed delete restores the unit — it still exists in the DB', async () => {
    unitsWriteError = { message: 'delete denied' };
    const { client, seededWrapper } = seeded();
    const { result } = renderHook(() => useDeleteUnit('sheet-1'), { wrapper: seededWrapper });

    await act(async () => {
      await expect(result.current.mutateAsync('u1')).rejects.toMatchObject({ message: 'delete denied' });
    });

    expect(unitIds(client)).toEqual(['u1']); // the location is back, matching reality
  });
});

// ── Danger-zone bulk type clear (audit Group A4) ─────────────────────────────
// The old implementation fired one unhandled per-unit PATCH via
// useUpdateUnitFields('') — optimistic edits/invalidations aimed at a
// nonexistent units('') cache, hundreds of parallel requests, zero failure
// feedback. Pin the replacement: one mutation, chunked ≤200 ids per request,
// and a failed chunk rejects (so the caller can tell the user).
describe('useClearProjectUnitTypes — chunked, error-checked bulk clear', () => {
  it('chunks the id list to ≤200 per request and reports the cleared count', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const { result } = renderHook(() => useClearProjectUnitTypes(), { wrapper });

    let cleared = 0;
    await act(async () => {
      cleared = await result.current.mutateAsync(ids);
    });

    expect(cleared).toBe(250);
    expect(unitsUpdateInCalls.map(c => c.length)).toEqual([200, 50]);
  });

  it('a failed chunk rejects instead of silently pretending success', async () => {
    unitsWriteError = { message: 'update denied' };
    const { result } = renderHook(() => useClearProjectUnitTypes(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(['u1'])).rejects.toMatchObject({ message: 'update denied' });
    });
  });
});

// ── onSettled invalidation targets (Frontend Structure W3, Phase 2 safety net) ──
// The split (P4 Units, P5 Statuses) moves these mutations to new files. Their
// onSettled invalidations flow through the P1 queryKeys factory; pin the EXACT
// prefix keys so a fat-fingered move that drops or drifts an invalidation goes red
// instead of silently leaving a stale map/list after a write. (The write contracts
// above are already pinned; this covers the cache-refresh side the split must keep.)
describe('status + unit mutations — onSettled invalidation targets', () => {
  function ctx() {
    const client = makeTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const w = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return { invalidate, w };
  }

  const statusVars = {
    unit_id: 'u1', activity_id: 'act-42', status_color: '#3366aa',
    temporal_state: 'completed', track: 'Production',
  } as unknown as UpdateStatusVars;

  it('useUpdateStatus invalidates statusesBySheet + allProjectStatusesAll', async () => {
    const { invalidate, w } = ctx();
    const { result } = renderHook(() => useUpdateStatus('sheet-1'), { wrapper: w });
    await act(async () => { await result.current.mutateAsync(statusVars); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.statusesBySheet('sheet-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.allProjectStatusesAll() });
  });

  it('useClearStatus invalidates statusesBySheet + allProjectStatusesAll', async () => {
    const { invalidate, w } = ctx();
    const { result } = renderHook(() => useClearStatus('sheet-1'), { wrapper: w });
    await act(async () => {
      await result.current.mutateAsync({ unitId: 'u1', track: 'Production', activityId: 'act-42' });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.statusesBySheet('sheet-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.allProjectStatusesAll() });
  });

  it('useBulkUpdateStatus invalidates statusesBySheet + allProjectStatusesAll', async () => {
    const { invalidate, w } = ctx();
    const { result } = renderHook(() => useBulkUpdateStatus('sheet-1'), { wrapper: w });
    await act(async () => {
      await result.current.mutateAsync({
        unitIds: ['u1'], activityName: 'Drywall', activity_id: 'act-42',
        color: '#3366aa', temporal_state: 'completed', track: 'Production',
      });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.statusesBySheet('sheet-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.allProjectStatusesAll() });
  });

  it('useBulkInsertStatusLogs invalidates statusesBySheet + allProjectStatusesAll', async () => {
    const { invalidate, w } = ctx();
    const { result } = renderHook(() => useBulkInsertStatusLogs('sheet-1'), { wrapper: w });
    await act(async () => {
      await result.current.mutateAsync([
        { unit_id: 'u1', activity_id: 'act-42', temporal_state: 'completed', track: 'Production', status_color: '#3366aa' },
      ] as unknown as StatusLog[]);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.statusesBySheet('sheet-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.allProjectStatusesAll() });
  });

  it('useUpdateUnitFields invalidates units + allProjectUnitsAll', async () => {
    const { invalidate, w } = ctx();
    const { result } = renderHook(() => useUpdateUnitFields('sheet-1'), { wrapper: w });
    await act(async () => {
      await result.current.mutateAsync({ unitId: 'u1', updates: { unit_number: 'Renamed' } });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.units('sheet-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.allProjectUnitsAll() });
  });

  it('useDeleteUnit invalidates units + statusesBySheet + allProjectUnitsAll', async () => {
    const { invalidate, w } = ctx();
    const { result } = renderHook(() => useDeleteUnit('sheet-1'), { wrapper: w });
    await act(async () => { await result.current.mutateAsync('u1'); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.units('sheet-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.statusesBySheet('sheet-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.allProjectUnitsAll() });
  });
});
