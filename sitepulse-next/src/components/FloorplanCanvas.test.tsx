import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/renderWithQuery';
import { useMapStore } from '@/store/useMapStore';
import {
  flipPolygon,
  rotatePolygon,
  buildStampPolygon,
  IDENTITY_STAMP_TRANSFORM,
} from '@/utils/stampTransform';
import type { PercentPoint, Unit } from '@/types/domain';

// ─────────────────────────────────────────────────────────────────────────────
// FloorplanCanvas characterization tests — the "golden master" (Codebase Health
// Slice 0, Phase 0.4). This is the tripwire that must stay green before Slice 2
// decomposes the 2,700-line canvas.
//
// For EVERY interactive gesture that persists geometry, we pin TWO things exactly
// as the code behaves TODAY: (1) WHICH write callback fires, and (2) WITH WHAT
// arguments (the transformed points). These are NOT correctness claims — they
// freeze current behavior so the decomposition can't silently change what a
// gesture saves. The transform math is asserted by exercising the REAL shared
// helpers (flipPolygon / rotatePolygon / buildStampPolygon), never a fork.
//
// jsdom has NO real canvas, so these assert HANDLER WIRING + TRANSFORM ARGS, not
// pixel output (that gap is Phase 0.5's optional Playwright job). The mechanism:
//   • react-konva is stubbed to pass-through host components so the tree mounts
//     without a real Konva Stage, and the <Stage> stub captures its event props
//     (onClick / onPointerDown / onPointerUp) so canvas gestures can be driven;
//   • the child components that RECEIVE the gesture handlers (MappedUnit,
//     ContextActionDock, PendingPolygon) are stubbed to CAPTURE their props, so a
//     test can invoke `handleAnchorDragEnd` / `handleFlip` / … directly with a
//     minimal synthetic Konva event (mirrors the 0.3 WorkbenchTracer prop-capture);
//   • the container is given a non-zero size so `layout` (drawW/drawH) is real —
//     with a 1000×800 box and a 1000×1000 base image the draw area is 800×800 at
//     offset (100, 0), which the pixel↔percent helpers below assume.
// Test-layer only — no product code changes.
// ─────────────────────────────────────────────────────────────────────────────

// Shared, hoisted holders so the (hoisted) vi.mock factories can reference them.
const H = vi.hoisted(() => ({
  stage: { value: null as Record<string, unknown> | null },
  dock: { value: null as Record<string, unknown> | null },
  pending: { value: null as Record<string, unknown> | null },
  mapped: { value: {} as Record<string, Record<string, unknown>> },
  units: { value: [] as Unit[] },
}));

// Benign Supabase stub — util imports load it at module init; no query runs (all
// data hooks are mocked below).
vi.mock('@/supabaseClient', () => ({
  supabase: {
    from: () => ({}),
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));

// Stub react-konva to plain pass-through host components (React 19: `ref` is just a
// prop, so no forwardRef needed). The Stage stub captures its props so the tests can
// fire its onClick / onPointerDown / onPointerUp with synthetic Konva events.
vi.mock('react-konva', () => {
  const passthrough = () => (props: Record<string, unknown>) =>
    (props.children as React.ReactNode) ?? null;
  const Stage = (props: Record<string, unknown>) => {
    H.stage.value = props;
    return (props.children as React.ReactNode) ?? null;
  };
  return {
    __esModule: true,
    Stage,
    Layer: passthrough(),
    Group: passthrough(),
    Rect: passthrough(),
    Line: passthrough(),
    Circle: passthrough(),
    Text: passthrough(),
    Image: passthrough(),
    Path: passthrough(),
    Label: passthrough(),
    Tag: passthrough(),
    Arrow: passthrough(),
    Shape: passthrough(),
  };
});

// `import Konva from 'konva'` — the component writes `Konva.pixelRatio`; a plain
// object is enough (react-konva is stubbed, so nothing else touches it).
vi.mock('konva', () => ({ __esModule: true, default: { pixelRatio: 1 } }));

// use-image never loads in jsdom; return no image so the raster-dimensions effect
// no-ops and originalWidth/Height keep their 1000×1000 defaults.
vi.mock('use-image', () => ({ __esModule: true, default: () => [undefined] }));

// Route params (projectId) — the component reads `params?.projectId`.
vi.mock('next/navigation', () => ({ useParams: () => ({ projectId: 'proj-1' }) }));

// ── Child components that receive the gesture handlers: capture their props ──
vi.mock('@/components/canvas/MappedUnit', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const unit = props.unit as { id: string };
    H.mapped.value[unit.id] = props;
    return null;
  },
}));
vi.mock('@/components/canvas/ContextActionDock', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    H.dock.value = props;
    return null;
  },
}));
vi.mock('@/components/canvas/PendingPolygon', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    H.pending.value = props;
    return null;
  },
}));

