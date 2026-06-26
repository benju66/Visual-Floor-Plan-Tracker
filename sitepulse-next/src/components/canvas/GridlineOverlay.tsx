import React, { useEffect, useState } from 'react';
import { Group, Line, Circle, Text } from 'react-konva';
import type { Gridline, PercentPoint, CanvasLayout } from '@/types/domain';

/**
 * A grid to draw, tagged by whether it's already saved or still pending confirm.
 * Saved grids carry their index into `sheet_gridlines.gridlines` so the editor can
 * address the right one when the user selects / moves it.
 */
export type GridlineOverlayItem = Gridline & { kind: 'saved' | 'pending'; savedIndex?: number };

const VIOLET = '139, 92, 246';

export interface GridlineOverlayProps {
  items: GridlineOverlayItem[];
  stageScale: number;
  layout: CanvasLayout;
  toPixels: (points: PercentPoint[]) => number[];
  /**
   * Editing affordances (AI Tracing Assist — Phase 3c follow-up). When `editable`,
   * the SELECTED saved grid (by `savedIndex`) is highlighted and becomes a draggable
   * group (translate the whole line) with two draggable ENDPOINT handles (re-aim /
   * resize). Omitted on the live map and during plain display.
   */
  editable?: boolean;
  /**
   * When `selectMode` (the canvas Select tool is active), a click on any saved grid
   * selects it. Independent of `editable` so you can pick a grid from the canvas
   * before the gridline panel is even open. Inert on the live map.
   */
  selectMode?: boolean;
  selectedSavedIndex?: number | null;
  /** Select a saved grid from the canvas (or `null` to clear). */
  onSelectGridline?: (index: number | null) => void;
  /** Commit a moved/reshaped grid's new endpoints (percent space). */
  onAdjustSavedGridline?: (index: number, p1: PercentPoint, p2: PercentPoint) => void;
  /** Snap a percent point to the nearest detected vector (locks moved geometry). */
  snap?: (p: PercentPoint) => PercentPoint;
}

/**
 * The SELECTED saved grid, rendered as an interactive editor: one draggable group
 * (line + bubble + label + handles) that TRANSLATES the whole line, plus two
 * draggable ENDPOINT handles to re-aim/resize a single end. Geometry is data-driven
 * from a local `live` draft so the line follows an endpoint handle smoothly during a
 * drag; on release the moved point(s) snap to the detected vectors and the change is
 * committed. `cancelBubble` keeps a handle drag from also translating the group, and
 * keeps either drag from starting a capture-box on the stage beneath.
 */
function EditableGridline({
  grid,
  index,
  stageScale,
  layout,
  toPixels,
  snap,
  onAdjust,
}: {
  grid: Gridline;
  index: number;
  stageScale: number;
  layout: CanvasLayout;
  toPixels: (points: PercentPoint[]) => number[];
  snap: (p: PercentPoint) => PercentPoint;
  onAdjust: (index: number, p1: PercentPoint, p2: PercentPoint) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'translate' | 'p1' | 'p2'>('idle');
  const [live, setLive] = useState<{ p1: PercentPoint; p2: PercentPoint }>({ p1: grid.p1, p2: grid.p2 });

  // Re-sync the draft from the saved grid whenever it changes AND we're not mid-drag
  // (so a committed edit / refetch redraws at the new spot without a fight).
  useEffect(() => {
    if (mode === 'idle') setLive({ p1: grid.p1, p2: grid.p2 });
  }, [grid.p1.pctX, grid.p1.pctY, grid.p2.pctX, grid.p2.pctY, mode]);

  const pixToPct = (xPx: number, yPx: number): PercentPoint => ({
    pctX: layout.drawW ? (xPx - layout.offsetX) / layout.drawW : 0,
    pctY: layout.drawH ? (yPx - layout.offsetY) / layout.drawH : 0,
  });

  const pts = toPixels([live.p1, live.p2]);
  const bubbleR = 10 / stageScale;
  const fontSize = 11 / stageScale;
  const handleR = 6 / stageScale;

  // Whole-line translate: Konva moves the group; on release turn the pixel offset
  // into a percent delta, snap both ends, reset the node, and commit.
  const onGroupDragEnd = (e: { currentTarget: { x: () => number; y: () => number; position: (p: { x: number; y: number }) => void } }) => {
    const node = e.currentTarget;
    const dPctX = layout.drawW ? node.x() / layout.drawW : 0;
    const dPctY = layout.drawH ? node.y() / layout.drawH : 0;
    node.position({ x: 0, y: 0 });
    setMode('idle');
    const p1 = snap({ pctX: grid.p1.pctX + dPctX, pctY: grid.p1.pctY + dPctY });
    const p2 = snap({ pctX: grid.p2.pctX + dPctX, pctY: grid.p2.pctY + dPctY });
    onAdjust(index, p1, p2);
  };

  // Endpoint handle: the line follows it live (unsnapped) during the drag; on
  // release the moved end snaps and commits.
  const handleProps = (which: 'p1' | 'p2') => ({
    x: which === 'p1' ? pts[0] : pts[2],
    y: which === 'p1' ? pts[1] : pts[3],
    radius: handleR,
    fill: '#ffffff',
    stroke: `rgb(${VIOLET})`,
    strokeWidth: 2 / stageScale,
    draggable: true,
    hitStrokeWidth: 14 / stageScale,
    onMouseDown: (e: { cancelBubble: boolean }) => { e.cancelBubble = true; },
    onDragStart: (e: { cancelBubble: boolean }) => { e.cancelBubble = true; setMode(which); },
    onDragMove: (e: { cancelBubble: boolean; target: { x: () => number; y: () => number } }) => {
      e.cancelBubble = true;
      const p = pixToPct(e.target.x(), e.target.y());
      setLive((prev) => ({ ...prev, [which]: p }));
    },
    onDragEnd: (e: { cancelBubble: boolean; target: { x: () => number; y: () => number } }) => {
      e.cancelBubble = true;
      const p = snap(pixToPct(e.target.x(), e.target.y()));
      const next = { ...live, [which]: p };
      setMode('idle');
      onAdjust(index, next.p1, next.p2);
    },
  });

  return (
    <Group
      draggable
      onDragStart={(e) => { e.cancelBubble = true; setMode('translate'); }}
      onDragEnd={onGroupDragEnd}
      onMouseDown={(e) => { e.cancelBubble = true; }}
      onMouseEnter={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'move'; }}
      onMouseLeave={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'default'; }}
    >
      {/* Active halo behind the line marks it grabbable. */}
      <Line points={pts} stroke={`rgba(${VIOLET}, 0.25)`} strokeWidth={9 / stageScale} lineCap="round" listening={false} />
      <Line
        points={pts}
        stroke={`rgb(${VIOLET})`}
        strokeWidth={2.5 / stageScale}
        lineCap="round"
        hitStrokeWidth={16 / stageScale}
      />
      <Circle x={pts[0]} y={pts[1]} radius={bubbleR} fill={`rgba(${VIOLET}, 0.95)`} stroke="#ffffff" strokeWidth={2 / stageScale} listening={false} />
      <Text
        x={pts[0] - bubbleR}
        y={pts[1] - bubbleR}
        width={bubbleR * 2}
        height={bubbleR * 2}
        text={grid.label}
        fontSize={fontSize}
        fontStyle="bold"
        fill="#ffffff"
        align="center"
        verticalAlign="middle"
        listening={false}
      />
      {/* Endpoint handles (drag to re-aim / resize a single end). */}
      <Circle {...handleProps('p1')} />
      <Circle {...handleProps('p2')} />
    </Group>
  );
}

