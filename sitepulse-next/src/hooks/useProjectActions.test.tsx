import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithQuery';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { queryKeys } from '@/types/queryKeys';
import type { Activity, Project, Sheet } from '@/types/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Characterization tests for useProjectActions (Frontend Structure W3, Phase 2 —
// the safety net BEFORE the useProjectQueries split). This hook had NO test today
// and owns the highest-risk untested path in the data layer: handleDeleteSheet, a
// multi-step cascade whose paginated status_logs delete fixed a real 1000-row-cap
// prod bug (a big level used to leave orphaned rows and fail to delete).
//
// These assert TODAY's behavior — the exact DB calls, the cascade ORDER, and the
// exact invalidation keys (via the queryKeys factory, post-P1) — so if the split
// (P3–P5) moves a hook and changes any of that, a test goes red. They pin the
// contract, not the implementation; surprising-but-current behavior is pinned
// AS-IS (see the tile-cleanup note) rather than "corrected" here.
// ─────────────────────────────────────────────────────────────────────────────

// ── Supabase chainable stub (per-table verbs, so we can assert order + chunking) ──
const activitiesInsertSelect = vi.fn();
const activitiesInsert = vi.fn((_rows: unknown) => ({ select: activitiesInsertSelect }));
const activitiesDeleteEq = vi.fn();
const activitiesDelete = vi.fn(() => ({ eq: activitiesDeleteEq }));

// status_logs.delete().in(unit_id, chunk) — record each chunk to assert ≤200 sizing.
let statusLogsDeleteInChunks: string[][] = [];
let statusLogsDeleteError: { message: string } | null = null;
const statusLogsDeleteIn = vi.fn((_col: string, ids: string[]) => {
  statusLogsDeleteInChunks.push(ids);
  return Promise.resolve({ error: statusLogsDeleteError });
});
const statusLogsDelete = vi.fn(() => ({ in: statusLogsDeleteIn }));

const unitsDeleteEq = vi.fn(() => Promise.resolve({ error: null }));
const unitsDelete = vi.fn(() => ({ eq: unitsDeleteEq }));

let sheetsDeleteError: { message: string } | null = null;
const sheetsDeleteEq = vi.fn(() => Promise.resolve({ error: sheetsDeleteError }));
const sheetsDelete = vi.fn(() => ({ eq: sheetsDeleteEq }));

const sheetVectorsDeleteEq = vi.fn(() => Promise.resolve({ error: null }));
const sheetVectorsDelete = vi.fn(() => ({ eq: sheetVectorsDeleteEq }));

const from = vi.fn((table: string) => {
  switch (table) {
    case 'activities': return { insert: activitiesInsert, delete: activitiesDelete };
    case 'status_logs': return { delete: statusLogsDelete };
    case 'units': return { delete: unitsDelete };
    case 'sheets': return { delete: sheetsDelete };
    case 'sheet_vectors': return { delete: sheetVectorsDelete };
    default: return {};
  }
});

// storage.from('floorplans').list()/remove() — default: no tile files (skip the
// tile-cleanup block); overridable per-test.
const storageList = vi.fn(() => Promise.resolve({ data: [] as Array<{ name: string }> }));
const storageRemove = vi.fn(() => Promise.resolve({ data: [], error: null }));
const storageFrom = vi.fn((_bucket: string) => ({ list: storageList, remove: storageRemove }));

const getSession = vi.fn();

vi.mock('@/supabaseClient', () => ({
  supabase: {
    auth: { getSession: () => getSession() },
    from: (table: string) => from(table),
    storage: { from: (bucket: string) => storageFrom(bucket) },
  },
}));

// ── The three symbols useProjectActions pulls from the god-file (barrel-preserving
// split keeps these paths working; mock them at the boundary so this test is
// isolated from the god-file's internals). ──
const updateActivityMutateAsync = vi.fn();
const reorderSheetsMutateAsync = vi.fn();
let fetchAllInResult: Array<{ id: string }> = [];
const fetchAllIn = vi.fn(() => Promise.resolve(fetchAllInResult));
vi.mock('@/hooks/useProjectQueries', () => ({
  useUpdateActivity: () => ({ mutateAsync: updateActivityMutateAsync }),
  useReorderSheets: () => ({ mutateAsync: reorderSheetsMutateAsync }),
  fetchAllIn: (...args: unknown[]) => fetchAllIn(...(args as [])),
}));