// ── The rest of the canvas chrome is not under test: stub to keep the render
//    surface tiny + deterministic (they'd otherwise render Konva children). The
//    factory literal is inlined per mock because vi.mock is hoisted above any
//    top-level const it might reference. ──
vi.mock('@/components/canvas/ZoomIndicator', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/ViewportControls', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/CanvasContextMenu', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/DraftPolygon', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/MeasureReadout', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/StampPreview', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/StampDrawer', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/CaptureBoxOverlay', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/CaptureLineOverlay', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/GridlineOverlay', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/OpeningEdgeOverlay', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/MapLegend', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/CrosshairOverlay', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/LoupeOverlay', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/MiniMapOverlay', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/WalkRouteOverlay', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/HoverHistoryTooltip', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/canvas/PdfBaseLayer', () => ({
  __esModule: true,
  PdfBaseLayer: () => null,
}));

// ── Data + worker hooks: empty/fake so no DB, worker, or network is touched. ──
vi.mock('@/hooks/useProjectQueries', () => ({
  useUnits: () => ({ data: H.units.value, isLoading: false }),
  useActivities: () => ({ data: [] }),
  useUpdateWalkSequence: () => ({ mutateAsync: vi.fn() }),
  useSheetById: () => ({ data: null }),
  useUpdateSheetScale: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useActivityDependencies', () => ({
  useActivityDependencies: () => ({ data: [] }),
}));
vi.mock('@/hooks/useSnappingVectors', () => ({
  useSnappingVectors: () => ({ vectors: [] }),
}));
vi.mock('@/hooks/useLoupeRenderer', () => ({
  useLoupeRenderer: () => ({ patch: null, requestPatch: vi.fn() }),
}));

import FloorplanCanvas from '@/components/FloorplanCanvas';

// ── jsdom shims the component needs at mount ──
// A non-zero container size drives `layout`; matchMedia backs the HiDPI effect.
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1000 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 800 });
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// ── Geometry fixtures + the pixel↔percent mapping the real layout produces ──
// layout with a 1000×800 box over a 1000×1000 image: scale 0.8 → drawW=drawH=800,
// offsetX=(1000-800)/2=100, offsetY=(800-800)/2=0.
const OFFSET_X = 100;
const OFFSET_Y = 0;
const DRAW = 800;
const px = (pctX: number) => OFFSET_X + pctX * DRAW;
const py = (pctY: number) => OFFSET_Y + pctY * DRAW;

const SHEET_ID = 'sheet-1';
const UNIT_ID = 'unit-1';
// A 0.4×0.4 axis-aligned square, comfortably inside the visible box.
const SQUARE: PercentPoint[] = [
  { pctX: 0.2, pctY: 0.2 },
  { pctX: 0.6, pctY: 0.2 },
  { pctX: 0.6, pctY: 0.6 },
  { pctX: 0.2, pctY: 0.6 },
];
const TRIANGLE: PercentPoint[] = [
  { pctX: 0.2, pctY: 0.2 },
  { pctX: 0.6, pctY: 0.2 },
  { pctX: 0.4, pctY: 0.6 },
];

function makeUnit(id: string, coords: PercentPoint[]): Unit {
  return {
    id,
    polygon_coordinates: coords,
    unit_number: `R-${id}`,
    subtype_id: null,
    unit_type: 'Room',
  } as unknown as Unit;
}

