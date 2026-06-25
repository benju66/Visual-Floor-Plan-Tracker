import React from 'react';
import { Group, Line, Circle, Text } from 'react-konva';
import type { Gridline, PercentPoint, CanvasLayout } from '@/types/domain';

/** A grid to draw, tagged by whether it's already saved or still pending confirm. */
export type GridlineOverlayItem = Gridline & { kind: 'saved' | 'pending' };

export interface GridlineOverlayProps {
  items: GridlineOverlayItem[];
  stageScale: number;
  layout: CanvasLayout;
  toPixels: (points: PercentPoint[]) => number[];
}

const VIOLET = '139, 92, 246';

/**
 * Draws a sheet's gridlines on the canvas overlay Layer (AI Tracing Assist —
 * Phase 3b): SAVED grids (from `sheet_gridlines`) as solid violet lines with a
 * filled label bubble, and the current session's PENDING grids as dashed, lighter,
 * hollow-bubble lines. Static (no pointer subscription) — it only redraws when the
 * saved/pending arrays change, so plain pan/zoom never re-renders it beyond the
 * Konva transform. Listening is off: grids are display-only, never hit-targets, so
 * they never steal pointer events from the trace/capture tools (AGENTS.md §3).
 */
export default function GridlineOverlay({ items, stageScale, layout, toPixels }: GridlineOverlayProps) {
  if (!items.length) return null;
  const bubbleR = 9 / stageScale;
  const fontSize = 11 / stageScale;

  return (
    <>
      {items.map((g, i) => {
        const saved = g.kind === 'saved';
        const pts = toPixels([g.p1, g.p2]);
        // Anchor the label bubble at endpoint p1 (where the grid bubble prints).
        const bx = pts[0];
        const by = pts[1];
        const lineColor = `rgba(${VIOLET}, ${saved ? 0.85 : 0.6})`;
        return (
          <Group key={`${g.kind}-${i}-${g.label}`} listening={false}>
            <Line
              points={pts}
              stroke={lineColor}
              strokeWidth={(saved ? 1.5 : 1.25) / stageScale}
              dash={saved ? undefined : [6 / stageScale, 4 / stageScale]}
              lineCap="round"
              listening={false}
            />
            <Circle
              x={bx}
              y={by}
              radius={bubbleR}
              fill={saved ? `rgba(${VIOLET}, 0.95)` : 'rgba(255, 255, 255, 0.9)'}
              stroke={`rgba(${VIOLET}, 0.95)`}
              strokeWidth={1.25 / stageScale}
              listening={false}
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