const deleteSheetStorageService = vi.fn(() => Promise.resolve());
const uploadFloorplanService = vi.fn(() => Promise.resolve());
const attachOriginalService = vi.fn(() => Promise.resolve());
vi.mock('@/services/api', () => ({
  deleteSheetStorageService: (...a: unknown[]) => deleteSheetStorageService(...(a as [])),
  uploadFloorplanService: (...a: unknown[]) => uploadFloorplanService(...(a as [])),
  attachOriginalService: (...a: unknown[]) => attachOriginalService(...(a as [])),
}));

const invalidatePdfBytes = vi.fn();
vi.mock('@/utils/pdfByteCache', () => ({
  invalidatePdfBytes: (...a: unknown[]) => invalidatePdfBytes(...(a as [])),
}));

import { useProjectActions } from './useProjectActions';

const project = { id: 'proj-1' } as unknown as Project;

/**
 * Build a QueryClient + wrapper + an invalidateQueries spy. Optionally seed the
 * cache (handleAddActivity reads the activities cache to compute sequence_order).
 */
function makeCtx(seed?: (client: QueryClient) => void) {
  const client = makeTestQueryClient();
  seed?.(client);
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidateSpy, wrapper };
}

beforeEach(() => {
  activitiesInsert.mockClear();
  activitiesInsertSelect.mockReset().mockResolvedValue({ data: [{ id: 'act-new' }], error: null });
  activitiesDelete.mockClear();
  activitiesDeleteEq.mockReset().mockResolvedValue({ error: null });
  statusLogsDelete.mockClear();
  statusLogsDeleteIn.mockClear();
  statusLogsDeleteInChunks = [];
  statusLogsDeleteError = null;
  unitsDelete.mockClear();
  unitsDeleteEq.mockClear();
  sheetsDelete.mockClear();
  sheetsDeleteEq.mockClear();
  sheetsDeleteError = null;
  sheetVectorsDelete.mockClear();
  from.mockClear();
  storageList.mockClear().mockResolvedValue({ data: [] });
  storageRemove.mockClear();
  storageFrom.mockClear();
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok' } } });
  updateActivityMutateAsync.mockReset().mockResolvedValue(undefined);
  reorderSheetsMutateAsync.mockReset().mockResolvedValue(undefined);
  fetchAllIn.mockClear();
  fetchAllInResult = [];
  deleteSheetStorageService.mockReset().mockResolvedValue(undefined);
  invalidatePdfBytes.mockClear();

  // Real Zustand singletons — reset the slices this hook reads so nothing bleeds.
  // enableToasts:false keeps success/info toasts a no-op; errors/warnings still
  // surface even when toasts are off (post-W3 fix — see the rename-failure test).
  useMapStore.setState({ activeSheetId: '', selectedFile: null, isUploading: false, pdfPageNumber: 1 });
  useUIStore.setState({ newLevelName: '', isModalOpen: false, toast: null });
  useSettingsStore.setState({ settings: { enableToasts: false } as never });
});

