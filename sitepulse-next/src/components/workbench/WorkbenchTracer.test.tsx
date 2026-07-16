import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { renderWithQuery } from '@/test/renderWithQuery';
import { useWorkbenchStore } from '@/store/useWorkbenchStore';
import { useMapStore } from '@/store/useMapStore';
import type { OpeningEdge, PercentPoint, WorkbenchDrawing } from '@/types/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Wiring / regression tests for the WORKBENCH tracer (Codebase Health Slice 0,
// Phase 0.3). One altitude ABOVE the Phase 0.2 hook contract tests: 0.2 proved
// `useUpdateWorkbenchGeometry` writes the new points in isolation — here we prove
// the COMPONENT actually hands that handler down and that a simulated canvas gesture
// reaches it. Two pins:
//   • the 2026-06-29 "node move snapped back to a square" bug — `WorkbenchTracer`
//     must pass a DEFINED `onUpdateUnitPolygon` into `<FloorplanCanvas>`, and firing
//     it must call the geometry mutation with the moved points (a missing/undefined
//     prop was the bug — node drags never persisted);
//   • the draw → name → save seam — a finished trace opens the naming popover and
//     hitting Save routes the traced polygon + name + type into `useCreateWorkbenchLabel`.
//
// jsdom has NO real canvas, so `FloorplanCanvas` is stubbed to CAPTURE the props the
// parent wires down (we test the parent's wiring + args, not Konva pixels — that gap
// is Phase 0.5's optional Playwright job). The naming popover is likewise stubbed to a
// prop-capture so we can invoke its `onSave` like a user hitting Save. The data hooks
// are mocked to empty/fake so the tracer renders without a DB. Test-layer only — no
// product code changes.
// ─────────────────────────────────────────────────────────────────────────────

// Shared, hoisted holders so the (hoisted) vi.mock factories can reference them.
const mocks = vi.hoisted(() => ({
  canvasProps: { value: null as Record<string, unknown> | null },
  popoverProps: { value: null as Record<string, unknown> | null },
  geometryMutate: vi.fn(),
  createLabelAsync: vi.fn(),
}));

// Benign Supabase stub — the real util imports (traceCapture, etc.) load it at
// module init; no query runs here (every data hook is mocked below).
vi.mock('@/supabaseClient', () => ({
  supabase: {
    from: () => ({}),
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));

// Stub the Konva canvas: capture the props `WorkbenchTracer` passes down.
vi.mock('@/components/FloorplanCanvas', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mocks.canvasProps.value = props;
    return null;
  },
}));

// Stub the naming popover: capture its props so a test can drive `onSave` (the
// popover owns the name + type; the tracer owns the write).
vi.mock('./WorkbenchLabelPopover', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mocks.popoverProps.value = props;
    return null;
  },
}));

// The always-rendered toolbar + the conditionally-rendered panels are not under
// test — stub them to keep the render surface tiny and deterministic.
vi.mock('./WorkbenchTracerToolbar', () => ({ __esModule: true, default: () => null }));
vi.mock('./TitleBlockPopover', () => ({ __esModule: true, default: () => null }));
vi.mock('./GridlinePanel', () => ({ __esModule: true, default: () => null }));
vi.mock('./OpeningModePanel', () => ({ __esModule: true, default: () => null }));

