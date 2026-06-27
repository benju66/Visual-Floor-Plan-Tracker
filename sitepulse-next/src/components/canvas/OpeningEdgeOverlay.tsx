import React from 'react';
import { Group, Line, Circle, Text } from 'react-konva';
import { openingSegment, OPENING_TYPE_GLYPHS, OPENING_TYPE_RGB, type ResolvedOpening } from '@/utils/openingEdges';
import type { OpeningEdge, OpeningType, PercentPoint, CanvasLayout } from '@/types/domain';

/** One room's resolved openings to draw (display layer). */
export interface OpeningOverlayUnit {
  unitId: string;
  segments: ResolvedOpening[];
}

/** The selected room whose boundary edges are clickable to tag/clear (edit-after). */
export interface OpeningEditTarget {
  unitId: string;
  polygon: PercentPoint[];
  edges: OpeningEdge[];
}

export interface OpeningEdgeOverlayProps {
  /** Saved openings per room (display only; `listening` off). */
  items: OpeningOverlayUnit[];
  stageScale: number;
  layout: CanvasLayout;
  toPixels: (points: PercentPoint[]) => number[];
  /**
   * When set (openings session + a selected room), EVERY edge of this room becomes a
   * click target: an untagged edge shows a faint dashed guide, a tagged one shows its
   * colored segment; a click toggles it via {@link onToggleEdge}. Omitted on display.
   */
  editTarget?: OpeningEditTarget | null;
  onToggleEdge?: (unitId: string, edgeIndex: number) => void;
}

/**
 * Draw one opening segment (colored line + a small midpoint glyph badge). All
 * sub-elements are non-interactive (`listening` off) — in edit mode the wrapping
 * Group's wide hit line catches clicks; in display mode nothing here should ever
 * steal a pointer event (AGENTS.md §3).
 */
function OpeningSegment({
  p1,
  p2,
  type,
  stageScale,
  toPixels,
}: {
  p1: PercentPoint;
  p2: PercentPoint;
  type: OpeningType;
  stageScale: number;
  toPixels: (points: PercentPoint[]) => number[];
}) {
  const pts = toPixels([p1, p2]);
  const mx = (pts[0] + pts[2]) / 2;
  const my = (pts[1] + pts[3]) / 2;
  const rgb = OPENING_TYPE_RGB[type];
  const badgeR = 7 / stageScale;
  return (
    <>
      {/* Soft halo so the opening reads over the room boundary at any zoom. */}
      <Line points={pts} stroke={`rgba(${rgb}, 0.25)`} strokeWidth={7 / stageScale} lineCap="round" listening={false} />
      <Line points={pts} stroke={`rgb(${rgb})`} strokeWidth={3 / stageScale} lineCap="round" listening={false} />
      <Circle x={mx} y={my} radius={badgeR} fill={`rgb(${rgb})`} stroke="#ffffff" strokeWidth={1.25 / stageScale} listening={false} />
      <Text
        x={mx - badgeR}
        y={my - badgeR}
        width={badgeR * 2}
        height={badgeR * 2}
        text={OPENING_TYPE_GLYPHS[type]}
        fontSize={9 / stageScale}
        fontStyle="bold"
        fill="#ffffff"
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </>
  );
}

/**
 * Draws rooms' tagged openings on the canvas overlay Layer (AI Tracing Assist —
 * Phase 4a): each opening as a colored segment over the room boundary, color + glyph
 * per type (door / cased opening / overhead / pass-through). Display-only by default
 * (`listening` off) so openings never steal pointer events from the trace/select
 * tools (AGENTS.md §3).
 *
 * When an {@link OpeningEditTarget} is supplied (openings session + a selected room),
 * that room's EVERY edge becomes clickable: untagged edges show a faint dashed guide,
 * tagged edges their colored segment, and a click toggles the edge against the active
 * type via {@link onToggleEdge}.
 */
export default function OpeningEdgeOverlay({
  items,
  stageScale,
  layout,
  toPixels,
  editTarget,
  onToggleEdge,
}: OpeningEdgeOverlayProps) {
  if (!items.length && !editTarget) return null;

  return (
    <>
      {/* Display: saved openings on every (non-edited) room. */}
      {items.map((u) =>
        u.segments.map((s) => (
          <OpeningSegment
            key={`${u.unitId}-${s.edgeIndex}`}
            p1={s.p1}
            p2={s.p2}
            type={s.type}
            stageScale={stageScale}
            toPixels={toPixels}
          />
        )),
      )}

      {/* Edit-after: clickable edges of the selected room. */}
      {editTarget &&
        editTarget.polygon.map((_, i) => {
          const seg = openingSegment(editTarget.polygon, i);
          if (!seg) return null;
          const tag = editTarget.edges.find((e) => e.edgeIndex === i) ?? null;
          const pts = toPixels([seg.p1, seg.p2]);
          return (
            <Group
              key={`edit-${editTarget.unitId}-${i}`}
              onMouseDown={(e) => {
                e.cancelBubble = true;
              }}
              onClick={(e) => {
                e.cancelBubble = true;
                onToggleEdge?.(editTarget.unitId, i);
              }}
              onTap={(e) => {
                e.cancelBubble = true;
                onToggleEdge?.(editTarget.unitId, i);
              }}
              onMouseEnter={(e) => {
                const s = e.target.getStage();
                if (s) s.container().style.cursor = 'pointer';
              }}
              onMouseLeave={(e) => {
                const s = e.target.getStage();
                if (s) s.container().style.cursor = 'default';
              }}
            >
              {/* Wide invisible hit line so a thin edge is easy to click. */}
              <Line points={pts} stroke="rgba(0,0,0,0.001)" strokeWidth={3 / stageScale} hitStrokeWidth={16 / stageScale} />
              {tag ? (
                <OpeningSegment p1={seg.p1} p2={seg.p2} type={tag.type} stageScale={stageScale} toPixels={toPixels} />
              ) : (
                <Line
                  points={pts}
                  stroke="rgba(99, 102, 241, 0.55)"
                  strokeWidth={1.5 / stageScale}
                  dash={[5 / stageScale, 4 / stageScale]}
                  lineCap="round"
                  listening={false}
                />
              )}
            </Group>
          );
        })}
    </>
  );
}