// The four write-callback spies, typed so `.mock.calls` stays checked.
const onUpdateUnitPolygon = vi.fn<(unitId: string, points: PercentPoint[]) => void>();
const onPolygonComplete = vi.fn<(points: PercentPoint[], openingEdges?: unknown) => void>();
const onInstantStamp = vi.fn<(unitId: string, points: PercentPoint[]) => void>();
const onPendingPolygonMove = vi.fn<(points: PercentPoint[]) => void>();

interface CanvasOverrides {
  pendingPolygonPoints?: PercentPoint[] | null;
}

function renderCanvas(overrides: CanvasOverrides = {}) {
  return renderWithQuery(
    <FloorplanCanvas
      activeStatuses={[]}
      rawStatuses={[]}
      imageUrl=""
      onPolygonComplete={onPolygonComplete}
      onUpdateUnitPolygon={onUpdateUnitPolygon}
      onInstantStamp={onInstantStamp}
      onPendingPolygonMove={onPendingPolygonMove}
      pendingPolygonPoints={overrides.pendingPolygonPoints}
    />,
  );
}

// Minimal synthetic Konva stage/event shapes for the handlers we drive.
interface StageLike {
  getPointerPosition: () => { x: number; y: number };
  x: () => number;
  y: () => number;
  scaleX: () => number;
}
function stageAt(x: number, y: number): StageLike {
  return { getPointerPosition: () => ({ x, y }), x: () => 0, y: () => 0, scaleX: () => 1 };
}

/** Read a captured handler off the (default-null) MappedUnit props for a unit. */
function mappedHandler<T>(unitId: string, key: string): T {
  const props = H.mapped.value[unitId];
  if (!props) throw new Error(`MappedUnit for ${unitId} did not render`);
  return props[key] as T;
}
function dockHandler<T>(key: string): T {
  if (!H.dock.value) throw new Error('ContextActionDock did not render');
  return H.dock.value[key] as T;
}

beforeEach(() => {
  onUpdateUnitPolygon.mockReset();
  onPolygonComplete.mockReset();
  onInstantStamp.mockReset();
  onPendingPolygonMove.mockReset();
  H.stage.value = null;
  H.dock.value = null;
  H.pending.value = null;
  H.mapped.value = {};
  H.units.value = [makeUnit(UNIT_ID, SQUARE)];
  // Reset the shared Zustand singleton to a known, deterministic tool/selection.
  useMapStore.setState({
    toolMode: 'pan',
    selectedUnitIds: [],
    activeSheetId: SHEET_ID,
    pendingPolygonPoints: null,
    armedStamp: null,
    stampTransform: IDENTITY_STAMP_TRANSFORM,
    trackingMode: 'Production',
  });
});

afterEach(cleanup);

