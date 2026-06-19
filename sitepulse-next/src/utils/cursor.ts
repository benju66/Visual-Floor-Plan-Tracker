import type { ToolMode, RouteSubMode } from '@/store/useMapStore';

/**
 * Single source of truth for the drawing-viewer cursor.
 *
 * The Konva canvas previously drove the cursor from three uncoordinated places
 * (an outer div style, an effect on the Konva container, and direct
 * `container.style.cursor` mutations inside individual shape handlers). Those
 * imperative mutations only restored the cursor on a shape's own `mouseLeave`,
 * so a shape that unmounted under the pointer (e.g. a route node removed by a
 * click) left a stale cursor. This pure function replaces that logic: the
 * component feeds it React state and applies the single returned value.
 */
export interface ToolCursorState {
  toolMode: ToolMode;
  routeSubMode: RouteSubMode;
  /** Any active drag (canvas pan, polygon, anchor, route node, or route midpoint). */
  isDragging: boolean;
  /** Hovering a polygon anchor handle. */
  hoveredAnchor: boolean;
  /** Hovering a status-icon drag handle (only draggable in select + shift). */
  hoveredIcon: boolean;
  /** Hovering the in-flight "pending" placement polygon. */
  hoveredPendingPolygon: boolean;
  /** Id of the hovered mapped unit polygon, if any. */
  hoveredUnit: string | null;
  /** Id of the hovered route sequence node, if any. */
  hoveredRouteNode: string | null;
  /** Index of the hovered route segment line, if any. */
  hoveredRouteSegment: number | null;
  isShiftDown: boolean;
  selectedUnitIds: string[];
  pendingRoute: string[];
  /** Pre-built custom SVG data-URI cursors (built once in the component). */
  addNodeCursor: string;
  removeNodeCursor: string;
}

function getRouteCursor(s: ToolCursorState): string {
  const overRoutedUnit = !!(s.hoveredUnit && s.pendingRoute.includes(s.hoveredUnit));
  switch (s.routeSubMode) {
    case 'move':
      return s.hoveredRouteNode ? 'grab' : 'default';
    case 'add':
      // A node already in the route can't be added again.
      if (s.hoveredRouteNode || overRoutedUnit) return 'not-allowed';
      return s.addNodeCursor;
    case 'remove':
      if (s.hoveredRouteNode || s.hoveredRouteSegment !== null || overRoutedUnit) {
        return s.removeNodeCursor;
      }
      return 'default';
    default:
      return 'default';
  }
}

export function getToolCursor(s: ToolCursorState): string {
  if (s.isDragging) return 'grabbing';
  if (s.hoveredPendingPolygon) return 'grab';

  switch (s.toolMode) {
    case 'pan':
      return 'grab';
    case 'draw':
      return 'crosshair';
    case 'fill_room':
      // A single click proposes a whole room — distinct intent from freehand draw.
      return 'cell';
    case 'stamp':
      return 'copy';
    case 'add_node':
      // Over an existing anchor the node is draggable; elsewhere a click adds one.
      return s.hoveredAnchor ? 'grab' : s.addNodeCursor;
    case 'delete_node':
      // Symmetric with add_node: the tool always shows its intent cursor.
      return s.removeNodeCursor;
    case 'route':
      return getRouteCursor(s);
    case 'select':
    case 'multi_select': {
      // Shift-drag of a status icon is only possible in single-select.
      if (s.hoveredIcon && s.toolMode === 'select' && s.isShiftDown) return 'grab';
      if (s.hoveredAnchor) return 'pointer';
      if (s.hoveredUnit) {
        // Only single-select can drag a whole polygon, so only it gets "grab".
        if (s.toolMode === 'select' && s.selectedUnitIds.includes(s.hoveredUnit)) {
          return 'grab';
        }
        return 'pointer';
      }
      return 'default';
    }
    default:
      return 'default';
  }
}
