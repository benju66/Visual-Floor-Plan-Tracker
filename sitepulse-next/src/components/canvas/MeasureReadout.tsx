"use client";
import React from 'react';
import { usePointerSample, type PointerStore } from '@/utils/pointerStore';
import { lengthFt, formatFeetInchesFraction, type FractionDenominator } from '@/utils/measure';
import type { PercentPoint } from '@/types/domain';

export interface MeasureReadoutProps {
  /** Committed measure points (percent-space), in click order. */
  points: PercentPoint[];
  pointerStore: PointerStore;
  /** Base-image natural pixel dims — the SAME basis as the area/calibration math. */
  imgW: number;
  imgH: number;
  unitsPerPx: number | null | undefined;
  denom: FractionDenominator;
  /** Snap the live-to-cursor segment to the same vectors the click will. */
  enableSnapping: boolean;
}

/**
 * The live numeric part of the measure panel (Scale, Measure & Production Rates —
 * Phase 4). Subscribes to the pointer store so it re-renders at most once per frame
 * (isolated from the canvas), and shows the running length INCLUDING the pending
 * segment to the cursor — the tape-measure feel. Per-segment breakdown appears once
 * there are 2+ committed segments. Everything is ephemeral; nothing persists.
 */
export default function MeasureReadout({
  points,
  pointerStore,
  imgW,
  imgH,
  unitsPerPx,
  denom,
  enableSnapping,
}: MeasureReadoutProps) {
  const sample = usePointerSample(pointerStore);

  // The point currently under the cursor (snapped like the next click would be).
  const live: PercentPoint | null =
    points.length >= 1 && sample
      ? enableSnapping && sample.snap?.snapped
        ? { pctX: sample.snap.pctX, pctY: sample.snap.pctY }
        : { pctX: sample.pctX, pctY: sample.pctY }
      : null;

  // The committed total is STABLE — it only changes when a point is clicked, so the
  // headline number is steady to read. Needs 2+ committed points (else null).
  const committedTotal = lengthFt(points, imgW, imgH, unitsPerPx);

  // Committed per-segment lengths (a breakdown is only useful with 2+ segments).
  const segs: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const s = lengthFt([points[i - 1], points[i]], imgW, imgH, unitsPerPx);
    if (s !== null) segs.push(s);
  }
  // The pending segment from the last committed point to the cursor (live).
  const liveSeg = live ? lengthFt([points[points.length - 1], live], imgW, imgH, unitsPerPx) : null;

  // With one committed point the only meaningful reading is the live cursor
  // distance, so it becomes the headline; with 2+ points the committed total does.
  const headline = committedTotal ?? liveSeg;

  if (points.length === 0) {
    return (
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Click the first point to start measuring…
      </p>
    );
  }

  return (
    <div>
      <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums leading-tight">
        {headline !== null ? formatFeetInchesFraction(headline, denom) : '—'}
      </div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
        {committedTotal !== null
          ? `Total (${segs.length} segment${segs.length === 1 ? '' : 's'})`
          : 'Length to cursor'}
      </div>

      {segs.length >= 2 && (
        <div className="space-y-0.5 mb-1 max-h-24 overflow-auto">
          {segs.map((s, i) => (
            <div
              key={i}
              className="flex justify-between gap-3 text-[11px] tabular-nums text-slate-600 dark:text-slate-300"
            >
              <span>Segment {i + 1}</span>
              <span>{formatFeetInchesFraction(s, denom)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pending segment preview — only when the live value isn't already the headline. */}
      {committedTotal !== null && liveSeg !== null && (
        <div className="text-[11px] text-blue-500 dark:text-blue-400 tabular-nums">
          + {formatFeetInchesFraction(liveSeg, denom)} to cursor
        </div>
      )}
    </div>
  );
}