/**
 * Draws a sheet's gridlines on the canvas overlay Layer (AI Tracing Assist —
 * Phase 3b): SAVED grids (from `sheet_gridlines`) as solid violet lines with a
 * filled label bubble, and the current session's PENDING grids as dashed, lighter,
 * hollow-bubble lines. Display-only by default — `listening` is off so grids never
 * steal pointer events from the trace/capture tools (AGENTS.md §3).
 *
 * When the Select tool is active (`selectMode`), saved grids become clickable to
 * select; when `editable` and a saved grid is selected, that grid alone renders as
 * an interactive {@link EditableGridline} (translate + endpoint handles).
 */
export default function GridlineOverlay({
  items,
  stageScale,
  layout,
  toPixels,
  editable,
  selectMode,
  selectedSavedIndex,
  onSelectGridline,
  onAdjustSavedGridline,
  snap,
}: GridlineOverlayProps) {
  if (!items.length) return null;
  const bubbleR = 9 / stageScale;
  const fontSize = 11 / stageScale;
  const identity = (p: PercentPoint) => p;

  return (
    <>
      {items.map((g, i) => {
        const saved = g.kind === 'saved';
        const isSelected =
          !!editable && saved && g.savedIndex != null && g.savedIndex === selectedSavedIndex;

        // The selected saved grid renders as the interactive editor.
        if (isSelected && g.savedIndex != null) {
          return (
            <EditableGridline
              key={`edit-${g.savedIndex}`}
              grid={g}
              index={g.savedIndex}
              stageScale={stageScale}
              layout={layout}
              toPixels={toPixels}
              snap={snap ?? identity}
              onAdjust={onAdjustSavedGridline ?? (() => {})}
            />
          );
        }

        const pts = toPixels([g.p1, g.p2]);
        const bx = pts[0];
        const by = pts[1];
        // A non-selected saved grid is clickable to select while the Select tool is on.
        const clickable = !!selectMode && saved && g.savedIndex != null;
        const lineColor = `rgba(${VIOLET}, ${saved ? 0.85 : 0.6})`;

        return (
          <Group
            key={`${g.kind}-${i}-${g.label}`}
            listening={clickable}
            onMouseDown={clickable ? (e) => { e.cancelBubble = true; } : undefined}
            onClick={clickable ? (e) => { e.cancelBubble = true; onSelectGridline?.(g.savedIndex as number); } : undefined}
            onTap={clickable ? (e) => { e.cancelBubble = true; onSelectGridline?.(g.savedIndex as number); } : undefined}
            onMouseEnter={clickable ? (e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'pointer'; } : undefined}
            onMouseLeave={clickable ? (e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'default'; } : undefined}
          >
            <Line
              points={pts}
              stroke={lineColor}
              strokeWidth={(saved ? 1.5 : 1.25) / stageScale}
              dash={saved ? undefined : [6 / stageScale, 4 / stageScale]}
              lineCap="round"
              hitStrokeWidth={clickable ? 14 / stageScale : 0}
              listening={clickable}
            />
            <Circle
              x={bx}
              y={by}
              radius={bubbleR}
              fill={saved ? `rgba(${VIOLET}, 0.95)` : 'rgba(255, 255, 255, 0.9)'}
              stroke={`rgba(${VIOLET}, 0.95)`}
              strokeWidth={1.25 / stageScale}
              listening={clickable}
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