// ── Activity CRUD ────────────────────────────────────────────────────────────
describe('useProjectActions — handleAddActivity', () => {
  const activitiesSeed = [
    { id: 'a1', track: 'Production', sequence_order: 0 },
    { id: 'a2', track: 'Production', sequence_order: 1 },
    { id: 'a3', track: 'Inspection', sequence_order: 0 },
  ] as unknown as Activity[];

  it('inserts with the next sequence_order for the track and invalidates the activities cache', async () => {
    const { invalidateSpy, wrapper } = makeCtx(c =>
      c.setQueryData(queryKeys.activities('proj-1'), activitiesSeed));
    const { result } = renderHook(() => useProjectActions(project, [], 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleAddActivity('Framing', '#ffffff', 'Production');
    });

    expect(activitiesInsert).toHaveBeenCalledTimes(1);
    const [rows] = activitiesInsert.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(rows).toHaveLength(1);
    // maxOrder for 'Production' is 1 → the new activity lands at 2 (the Inspection
    // track's order-0 is correctly ignored).
    expect(rows[0]).toMatchObject({
      project_id: 'proj-1',
      name: 'Framing',
      color: '#ffffff',
      track: 'Production',
      sequence_order: 2,
      dictionary_id: null,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.activities('proj-1') });
  });

  it('passes a dictionary_id through when linking to the governed dictionary', async () => {
    const { wrapper } = makeCtx(c => c.setQueryData(queryKeys.activities('proj-1'), []));
    const { result } = renderHook(() => useProjectActions(project, [], 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleAddActivity('Framing', '#fff', 'Production', 'dict-9');
    });

    const [rows] = activitiesInsert.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(rows[0].dictionary_id).toBe('dict-9');
    // First activity on an empty track starts at sequence_order 0.
    expect(rows[0].sequence_order).toBe(0);
  });

  it('early-returns on a blank name (no insert, no invalidation)', async () => {
    const { invalidateSpy, wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, [], 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleAddActivity('   ', '#fff', 'Production');
    });

    expect(activitiesInsert).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useProjectActions — handleUpdateActivity', () => {
  it('delegates to the useUpdateActivity mutation with the id/name/color payload', async () => {
    const { wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, [], 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleUpdateActivity('act-1', 'Old', 'New', '#123456');
    });

    expect(updateActivityMutateAsync).toHaveBeenCalledWith({
      id: 'act-1', oldName: 'Old', newName: 'New', newColor: '#123456',
    });
  });

  it('swallows a mutation failure, surfacing it via an error toast even when toasts are OFF (never throws)', async () => {
    updateActivityMutateAsync.mockRejectedValueOnce(new Error('rename denied'));
    const { wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, [], 'proj-1'), { wrapper });

    // The handler must resolve (not reject) — a thrown error would break the caller.
    await act(async () => {
      await expect(
        result.current.handleUpdateActivity('act-1', 'Old', 'New', '#123456'),
      ).resolves.toBeUndefined();
    });
    expect(updateActivityMutateAsync).toHaveBeenCalledTimes(1);
    // Post-W3 fix: the failure is NOT silent even though beforeEach set enableToasts:false.
    const toast = useUIStore.getState().toast;
    expect(toast?.type).toBe('error');
    expect(toast?.message).toContain('Failed to update activity');
  });
});

