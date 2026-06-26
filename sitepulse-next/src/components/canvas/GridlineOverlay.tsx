import React from 'react';
import { Group, Line, Circle, Text } from 'react-konva';
import type { Gridline, PercentPoint, CanvasLayout } from '@/types/domain';

/**
 * A grid to draw, tagged by whether it's already saved or still pending confirm.
 * Saved grids carry their index into `sheet_gridlines.gridlines` so the editor can
 * address the right one when the user selects / moves it.
 */
export type GridlineOverlayItem = Gridline & { kind: 'saved' | 'pending'; savedIndex?: number };

export interface GridlineOverlayProps {
  items: GridlineOverlayItem[];
  stageScale: number;
  layout: CanvasLayout;
  toPixels: (points: PercentPoint[]) => number[];
  /**
   * Editing affordances (AI Tracing Assist — Phase 3c follow-up). When `editable`,
   * the SELECTED saved grid (by `savedIndex`) is highlighted and made draggable to
   * reposition. Selection itself is driven from the panel, so non-selected grids
   * stay inert (they never steal pointer events from the capture tools, AGENTS.md
   * §3). Omitted on the live map and during plain display.
   */
  editable?: boolean;
  selectedSavedIndex?: number | null;
  /** Commit a moved grid's new endpoints (percent space). */
  onAdjustSavedGridline?: (index: number, p1: PercentPoint, p2: PercentPoint) => void;
  /** Snap a percent point to the nearest detected vector (locks the moved line). */
  snap?: (p: PercentPoint) => PercentPoint;
}

const VIOLET = '139, 92, 246';

/**
 * Draws a sheet's gridlines on the canvas overlay Layer (AI Tracing Assist —
 * Phase 3b): SAVED grids (from `sheet_gridlines`) as solid violet lines with a
 * filled label bubble, and the current session's PENDING grids as dashed, lighter,
 * hollow-bubble lines. Display-only by default — `listening` is off so grids never
 * steal pointer events from the trace/capture tools (AGENTS.md §3).
 *
 * When `editable` and a saved grid is selected, THAT grid alone becomes an
 * interactive, draggable group (highlighted) so the user can slide it onto the right
 * line; on release both endpoints snap to the detected vectors and the move is
 * committed. Everything else stays static.
 */
export default function GridlineOverlay({
  items,
  stageScale,
  layout,
  toPixels,
  editable,
  selectedSavedIndex,
  onAdjustSavedGridline,
  snap,
}: GridlineOverlayProps) {
  if (!items.length) return null;
  const bubbleR = 9 / stageScale;
  const fontSize = 11 / stageScale;

  return (
    <>
      {items.map((g, i) => {
        const saved = g.kind === 'saved';
        const isSelected =
          !!editable && saved && g.savedIndex != null && g.savedIndex === selectedSavedIndex;
        const pts = toPixels([g.p1, g.p2]);
        // Anchor the label bubble at endpoint p1 (where the grid bubble prints).
        const bx = pts[0];
        const by = pts[1];
        const lineColor = isSelected
          ? `rgb(${VIOLET})`
          : `rgba(${VIOLET}, ${saved ? 0.85 : 0.6})`;

        // The SELECTED saved grid: a draggable group. Dragging translates the whole
        // line; on release we turn the pixel offset into a percent delta, snap both
        // ends to the detected vectors, and commit. `cancelBubble` keeps the drag
        // from also starting a capture-box on the stage beneath it.
        const handleDragEnd = (e: { currentTarget: { x: () => number; y: () => number; position: (p: { x: number; y: number }) => void } }) => {
          const node = e.currentTarget;
          const dPctX = layout.drawW ? node.x() / layout.drawW : 0;
          const dPctY = layout.drawH ? node.y() / layout.drawH : 0;
          node.position({ x: 0, y: 0 }); // reset; props re-render at the committed spot
          if (g.savedIndex == null || !onAdjustSavedGridline) return;
          let np1: PercentPoint = { pctX: g.p1.pctX + dPctX, pctY: g.p1.pctY + dPctY };
          let np2: PercentPoint = { pctX: g.p2.pctX + dPctX, pctY: g.p2.pctY + dPctY };
          if (snap) {
            np1 = snap(np1);
            np2 = snap(np2);
          }
          onAdjustSavedGridline(g.savedIndex, np1, np2);
        };

        return (
          <Group
            key={`${g.kind}-${i}-${g.label}`}
            listening={isSelected}
            draggable={isSelected}
            onDragEnd={isSelected ? handleDragEnd : undefined}
            onMouseDown={isSelected ? (e) => { e.cancelBubble = true; } : undefined}
            onMouseEnter={isSelected ? (e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'move'; } : undefined}
            onMouseLeave={isSelected ? (e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'default'; } : undefined}
          >
            {/* A faint wide halo behind the selected line marks it as active + grabbable. */}
            {isSelected && (
              <Line
                points={pts}
                stroke={`rgba(${VIOLET}, 0.25)`}
                strokeWidth={9 / stageScale}
                lineCap="round"
                listening={false}
              />
            )}
            <Line
              points={pts}
              stroke={lineColor}
              strokeWidth={(isSelected ? 2.5 : saved ? 1.5 : 1.25) / stageScale}
              dash={saved ? undefined : [6 / stageScale, 4 / stageScale]}
              lineCap="round"
              hitStrokeWidth={isSelected ? 16 / stageScale : 0}
              listening={isSelected}
            />
            <Circle
              x={bx}
              y={by}
              radius={isSelected ? bubbleR * 1.15 : bubbleR}
              fill={saved ? `rgba(${VIOLET}, 0.95)` : 'rgba(255, 255, 255, 0.9)'}
              stroke={isSelected ? '#ffffff' : `rgba(${VIOLET}, 0.95)`}
              strokeWidth={(isSelected ? 2 : 1.25) / stageScale}
              listening={isSelected}
            />
            <Text
              x={bx - bubbleR}
              y={by - bubbleR}
              width={bubbleR * 2}
              height={bubbleR * 2}
              text={g.label}
              fontSize={fontSize}
              fontStyle="bold"
              fill={saved ? '#ffffff' : `rgb(${VIOLET})`}
              align="center"
              verticalAlign="middle"
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}