// ═════════════════════════════════════════════════════════════════════════════
// onUpdateUnitPolygon — the single geometry-persist callback for saved rooms.
// ═════════════════════════════════════════════════════════════════════════════
describe('FloorplanCanvas — onUpdateUnitPolygon (saved-room geometry writes)', () => {
  it(':node-move replaces the dragged vertex with the snapped point', () => {
    renderCanvas();
    act(() => useMapStore.setState({ toolMode: 'select', selectedUnitIds: [UNIT_ID] }));
    const handleAnchorDragEnd = mappedHandler<
      (e: unknown, unitId: string, index: number, overridePct?: PercentPoint) => void
    >(UNIT_ID, 'handleAnchorDragEnd');

    const moved = { pctX: 0.9, pctY: 0.15 };
    act(() => handleAnchorDragEnd({ target: {} }, UNIT_ID, 1, moved));

    expect(onUpdateUnitPolygon).toHaveBeenCalledTimes(1);
    const [id, points] = onUpdateUnitPolygon.mock.calls[0];
    expect(id).toBe(UNIT_ID);
    expect(points).toEqual([SQUARE[0], moved, SQUARE[2], SQUARE[3]]);
  });

  it(':polygon-drag adds the drag delta to every vertex', () => {
    renderCanvas();
    act(() => useMapStore.setState({ toolMode: 'select', selectedUnitIds: [UNIT_ID] }));
    const handlePolygonDragEnd = mappedHandler<(e: unknown, unit: Unit) => void>(
      UNIT_ID,
      'handlePolygonDragEnd',
    );

    // Konva reports the group's pixel translation; the handler divides by drawW/H.
    const target = { x: () => 80, y: () => 40 };
    act(() => handlePolygonDragEnd({ target }, H.units.value[0]));

    const dx = 80 / DRAW;
    const dy = 40 / DRAW;
    expect(onUpdateUnitPolygon).toHaveBeenCalledTimes(1);
    const [id, points] = onUpdateUnitPolygon.mock.calls[0];
    expect(id).toBe(UNIT_ID);
    expect(points).toEqual(SQUARE.map((p) => ({ pctX: p.pctX + dx, pctY: p.pctY + dy })));
  });

  it(':arrow-nudge shifts every vertex by 1px / drawW on ArrowRight', () => {
    renderCanvas();
    act(() => useMapStore.setState({ selectedUnitIds: [UNIT_ID] }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    const dx = 1 / DRAW;
    expect(onUpdateUnitPolygon).toHaveBeenCalledTimes(1);
    const [id, points] = onUpdateUnitPolygon.mock.calls[0];
    expect(id).toBe(UNIT_ID);
    expect(points).toEqual(SQUARE.map((p) => ({ pctX: p.pctX + dx, pctY: p.pctY })));
  });

  it(':flip mirrors the selected room about its bounding-box mid-x', () => {
    renderCanvas();
    act(() => useMapStore.setState({ selectedUnitIds: [UNIT_ID] }));
    const handleFlip = dockHandler<(dir: 'horizontal' | 'vertical') => void>('handleFlip');

    act(() => handleFlip('horizontal'));

    expect(onUpdateUnitPolygon).toHaveBeenCalledTimes(1);
    const [id, points] = onUpdateUnitPolygon.mock.calls[0];
    expect(id).toBe(UNIT_ID);
    expect(points).toEqual(flipPolygon(SQUARE, 'horizontal'));
  });

  it(':rotate applies an aspect-corrected 90° turn about the centroid', () => {
    renderCanvas();
    const handleRotatePolygon = dockHandler<
      (dir: 'left' | 'right', overrideId?: string | null) => void
    >('handleRotatePolygon');

    // overrideId targets the unit directly (no selection needed). aspect = drawW/drawH = 1.
    act(() => handleRotatePolygon('right', UNIT_ID));

    expect(onUpdateUnitPolygon).toHaveBeenCalledTimes(1);
    const [id, points] = onUpdateUnitPolygon.mock.calls[0];
    expect(id).toBe(UNIT_ID);
    expect(points).toEqual(rotatePolygon(SQUARE, 'right', 1));
  });

  it(':add-node inserts the clicked point after its nearest edge', () => {
    renderCanvas();
    act(() => useMapStore.setState({ toolMode: 'add_node', selectedUnitIds: [UNIT_ID] }));
    const handlePolygonClick = mappedHandler<(e: unknown, unit: Unit) => void>(
      UNIT_ID,
      'handlePolygonClick',
    );

    // Click on the top edge (nearest segment index 0) at pct (0.4, 0.2).
    const e = { cancelBubble: false, target: { getStage: () => stageAt(px(0.4), py(0.2)) } };
    act(() => handlePolygonClick(e, H.units.value[0]));

    const inserted = { pctX: 0.4, pctY: 0.2 };
    expect(onUpdateUnitPolygon).toHaveBeenCalledTimes(1);
    const [id, points] = onUpdateUnitPolygon.mock.calls[0];
    expect(id).toBe(UNIT_ID);
    expect(points).toEqual([SQUARE[0], inserted, SQUARE[1], SQUARE[2], SQUARE[3]]);
  });

  it(':delete-node splices out the clicked vertex', () => {
    renderCanvas();
    act(() => useMapStore.setState({ toolMode: 'delete_node', selectedUnitIds: [UNIT_ID] }));
    const handleAnchorClick = mappedHandler<(e: unknown, unitId: string, index: number) => void>(
      UNIT_ID,
      'handleAnchorClick',
    );

    act(() => handleAnchorClick({ cancelBubble: false }, UNIT_ID, 1));

    expect(onUpdateUnitPolygon).toHaveBeenCalledTimes(1);
    const [id, points] = onUpdateUnitPolygon.mock.calls[0];
    expect(id).toBe(UNIT_ID);
    expect(points).toEqual([SQUARE[0], SQUARE[2], SQUARE[3]]);
  });

  it(':insert-vertex adds the edge midpoint to a saved room', () => {
    renderCanvas();
    const onInsertVertex = mappedHandler<(unitId: string, edgeIndex: number) => void>(
      UNIT_ID,
      'onInsertVertex',
    );

    act(() => onInsertVertex(UNIT_ID, 0));

    const midpoint = { pctX: (SQUARE[0].pctX + SQUARE[1].pctX) / 2, pctY: (SQUARE[0].pctY + SQUARE[1].pctY) / 2 };
    expect(onUpdateUnitPolygon).toHaveBeenCalledTimes(1);
    const [id, points] = onUpdateUnitPolygon.mock.calls[0];
    expect(id).toBe(UNIT_ID);
    expect(points).toEqual([SQUARE[0], midpoint, SQUARE[1], SQUARE[2], SQUARE[3]]);
  });

  it('does NOT save a node move that produces a non-finite polygon', () => {
    renderCanvas();
    act(() => useMapStore.setState({ toolMode: 'select', selectedUnitIds: [UNIT_ID] }));
    const handleAnchorDragEnd = mappedHandler<
      (e: unknown, unitId: string, index: number, overridePct?: PercentPoint) => void
    >(UNIT_ID, 'handleAnchorDragEnd');

    act(() => handleAnchorDragEnd({ target: {} }, UNIT_ID, 1, { pctX: Infinity, pctY: 0.1 }));

    expect(onUpdateUnitPolygon).not.toHaveBeenCalled();
  });

  it('does NOT delete a node when the polygon is already a triangle (floor of 3)', () => {
    H.units.value = [makeUnit(UNIT_ID, TRIANGLE)];
    renderCanvas();
    act(() => useMapStore.setState({ toolMode: 'delete_node', selectedUnitIds: [UNIT_ID] }));
    const handleAnchorClick = mappedHandler<(e: unknown, unitId: string, index: number) => void>(
      UNIT_ID,
      'handleAnchorClick',
    );

    act(() => handleAnchorClick({ cancelBubble: false }, UNIT_ID, 1));

    expect(onUpdateUnitPolygon).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// onPolygonComplete — a finished trace (Enter / Finish button) and the box draw.
// ═════════════════════════════════════════════════════════════════════════════
describe('FloorplanCanvas — onPolygonComplete (finished draft polygons)', () => {
  // Drop N draft vertices by firing the captured Stage onClick in draw mode.
  function drawVertices(points: PercentPoint[]) {
    for (const p of points) {
      const onClick = H.stage.value!.onClick as (e: unknown) => void;
      act(() =>
        onClick({ target: { getStage: () => stageAt(px(p.pctX), py(p.pctY)) }, evt: { shiftKey: false } }),
      );
    }
  }

  it(':finish emits the draft polygon when the Finish button is clicked', () => {
    const { getByRole } = renderCanvas();
    act(() => useMapStore.setState({ toolMode: 'draw' }));

    const draft = [
      { pctX: 0.2, pctY: 0.2 },
      { pctX: 0.6, pctY: 0.2 },
      { pctX: 0.6, pctY: 0.6 },
    ];
    drawVertices(draft);

    fireEvent.click(getByRole('button', { name: /Finish Shape/i }));

    expect(onPolygonComplete).toHaveBeenCalledTimes(1);
    expect(onPolygonComplete.mock.calls[0][0]).toEqual(draft);
  });

  it(':draw-enter emits the draft polygon (+ its opening tags) on Enter', () => {
    renderCanvas();
    act(() => useMapStore.setState({ toolMode: 'draw' }));

    const draft = [
      { pctX: 0.2, pctY: 0.2 },
      { pctX: 0.6, pctY: 0.2 },
      { pctX: 0.6, pctY: 0.6 },
    ];
    drawVertices(draft);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    expect(onPolygonComplete).toHaveBeenCalledTimes(1);
    expect(onPolygonComplete.mock.calls[0][0]).toEqual(draft);
    // No opening capture on this surface → the second arg is the empty tag list.
    expect(onPolygonComplete.mock.calls[0][1]).toEqual([]);
  });

  it(':box emits the 4-corner rectangle from a press-drag-release', () => {
    renderCanvas();
    act(() => useMapStore.setState({ toolMode: 'draw' }));

    // Press at (0.2, 0.2) to arm the box origin…
    const onPointerDown = H.stage.value!.onPointerDown as (e: unknown) => void;
    act(() =>
      onPointerDown({ target: { getStage: () => stageAt(px(0.2), py(0.2)) }, evt: { button: 0 } }),
    );
    // …release at (0.7, 0.8) to complete it (re-read onPointerUp after the re-render).
    const onPointerUp = H.stage.value!.onPointerUp as (e: unknown) => void;
    act(() => onPointerUp({ target: { getStage: () => stageAt(px(0.7), py(0.8)) }, evt: { button: 0 } }));

    expect(onPolygonComplete).toHaveBeenCalledTimes(1);
    expect(onPolygonComplete.mock.calls[0][0]).toEqual([
      { pctX: 0.2, pctY: 0.2 },
      { pctX: 0.7, pctY: 0.2 },
      { pctX: 0.7, pctY: 0.8 },
      { pctX: 0.2, pctY: 0.8 },
    ]);
    // The box path passes no opening tags (single-arg call).
    expect(onPolygonComplete.mock.calls[0][1]).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// onInstantStamp — dropping a copy of the selected room at the click point.
// ═════════════════════════════════════════════════════════════════════════════
describe('FloorplanCanvas — onInstantStamp (stamp a copy of the selected room)', () => {
  it(':stamp emits the source id + the re-anchored copy at the click point', () => {
    renderCanvas();
    act(() => useMapStore.setState({ toolMode: 'stamp', selectedUnitIds: [UNIT_ID] }));

    const onClick = H.stage.value!.onClick as (e: unknown) => void;
    act(() => onClick({ target: { getStage: () => stageAt(px(0.5), py(0.5)) }, evt: { shiftKey: false } }));

    const anchor = { pctX: 0.5, pctY: 0.5 };
    // aspect is unused with the identity transform (no rotation), so any value works.
    const expected = buildStampPolygon(SQUARE, IDENTITY_STAMP_TRANSFORM, 1, anchor);
    expect(onInstantStamp).toHaveBeenCalledTimes(1);
    const [id, points] = onInstantStamp.mock.calls[0];
    expect(id).toBe(UNIT_ID);
    expect(points).toEqual(expected);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// onPendingPolygonMove — edits to the not-yet-saved draft (via the history wrapper).
// ═════════════════════════════════════════════════════════════════════════════
describe('FloorplanCanvas — onPendingPolygonMove (unsaved pending-polygon edits)', () => {
  it(':pending flip routes the mirrored draft through handlePendingPolygonEdit', () => {
    renderCanvas({ pendingPolygonPoints: SQUARE });
    const handleFlip = dockHandler<(dir: 'horizontal' | 'vertical') => void>('handleFlip');

    // With a pending polygon present, flip edits the DRAFT (not a saved unit) and
    // commits through handlePendingPolygonEdit → onPendingPolygonMove.
    act(() => handleFlip('horizontal'));

    expect(onPendingPolygonMove).toHaveBeenCalledTimes(1);
    expect(onPendingPolygonMove.mock.calls[0][0]).toEqual(flipPolygon(SQUARE, 'horizontal'));
    // …and it does NOT touch the saved-room persist path.
    expect(onUpdateUnitPolygon).not.toHaveBeenCalled();
  });
});