describe('useProjectActions — handleDeleteActivity', () => {
  it('deletes the activity row and invalidates activities + statuses + dependencies', async () => {
    const { invalidateSpy, wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, [], 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleDeleteActivity('act-7');
    });

    expect(activitiesDelete).toHaveBeenCalledTimes(1);
    expect(activitiesDeleteEq).toHaveBeenCalledWith('id', 'act-7');
    // The FK-cascade refresh contract: the activity's status_logs cascade-delete and
    // its FS dependency edges cascade-delete, so all three caches must refresh.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.activities('proj-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.statusesAll() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.activityDependencies('proj-1') });
  });

  it('does not invalidate when the delete errors (surfaces the failure instead)', async () => {
    activitiesDeleteEq.mockResolvedValueOnce({ error: { message: 'delete denied' } });
    const { invalidateSpy, wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, [], 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleDeleteActivity('act-7');
    });

    // The throw lands in the catch before any invalidation — no "pretend success".
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

// ── handleDeleteSheet cascade — the highest-value characterization ────────────
describe('useProjectActions — handleDeleteSheet cascade', () => {
  const threeSheets = [{ id: 's1' }, { id: 's2' }, { id: 's3' }] as unknown as Sheet[];

  it('runs the cascade in order: storage → paginated units read → chunked status_logs delete → units delete → sheets delete → invalidate', async () => {
    // 450 units → the status_logs delete must chunk at 200 (200/200/50). Anything
    // larger than one .in(...) would 414; a single unchunked read/delete is the
    // 1000-row-cap bug this path fixed.
    fetchAllInResult = Array.from({ length: 450 }, (_, i) => ({ id: `u${i}` }));
    useMapStore.setState({ activeSheetId: 's1' }); // deleting s2 (not active) → no reassignment
    const { invalidateSpy, wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, threeSheets, 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleDeleteSheet('s2');
    });

    // Storage cleanup ran through the backend service (client .remove() is RLS-denied).
    expect(deleteSheetStorageService).toHaveBeenCalledWith('s2', 'tok');
    expect(invalidatePdfBytes).toHaveBeenCalledWith('s2');

    // Units were read via the paginated helper (never a bare select).
    expect(fetchAllIn).toHaveBeenCalledWith('units', 'sheet_id', ['s2'], 'id');

    // status_logs deleted in ≤200-id chunks covering all 450 units, nothing dropped.
    expect(statusLogsDeleteInChunks.map(c => c.length)).toEqual([200, 200, 50]);
    expect(new Set(statusLogsDeleteInChunks.flat()).size).toBe(450);
    // Units are keyed to the sheet → one filtered delete, no id list.
    expect(unitsDelete).toHaveBeenCalledTimes(1);
    expect(unitsDeleteEq).toHaveBeenCalledWith('sheet_id', 's2');
    // Then the sheet row itself, then the cache refresh.
    expect(sheetsDeleteEq).toHaveBeenCalledWith('id', 's2');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.sheets('proj-1') });

    // s2 wasn't the active sheet → the active sheet is left untouched.
    expect(useMapStore.getState().activeSheetId).toBe('s1');
  });

  it('skips the unit/status deletes when the sheet has no units', async () => {
    fetchAllInResult = [];
    const { wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, threeSheets, 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleDeleteSheet('s2');
    });

    expect(statusLogsDelete).not.toHaveBeenCalled();
    expect(unitsDelete).not.toHaveBeenCalled();
    // The sheet row is still deleted.
    expect(sheetsDeleteEq).toHaveBeenCalledWith('id', 's2');
  });

  it('reassigns the active sheet to the first survivor when the ACTIVE sheet is deleted', async () => {
    useMapStore.setState({ activeSheetId: 's2' });
    const { wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, threeSheets, 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleDeleteSheet('s2');
    });

    // Survivors are [s1, s3] → active moves to s1.
    expect(useMapStore.getState().activeSheetId).toBe('s1');
  });

  it('clears the active sheet to empty when the last sheet is deleted', async () => {
    useMapStore.setState({ activeSheetId: 's1' });
    const oneSheet = [{ id: 's1' }] as unknown as Sheet[];
    const { wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, oneSheet, 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleDeleteSheet('s1');
    });

    expect(useMapStore.getState().activeSheetId).toBe('');
  });

  it('a status_logs delete error aborts the cascade before the sheet is deleted (never pretends success)', async () => {
    fetchAllInResult = [{ id: 'u0' }];
    statusLogsDeleteError = { message: 'log delete denied' };
    useMapStore.setState({ activeSheetId: 's2' });
    const { invalidateSpy, wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, threeSheets, 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleDeleteSheet('s2');
    });

    // The throw lands in the catch BEFORE the sheets delete + invalidation + the
    // active-sheet reassignment — so a failed cleanup can't destroy the sheet row
    // or silently drop the user on a phantom active sheet.
    expect(unitsDelete).not.toHaveBeenCalled();
    expect(sheetsDelete).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(useMapStore.getState().activeSheetId).toBe('s2'); // untouched
  });

  it('storage cleanup failure is non-fatal — the row cascade still completes', async () => {
    deleteSheetStorageService.mockRejectedValueOnce(new Error('storage 500'));
    fetchAllInResult = [];
    const { invalidateSpy, wrapper } = makeCtx();
    const { result } = renderHook(() => useProjectActions(project, threeSheets, 'proj-1'), { wrapper });

    await act(async () => {
      await result.current.handleDeleteSheet('s2');
    });

    // A storage hiccup re-orphans blobs (recoverable) but must NOT block the delete.
    expect(sheetsDeleteEq).toHaveBeenCalledWith('id', 's2');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.sheets('proj-1') });
  });
});
