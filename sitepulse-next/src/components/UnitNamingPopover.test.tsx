import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithQuery';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import type { PercentPoint, Project } from '@/types/domain';
import { useMapActions } from '@/hooks/useMapActions';
import UnitNamingPopover from './UnitNamingPopover';

// ─────────────────────────────────────────────────────────────────────────────
// Wiring / regression tests for the PROJECT-MAP draw → name → save flow (Codebase
// Health Slice 0, Phase 0.3). One altitude ABOVE the Phase 0.2 contract tests: 0.2
// proved `handlePolygonComplete` sets the store value in isolation — here we pin the
// RETURN SURFACE the popover destructures and drive the real popover end-to-end.
// Two pins:
//   • the 2026-06-29 "freshly-traced room had nothing to save" bug — `useMapActions`
//     must expose BOTH `pendingPolygonPoints` AND a working `setPendingPolygonPoints`
//     on its return (a consumer destructures both; dropping the setter is the regression);
//   • the draw → name → save seam — finishing a trace opens `UnitNamingPopover`, and a
//     real "type a name → Save location" gesture routes the traced polygon + name into
//     the `units` insert (`useCreateUnit`).
//
// jsdom has NO real canvas, so the trace is simulated by calling `handlePolygonComplete`
// directly (we test handler wiring + the write payload, not Konva pixels — that gap is
// Phase 0.5's optional Playwright job). Peripheral naming hooks are mocked to empty and
// `recordTraceEvent` is stubbed, so the ONLY data-layer interaction is the unit insert.
// Test-layer only — no product code changes.
// ─────────────────────────────────────────────────────────────────────────────

// Chainable `from('units').insert([row]).select().single()` stub — the create path.
const single = vi.fn();
const select = vi.fn(() => ({ single }));
const insert = vi.fn((_rows: unknown) => ({ select }));
const from = vi.fn((_table: string) => ({ insert }));
const getSession = vi.fn();

vi.mock('@/supabaseClient', () => ({
  supabase: {
    auth: { getSession: () => getSession() },
    from: (table: string) => from(table),
  },
}));

// Stub the best-effort corpus log so a successful save never touches Supabase; keep the
// rest of traceCapture real (pure snapshot/derivation helpers).
vi.mock('@/utils/traceCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/traceCapture')>();
  return { ...actual, recordTraceEvent: vi.fn().mockResolvedValue(undefined) };
});

// Peripheral naming hooks → empty, so no suggestion is built and the only write we
// observe is the unit insert (mirror the Phase 0.2 useMapActions mocking style).
vi.mock('@/hooks/useSubtypes', () => ({
  useSubtypes: () => ({ data: [] }),
  useProposePendingSubtype: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/hooks/useSheetText', () => ({ useSheetText: () => ({ words: [] }) }));
vi.mock('@/hooks/useNamingVocabulary', () => ({
  useNamingVocabulary: () => ({ vocabulary: { nameTokenCounts: {}, nameToSubtype: {} } }),
}));

const project = { id: 'proj-1' } as unknown as Project;

const POINTS: PercentPoint[] = [
  { pctX: 0.1, pctY: 0.1 },
  { pctX: 0.4, pctY: 0.1 },
  { pctX: 0.4, pctY: 0.4 },
];

function wrapper({ children }: { children: ReactNode }) {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// A minimal stand-in for the page.jsx wiring: mount useMapActions and render the real
// popover with the hook's returned props (the same members page.jsx destructures).
function MapNamingHarness({ project: proj }: { project: Project }) {
  const m = useMapActions(proj);
  return (
    <div>
      <button type="button" data-testid="finish-trace" onClick={() => m.handlePolygonComplete(POINTS)}>
        finish trace
      </button>
      {m.unitNamingOpen && (
        <UnitNamingPopover
          editingUnitId={m.editingUnitId}
          newUnitName={m.newUnitName}
          setNewUnitName={m.setNewUnitName}
          subtypes={[]}
          projectType={null}
          // Peripheral naming hooks are mocked empty → no suggestion, so suggestedPick
          // is always null here (the .jsx popover's inferred prop type is null-only).
          initialPick={null}
          isSuggested={m.isSuggested}
          recentSubtypeIds={[]}
          saveNewUnitFromPopover={m.saveNewUnitFromPopover}
          cancelUnitNaming={m.cancelUnitNaming}
        />
      )}
    </div>
  );
}

beforeEach(() => {
  insert.mockClear();
  select.mockClear();
  from.mockClear();
  single.mockReset().mockResolvedValue({ data: { id: 'u-new', unit_number: 'Kitchen' }, error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'user-1' } } } });
  useMapStore.setState({
    pendingPolygonPoints: null,
    editingUnitId: null,
    savingUnitId: null,
    mapLabelSuggestion: null,
    activeSheetId: 's1',
  });
  useUIStore.setState({ unitNamingOpen: false, newUnitName: '' });
});

afterEach(cleanup);

describe('useMapActions return surface — the dropped-setter regression', () => {
  it('exposes pendingPolygonPoints AND a working setPendingPolygonPoints (the popover destructures both)', () => {
    const { result } = renderHook(() => useMapActions(project), { wrapper });

    // Both members must ride the return object — the 2026-06-29 bug was the setter
    // going missing, which left the naming popover with nothing to save.
    expect(result.current).toHaveProperty('pendingPolygonPoints');
    expect(typeof result.current.setPendingPolygonPoints).toBe('function');

    // And the returned setter is the LIVE store setter (not a dead stub): calling it
    // updates the returned value a consumer reads.
    act(() => {
      result.current.setPendingPolygonPoints(POINTS);
    });
    expect(result.current.pendingPolygonPoints).toEqual(POINTS);
  });
});

describe('draw → name → save seam (project map)', () => {
  it('routes the traced polygon + typed name into the units insert', async () => {
    render(<MapNamingHarness project={project} />, { wrapper });

    // 1. Finish a trace → the naming popover opens.
    fireEvent.click(screen.getByTestId('finish-trace'));
    const input = screen.getByPlaceholderText('e.g. 1204');

    // 2. Type a name and hit Save location (the real popover gesture).
    fireEvent.change(input, { target: { value: 'Kitchen' } });
    fireEvent.click(screen.getByText('Save location'));

    // 3. The create write fires carrying the drawn geometry + name (the whole seam).
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(from).toHaveBeenCalledWith('units');
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0].unit_number).toBe('Kitchen');
    expect(rows[0].polygon_coordinates).toEqual(POINTS);
    expect(rows[0].sheet_id).toBe('s1');
  });
});
