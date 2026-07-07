"use client";
/**
 * useMeasureTools — the floor-plan canvas's scale-calibration + measure tools
 * (FloorplanCanvas Decomposition — Phase 7). Extracted verbatim from
 * FloorplanCanvas.tsx: the calibrate state (the transient 2-point line, the
 * length prompt, the typed input + parse error) with its load-bearing sync
 * refs, the measure state (the ephemeral polyline, the kept-across-runs
 * fraction precision, the natural-pixel measure basis), both tools' branches
 * of the stage click, the tool-change resets, the measure-basis load effect,
 * and `cancelCalibrate` / `submitCalibrate`. Behavior-preserving — the
 * `useUpdateSheetScale` write inside `submitCalibrate` is byte-identical (a
 * `sheets` update keyed off the sheet's own project_id, NOT a status write;
 * the canvas's only direct write).
 *
 * Seams: the branch CONDITIONS stay in the component's handleStageClick
 * else-if chain (preserving the final-else legend-deselect fallthrough) and
 * call `handleCalibrateClick` / `handleMeasureClick` with the already-computed
 * percent-space click point. The window keydown effect stays in the component
 * (Phase 8 territory) — its Escape ladder consumes the returned
 * `calibratePointsRef` / `calibratePromptRef` / `measurePointsRef` plus the
 * stable `cancelCalibrate` / `clearMeasureRun` callbacks. `lastSnapRef` stays
 * component-owned (shared with the draw path's snap-consume); `useSheetById` /
 * `useUpdateSheetScale` stay mounted in the component (the measure panel reads
 * `scale_units_per_px` and the popover reads `isPending`), which passes
 * `activeSheet` + the mutation in. The calibrate popover, the measure panel
 * (fraction picker + MeasureReadout + Clear), and the two DraftPolygon mounts
 * stay in the component, fed from the hook's returns.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { unitsPerPxFromCalibration, parseFeetInches } from '@/utils/scale';
import { loadImageDimensions } from '@/utils/imageDimensions';
import type { FractionDenominator } from '@/utils/measure';
import type { useUpdateSheetScale } from '@/hooks/useProjectQueries';
import type { ToolMode } from '@/store/useMapStore';
import type { PercentPoint as Point, Sheet } from '@/types/domain';

interface UseMeasureToolsArgs {
  /** Active tool — each handler keeps its own gate; leaving a tool resets its state. */
  toolMode: ToolMode;
  /** enableSnapping AND the magnifier is off — from useCanvasSnapping. */
  effectiveSnapping: boolean;
  /** The last onMouseMove snap — consumed so the committed point matches the visual ring. */
  lastSnapRef: RefObject<{ pctX: number; pctY: number; snapped: boolean } | null>;
  /** The active sheet (resolved by PK in the component) — basis image + scale target. */
  activeSheet: Sheet | null | undefined;
  /** The single scale mutation — stays mounted in the component (popover reads isPending). */
  updateSheetScale: ReturnType<typeof useUpdateSheetScale>;
  /** On-canvas render dims — the measure/calibrate basis FALLBACK when no base image. */
  originalWidth: number;
  originalHeight: number;
  /** setToolMode — a successful calibration returns to pan. */
  onToolModeChange: (mode: ToolMode) => void;
}

