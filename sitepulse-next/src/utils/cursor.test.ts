import { describe, it, expect } from 'vitest';
import { getToolCursor, type ToolCursorState } from './cursor';

const ADD = 'url(add) 12 12, crosshair';
const REMOVE = 'url(remove) 12 12, crosshair';

function state(overrides: Partial<ToolCursorState> = {}): ToolCursorState {
  return {
    toolMode: 'pan',
    routeSubMode: 'move',
    isDragging: false,
    hoveredAnchor: false,
    hoveredIcon: false,
    hoveredPendingPolygon: false,
    hoveredUnit: null,
    hoveredRouteNode: null,
    hoveredRouteSegment: null,
    isShiftDown: false,
    selectedUnitIds: [],
    pendingRoute: [],
    addNodeCursor: ADD,
    removeNodeCursor: REMOVE,
    ...overrides,
  };
}

describe('getToolCursor', () => {
  it('shows grabbing whenever something is being dragged, regardless of tool', () => {
    expect(getToolCursor(state({ isDragging: true, toolMode: 'draw' }))).toBe('grabbing');
    expect(getToolCursor(state({ isDragging: true, toolMode: 'select' }))).toBe('grabbing');
  });

  it('prioritises the pending placement polygon hover before tool logic', () => {
    expect(getToolCursor(state({ hoveredPendingPolygon: true, toolMode: 'draw' }))).toBe('grab');
  });

  it('maps the simple tool modes', () => {
    expect(getToolCursor(state({ toolMode: 'pan' }))).toBe('grab');
    expect(getToolCursor(state({ toolMode: 'draw' }))).toBe('crosshair');
    expect(getToolCursor(state({ toolMode: 'stamp' }))).toBe('copy');
  });

  it('add_node shows the add cursor by default and grab over an anchor', () => {
    expect(getToolCursor(state({ toolMode: 'add_node' }))).toBe(ADD);
    expect(getToolCursor(state({ toolMode: 'add_node', hoveredAnchor: true }))).toBe('grab');
  });

  it('delete_node always shows the remove cursor', () => {
    expect(getToolCursor(state({ toolMode: 'delete_node' }))).toBe(REMOVE);
    expect(getToolCursor(state({ toolMode: 'delete_node', hoveredAnchor: true }))).toBe(REMOVE);
  });

  describe('select / multi_select', () => {
    it('defaults to default with nothing hovered', () => {
      expect(getToolCursor(state({ toolMode: 'select' }))).toBe('default');
      expect(getToolCursor(state({ toolMode: 'multi_select' }))).toBe('default');
    });

    it('shows pointer over an unselected unit in both modes', () => {
      expect(getToolCursor(state({ toolMode: 'select', hoveredUnit: 'u1' }))).toBe('pointer');
      expect(getToolCursor(state({ toolMode: 'multi_select', hoveredUnit: 'u1' }))).toBe('pointer');
    });

    it('shows grab over a selected unit only in single-select (no false drag affordance)', () => {
      const sel = { hoveredUnit: 'u1', selectedUnitIds: ['u1'] };
      expect(getToolCursor(state({ toolMode: 'select', ...sel }))).toBe('grab');
      // multi_select cannot drag a polygon — must not imply it can.
      expect(getToolCursor(state({ toolMode: 'multi_select', ...sel }))).toBe('pointer');
    });

    it('shows the icon grab cursor only in single-select with shift held', () => {
      expect(getToolCursor(state({ toolMode: 'select', hoveredIcon: true, isShiftDown: true }))).toBe('grab');
      expect(getToolCursor(state({ toolMode: 'select', hoveredIcon: true, isShiftDown: false }))).toBe('default');
      expect(getToolCursor(state({ toolMode: 'multi_select', hoveredIcon: true, isShiftDown: true }))).toBe('default');
    });

    it('shows pointer over an anchor', () => {
      expect(getToolCursor(state({ toolMode: 'select', hoveredAnchor: true }))).toBe('pointer');
    });
  });

  describe('route', () => {
    it('move: grab over a node, default otherwise', () => {
      expect(getToolCursor(state({ toolMode: 'route', routeSubMode: 'move' }))).toBe('default');
      expect(getToolCursor(state({ toolMode: 'route', routeSubMode: 'move', hoveredRouteNode: 'n1' }))).toBe('grab');
    });

    it('add: add cursor by default, not-allowed over a unit already in the route', () => {
      expect(getToolCursor(state({ toolMode: 'route', routeSubMode: 'add' }))).toBe(ADD);
      expect(getToolCursor(state({
        toolMode: 'route', routeSubMode: 'add', hoveredUnit: 'u1', pendingRoute: ['u1'],
      }))).toBe('not-allowed');
      expect(getToolCursor(state({ toolMode: 'route', routeSubMode: 'add', hoveredRouteNode: 'n1' }))).toBe('not-allowed');
    });

    it('remove: remove cursor over node / segment / routed unit, default otherwise', () => {
      expect(getToolCursor(state({ toolMode: 'route', routeSubMode: 'remove' }))).toBe('default');
      expect(getToolCursor(state({ toolMode: 'route', routeSubMode: 'remove', hoveredRouteNode: 'n1' }))).toBe(REMOVE);
      expect(getToolCursor(state({ toolMode: 'route', routeSubMode: 'remove', hoveredRouteSegment: 0 }))).toBe(REMOVE);
      expect(getToolCursor(state({
        toolMode: 'route', routeSubMode: 'remove', hoveredUnit: 'u1', pendingRoute: ['u1'],
      }))).toBe(REMOVE);
    });
  });
});