// Peripheral data hooks — empty/fake so no DB is touched. The two WRITE hooks the
// tests observe expose the shared hoisted spies.
vi.mock('@/hooks/useSubtypes', () => ({ useSubtypes: () => ({ data: [] }) }));
vi.mock('@/hooks/useSheetText', () => ({ useSheetText: () => ({ words: [] }) }));
vi.mock('@/hooks/useNamingVocabulary', () => ({
  useNamingVocabulary: () => ({ vocabulary: { nameTokenCounts: {}, nameToSubtype: {} } }),
}));
vi.mock('@/hooks/useSheetMetadata', () => ({
  useSheetMetadata: () => ({ metadata: null }),
  useUpsertSheetMetadata: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));
vi.mock('@/hooks/useSheetGridlines', () => ({
  useSheetGridlines: () => ({ gridlines: null }),
  useUpsertSheetGridlines: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));
vi.mock('@/hooks/useProjectQueries', () => ({
  useUnits: () => ({ data: [] }),
  useDeleteUnit: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useSnappingVectors', () => ({
  useSnappingVectors: () => ({ isFetching: false }),
}));
vi.mock('@/hooks/useWorkbenchActions', () => ({
  useCreateWorkbenchLabel: () => ({ mutateAsync: mocks.createLabelAsync, isPending: false, error: null }),
  useUpdateWorkbenchLabel: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateWorkbenchOpeningEdges: () => ({ mutate: vi.fn() }),
  useUpdateWorkbenchGeometry: () => ({ mutate: mocks.geometryMutate }),
}));

import WorkbenchTracer from './WorkbenchTracer';

const DRAWING = {
  id: 'wb-sheet-1',
  base_image_url: 'http://example.test/plan.png',
  pdf_version: 1,
  workbench: { sheet_project_type: null },
} as unknown as WorkbenchDrawing;

const POINTS: PercentPoint[] = [
  { pctX: 0.1, pctY: 0.1 },
  { pctX: 0.5, pctY: 0.1 },
  { pctX: 0.5, pctY: 0.5 },
];

beforeEach(() => {
  mocks.canvasProps.value = null;
  mocks.popoverProps.value = null;
  mocks.geometryMutate.mockReset();
  mocks.createLabelAsync.mockReset().mockResolvedValue({ id: 'u-new' });
  // Reset the shared Zustand singletons so no half-finished trace bleeds between tests.
  useWorkbenchStore.setState({
    pendingLabelPoints: null,
    isLabelNamingOpen: false,
    labelDraftName: '',
    editingLabelId: null,
    labelSuggestion: null,
    pendingOpeningEdges: [],
  });
  useMapStore.setState({ toolMode: 'pan', selectedUnitIds: [], activeSheetId: '' });
});

afterEach(cleanup);

describe('WorkbenchTracer — node-move persistence (the 2026-06-29 unwired-save bug)', () => {
  it('passes a DEFINED onUpdateUnitPolygon into the canvas', () => {
    renderWithQuery(<WorkbenchTracer drawing={DRAWING} />);
    const props = mocks.canvasProps.value;
    expect(props).not.toBeNull();
    // The bug: this prop was missing/undefined, so canvas node drags never reached a
    // write and the polygon reverted to its saved shape on the next refetch.
    expect(typeof props!.onUpdateUnitPolygon).toBe('function');
  });

  it('routes a canvas node move to the geometry mutation with the moved points', () => {
    renderWithQuery(<WorkbenchTracer drawing={DRAWING} />);
    const onUpdateUnitPolygon = mocks.canvasProps.value!.onUpdateUnitPolygon as (
      unitId: string,
      points: PercentPoint[],
    ) => void;

    act(() => {
      onUpdateUnitPolygon('u1', POINTS);
    });

    expect(mocks.geometryMutate).toHaveBeenCalledTimes(1);
    expect(mocks.geometryMutate).toHaveBeenCalledWith({ unitId: 'u1', points: POINTS });
  });
});

describe('WorkbenchTracer — draw → name → save seam', () => {
  it('carries the traced polygon + name + type into useCreateWorkbenchLabel', async () => {
    renderWithQuery(<WorkbenchTracer drawing={DRAWING} />);
    const onPolygonComplete = mocks.canvasProps.value!.onPolygonComplete as (
      points: PercentPoint[],
      openingEdges?: OpeningEdge[],
    ) => void;

    // 1. Finish a trace on the canvas → the naming popover opens holding the polygon.
    act(() => {
      onPolygonComplete(POINTS);
    });
    expect(useWorkbenchStore.getState().isLabelNamingOpen).toBe(true);
    expect(mocks.popoverProps.value).not.toBeNull();

    // 2. Type a name (empty sheet text → no suggestion → blank draft; the popover owns it).
    act(() => {
      useWorkbenchStore.getState().setLabelDraftName('Kitchen');
    });

    // 3. Hit Save with a chosen type — the popover hands its meta back to the tracer.
    const meta = {
      pick: { kind: 'subtype', subtypeId: 'sub-1', name: 'Office' },
      spansLevels: false,
      levelNote: '',
      hasVoid: false,
    };
    const onSave = mocks.popoverProps.value!.onSave as (m: typeof meta) => Promise<void>;
    await act(async () => {
      await onSave(meta);
    });

    // The write fires with the drawn geometry + typed name + picked type — the whole seam.
    expect(mocks.createLabelAsync).toHaveBeenCalledTimes(1);
    const arg = mocks.createLabelAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.name).toBe('Kitchen');
    expect(arg.points).toEqual(POINTS);
    expect(arg.pick).toEqual(meta.pick);
  });
});