export function useMeasureTools({
  toolMode,
  effectiveSnapping,
  lastSnapRef,
  activeSheet,
  updateSheetScale,
  originalWidth,
  originalHeight,
  onToolModeChange,
}: UseMeasureToolsArgs) {
  // ── Scale calibration (Phase 2b) ──────────────────────────────────────────
  // A transient 2-point line the user drops across a known dimension. Isolated
  // from `draftPoints` so it never leaks into the trace path (drawing-tool-
  // excellence guard). Once both points are placed we freeze and prompt for the
  // real length; on submit we set the sheet's `scale_units_per_px`.
  const [calibratePoints, setCalibratePoints] = useState<Point[]>([]);
  const calibratePointsRef = useRef(calibratePoints);
  useEffect(() => { calibratePointsRef.current = calibratePoints; }, [calibratePoints]);
  const [calibratePrompt, setCalibratePrompt] = useState<{ p1: Point; p2: Point } | null>(null);
  const calibratePromptRef = useRef(calibratePrompt);
  useEffect(() => { calibratePromptRef.current = calibratePrompt; }, [calibratePrompt]);
  const [calibrateInput, setCalibrateInput] = useState('');
  const [calibrateError, setCalibrateError] = useState(false);

  // ── Standalone measure tool (Phase 4) ─────────────────────────────────────
  // An ephemeral 2..N-point polyline the user drops on a CALIBRATED drawing to
  // read a running length in fractional feet-inches. Isolated from `draftPoints`
  // (like calibrate) so it never leaks into the trace path. Persists NOTHING.
  const [measurePoints, setMeasurePoints] = useState<Point[]>([]);
  const measurePointsRef = useRef(measurePoints);
  useEffect(() => { measurePointsRef.current = measurePoints; }, [measurePoints]);
  // Selected fraction precision for the readout (¼" / ⅛" / 1⁄16"). A UI preference
  // held across measurements; defaults to ¼".
  const [measureDenom, setMeasureDenom] = useState<FractionDenominator>(4);
  // Base-image natural pixel dims — the SAME basis the area/calibration math uses.
  // Loaded once on entering measure mode (falls back to the on-canvas dims only when
  // there's no base image, where the two bases are equal anyway).
  const [measureBasis, setMeasureBasis] = useState<{ width: number; height: number } | null>(null);

  // Clear any half-placed calibration line + length prompt whenever we leave the
  // calibrate tool, so a stale point/prompt never bleeds into another mode.
  // (The calibrate line of the component's tool-change reset effect, moved here
  // with the state it clears.)
  useEffect(() => {
    if (toolMode !== 'calibrate') { setCalibratePoints([]); setCalibratePrompt(null); setCalibrateInput(''); setCalibrateError(false); }
  }, [toolMode]);

  // Drop the ephemeral measure run whenever we leave the measure tool (the fraction
  // preference is intentionally kept). Nothing here persists. (The measure line of
  // the component's tool-change reset effect, moved here with the state it clears.)
  useEffect(() => {
    if (toolMode !== 'measure') { setMeasurePoints([]); }
  }, [toolMode]);

  // Load the base-image natural pixel dims once when the measure tool opens — the
  // SAME basis calibration/area use (NOT the on-canvas pdf.js render). Falls back to
  // the on-canvas dims only when there's no base image (raster sheets, equal bases).
  useEffect(() => {
    if (toolMode !== 'measure') return;
    let cancelled = false;
    (async () => {
      const dims = await loadImageDimensions(activeSheet?.base_image_url);
      if (cancelled) return;
      setMeasureBasis(
        dims ?? (originalWidth && originalHeight ? { width: originalWidth, height: originalHeight } : null),
      );
    })();
    return () => { cancelled = true; };
  }, [toolMode, activeSheet?.base_image_url, originalWidth, originalHeight]);

  // The Escape backout body for calibrate (also the popover's Cancel + the
  // post-submit reset): drop the line, the prompt, the typed input + the error.
  // The keydown effect keeps the key matching + the backout-ladder ordering.
  // Stable identity: setters only.
  const cancelCalibrate = useCallback(() => {
    setCalibratePoints([]);
    setCalibratePrompt(null);
    setCalibrateInput('');
    setCalibrateError(false);
  }, []);

  // The Escape backout body for measure (also the panel's Clear button): drop the
  // current run but stay in measure mode. Stable identity: setters only.
  const clearMeasureRun = useCallback(() => {
    setMeasurePoints([]);
  }, []);

  // Turn the placed 2-point line + typed real length into `scale_units_per_px`.
  // CRITICAL: measure against the base image's NATURAL pixel size (the converted
  // PNG at `base_image_url`) — the exact same basis the area math uses. The
  // on-canvas `originalWidth/originalHeight` come from the client-side pdf.js
  // render, which is a DIFFERENT scale than the PNG, so calibrating against them
  // made every computed area wrong by that ratio squared. Percent-space points are
  // resolution-independent, so they map onto either image identically; only the
  // width/height basis matters, and it must match the area path. Falls back to the
  // on-canvas dims only when there is no base image (raster sheets, where the two
  // bases are equal anyway). Scale math lives in scale.ts; the caller stamps `at`.
  const submitCalibrate = async () => {
    if (!calibratePrompt || !activeSheet) return;
    const ft = parseFeetInches(calibrateInput);
    if (ft === null || ft <= 0) { setCalibrateError(true); return; }
    const dims = await loadImageDimensions(activeSheet.base_image_url);
    const basisW = dims?.width ?? originalWidth;
    const basisH = dims?.height ?? originalHeight;
    const upp = unitsPerPxFromCalibration(
      calibratePrompt.p1, calibratePrompt.p2, basisW, basisH, ft,
    );
    if (upp === null) { setCalibrateError(true); return; }
    updateSheetScale.mutate({
      sheetId: activeSheet.id,
      // Calibration is not a preset — clear the preset dropdown, keep the legacy
      // ratio untouched (the area path stops trusting it in Phase 3).
      scale_preset: 'custom',
      scale_ratio: activeSheet.scale_ratio ?? 1,
      scale_units_per_px: upp,
      scale_unit: 'ft',
      scale_calibration: {
        p1: calibratePrompt.p1,
        p2: calibratePrompt.p2,
        length: ft,
        unit: 'ft',
        source: 'calibration',
        preset: null,
        at: new Date().toISOString(),
      },
    });
    cancelCalibrate();
    onToolModeChange('pan');
  };

  // The `calibrate` branch of handleStageClick: drop exactly two snapped points
  // across a known dimension. Consume the fresh snap computed by onMouseMove so
  // the committed point matches the visual ring (same trick as the draw path).
  // After the 2nd point, freeze and prompt. The component's click handler keeps
  // the tool routing and calls this with the percent-space click point.
  const handleCalibrateClick = (clickPctX: number, clickPctY: number) => {
    if (calibratePromptRef.current) return; // already awaiting a length
    let pctX = clickPctX;
    let pctY = clickPctY;
    if (effectiveSnapping && lastSnapRef.current?.snapped) {
      pctX = lastSnapRef.current.pctX;
      pctY = lastSnapRef.current.pctY;
    }
    const next = [...calibratePointsRef.current, { pctX, pctY }];
    if (next.length >= 2) {
      setCalibratePoints([next[0], next[1]]);
      setCalibratePrompt({ p1: next[0], p2: next[1] });
      setCalibrateInput('');
      setCalibrateError(false);
    } else {
      setCalibratePoints(next);
    }
  };

  // The `measure` branch of handleStageClick: drop a snapped point onto the running
  // measurement polyline. Consume the fresh snap from onMouseMove so the committed
  // point matches the visual ring.
  const handleMeasureClick = (clickPctX: number, clickPctY: number) => {
    let pctX = clickPctX;
    let pctY = clickPctY;
    if (effectiveSnapping && lastSnapRef.current?.snapped) {
      pctX = lastSnapRef.current.pctX;
      pctY = lastSnapRef.current.pctY;
    }
    const pts = measurePointsRef.current;
    const last = pts[pts.length - 1];
    // Ignore a click that lands on essentially the last point (prevents a
    // zero-length segment, e.g. from an accidental double-click / stutter).
    if (last && Math.abs(last.pctX - pctX) < 1e-4 && Math.abs(last.pctY - pctY) < 1e-4) return;
    setMeasurePoints([...pts, { pctX, pctY }]);
  };

  return {
    /** The transient 2-point calibration line — feeds its DraftPolygon + the popover hint. */
    calibratePoints,
    /** Live mirror — the keydown Esc ladder gates on a half-placed line. */
    calibratePointsRef,
    /** The frozen line awaiting a length — gates the popover form + suspends its snapping. */
    calibratePrompt,
    /** Live mirror — the keydown Esc ladder gates on an open prompt. */
    calibratePromptRef,
    /** The typed real length — the popover input's value. */
    calibrateInput,
    /** The popover input writes it (and clears the error) on change. */
    setCalibrateInput,
    /** Unparseable/zero length — the popover's inline error. */
    calibrateError,
    setCalibrateError,
    /** Calibrate backout body (Esc / Cancel) — drops line, prompt, input + error. */
    cancelCalibrate,
    /** Parse the length, compute units-per-px on the base-image basis, write the sheet scale. */
    submitCalibrate,
    /** calibrate branch of the stage click — snapped 2-point placement, then prompt. */
    handleCalibrateClick,
    /** The running measurement polyline — feeds its DraftPolygon + MeasureReadout. */
    measurePoints,
    /** Live mirror — the keydown Esc ladder gates on a non-empty run. */
    measurePointsRef,
    /** Measure backout body (Esc / Clear) — drops the run, keeps the fraction preference. */
    clearMeasureRun,
    /** Fraction precision for the readout (¼ / ⅛ / 1⁄16) — kept across runs. */
    measureDenom,
    setMeasureDenom,
    /** Base-image natural dims — MeasureReadout's px basis (same basis as area math). */
    measureBasis,
    /** measure branch of the stage click — snapped point onto the running polyline. */
    handleMeasureClick,
  };
}
