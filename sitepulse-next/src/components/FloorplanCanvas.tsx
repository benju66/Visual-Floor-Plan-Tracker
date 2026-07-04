"use client";
import React, { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import { Check, AlertTriangle } from 'lucide-react';
import ZoomIndicator from '@/components/canvas/ZoomIndicator';
import ViewportControls from '@/components/canvas/ViewportControls';
import ContextActionDock from '@/components/canvas/ContextActionDock';
import CanvasContextMenu from '@/components/CanvasContextMenu';
import MappedUnit from '@/components/canvas/MappedUnit';
import DraftPolygon from '@/components/canvas/DraftPolygon';
import MeasureReadout from '@/components/canvas/MeasureReadout';
import StampPreview from '@/components/canvas/StampPreview';
import PendingPolygon from '@/components/canvas/PendingPolygon';
import CaptureBoxOverlay from '@/components/canvas/CaptureBoxOverlay';
import CaptureLineOverlay from '@/components/canvas/CaptureLineOverlay';
import GridlineOverlay, { type GridlineOverlayItem } from '@/components/canvas/GridlineOverlay';
import OpeningEdgeOverlay, { type OpeningOverlayUnit, type OpeningEditTarget } from '@/components/canvas/OpeningEdgeOverlay';
import { OPENING_TYPE_RGB, openingTypeForKey } from '@/utils/openingEdges';
import MapLegend from '@/components/canvas/MapLegend';
import CrosshairOverlay from '@/components/canvas/CrosshairOverlay';
import LoupeOverlay from '@/components/canvas/LoupeOverlay';
import MiniMapOverlay from '@/components/canvas/MiniMapOverlay';
import { useLoupeRenderer } from '@/hooks/useLoupeRenderer';
import { withVersion } from '@/utils/pdfSource';
import WalkRouteOverlay from '@/components/canvas/WalkRouteOverlay';
import HoverHistoryTooltip from '@/components/HoverHistoryTooltip';
import { distToSegment, getCentroid, getSnappedCoordinate, isFinitePolygon, mixAlpha, nearestCentroidWithin } from '@/utils/geometry';
import { isSelfIntersecting } from '@/utils/polygonValidity';
import { pushSnapshot, undo as undoEditHistory, redo as redoEditHistory, seedEditHistory, emptyEditHistory, type EditHistory } from '@/utils/editHistory';
import { tagVectorsWithGrid } from '@/utils/gridAwareSnap';
import { computeUnitVariance, varianceFill, orderedTrackActivities } from '@/utils/progressAnalytics';
import { unitMakeReady, makeReadyFill, slotKey } from '@/utils/activityReadiness';
import { classifyWheelIntent, clampStagePosition, createViewportSync, dampToward } from '@/utils/viewport';
import { createPointerStore } from '@/utils/pointerStore';
import { getToolCursor } from '@/utils/cursor';
import { warnIfUnwired } from '@/utils/wiringGuard';
import RBush from 'rbush';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore, useHydratedStore } from '@/store/useSettingsStore';
import { useUnits, useActivities, useUpdateWalkSequence, useSheetById, useUpdateSheetScale } from '@/hooks/useProjectQueries';
import { useActivityDependencies } from '@/hooks/useActivityDependencies';
import { unitsPerPxFromCalibration, parseFeetInches } from '@/utils/scale';
import { FRACTION_LABELS, type FractionDenominator } from '@/utils/measure';
import { loadImageDimensions } from '@/utils/imageDimensions';
import { useSnappingVectors } from '@/hooks/useSnappingVectors';
import { PdfBaseLayer } from '@/components/canvas/PdfBaseLayer';
import { useParams } from 'next/navigation';
import type { StatusLog, Unit, PercentPoint as Point, Gridline, OpeningEdge, OpeningType } from '@/types/domain';
import { applicableActivities, isActivityApplicable } from '@/utils/applicability';
import type { ApplicabilityIndex } from '@/utils/applicability';
import type { ToolMode } from '@/store/useMapStore';
import type { AppSettings as ProjectSettings, MapSettings } from '@/store/useSettingsStore';

// Custom cursors for add/remove-node modes — static, so built once at module scope.
const ADD_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='#10b981' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10'/><line x1='12' y1='8' x2='12' y2='16'/><line x1='8' y1='12' x2='16' y2='12'/></svg>`;
const REMOVE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='#ef4444' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='10'/><line x1='8' y1='12' x2='16' y2='12'/></svg>`;
const ADD_NODE_CURSOR = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(ADD_SVG)}") 12 12, crosshair`;
const REMOVE_NODE_CURSOR = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(REMOVE_SVG)}") 12 12, crosshair`;

// Wheel-zoom scale bounds (shared by instant + smooth paths) and the glide time
// constant for smooth-wheel-zoom. ~70ms reads as a glide without feeling laggy.
const MIN_SCALE = 0.1;
const MAX_SCALE = 15;
const WHEEL_SMOOTH_TAU = 0.07;

interface FloorplanCanvasProps {
  activeStatuses: StatusLog[];
  rawStatuses: StatusLog[];
  imageUrl: string;
  /** sheets.pdf_version of the active sheet — cache-busts public PDF/PNG URLs */
  pdfVersion?: string | null;
  onUpdateUnitPolygon?: (unitId: string, points: Point[]) => void;
  onUpdateUnitIconOffset?: (unitId: string, offsetX: number, offsetY: number) => void;
  onDuplicateUnit?: (unitId: string | null) => void;
  /**
   * A trace finished. `openingEdges` (AI Tracing Assist — Phase 4a) carries any
   * floor-level passages tagged during the trace (`[{ edgeIndex, type }]`); it is
   * undefined on the live map and the quick box-draw (no per-edge tagging there).
   */
  onPolygonComplete: (points: Point[], openingEdges?: OpeningEdge[]) => void;
  /**
   * Workbench capture-box tool (AI Tracing Assist — Phase 3a). Fires when the
   * user finishes a `capture_box` rubber-band drag, with the normalized
   * percent-space rect (x0<=x1, y0<=y1). Optional — only the workbench tracer
   * wires it; the live map leaves it undefined and the mode is inert there.
   */
  onCaptureBox?: (rect: { x0: number; y0: number; x1: number; y1: number }) => void;
  /**
   * Workbench capture-line tool (AI Tracing Assist — Phase 3b). Fires when the
   * user finishes a `capture_line` drag across a grid line, with BOTH endpoints
   * already snapped to the detected vectors (percent space). Optional — only the
   * workbench tracer wires it; the mode is inert on the live map.
   */
  onCaptureLine?: (p1: Point, p2: Point) => void;
  /**
   * Gridlines to draw on the overlay Layer (AI Tracing Assist — Phase 3b): the
   * sheet's SAVED grids plus the current session's PENDING ones. Display-only,
   * never hit-targets. Empty/omitted on the live map.
   */
  gridlineOverlays?: GridlineOverlayItem[];
  /**
   * The sheet's CONFIRMED gridlines (AI Tracing Assist — Phase 3c) — used to tag the
   * snapping vectors that ARE grid lines so tracing de-prioritizes them (grid-aware
   * snapping). Workbench-only: the live map omits it → nothing is tagged and snapping
   * is unchanged. Distinct from `gridlineOverlays` (which also carries pending grids
   * for display); this is only the saved/confirmed set that drives snap weighting.
   */
  confirmedGridlines?: Gridline[];
  /**
   * Gridline editing (AI Tracing Assist — Phase 3c follow-up). When `editableGridlines`
   * is on (workbench gridline session), the SAVED grid at `selectedGridlineIndex`
   * becomes draggable on the canvas; releasing it fires `onAdjustGridline` with the
   * snapped new endpoints. Omitted on the live map.
   */
  editableGridlines?: boolean;
  selectedGridlineIndex?: number | null;
  onAdjustGridline?: (index: number, p1: Point, p2: Point) => void;
  /** Select a saved gridline from the canvas (Select tool), or `null` to clear. */
  onSelectGridline?: (index: number | null) => void;
  onRenameUnit?: (unitId: string | null) => void;
  onDeleteUnit?: (unitId: string | string[] | null) => void;
  /**
   * Opening-edge capture (AI Tracing Assist — Phase 4a). When `openingCaptureEnabled`
   * (workbench openings session), holding the opening key while tracing marks the next
   * placed edge as an opening of `activeOpeningType`. `openingOverlays` draws saved
   * rooms' openings; `openingEditTarget` + `onToggleOpeningEdge` make a selected room's
   * boundary edges clickable to tag/clear. All omitted on the live map (inert there).
   */
  openingCaptureEnabled?: boolean;
  activeOpeningType?: OpeningType;
  openingOverlays?: OpeningOverlayUnit[];
  openingEditTarget?: OpeningEditTarget | null;
  onToggleOpeningEdge?: (unitId: string, edgeIndex: number) => void;
  onInstantStamp?: (unitId: string, points: Point[]) => void;
  pendingPolygonPoints?: Point[] | null;
  onPendingPolygonMove?: (points: Point[]) => void;
  onAddNodeToSegment?: (unitId: string, segmentIndex: number, newPoint: Point) => void;
  onPendingPolygonComplete?: () => void;
  onOpenActivityModal?: (unitId: string | null) => void;
  onOpenStatusModal?: (unitId: string | null) => void;
  applicabilityIndex?: ApplicabilityIndex;
}

const FloorplanCanvas = forwardRef<any, FloorplanCanvasProps>(({
  activeStatuses,
  rawStatuses,
  imageUrl,
  pdfVersion,
  onUpdateUnitPolygon,
  onUpdateUnitIconOffset,
  onDuplicateUnit,
  onPolygonComplete,
  onCaptureBox,
  onCaptureLine,
  gridlineOverlays,
  confirmedGridlines,
  editableGridlines,
  selectedGridlineIndex,
  onAdjustGridline,
  onSelectGridline,
  onRenameUnit,
  onDeleteUnit,
  openingCaptureEnabled,
  activeOpeningType,
  openingOverlays,
  openingEditTarget,
  onToggleOpeningEdge,
  onInstantStamp,
  pendingPolygonPoints,
  onPendingPolygonMove,
  onOpenActivityModal,
  onOpenStatusModal,
  applicabilityIndex,
}, ref) => {
  const activeSheetId = useMapStore(s => s.activeSheetId);
  const toolMode = useMapStore(s => s.toolMode);
  const onToolModeChange = useMapStore(s => s.setToolMode);
  const pendingRoute = useMapStore(s => s.pendingRoute);
  const setPendingRoute = useMapStore(s => s.setPendingRoute);
  const routeSubMode = useMapStore(s => s.routeSubMode);
  const selectedUnitIds = useMapStore(s => s.selectedUnitIds);
  const onSelectUnit = useMapStore(s => s.toggleSelectedUnitId);
  const onClearSelection = useMapStore(s => s.clearSelectedUnits);
  const onSetSelectedUnitIds = useMapStore(s => s.setSelectedUnitIds);
  const trackingMode = useMapStore(s => s.trackingMode);

  const temporalFilters = useSettingsStore(s => s.temporalFilters);
  const legendFilter = useSettingsStore(s => s.filterActivity);
  
  const setHistoryModalUnitId = useUIStore(s => s.setHistoryModalUnitId);
  
  const settings = useHydratedStore(s => s.settings, { showHistoryHover: false } as ProjectSettings);
  const mapSettings = useHydratedStore(s => s.mapSettings, { showCrosshair: false } as MapSettings);
  const legendPosition = useHydratedStore(s => s.legendPosition, { isVisible: false } as any);
  const onLegendDragEnd = useSettingsStore(s => s.setLegendPosition);

  const params = useParams();
  const projectId = params?.projectId as string;

  const { data: allActivities = [] } = useActivities(projectId);
  const activities = allActivities.filter(m => m.track === trackingMode);
  // FS dependency edges (Scheduling Analytics Phase 4) — read-only make-ready coloring.
  const { data: dependencies = [] } = useActivityDependencies(projectId);
  const { data: units = [], isLoading: isLoadingUnits } = useUnits(activeSheetId);

  // Active sheet resolved by PK so scale calibration (Phase 2b) works in BOTH the
  // live map and the workbench (no `projectId` route param there). The write is
  // keyed off the sheet's OWN project_id via the single scale mutation.
  const { data: activeSheet } = useSheetById(activeSheetId || null);
  const updateSheetScale = useUpdateSheetScale((activeSheet?.project_id as string) || '');

  // ── Lag Mode: re-skin bottleneck statuses with schedule-variance colors ──
  // Purely visual: only the copies passed to the canvas renderers are recolored,
  // so write paths (BulkActionDock bottlenecks, quick modals) never see lag colors.
  const lagMode = !!mapSettings?.colorByVariance;
  // Make-Ready Mode (Scheduling Analytics Phase 4): recolor by dependency readiness
  // instead of activity color. Mutually exclusive with Lag Mode (the toolbar clears
  // the other when one turns on; guard here too so a stale-both state prefers Lag).
  const makeReadyMode = !lagMode && !!mapSettings?.colorByMakeReady;
  // Stable for the component's lifetime — matches how the dashboard modules and
  // history modal source "today", and keeps the memo dep array honest.
  const today = useMemo(() => new Date(), []);
  const displayStatuses = useMemo(() => {
    if (!lagMode && !makeReadyMode) return activeStatuses;
    const unitById = new Map(units.map(u => [u.id, u]));

    if (makeReadyMode) {
      // Completed slots + applicable slots for the active track (N/A slots respected —
      // AGENTS.md §3). Both are plain slot-key sets keyed `${unitId}_${activityId}`.
      const orderedActs = orderedTrackActivities(allActivities, trackingMode);
      const completed = new Set<string>();
      for (const log of rawStatuses) {
        if (log.track === trackingMode && log.unit_id && log.activity_id && log.temporal_state === 'completed') {
          completed.add(slotKey(log.unit_id, log.activity_id));
        }
      }
      const hasIndex = !!applicabilityIndex;
      const applicable = new Set<string>();
      if (hasIndex) {
        for (const u of units) for (const a of orderedActs) {
          if (isActivityApplicable(a, u, applicabilityIndex)) applicable.add(slotKey(u.id, a.id));
        }
      }
      return activeStatuses.map(s => {
        const unit = unitById.get(s.unit_id as string);
        if (!unit) return s;
        const appActs = hasIndex ? applicableActivities(orderedActs, unit, applicabilityIndex) : orderedActs;
        const info = unitMakeReady(unit.id, appActs, dependencies, completed, hasIndex ? applicable : undefined);
        return { ...s, status_color: makeReadyFill(info) };
      });
    }

    // Lag Mode: schedule-variance recolor.
    const logsByUnit = new Map<string, StatusLog[]>();
    for (const log of rawStatuses) {
      if (log.track !== trackingMode || !log.unit_id) continue;
      const arr = logsByUnit.get(log.unit_id);
      if (arr) arr.push(log);
      else logsByUnit.set(log.unit_id, [log]);
    }
    return activeStatuses.map(s => {
      // Variance skips activities that are N/A for this unit, matching the bottleneck.
      const unit = unitById.get(s.unit_id as string);
      const unitActivities = unit && applicabilityIndex
        ? applicableActivities(activities, unit, applicabilityIndex)
        : activities;
      const info = computeUnitVariance(logsByUnit.get(s.unit_id as string) || [], unitActivities, today);
      return { ...s, status_color: varianceFill(info) };
    });
  // `activities` is derived from allActivities+trackingMode (both in deps); listing
  // the derived array would change identity every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lagMode, makeReadyMode, activeStatuses, rawStatuses, allActivities, trackingMode, today, units, applicabilityIndex, dependencies]);
  // Synchronous main-thread snapping engine. The hook returns raw JSON vectors;
  // we instantiate the RBush spatial index here in a deferred effect (never in the
  // Query cache — see AGENTS.md §5). getSnappedCoordinate() is then called inline,
  // synchronously, which is required by Konva's dragBoundFunc and guarantees the
  // committed point matches the visual snap ring.
  const { vectors: rawVectors } = useSnappingVectors(activeSheetId);

  const [vectorTree, setVectorTree] = useState<RBush<any> | null>(null);
  useEffect(() => {
    if (!rawVectors || rawVectors.length === 0) {
      setVectorTree(null);
      return;
    }
    // Defer the heavy spatial-index build off the render path.
    const timeoutId = setTimeout(() => {
      const tree = new RBush();
      // Grid-aware snapping (Phase 3c): tag the vectors that ARE confirmed grid lines
      // so the snap engine can de-prioritize them. The aspect is read from the live
      // layout ref (not a dep) so we tag with the freshest sheet proportions without
      // forcing a rebuild on every resize. No confirmed grids → passthrough untagged
      // (live map / un-gridded sheets are unchanged). The tagged TREE stays in
      // component state; only the raw JSON lives in the Query cache (AGENTS.md §5).
      const classifyAspect = layoutRef.current.drawH > 0
        ? layoutRef.current.drawW / layoutRef.current.drawH
        : 1;
      tree.load(tagVectorsWithGrid(rawVectors, confirmedGridlines, classifyAspect));
      setVectorTree(tree);
    }, 10);
    return () => clearTimeout(timeoutId);
  }, [rawVectors, confirmedGridlines]);

  // Grid-aware snapping is live only when this sheet HAS confirmed grids (so some
  // vectors are tagged) AND the toggle is on (default on; only an explicit false is
  // off). False on the live map (no confirmedGridlines) → snapping is untouched.
  const gridAwareSnapping =
    !!confirmedGridlines?.length && mapSettings?.gridAwareSnapping !== false;

  const [originalWidth, setOriginalWidth] = useState(1000);
  const [originalHeight, setOriginalHeight] = useState(1000);

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfSharpening, setPdfSharpening] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfRetry, setPdfRetry] = useState<(() => void) | null>(null);


  
  // activeStatuses is now provided by props and bottleneck resolution.
  // The raster image is only the legacy fallback for sheets without a PDF; when
  // activeSheetId is present, PdfBaseLayer.onDimensionsReady is the single source
  // of truth for dimensions (avoids a race between the two writers).
  const [image] = useImage(activeSheetId ? '' : imageUrl, 'anonymous');

  useEffect(() => {
    if (activeSheetId) return; // PDF path owns dimensions
    if (image && image.naturalWidth && image.naturalHeight) {
      setOriginalWidth(image.naturalWidth);
      setOriginalHeight(image.naturalHeight);
    }
  }, [image, activeSheetId]);

  const stageRef = useRef<any>(null);
  // The 3rd (interactive-overlays) Konva layer — DraftPolygon's trace line,
  // placed nodes, and snap ring. Handed to LoupeOverlay so the magnifier can
  // composite the in-progress trace on top of its sharp PDF crop (Phase 4).
  const overlayLayerRef = useRef<Konva.Layer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const spaceWasPanRef = useRef<ToolMode | null>(null);

  // Smooth-wheel-zoom glide state (default-on; mapSettings.smoothWheelZoom !== false). Each
  // wheel notch updates a target scale + cursor anchor; a single rAF loop eases the
  // live transform toward it via dampToward(). Refs (not state) so the loop never
  // triggers a React render — same direct-Konva-mutation pattern as handleWheel.
  const wheelTargetScaleRef = useRef<number | null>(null);
  const wheelAnchorRef = useRef<{ screenX: number; screenY: number; contentX: number; contentY: number } | null>(null);
  const wheelRafRef = useRef<number | null>(null);
  const wheelLastFrameRef = useRef(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // HiDPI / Retina fix: ensure Konva renders at native device pixel ratio
  useEffect(() => {
    const updatePixelRatio = () => {
      const dpr = window.devicePixelRatio || 1;
      Konva.pixelRatio = dpr;
    };
    updatePixelRatio();
    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handler = () => updatePixelRatio();
    mediaQuery.addEventListener?.('change', handler);
    return () => mediaQuery.removeEventListener?.('change', handler);
  }, []);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const draftPointsRef = useRef(draftPoints);
  useEffect(() => { draftPointsRef.current = draftPoints; }, [draftPoints]);

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

  // Opening-edge capture (AI Tracing Assist — Phase 4a). The in-progress opening tags
  // of a half-drawn trace are an ephemeral DRAW buffer co-located with `draftPoints`
  // (the same category of canvas-local draw state, never persisted), handed up to
  // `onPolygonComplete` when the polygon closes. The session/active-type tool settings
  // live in `useWorkbenchStore` (passed in as props) per AGENTS.md §2.
  const [draftOpeningEdges, setDraftOpeningEdges] = useState<OpeningEdge[]>([]);
  const draftOpeningEdgesRef = useRef(draftOpeningEdges);
  useEffect(() => { draftOpeningEdgesRef.current = draftOpeningEdges; }, [draftOpeningEdges]);
  // Which opening TYPE key (D/C/H/P) is currently held — while one is down, the next
  // placed edge becomes an opening of that type. The ref drives the commit (read
  // synchronously on click); the state drives the armed cursor tint. Only wired when
  // openingCaptureEnabled (workbench); the live map never subscribes.
  const heldOpeningTypeRef = useRef<OpeningType | null>(null);
  const [armedOpeningType, setArmedOpeningType] = useState<OpeningType | null>(null);

  const unitsRef = useRef(units);
  useEffect(() => { unitsRef.current = units; }, [units]);

  const selectedUnitIdsRef = useRef(selectedUnitIds);
  useEffect(() => { selectedUnitIdsRef.current = selectedUnitIds; }, [selectedUnitIds]);

  const onUpdateUnitPolygonRef = useRef(onUpdateUnitPolygon);
  useEffect(() => { onUpdateUnitPolygonRef.current = onUpdateUnitPolygon; }, [onUpdateUnitPolygon]);

  // Fresh reads for the window-level keydown handler + the pending-edit seed effect
  // (Drawing Tool Excellence — Phase 3). The handler is created once per toolMode and
  // reads these via refs so it never closes over stale props.
  const pendingPolygonPointsRef = useRef(pendingPolygonPoints);
  useEffect(() => { pendingPolygonPointsRef.current = pendingPolygonPoints; }, [pendingPolygonPoints]);
  const onPendingPolygonMoveRef = useRef(onPendingPolygonMove);
  useEffect(() => { onPendingPolygonMoveRef.current = onPendingPolygonMove; }, [onPendingPolygonMove]);

  const layoutRef = useRef({ offsetX: 0, offsetY: 0, drawW: 0, drawH: 0, stageW: 0, stageH: 0 });
  
  const [hoveredUnit, setHoveredUnit] = useState<string | null>(null);
  const [hoveredRouteNode, setHoveredRouteNode] = useState<string | null>(null);
  const [activeRouteDrag, setActiveRouteDrag] = useState<any>(null);
  const [routeDropTarget, setRouteDropTarget] = useState<string | null>(null);
  // Cursor hover state — the single set of inputs that drive computedCursor.
  // hoveredAnchor is keyed by `${unitId}:${index}` (or `PENDING:${index}`) so that
  // interleaved enter/leave events between adjacent anchors can't leave it stuck.
  const [hoveredAnchor, setHoveredAnchor] = useState<string | null>(null);
  const [hoveredIcon, setHoveredIcon] = useState(false);
  const [hoveredPendingPolygon, setHoveredPendingPolygon] = useState(false);
  const [hoveredRouteSegment, setHoveredRouteSegment] = useState<number | null>(null);
  const [isDraggingRouteNode, setIsDraggingRouteNode] = useState(false);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [activeDragNode, setActiveDragNode] = useState<any>(null);
  const [activeDragPolygon, setActiveDragPolygon] = useState<any>(null);
  const [contextMenu, setContextMenu] = useState<any>(null);
  const [isLegendSelected, setIsLegendSelected] = useState(false);
  // Magnifier loupe. Press M (or the toolbar button) to toggle it — both drive
  // the persistent `showMagnifier` setting. While it's on, magnetic snapping is
  // suspended (`effectiveSnapping`) so node placement follows the cursor exactly;
  // the user's toolbar snap preference is untouched and resumes when it's off.
  const magnifierZoom = mapSettings?.magnifierZoom ?? 3;
  const magnifierActive = !!mapSettings?.showMagnifier;
  const effectiveSnapping = !!mapSettings?.enableSnapping && !magnifierActive;
  const loupe = useLoupeRenderer(activeSheetId ?? null, pdfVersion ?? null, magnifierActive);
  // Refs so the keyboard handler (created once) can read the live magnifier state.
  const magnifierActiveRef = useRef(magnifierActive);
  magnifierActiveRef.current = magnifierActive;
  const magnifierZoomRef = useRef(magnifierZoom);
  magnifierZoomRef.current = magnifierZoom;

  // Pointer position lives OUTSIDE React state — a per-mousemove setState here
  // re-rendered the entire canvas tree every frame during panning. Leaf consumers
  // (draft ghost, stamp preview, crosshair, route ghost) subscribe to this store
  // and re-render at most once per animation frame; plain pan/zoom has zero
  // subscribers mounted, so mouse movement causes zero React work.
  const pointerStoreRef = useRef<ReturnType<typeof createPointerStore> | null>(null);
  if (!pointerStoreRef.current) pointerStoreRef.current = createPointerStore();
  const pointerStore = pointerStoreRef.current;
  useEffect(() => () => pointerStore.dispose(), [pointerStore]);

  // Lazy pointer read for HoverHistoryTooltip — it anchors once per hovered unit,
  // so it pulls the position on demand instead of subscribing to every move.
  const getTooltipPointerPos = useCallback(() => {
    const s = pointerStore.get();
    return s ? { x: s.screenX, y: s.screenY } : null;
  }, [pointerStore]);
  const routeMutation = useUpdateWalkSequence(activeSheetId);

  const [isShiftDown, setIsShiftDown] = useState(false);
  const [boxOrigin, setBoxOrigin] = useState<Point | null>(null);
  // Fresh boxOrigin for the keydown handler (its effect doesn't depend on boxOrigin).
  const boxOriginRef = useRef<Point | null>(null);
  useEffect(() => { boxOriginRef.current = boxOrigin; }, [boxOrigin]);

  // Drawing Tool Excellence — Phase 1 (interaction-state hardening). The instant a
  // trace closes we stay in `toolMode === 'draw'` and open the naming popover over an
  // editable PENDING polygon. `isEditingPending` is the single derived gate that makes
  // EVERY draw-only gesture inert during that window — box-draw arm/complete AND the
  // add-vertex click — so a long corner drag, a stray click, or a press-drag on empty
  // canvas can't be misread as "start a new box/draft" and silently replace the
  // not-yet-saved shape. Node drag, whole-shape drag, flip/rotate and naming all stay
  // live (they don't gate on this). Chosen over a dedicated `ToolMode 'edit_pending'`:
  // a derived guard keeps the change surgical (AGENTS.md §3 "keep FloorplanCanvas
  // lean") and avoids rippling a new mode through the toolMode-reset effects, the
  // toolbar, and the workbench tool wiring. boxOrigin/draftPoints are already cleared
  // before a pending polygon opens (box-complete and Enter/finish both null them), so
  // this gate only has to keep NEW ones from arming — nothing to mop up on entry.
  const isEditingPending = !!pendingPolygonPoints;
  // Fresh read for the window-level keydown handler (created once; not a dep of it).
  const isEditingPendingRef = useRef(isEditingPending);
  isEditingPendingRef.current = isEditingPending;

  // Drawing Tool Excellence — Phase 3 (undo/redo for the NOT-YET-SAVED polygon). A
  // local, in-memory history of `pendingPolygonPoints` snapshots, kept fully isolated
  // from the DB-backed saved-unit `useUndoRedo` (no DB writes; nothing enters the
  // offline IDB mutation queue, `status_logs`, or the `pendingChanges` buffer). It is
  // SEEDED with the freshly-traced shape the instant a pending polygon opens (so the
  // first Ctrl+Z returns to the original trace) and CLEARED when the polygon is saved
  // or cancelled (pending → null), so the next trace starts with a clean stack. Held in
  // a ref — the keydown handler mutates it without re-binding, and the React tree never
  // needs to re-render off it. The effect keys ONLY on the open/close transition (never
  // on `pendingPolygonPoints`), so an edit mid-session can't wipe the history; it reads
  // the opening points from a ref for the same reason.
  const editHistoryRef = useRef<EditHistory>(emptyEditHistory());
  useEffect(() => {
    editHistoryRef.current = isEditingPending
      ? seedEditHistory(pendingPolygonPointsRef.current ?? [])
      : emptyEditHistory();
  }, [isEditingPending]);

  // Wrap `onPendingPolygonMove`: record each committed pending edit (node move,
  // whole-shape move, flip) into the history, then apply it. Undo/redo replay snapshots
  // back through the RAW `onPendingPolygonMove` (via its ref) so they don't re-enter the
  // history here. Stable identity (depends only on the prop) so PendingPolygon's props
  // stay referentially steady.
  const handlePendingPolygonEdit = useCallback((newPoints: Point[]) => {
    editHistoryRef.current = pushSnapshot(editHistoryRef.current, newPoints);
    onPendingPolygonMove?.(newPoints);
  }, [onPendingPolygonMove]);

  // Drawing Tool Excellence — Phase 2 (validity warning). Run the LIVE pending shape
  // (with any in-progress node-drag applied via activeDragNode) through the pure
  // self-intersection check so a "bow-tie" lights up the moment a corner crosses the
  // shape and clears the moment it's dragged back out. A whole-shape drag is a pure
  // translation — it can't change self-intersection — so activeDragPolygon is ignored
  // here. This only WARNS (amber tint + a note); saving a bow-tie stays allowed.
  const pendingSelfIntersects = useMemo(() => {
    if (!pendingPolygonPoints || pendingPolygonPoints.length < 4) return false;
    const live =
      activeDragNode?.unitId === 'PENDING'
        ? pendingPolygonPoints.map((p, i) =>
            i === activeDragNode.index ? { pctX: activeDragNode.pctX, pctY: activeDragNode.pctY } : p,
          )
        : pendingPolygonPoints;
    return isSelfIntersecting(live);
  }, [pendingPolygonPoints, activeDragNode]);

  // Opening hold-keys (Phase 4a): track which TYPE key (D/C/H/P) is held, only while
  // opening capture is enabled (workbench), so the live map never even subscribes.
  // While one is down, the next edge placed during a trace is tagged an opening of
  // that type (committed in handleStageClick). Tapping a key to SET the active type
  // (for edit-after click-to-tag) is handled by the tracer, not here.
  useEffect(() => {
    if (!openingCaptureEnabled) {
      heldOpeningTypeRef.current = null;
      setArmedOpeningType(null);
      return;
    }
    const isTypingTarget = () =>
      document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget() || e.metaKey || e.ctrlKey || e.altKey) return;
      const type = openingTypeForKey(e.key);
      if (!type) return;
      heldOpeningTypeRef.current = type;
      setArmedOpeningType(type);
    };
    const up = (e: KeyboardEvent) => {
      const type = openingTypeForKey(e.key);
      if (!type || heldOpeningTypeRef.current !== type) return;
      heldOpeningTypeRef.current = null;
      setArmedOpeningType(null);
    };
    const clear = () => { heldOpeningTypeRef.current = null; setArmedOpeningType(null); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [openingCaptureEnabled]);

  const aspect = layoutRef.current.drawW / Math.max(1, layoutRef.current.drawH);
  const lastBoxEndRef = useRef(0);
  // Tracks the last snap result from onMouseMove — consumed by handleStageClick to guarantee
  // the committed draft point matches the visual snap indicator pixel-perfectly.
  const lastSnapRef = useRef<{ pctX: number; pctY: number; snapped: boolean } | null>(null);

  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });

  // Live viewport transform — the single freshest source of truth for the Stage's own
  // x/y/scale, updated synchronously at every mutation site (wheel, animation, drag). The
  // Stage props read from this ref instead of the debounced React state, so a re-render that
  // lands during the 100ms zoom-sync window never reconciles the stage back to a stale value
  // (fixes the wheel-zoom "snap-back"). React state (above) stays the source for derived math.
  const liveViewportRef = useRef({ scale: 1, x: 0, y: 0 });

  // Leading+trailing throttle pacing the React-state commits of the live transform.
  // Leading commit = instant LOD/culling response at gesture start; one commit per
  // ~120ms mid-gesture keeps them fresh; the flush/trailing commit lands the final
  // value. Every mutation site writes liveViewportRef BEFORE pushing, so a re-render
  // triggered by any commit reconciles the Stage to the value it already has
  // (preserving the snap-back fix).
  const viewportSync = useMemo(() => createViewportSync(({ scale, x, y }) => {
    setStageScale(scale);
    setStagePosition({ x, y });
  }), []);
  useEffect(() => () => viewportSync.cancel(), [viewportSync]);

  // Callback refs for functions defined later in the component — used by keyboard shortcuts
  // inside the useEffect (which runs before those functions are declared).
  const handleZoomRef = useRef<(direction: number) => void>(() => {});
  const resetViewRef = useRef<() => void>(() => {});
  const zoomToFitRef = useRef<(unitId: string) => void>(() => {});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputActive = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
      
      if (e.key === 'Shift') setIsShiftDown(true);
      
      if (e.key === 'Escape') {
        setIsLegendSelected(false);
        if (!isInputActive) {
          if (magnifierActiveRef.current) {
            // Escape dismisses the magnifier first — one transient layer at a
            // time, like the draft/tool backout below. A second Escape then
            // clears the draft, a third returns to pan. Mirrors the M toggle.
            e.stopImmediatePropagation();
            useSettingsStore.getState().setMapSettings({ showMagnifier: false });
          } else if (toolMode === 'draw' && draftPointsRef.current.length > 0) {
            e.stopImmediatePropagation();
            setDraftPoints([]);
            setDraftOpeningEdges([]);
          } else if (toolMode === 'capture_line' && boxOriginRef.current) {
            // Cancel a half-placed grid axis (start node dropped, no end yet) but stay
            // in capture mode so the next click can re-place it.
            e.stopImmediatePropagation();
            setBoxOrigin(null);
          } else if (toolMode === 'calibrate' && (calibratePointsRef.current.length > 0 || calibratePromptRef.current)) {
            // Back out a half-placed / awaiting-length calibration line but stay in
            // calibrate mode so the next click starts a fresh line.
            e.stopImmediatePropagation();
            setCalibratePoints([]);
            setCalibratePrompt(null);
            setCalibrateInput('');
            setCalibrateError(false);
          } else if (toolMode === 'measure' && measurePointsRef.current.length > 0) {
            // Clear the current measurement run but stay in measure mode; a second Esc
            // (no points left) falls through to return to pan.
            e.stopImmediatePropagation();
            setMeasurePoints([]);
          } else if (isEditingPendingRef.current) {
            // Drawing Tool Excellence — Phase 1. A freshly-traced polygon is open for
            // naming. Esc must NOT fall through to the tool backout below: switching to
            // 'pan' here would strand the pending polygon + naming popover in a half-live
            // state. When the naming input has focus (the default on open) the popover's
            // own Esc handler already cancels; this branch just makes Esc a safe no-op
            // when focus is elsewhere instead of a confusing tool switch.
          } else if (toolMode !== 'pan') {
            onToolModeChange('pan');
          }
        }
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedUnitIdsRef.current && selectedUnitIdsRef.current.length > 0 && !isInputActive) {
        e.preventDefault();
        const activeIds = selectedUnitIdsRef.current;
        const currentUnits = unitsRef.current;
        const currentLayout = layoutRef.current;

        if (currentLayout && currentLayout.drawW && currentLayout.drawH) {
          const nudgePx = 1; 
          const dx = e.key === 'ArrowLeft' ? -nudgePx / currentLayout.drawW : e.key === 'ArrowRight' ? nudgePx / currentLayout.drawW : 0;
          const dy = e.key === 'ArrowUp' ? -nudgePx / currentLayout.drawH : e.key === 'ArrowDown' ? nudgePx / currentLayout.drawH : 0;

          activeIds.forEach(id => {
            const unit = currentUnits.find(u => u.id === id);
            if (unit && unit.polygon_coordinates) {
              const newPoints = unit.polygon_coordinates.map(p => ({
                pctX: p.pctX + dx,
                pctY: p.pctY + dy
              }));
              if (warnIfUnwired(onUpdateUnitPolygonRef.current, 'onUpdateUnitPolygon:arrow-nudge')) {
                onUpdateUnitPolygonRef.current?.(unit.id, newPoints);
              }
            }
          });
        }
      }

      // Drawing Tool Excellence — Phase 3. While a freshly-traced polygon is open for
      // naming, Ctrl/Cmd+Z steps back through this session's local edit history and
      // Ctrl/Cmd+Shift+Z re-applies — entirely separate from the DB-backed saved-unit
      // undo. Gated on `isEditingPendingRef` so it takes priority over the draft-vertex
      // undo below; `stopImmediatePropagation` keeps it from also tripping that or the
      // parent's saved-unit `useUndoRedo`. Skipped while a text input is focused so
      // Ctrl+Z inside the name field still does native text undo (not geometry undo).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && isEditingPendingRef.current && !isInputActive) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const result = e.shiftKey
          ? redoEditHistory(editHistoryRef.current)
          : undoEditHistory(editHistoryRef.current);
        editHistoryRef.current = result.history;
        if (result.current) onPendingPolygonMoveRef.current?.(result.current);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (toolMode === 'draw' && draftPointsRef.current.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          // Undo the last vertex; drop any opening tag whose edge no longer exists
          // (the removed vertex was the end of edge newLen-1).
          const newLen = draftPointsRef.current.length - 1;
          setDraftPoints(prev => prev.slice(0, -1));
          setDraftOpeningEdges(prev => prev.filter(o => o.edgeIndex <= newLen - 2));
        }
      }

      if (toolMode === 'draw' && e.key === 'Enter') {
        if (!isInputActive && draftPointsRef.current.length > 2) {
          e.stopImmediatePropagation();
          if (warnIfUnwired(onPolygonComplete, 'onPolygonComplete:draw-enter')) {
            onPolygonComplete(draftPointsRef.current, draftOpeningEdgesRef.current);
          }
          setDraftPoints([]);
          setDraftOpeningEdges([]);
        }
      }

      // --- Phase 2 Keyboard Shortcuts ---
      if (!isInputActive && !(e.metaKey || e.ctrlKey)) {
        // Space held = temporary pan (like Figma/Photoshop)
        if (e.key === ' ' && !spaceWasPanRef.current) {
          e.preventDefault();
          spaceWasPanRef.current = toolMode as ToolMode;
          onToolModeChange('pan');
        }

        // Number keys for quick tool access
        if (e.key === '1') onToolModeChange('select');
        if (e.key === '2') onToolModeChange('pan');
        if (e.key === '3') onToolModeChange('draw');

        // M = toggle the magnifier loupe on/off (unified with the toolbar button).
        // The `e.repeat` guard means holding the key flips it once, not every frame.
        if (e.key.toLowerCase() === 'm' && !e.repeat) {
          const cur = useSettingsStore.getState().mapSettings.showMagnifier;
          useSettingsStore.getState().setMapSettings({ showMagnifier: !cur });
        }

        // While the loupe is up, [ and ] adjust its magnification (2×–8×),
        // Photoshop-style. The live "N×" readout in the lens gives feedback.
        if (magnifierActiveRef.current && (e.key === '[' || e.key === ']')) {
          e.preventDefault();
          const next = Math.min(8, Math.max(2, (magnifierZoomRef.current || 3) + (e.key === ']' ? 1 : -1)));
          useSettingsStore.getState().setMapSettings({ magnifierZoom: next });
        }

        // +/- for zoom (via ref to avoid block-scoped variable error)
        if (e.key === '=' || e.key === '+') handleZoomRef.current(1);
        if (e.key === '-' || e.key === '_') handleZoomRef.current(-1);

        // 0 or Home = fit to view
        if (e.key === '0' || e.key === 'Home') resetViewRef.current();

        // F = fit selection to screen
        if (e.key === 'f' && selectedUnitIdsRef.current?.length > 0) {
          zoomToFitRef.current(selectedUnitIdsRef.current[0]);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftDown(false);
      // Release space = return to previous tool
      if (e.key === ' ' && spaceWasPanRef.current) {
        onToolModeChange(spaceWasPanRef.current);
        spaceWasPanRef.current = null;
      }
    };

    // Safety: if user holds Space and switches windows, keyup never fires.
    // Reset the temporary pan state on window blur.
    const handleBlur = () => {
      if (spaceWasPanRef.current) {
        onToolModeChange(spaceWasPanRef.current);
        spaceWasPanRef.current = null;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleBlur);

    const checkSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    checkSize();
    const timeouts = [100, 500, 1000].map((t) => setTimeout(checkSize, t));

    window.addEventListener('resize', checkSize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('resize', checkSize);
      timeouts.forEach(clearTimeout);
    };
  }, [imageUrl, toolMode, onPolygonComplete, onToolModeChange]);

  // Re-measure when the CONTAINER resizes (e.g. dragging the side panel), not just
  // on window resize. Without this the Stage/layout stay stale after a container
  // resize, so the floor plan and its markups don't refit until a refresh.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        setDimensions(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
      });
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (toolMode !== 'draw') { setDraftPoints([]); setDraftOpeningEdges([]); }
    // Clear any half-placed calibration line + length prompt whenever we leave the
    // calibrate tool, so a stale point/prompt never bleeds into another mode.
    if (toolMode !== 'calibrate') { setCalibratePoints([]); setCalibratePrompt(null); setCalibrateInput(''); setCalibrateError(false); }
    // Drop the ephemeral measure run whenever we leave the measure tool (the fraction
    // preference is intentionally kept). Nothing here persists.
    if (toolMode !== 'measure') { setMeasurePoints([]); }
    if (!['select', 'multi_select', 'add_node', 'delete_node', 'stamp'].includes(toolMode)) {
      onClearSelection();
    }
    
    if (toolMode === 'route') {
      const existingRoute = [...unitsRef.current]
        .filter(u => typeof (u as any).walk_sequence === 'number' && (u as any).walk_sequence !== null)
        .sort((a, b) => ((a as any).walk_sequence as number) - ((b as any).walk_sequence as number))
        .map(u => u.id);
      setPendingRoute(existingRoute);
    } else {
      setPendingRoute([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const layout = useMemo(() => {
    const stageW = dimensions.width;
    const stageH = dimensions.height;
    if (!stageW || !stageH) {
      return { offsetX: 0, offsetY: 0, drawW: 0, drawH: 0, stageW: 0, stageH: 0 };
    }

    const nw = originalWidth;
    const nh = originalHeight;

    if (!nw || !nh) {
      return { offsetX: 0, offsetY: 0, drawW: stageW, drawH: stageH, stageW, stageH };
    }
    const scale = Math.min(stageW / nw, stageH / nh);
    const drawW = nw * scale;
    const drawH = nh * scale;
    const offsetX = (stageW - drawW) / 2;
    const offsetY = (stageH - drawH) / 2;
    return { offsetX, offsetY, drawW, drawH, stageW, stageH };
  }, [originalWidth, originalHeight, dimensions.width, dimensions.height]);

  useEffect(() => { layoutRef.current = layout; }, [layout]);

  const visibleBoundingBox = useMemo(() => {
    if (!layout.drawW || !layout.drawH || !dimensions.width || !dimensions.height) return null;
    const minX = ((-stagePosition.x / stageScale) - layout.offsetX) / layout.drawW;
    const minY = ((-stagePosition.y / stageScale) - layout.offsetY) / layout.drawH;
    const maxX = (((dimensions.width - stagePosition.x) / stageScale) - layout.offsetX) / layout.drawW;
    const maxY = (((dimensions.height - stagePosition.y) / stageScale) - layout.offsetY) / layout.drawH;
    return {
      minPctX: minX - 0.05,
      maxPctX: maxX + 0.05,
      minPctY: minY - 0.05,
      maxPctY: maxY + 0.05,
    };
  }, [stagePosition, stageScale, dimensions, layout]);

  const visibleUnits = useMemo(() => {
    if (!visibleBoundingBox || !layout.drawW) return units;
    const { minPctX, maxPctX, minPctY, maxPctY } = visibleBoundingBox;

    return units.filter(unit => {
      // Unmapped units have no renderable geometry — exclude them unless the user is
      // actively drawing, where clicking the canvas can target any unit slot.
      if (!unit.polygon_coordinates || (unit.polygon_coordinates as any[]).length === 0) {
        return toolMode === 'draw';
      }
      
      return unit.polygon_coordinates.some(pt => 
        pt.pctX >= minPctX && 
        pt.pctX <= maxPctX && 
        pt.pctY >= minPctY && 
        pt.pctY <= maxPctY
      );
    });
  }, [units, visibleBoundingBox, layout.drawW, toolMode]);

  useImperativeHandle(ref, () => ({
    exportFullImage: () => {
      if (!stageRef.current) return null;
      
      const stage = stageRef.current;

      const nw = originalWidth;
      const nh = originalHeight;
      if (!nw || !nh) return null;
      
      const oldScale = stage.scaleX();
      const oldPosition = stage.position();
      const oldWidth = stage.width();
      const oldHeight = stage.height();

      const exportScale = nw / layout.drawW;

      stage.width(nw);
      stage.height(nh);
      stage.scale({ x: exportScale, y: exportScale });
      stage.position({ x: -layout.offsetX * exportScale, y: -layout.offsetY * exportScale });
      
      const dataUrl = stage.toDataURL({ pixelRatio: 1 });

      stage.width(oldWidth);
      stage.height(oldHeight);
      stage.scale({ x: oldScale, y: oldScale });
      stage.position(oldPosition);

      return { dataUrl, width: nw, height: nh };
    },
    zoomToFit,
  }));

  // Cleanup animation on unmount or sheet change
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (wheelRafRef.current != null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
    };
  }, [activeSheetId]);

  // Animate the viewport from current state to a target scale/position over durationMs.
  // Uses requestAnimationFrame with ease-out interpolation. Syncs OSD on every frame.
  // Cancellable via animationFrameRef — any new viewport mutation cancels the running animation.
  // Stop any in-flight smooth-wheel glide and clear its target/anchor.
  const cancelSmoothWheel = useCallback(() => {
    if (wheelRafRef.current != null) {
      cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = null;
    }
    wheelTargetScaleRef.current = null;
    wheelAnchorRef.current = null;
  }, []);

  // One rAF loop that eases the live stage transform toward wheelTargetScaleRef,
  // re-anchored at the cursor every frame so the point under the pointer stays put.
  const stepSmoothWheel = useCallback(() => {
    const stage = stageRef.current;
    const anchor = wheelAnchorRef.current;
    const target = wheelTargetScaleRef.current;
    if (!stage || !anchor || target == null) {
      wheelRafRef.current = null;
      return;
    }

    const now = performance.now();
    const dt = (now - wheelLastFrameRef.current) / 1000;
    wheelLastFrameRef.current = now;

    const current = stage.scaleX();
    let next = dampToward(current, target, dt, WHEEL_SMOOTH_TAU);
    // Snap home once within 0.1% so the loop terminates instead of crawling.
    const done = Math.abs(next - target) / target < 0.001;
    if (done) next = target;

    const pos = clampStagePosition(
      { x: anchor.screenX - anchor.contentX * next, y: anchor.screenY - anchor.contentY * next },
      next,
      layoutRef.current,
      layoutRef.current.stageW,
      layoutRef.current.stageH,
    );

    stage.scale({ x: next, y: next });
    stage.position(pos);
    stage.batchDraw();
    liveViewportRef.current = { scale: next, x: pos.x, y: pos.y };
    viewportSync.push(liveViewportRef.current);

    if (done) {
      wheelRafRef.current = null;
      wheelTargetScaleRef.current = null;
      wheelAnchorRef.current = null;
      viewportSync.flush();
    } else {
      wheelRafRef.current = requestAnimationFrame(stepSmoothWheel);
    }
  }, [viewportSync]);

  const animateViewport = useCallback((targetScale: number, targetPosition: { x: number; y: number }, durationMs: number) => {
    // Cancel any running animation (rAF tween and/or smooth-wheel glide)
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    cancelSmoothWheel();

    const stage = stageRef.current;
    if (!stage) {
      liveViewportRef.current = { scale: targetScale, x: targetPosition.x, y: targetPosition.y };
      setStageScale(targetScale);
      setStagePosition(targetPosition);
      return;
    }

    const startScale = stage.scaleX();
    const startPos = { x: stage.x(), y: stage.y() };
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      // Ease-out cubic: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - progress, 3);

      const currentScale = startScale + (targetScale - startScale) * eased;
      const currentPos = {
        x: startPos.x + (targetPosition.x - startPos.x) * eased,
        y: startPos.y + (targetPosition.y - startPos.y) * eased,
      };

      // Direct Konva mutation for 60fps
      stage.scale({ x: currentScale, y: currentScale });
      stage.position(currentPos);
      stage.batchDraw();
      liveViewportRef.current = { scale: currentScale, x: currentPos.x, y: currentPos.y };
      viewportSync.push(liveViewportRef.current);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        // Animation complete — commit the final transform immediately
        animationFrameRef.current = null;
        liveViewportRef.current = { scale: targetScale, x: targetPosition.x, y: targetPosition.y };
        viewportSync.push(liveViewportRef.current);
        viewportSync.flush();
      }
    };

    animationFrameRef.current = requestAnimationFrame(step);
  }, [viewportSync]);

  // ── Mini-map navigation (Phase 5) ────────────────────────────────────────
  // The bottom-right MiniMapOverlay hands back already-projected (unclamped)
  // stage positions; the canvas owns the Konva stage, so clamping + applying
  // live the move here keeps all stage knowledge in one place. Reuse the same
  // primitives as wheel/zoom: clampStagePosition, animateViewport, viewportSync.
  const miniMapRecenter = useCallback((target: { x: number; y: number }) => {
    const scale = liveViewportRef.current.scale;
    const lay = layoutRef.current;
    const clamped = clampStagePosition(target, scale, lay, lay.stageW, lay.stageH);
    animateViewport(scale, clamped, 250);
  }, [animateViewport]);

  const miniMapPanTo = useCallback((target: { x: number; y: number }) => {
    const stage = stageRef.current;
    if (!stage) return;
    const scale = stage.scaleX();
    const lay = layoutRef.current;
    const clamped = clampStagePosition(target, scale, lay, lay.stageW, lay.stageH);
    stage.position(clamped);
    stage.batchDraw();
    liveViewportRef.current = { scale, x: clamped.x, y: clamped.y };
    viewportSync.push(liveViewportRef.current);
  }, [viewportSync]);

  const miniMapPanEnd = useCallback(() => {
    viewportSync.flush();
  }, [viewportSync]);

  const miniMapResize = useCallback((scale: number) => {
    useSettingsStore.getState().setMapSettings({ miniMapScale: scale });
  }, []);

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;

    // Cancel any running viewport animation (e.g., reset view)
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    const oldScale = stage.scaleX();
    const intent = classifyWheelIntent(e.evt);

    // Hybrid scroll model: trackpad two-finger scroll pans; mouse wheel and pinch zoom.
    if (intent === 'pan') {
      cancelSmoothWheel();
      const panPos = clampStagePosition(
        { x: stage.x() - e.evt.deltaX, y: stage.y() - e.evt.deltaY },
        oldScale,
        layoutRef.current,
        dimensions.width,
        dimensions.height,
      );
      stage.position(panPos);
      stage.batchDraw();
      liveViewportRef.current = { scale: oldScale, x: panPos.x, y: panPos.y };
      viewportSync.push(liveViewportRef.current);
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // Smooth glide path — opt-in, MOUSE WHEEL ONLY. Each notch nudges a target
    // scale (compounding off the live target, not the mid-glide scale) and re-anchors
    // at the cursor; stepSmoothWheel eases toward it. Trackpad pinch stays on the
    // instant path below — its deltas are already small and continuous.
    if (intent === 'zoom-wheel' && mapSettings?.smoothWheelZoom !== false) {
      const base = wheelTargetScaleRef.current ?? oldScale;
      const delta = Math.min(Math.abs(e.evt.deltaY), 50);
      const stretch = Math.pow(1.05, delta / 25);
      let target = e.evt.deltaY > 0 ? base / stretch : base * stretch;
      target = Math.max(MIN_SCALE, Math.min(target, MAX_SCALE));
      wheelTargetScaleRef.current = target;
      wheelAnchorRef.current = {
        screenX: pointer.x,
        screenY: pointer.y,
        contentX: (pointer.x - stage.x()) / oldScale,
        contentY: (pointer.y - stage.y()) / oldScale,
      };
      if (wheelRafRef.current == null) {
        wheelLastFrameRef.current = performance.now();
        wheelRafRef.current = requestAnimationFrame(stepSmoothWheel);
      }
      return;
    }

    // Instant path (trackpad pinch, or mouse wheel with smoothing off).
    cancelSmoothWheel();
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    let newScale;
    if (intent === 'zoom-pinch') {
      // True trackpad sensitivity
      newScale = oldScale * Math.exp(-e.evt.deltaY / 100);
    } else {
      // Mouse wheel: smoother inertial friction, capping the max delta
      const delta = Math.min(Math.abs(e.evt.deltaY), 50);
      const stretch = Math.pow(1.05, delta / 25);
      newScale = e.evt.deltaY > 0 ? oldScale / stretch : oldScale * stretch;
    }

    // Scale Clamping
    newScale = Math.max(MIN_SCALE, Math.min(newScale, MAX_SCALE));

    const newPos = clampStagePosition(
      {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      },
      newScale,
      layoutRef.current,
      dimensions.width,
      dimensions.height,
    );

    // Direct Konva Mutation (bypasses React loop for 60fps)
    stage.scale({ x: newScale, y: newScale });
    stage.position(newPos);
    stage.batchDraw();
    liveViewportRef.current = { scale: newScale, x: newPos.x, y: newPos.y };

    // Throttled sync into React state (leading + trailing) so LOD selection and
    // visible-unit culling stay fresh during a sustained gesture.
    viewportSync.push(liveViewportRef.current);
  };

  const handleZoom = (direction: number) => {
    setContextMenu(null);
    if (!stageRef.current) return;
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const scaleBy = 1.2;
    const newScale = Math.max(0.1, Math.min(direction === 1 ? oldScale * scaleBy : oldScale / scaleBy, 15));
    
    const centerPoint = {
      x: dimensions.width / 2,
      y: dimensions.height / 2
    };
    
    const mousePointTo = {
      x: (centerPoint.x - stage.x()) / oldScale,
      y: (centerPoint.y - stage.y()) / oldScale,
    };
    
    const newPos = {
      x: centerPoint.x - mousePointTo.x * newScale,
      y: centerPoint.y - mousePointTo.y * newScale,
    };

    animateViewport(newScale, newPos, 200);
  };

  const handleStageClick = (e: any) => {
    setContextMenu(null);
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    const logicalX = (pointer.x - stage.x()) / stageScale;
    const logicalY = (pointer.y - stage.y()) / stageScale;

    const { offsetX, offsetY, drawW, drawH } = layout;
    if (drawW <= 0 || drawH <= 0) return;

    let pctX = (logicalX - offsetX) / drawW;
    let pctY = (logicalY - offsetY) / drawH;

    if (toolMode === 'stamp' && selectedUnitIds?.length === 1) {
      const sourceUnit = units.find(u => u.id === selectedUnitIds[0]);
      if (sourceUnit && sourceUnit.polygon_coordinates && sourceUnit.polygon_coordinates.length > 0) {
        let sumX = 0, sumY = 0;
        sourceUnit.polygon_coordinates.forEach(pt => { sumX += pt.pctX; sumY += pt.pctY; });
        const cx = sumX / sourceUnit.polygon_coordinates.length;
        const cy = sumY / sourceUnit.polygon_coordinates.length;
        const dx = pctX - cx;
        const dy = pctY - cy;
        
        const translatedPoints = sourceUnit.polygon_coordinates.map(pt => ({
          pctX: pt.pctX + dx,
          pctY: pt.pctY + dy
        }));

        if (warnIfUnwired(onInstantStamp, 'onInstantStamp:stamp')) {
          onInstantStamp?.(selectedUnitIds[0], translatedPoints);
        }
      }
    } else if (toolMode === 'draw' && !isEditingPending) {
      // `!isEditingPending` (Phase 1): while a freshly-traced polygon is open for naming
      // we're still nominally in draw mode, but a click on the canvas (or on a pending
      // anchor, whose click bubbles up to the Stage) must NOT start a SECOND draft on top
      // of it — that left stray draft dots over the shape being named. The add-vertex
      // tool only arms again once the pending polygon is saved or cancelled.
      if (Date.now() - lastBoxEndRef.current < 200) return;
      if (e.evt.shiftKey && draftPoints.length > 0) {
        const lastPoint = draftPoints[draftPoints.length - 1];
        const dx = Math.abs(pctX - lastPoint.pctX);
        const dy = Math.abs(pctY - lastPoint.pctY);
        if (dx > dy) pctY = lastPoint.pctY;
        else pctX = lastPoint.pctX;
      } else if (effectiveSnapping && lastSnapRef.current?.snapped) {
        // Consume the last snap computed by onMouseMove — avoids double-computation
        // and guarantees the committed point matches the visual snap ring.
        pctX = lastSnapRef.current.pctX;
        pctY = lastSnapRef.current.pctY;
      }
      // Opening capture (Phase 4a): if a type key (D/C/H/P) is held and this isn't the
      // first vertex, the edge from the previous vertex to this new one is an opening
      // of the held type. The new edge's start vertex is the current last index.
      const heldType = heldOpeningTypeRef.current;
      if (openingCaptureEnabled && heldType && draftPoints.length > 0) {
        const edgeIndex = draftPoints.length - 1;
        setDraftOpeningEdges(prev => [...prev.filter(o => o.edgeIndex !== edgeIndex), { edgeIndex, type: heldType }]);
      }
      setDraftPoints([...draftPoints, { pctX, pctY }]);
    } else if (toolMode === 'calibrate') {
      // Drop exactly two snapped points across a known dimension. Consume the fresh
      // snap computed by onMouseMove so the committed point matches the visual ring
      // (same trick as the draw path). After the 2nd point, freeze and prompt.
      if (calibratePromptRef.current) return; // already awaiting a length
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
    } else if (toolMode === 'measure') {
      // Drop a snapped point onto the running measurement polyline. Consume the fresh
      // snap from onMouseMove so the committed point matches the visual ring.
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
    } else if (toolMode === 'capture_line') {
      // Two-click grid-axis placement (AI Tracing Assist — Phase 3c follow-up): the
      // first click drops the START node, the second drops the END node and emits.
      // Between clicks you can pan/zoom freely — no held drag (which was jumpy and
      // awkward when zoomed in). Both ends snap to the detected vectors.
      const snapped = snapPoint({ pctX, pctY });
      if (!boxOrigin) {
        setBoxOrigin(snapped);
      } else {
        if (Math.abs(snapped.pctX - boxOrigin.pctX) > 0.02 || Math.abs(snapped.pctY - boxOrigin.pctY) > 0.02) {
          lastBoxEndRef.current = Date.now();
          onCaptureLine?.(boxOrigin, snapped);
        }
        setBoxOrigin(null);
      }
    } else if (['select', 'multi_select', 'add_node', 'delete_node'].includes(toolMode)) {
      if (e.target === stage || e.target.nodeType === 'Image' || e.target.attrs?.id === 'bg-rect') {
        onClearSelection();
        onSelectGridline?.(null); // clicking empty canvas also drops a selected gridline
        setIsLegendSelected(false);
      }
    } else {
      if (e.target === stage || e.target.nodeType === 'Image' || e.target.attrs?.id === 'bg-rect') {
        setIsLegendSelected(false);
      }
    }
  };

  useEffect(() => {
    setContextMenu(null);
    // Drop any half-placed capture origin (e.g. a grid-axis start node) when the tool
    // changes, so a stale start never gets paired with a later click.
    setBoxOrigin(null);
  }, [toolMode]);

  const finishDrawing = () => {
    if (draftPoints.length > 2) {
      if (warnIfUnwired(onPolygonComplete, 'onPolygonComplete:finish')) {
        onPolygonComplete(draftPoints, draftOpeningEdges);
      }
      setDraftPoints([]);
      setDraftOpeningEdges([]);
    }
  };

  const cancelCalibrate = () => {
    setCalibratePoints([]);
    setCalibratePrompt(null);
    setCalibrateInput('');
    setCalibrateError(false);
  };

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

  const handlePolygonClick = (e: any, unit: Unit) => {
    if (toolMode === 'route') {
      e.cancelBubble = true;
      if (routeSubMode === 'add' && !pendingRoute.includes(unit.id)) {
        setPendingRoute((prev: string[]) => [...prev, unit.id]);
      } else if (routeSubMode === 'remove' && pendingRoute.includes(unit.id)) {
        setPendingRoute((prev: string[]) => prev.filter(id => id !== unit.id));
      }
      return;
    }
    if (!['select', 'multi_select', 'add_node', 'delete_node'].includes(toolMode)) return;
    e.cancelBubble = true;
    
    if (toolMode === 'multi_select') {
       onSelectUnit(unit.id); // It's actually toggleSelectedUnitId
       return;
    }

    if (toolMode === 'select') {
      if (!selectedUnitIds.includes(unit.id)) {
        onSetSelectedUnitIds([unit.id]);
        return;
      }
    }

    if (['add_node', 'delete_node'].includes(toolMode)) {
      if (!selectedUnitIds.includes(unit.id)) {
        onSetSelectedUnitIds([unit.id]);
      }
    }

    if (toolMode === 'add_node') {
      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      const logicalX = (pointer.x - stage.x()) / stageScale;
      const logicalY = (pointer.y - stage.y()) / stageScale;
      const pctX = (logicalX - layout.offsetX) / layout.drawW;
      const pctY = (logicalY - layout.offsetY) / layout.drawH;
      
      let bestIdx = -1;
      let minDistance = Infinity;
      const pts = unit.polygon_coordinates || [];
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i+1) % pts.length];
        const d = distToSegment({pctX, pctY}, p1, p2);
        if (d < minDistance) {
          minDistance = d;
          bestIdx = i;
        }
      }
      if (bestIdx !== -1) {
        const newPoints = [...pts];
        newPoints.splice(bestIdx + 1, 0, {pctX, pctY});
        if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:add-node')) {
          onUpdateUnitPolygon?.(unit.id, newPoints);
        }
      }
    }
  };

  const handleFlip = (direction: 'horizontal' | 'vertical') => {
    if (pendingPolygonPoints && pendingPolygonPoints.length > 0) {
      const newPoints = pendingPolygonPoints.map(p => ({ ...p }));
      if (direction === 'horizontal') {
        const xs = newPoints.map(p => p.pctX);
        const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
        newPoints.forEach(p => p.pctX = centerX - (p.pctX - centerX));
      } else {
        const ys = newPoints.map(p => p.pctY);
        const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
        newPoints.forEach(p => p.pctY = centerY - (p.pctY - centerY));
      }
      // Phase 3: route through the history-recording wrapper so a flip is one undo step.
      handlePendingPolygonEdit(newPoints);
      return;
    }

    if (selectedUnitIds?.length !== 1) return;
    const unit = units.find(u => u.id === selectedUnitIds[0]);
    if (!unit || !unit.polygon_coordinates || unit.polygon_coordinates.length === 0) return;
    
    const pts = unit.polygon_coordinates;
    const newPoints = pts.map(p => ({ ...p }));
    
    if (direction === 'horizontal') {
      const xs = pts.map(p => p.pctX);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      newPoints.forEach(p => p.pctX = centerX - (p.pctX - centerX));
    } else {
      const ys = pts.map(p => p.pctY);
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
      newPoints.forEach(p => p.pctY = centerY - (p.pctY - centerY));
    }
    
    
    if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:flip')) {
      onUpdateUnitPolygon?.(unit.id, newPoints);
    }
  };

  const handleRotatePolygon = (direction: 'left' | 'right', overrideId: string | null = null) => {
    const targetId = overrideId || (selectedUnitIds?.length === 1 ? selectedUnitIds[0] : null);
    if (!targetId) return;
    const unit = units.find(u => u.id === targetId);
    if (!unit || !unit.polygon_coordinates || unit.polygon_coordinates.length === 0) return;

    const { drawW, drawH } = layout;
    if (drawW <= 0 || drawH <= 0) return;
    const aspect = drawW / drawH;

    const pts = unit.polygon_coordinates;
    const centroid = getCentroid(pts);
    const cx = centroid.pctX || 0;
    const cy = centroid.pctY || 0;

    const newPoints = pts.map(p => {
      // 1. Get relative offsets in percentage space
      const dx = p.pctX - cx;
      const dy = p.pctY - cy;

      // 2. Convert to 'real' aspect-corrected space
      const realX = dx * aspect;
      const realY = dy;

      // 3. Rotate 90 degrees around (0,0) in real space
      let rotX, rotY;
      if (direction === 'left') { // CCW
        rotX = realY;
        rotY = -realX;
      } else { // CW
        rotX = -realY;
        rotY = realX;
      }

      // 4. Convert back to percentage space and re-add centroid
      return { 
        pctX: cx + (rotX / aspect), 
        pctY: cy + rotY 
      };
    });

    if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:rotate')) {
      onUpdateUnitPolygon?.(unit.id, newPoints);
    }
  };

  const handlePolygonDragEnd = (e: any, unit: Unit) => {
    if (toolMode !== 'select') return;
    const dx = e.target.x() / layout.drawW;
    const dy = e.target.y() / layout.drawH;
    
    e.target.x(0);
    e.target.y(0);
    
    if (dx === 0 && dy === 0) return;

    if (unit.polygon_coordinates) {
      const newPoints = unit.polygon_coordinates.map(p => ({
        pctX: p.pctX + dx,
        pctY: p.pctY + dy
      }));
      if (!isFinitePolygon(newPoints)) {
        console.warn('[geometry] polygon move produced an invalid shape — not saving', unit.id);
        return;
      }
      if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:polygon-drag')) {
        onUpdateUnitPolygon?.(unit.id, newPoints);
      }
    }
  };

  const handleAnchorDragEnd = (e: any, unitId: string, index: number, overridePct?: Point) => {
    if (!['select', 'add_node'].includes(toolMode)) return;
    const node = e.target;

    // MappedUnit computes the snapped position synchronously and passes it as
    // overridePct; fall back to the raw node position otherwise.
    let pctX = overridePct ? overridePct.pctX : (node.x() - layout.offsetX) / layout.drawW;
    let pctY = overridePct ? overridePct.pctY : (node.y() - layout.offsetY) / layout.drawH;

    if (!overridePct && effectiveSnapping) {
      const snap = getSnappedCoordinate(pctX, pctY, vectorTree, aspect, layout.drawW, stageScale, mapSettings.snappingStrength || 15);
      if (snap.snapped) {
        pctX = snap.pctX;
        pctY = snap.pctY;
      }
    }

    const unit = units.find(u => u.id === unitId);
    if (!unit || !unit.polygon_coordinates) return;
    
    const newPoints = [...unit.polygon_coordinates];
    newPoints[index] = { pctX, pctY };
    // Never persist a corrupt shape (NaN/off-canvas from a bad drag). Better to
    // leave the saved geometry untouched than to write a degenerate polygon.
    if (!isFinitePolygon(newPoints)) {
      console.warn('[geometry] node move produced an invalid polygon — not saving', unitId);
      return;
    }
    if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:node-move')) {
      onUpdateUnitPolygon?.(unitId, newPoints);
    }
  };

  const handleAnchorClick = (e: any, unitId: string, index: number) => {
    e.cancelBubble = true;
    if (toolMode !== 'delete_node') return;
    const unit = units.find(u => u.id === unitId);
    if (!unit || !unit.polygon_coordinates || unit.polygon_coordinates.length <= 3) return;

    const newPoints = [...unit.polygon_coordinates];
    newPoints.splice(index, 1);
    if (warnIfUnwired(onUpdateUnitPolygon, 'onUpdateUnitPolygon:delete-node')) {
      onUpdateUnitPolygon?.(unitId, newPoints);
    }
  };

  // Drawing Tool Excellence — Phase 4. Pending-polygon vertex insert/delete: the
  // not-yet-saved twins of handleAddNodeToPolygon / handleAnchorClick above. Both
  // write through handlePendingPolygonEdit (NOT the raw onPendingPolygonMove) so the
  // edit lands in the Phase 3 in-memory undo history and Ctrl+Z works on it. They
  // read the live points from a ref, so the callbacks stay referentially stable and
  // PendingPolygon's props don't churn.
  const handleInsertPendingVertex = useCallback((edgeIndex: number) => {
    const pts = pendingPolygonPointsRef.current;
    if (!pts || pts.length < 3) return;
    const p1 = pts[edgeIndex];
    const p2 = pts[(edgeIndex + 1) % pts.length];
    if (!p1 || !p2) return;
    // Insert at the edge midpoint the "+" marks (predictable; no pointer math).
    const midpoint = { pctX: (p1.pctX + p2.pctX) / 2, pctY: (p1.pctY + p2.pctY) / 2 };
    const newPoints = [...pts];
    newPoints.splice(edgeIndex + 1, 0, midpoint);
    // Guard like handleAnchorDragEnd — never apply a degenerate/off-canvas shape.
    if (!isFinitePolygon(newPoints)) return;
    handlePendingPolygonEdit(newPoints);
  }, [handlePendingPolygonEdit]);

  const handleDeletePendingVertex = useCallback((index: number) => {
    const pts = pendingPolygonPointsRef.current;
    // Mirror handleAnchorClick's <= 3 guard — never drop below a triangle.
    if (!pts || pts.length <= 3) return;
    const newPoints = [...pts];
    newPoints.splice(index, 1);
    if (!isFinitePolygon(newPoints)) return;
    handlePendingPolygonEdit(newPoints);
  }, [handlePendingPolygonEdit]);

  // Saved-unit midpoint "+" insert — the same affordance as the pending one, brought
  // to selected saved rooms so adding a corner is consistent across both (no need to
  // switch into the add_node tool). Persists via onUpdateUnitPolygon (which already
  // pushes a DB undo action). Reads units/callback from refs so the callback stays
  // referentially stable and MappedUnit's memo doesn't churn.
  const handleInsertSavedVertex = useCallback((unitId: string, edgeIndex: number) => {
    const unit = unitsRef.current.find(u => u.id === unitId);
    if (!unit || !unit.polygon_coordinates) return;
    const pts = unit.polygon_coordinates;
    const p1 = pts[edgeIndex];
    const p2 = pts[(edgeIndex + 1) % pts.length];
    if (!p1 || !p2) return;
    const midpoint = { pctX: (p1.pctX + p2.pctX) / 2, pctY: (p1.pctY + p2.pctY) / 2 };
    const newPoints = [...pts];
    newPoints.splice(edgeIndex + 1, 0, midpoint);
    if (!isFinitePolygon(newPoints)) return;
    if (warnIfUnwired(onUpdateUnitPolygonRef.current, 'onUpdateUnitPolygon:insert-vertex')) {
      onUpdateUnitPolygonRef.current?.(unitId, newPoints);
    }
  }, []);

  // Stable identity (keyed on layout) so memoized children don't re-render on
  // unrelated parent renders.
  const toPixels = useCallback((pointsArray: Point[]) => {
    const { offsetX, offsetY, drawW, drawH } = layout;
    return pointsArray.flatMap((p) => [
      offsetX + p.pctX * drawW,
      offsetY + p.pctY * drawH,
    ]);
  }, [layout]);

  // Snap a percent-space point to the nearest detected vector — the same
  // getSnappedCoordinate the trace tool uses. Drives the capture-line endpoints
  // (AI Tracing Assist — Phase 3b): both the live overlay preview and the emitted
  // grid axis. A no-op when snapping is off or the vector tree isn't built yet.
  const snapPoint = useCallback((p: Point): Point => {
    if (!mapSettings?.enableSnapping || !vectorTree) return p;
    const s = getSnappedCoordinate(
      p.pctX, p.pctY, vectorTree, aspect, layout.drawW, stageScale, mapSettings.snappingStrength || 15,
    );
    return { pctX: s.pctX, pctY: s.pctY };
  }, [mapSettings?.enableSnapping, mapSettings?.snappingStrength, vectorTree, aspect, layout.drawW, stageScale]);

  const resetView = () => {
    animateViewport(1, { x: 0, y: 0 }, 300);
  };

  // Zoom the viewport to fit a specific unit's bounding box at ~70% viewport fill
  const zoomToFit = useCallback((unitId: string) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit?.polygon_coordinates?.length || !layout.drawW || !layout.drawH) return;

    const coords = unit.polygon_coordinates;
    let minPctX = Infinity, maxPctX = -Infinity, minPctY = Infinity, maxPctY = -Infinity;
    coords.forEach(p => {
      if (p.pctX < minPctX) minPctX = p.pctX;
      if (p.pctX > maxPctX) maxPctX = p.pctX;
      if (p.pctY < minPctY) minPctY = p.pctY;
      if (p.pctY > maxPctY) maxPctY = p.pctY;
    });

    // Convert to logical pixel coordinates
    const bboxLeft = layout.offsetX + minPctX * layout.drawW;
    const bboxTop = layout.offsetY + minPctY * layout.drawH;
    const bboxW = (maxPctX - minPctX) * layout.drawW;
    const bboxH = (maxPctY - minPctY) * layout.drawH;

    // Calculate scale to fill 70% of viewport
    const viewW = dimensions.width;
    const viewH = dimensions.height;
    const fitScale = Math.min(viewW / bboxW, viewH / bboxH) * 0.7;
    const clampedScale = Math.max(0.1, Math.min(fitScale, 15));

    // Center the bounding box in the viewport
    const centerX = bboxLeft + bboxW / 2;
    const centerY = bboxTop + bboxH / 2;
    const targetPos = {
      x: viewW / 2 - centerX * clampedScale,
      y: viewH / 2 - centerY * clampedScale,
    };

    animateViewport(clampedScale, targetPos, 350);
  }, [units, layout, dimensions, animateViewport]);

  // Zoom to a specific absolute scale level, centered on the current viewport center
  const zoomToLevel = useCallback((targetScale: number) => {
    if (!stageRef.current) return;
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const centerPoint = { x: dimensions.width / 2, y: dimensions.height / 2 };
    const mousePointTo = {
      x: (centerPoint.x - stage.x()) / oldScale,
      y: (centerPoint.y - stage.y()) / oldScale,
    };
    const newPos = {
      x: centerPoint.x - mousePointTo.x * targetScale,
      y: centerPoint.y - mousePointTo.y * targetScale,
    };
    animateViewport(targetScale, newPos, 250);
  }, [dimensions, animateViewport]);

  // Keep keyboard shortcut callback refs in sync
  handleZoomRef.current = handleZoom;
  resetViewRef.current = resetView;
  zoomToFitRef.current = zoomToFit;

  // computedCursor is the SINGLE source of truth for the cursor. All hover/drag
  // affordances feed in here as React state — no shape handler mutates the cursor
  // imperatively, so a shape that unmounts under the pointer can't strand a stale
  // cursor (the value simply recomputes from the remaining state).
  const computedCursor = getToolCursor({
    toolMode,
    routeSubMode,
    isDragging: isDraggingCanvas || !!activeDragPolygon || !!activeDragNode || isDraggingRouteNode || !!activeRouteDrag,
    hoveredAnchor: hoveredAnchor !== null,
    hoveredIcon,
    hoveredPendingPolygon,
    hoveredUnit,
    hoveredRouteNode,
    hoveredRouteSegment,
    isShiftDown,
    selectedUnitIds: selectedUnitIds ?? [],
    pendingRoute,
    addNodeCursor: ADD_NODE_CURSOR,
    removeNodeCursor: REMOVE_NODE_CURSOR,
  });

  // When the styled crosshair overlay is on it BECOMES the cursor: hide the native
  // OS cursor over the drawing surface so the chosen look (lines / ring / dot /
  // gap-cross) is what the user sees at the pointer. Scoped to the Konva container
  // only — the toolbars and corner controls are separate elements and keep their
  // normal cursor (so it reappears when interacting with them).
  const canvasCursor = mapSettings?.showCrosshair ? 'none' : computedCursor;

  // Apply canvasCursor to the Konva-generated container (it sits above the outer
  // wrapper div for the canvas area). This effect is now the ONLY writer of the
  // container cursor, so re-running on string change is sufficient — nothing else
  // can leave a value behind for it to miss.
  useEffect(() => {
    if (stageRef.current) {
      const container = stageRef.current.container();
      if (container) {
        container.style.cursor = canvasCursor;
      }
    }
  }, [canvasCursor]);

  // Anchor hover tracking by id. Leave only clears if it still owns the hover,
  // so a stale `leave` arriving after the next anchor's `enter` can't unset it.
  const handleAnchorEnter = useCallback((id: string) => setHoveredAnchor(id), []);
  const handleAnchorLeave = useCallback(
    (id: string) => setHoveredAnchor(prev => (prev === id ? null : prev)),
    [],
  );

  const isZoomedOut = stageScale < 1.5;

  if (isLoadingUnits) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 dark:bg-[#0f172a] rounded-xl border border-slate-200/60 dark:border-white/10">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4 shadow-sm"></div>
        <p className="text-slate-500 font-medium text-sm animate-pulse">Loading floor plan...</p>
      </div>
    );
  }

  return (
    <div
      id="sitepulse-floorplan-container"
      ref={containerRef}
      className="relative w-full h-full flex-1 border rounded-xl overflow-hidden"
      style={{
        cursor: computedCursor,
        background: 'radial-gradient(circle, var(--canvas-dot, rgba(148,163,184,0.15)) 1px, transparent 1px)',
        backgroundColor: 'var(--canvas-bg, #f8f9fb)',
        backgroundSize: '20px 20px',
        borderColor: 'var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
      }}
    >
      {/* PDF Loading overlay — shown during initial download+render */}
      {pdfLoading && !pdfError && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="flex items-center gap-3 bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm px-4 py-2 rounded-lg shadow-sm border border-slate-200/60 dark:border-white/10">
            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">Loading drawing...</span>
          </div>
        </div>
      )}

      {/* Sharpening chip — preview visible and interactive, base LOD still rendering */}
      {!pdfLoading && !pdfError && pdfSharpening && (
        <div className="absolute bottom-3 left-3 z-10 pointer-events-none">
          <div className="flex items-center gap-2 bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border border-slate-200/60 dark:border-white/10">
            <div className="animate-spin h-3.5 w-3.5 border-2 border-blue-500 border-t-transparent rounded-full" />
            <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Sharpening…</span>
          </div>
        </div>
      )}

      {/* PDF Error overlay — shown when download/render fails */}
      {pdfError && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-6 py-4 rounded-xl shadow-lg border border-red-200/30 dark:border-red-900/30">
            <p className="text-sm text-red-500 font-bold">Failed to load drawing</p>
            <p className="text-xs text-slate-500 max-w-64 text-center">{pdfError}</p>
            {pdfRetry && (
              <button 
                type="button"
                onClick={pdfRetry}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-4 py-1.5 rounded-lg shadow-sm font-medium transition-all"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {/* Drawing Tool Excellence — Phase 2: non-blocking self-intersection warning.
          Appears while naming a freshly-traced room whose shape overlaps itself (a
          "bow-tie", which yields a wrong square-footage) and clears the moment it's
          fixed. Sits below the top-right naming popover; saving stays allowed. */}
      {isEditingPending && pendingSelfIntersects && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[55] pointer-events-none">
          <div className="flex items-center gap-2 bg-amber-500/95 text-white px-3 py-1.5 rounded-full shadow-lg border border-white/20 backdrop-blur-sm">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="text-xs font-semibold">This shape overlaps itself — its area may be wrong.</span>
          </div>
        </div>
      )}

      <ViewportControls
        resetView={resetView}
        handleZoom={handleZoom}
      />

      {/* Calibrate prompt (Phase 2b): after the 2-point line is placed, ask for the
          real length. Stops native pointer events so it doesn't pan/zoom the map. */}
      {toolMode === 'calibrate' && (
        <div
          className="absolute left-1/2 top-4 -translate-x-1/2 z-40 pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="rounded-2xl border shadow-xl backdrop-blur-md px-4 py-3 w-72"
            style={{
              background: 'var(--glass-bg, rgba(255, 255, 255, 0.95))',
              borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
            }}
          >
            {!calibratePrompt ? (
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {calibratePoints.length === 0
                  ? 'Click the start of a known dimension…'
                  : 'Click the end of the dimension…'}
              </p>
            ) : (
              <>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">Set scale from this line</div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                  Enter its real length (e.g. <span className="font-mono">12&apos;-6&quot;</span>).
                </p>
                <input
                  autoFocus
                  value={calibrateInput}
                  onChange={(e) => { setCalibrateInput(e.target.value); setCalibrateError(false); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submitCalibrate(); }
                    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelCalibrate(); }
                  }}
                  placeholder={`12'-6"`}
                  className="w-full text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg px-2 py-1.5 mb-1"
                />
                {calibrateError && (
                  <p className="text-[11px] text-rose-500 mb-1">Couldn&apos;t read that length — try like <span className="font-mono">12&apos;-6&quot;</span>.</p>
                )}
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={submitCalibrate}
                    disabled={updateSheetScale.isPending}
                    className="flex-1 text-sm font-semibold rounded-lg px-3 py-1.5 bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
                  >
                    Set scale
                  </button>
                  <button
                    type="button"
                    onClick={cancelCalibrate}
                    className="text-sm font-medium rounded-lg px-3 py-1.5 text-slate-500 hover:text-slate-700 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Measure panel (Phase 4): fraction selector + live running-length readout.
          Ephemeral — nothing persists. Stops native pointer events so choosing a
          fraction doesn't pan/zoom the map. */}
      {toolMode === 'measure' && (
        <div
          className="absolute left-1/2 top-4 -translate-x-1/2 z-40 pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="rounded-2xl border shadow-xl backdrop-blur-md px-4 py-3 w-72"
            style={{
              background: 'var(--glass-bg, rgba(255, 255, 255, 0.95))',
              borderColor: 'var(--glass-border, rgba(226, 232, 240, 0.5))',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Measure</div>
              <button
                type="button"
                onClick={() => onToolModeChange('pan')}
                className="text-[11px] font-semibold rounded-lg px-2 py-1 text-slate-500 hover:text-slate-700 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-white/10 transition-colors"
              >
                Done
              </button>
            </div>

            {typeof activeSheet?.scale_units_per_px === 'number' && activeSheet.scale_units_per_px > 0 ? (
              <>
                {/* Fraction precision selector */}
                <div className="flex gap-1 mb-2">
                  {([4, 8, 16] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setMeasureDenom(d)}
                      className={`flex-1 text-xs font-semibold rounded-lg px-2 py-1 transition-colors tabular-nums
                        ${measureDenom === d
                          ? 'bg-blue-500 text-white'
                          : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20'}`}
                    >
                      {FRACTION_LABELS[d]}
                    </button>
                  ))}
                </div>

                <MeasureReadout
                  points={measurePoints}
                  pointerStore={pointerStore}
                  imgW={measureBasis?.width ?? 0}
                  imgH={measureBasis?.height ?? 0}
                  unitsPerPx={activeSheet.scale_units_per_px}
                  denom={measureDenom}
                  enableSnapping={effectiveSnapping}
                />

                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setMeasurePoints([])}
                    disabled={measurePoints.length === 0}
                    className="flex-1 text-xs font-semibold rounded-lg px-3 py-1.5 bg-slate-500/10 text-slate-600 dark:text-slate-300 hover:bg-slate-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                  Click points to measure. Esc or Clear starts over.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                This drawing has no scale yet. Set one with the ruler tool, then measure.
              </p>
            )}
          </div>
        </div>
      )}

      <ZoomIndicator
        stageScale={stageScale}
        onZoomToLevel={zoomToLevel}
        onFitToView={resetView}
      />

      <ContextActionDock
        selectedUnitIds={selectedUnitIds}
        isLegendSelected={isLegendSelected}
        toolMode={toolMode}
        onToolModeChange={onToolModeChange}
        onRenameUnit={onRenameUnit}
        onDuplicateUnit={onDuplicateUnit}
        handleFlip={handleFlip}
        handleRotatePolygon={handleRotatePolygon}
        onDeleteUnit={onDeleteUnit}
        onOpenActivityModal={onOpenActivityModal}
        onOpenStatusModal={onOpenStatusModal}
        onOpenHistoryModal={(id) => setHistoryModalUnitId(id)}
        onHideLegend={() => onLegendDragEnd?.({ isVisible: false })}
        onRotateLegend={(dir) => {
          const rotDelta = dir === 'left' ? -90 : 90;
          onLegendDragEnd?.({ rotation: (legendPosition?.rotation || 0) + rotDelta });
        }}
      />

      {toolMode === 'draw' && draftPoints.length > 2 && (
        <button
          type="button"
          onClick={finishDrawing}
          className="absolute top-6 right-6 z-20 bg-emerald-500/95 backdrop-blur-sm text-white px-6 py-2 rounded-full shadow-lg hover:bg-emerald-600 transition-all flex items-center gap-2 font-bold border border-white/20"
        >
          <Check size={18} /> Finish Shape
        </button>
      )}

      {toolMode === 'route' && pendingRoute.length > 0 && (
        <button
          type="button"
          onClick={async () => {
            const updates: any[] = [];
            pendingRoute.forEach((id, idx) => updates.push({ id, walk_sequence: idx + 1 }));
            const pendingSet = new Set(pendingRoute);
            units.forEach(u => {
              if (!pendingSet.has(u.id)) updates.push({ id: u.id, walk_sequence: null });
            });
            await routeMutation.mutateAsync(updates);
            onToolModeChange('pan');
          }}
          className="absolute top-6 right-6 z-20 bg-emerald-500/95 backdrop-blur-sm text-white px-6 py-2 rounded-full shadow-lg hover:bg-emerald-600 transition-all flex items-center gap-2 font-bold border border-white/20"
        >
          <Check size={18} /> Save Route ({pendingRoute.length})
        </button>
      )}

      {dimensions.width > 0 && dimensions.height > 0 && (
        <>
        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          onClick={handleStageClick}
          onWheel={handleWheel}
          onDblClick={(e: any) => {
            // Double-click zoom: 2x in (or Shift+dblclick for 2x out)
            if (e.target !== stageRef.current && e.target?.attrs?.id !== 'bg-rect') return;
            const stage = e.target.getStage();
            if (!stage) return;
            const pointer = stage.getPointerPosition();
            if (!pointer) return;
            const zoomFactor = e.evt?.shiftKey ? 0.5 : 2;
            const oldScale = stage.scaleX();
            const newScale = Math.max(0.1, Math.min(oldScale * zoomFactor, 15));
            const mousePointTo = {
              x: (pointer.x - stage.x()) / oldScale,
              y: (pointer.y - stage.y()) / oldScale,
            };
            const newPos = {
              x: pointer.x - mousePointTo.x * newScale,
              y: pointer.y - mousePointTo.y * newScale,
            };
            animateViewport(newScale, newPos, 300);
          }}
          draggable={true}
          onPointerDown={(e) => {
            if (toolMode === 'pan' || (e.evt && e.evt.button === 1)) {
              setIsDraggingCanvas(true);
            } else if (toolMode === 'draw' && (!e.evt || e.evt.button === 0) && draftPoints.length === 0 && !isEditingPending) {
              // The box-drag shortcut (press-drag-release → rectangle room) stays live in
              // draw mode. But after a trace completes we remain in draw mode with the
              // naming popover open over an editable pending polygon. Pressing one of that
              // polygon's anchor nodes bubbles pointerdown up to the stage; without the
              // `!isEditingPending` guard it would arm a box here, and a node drag past
              // the box threshold would commit it — replacing the traced shape with a 4-pt
              // bounding rectangle (and the node-drag ↔ box-complete race could collapse it
              // to a triangle). Suppress box-arming while a pending polygon is being named.
              const stage = e.target.getStage();
              if (!stage) return;
              const pointer = stage.getPointerPosition();
              if (!pointer) return;
              const logicalX = (pointer.x - stage.x()) / stageScale;
              const logicalY = (pointer.y - stage.y()) / stageScale;
              const pctX = (logicalX - layout.offsetX) / layout.drawW;
              const pctY = (logicalY - layout.offsetY) / layout.drawH;
              setBoxOrigin({ pctX, pctY });
            } else if (toolMode === 'capture_box' && (!e.evt || e.evt.button === 0)) {
              // Start a capture-box drag (title-block / grid-bubble read). Pointer-up
              // emits the normalized rect. (The grid AXIS uses two-click placement via
              // handleStageClick instead — easier than a hold-drag when zoomed in.)
              const stage = e.target.getStage();
              if (!stage) return;
              const pointer = stage.getPointerPosition();
              if (!pointer) return;
              const logicalX = (pointer.x - stage.x()) / stageScale;
              const logicalY = (pointer.y - stage.y()) / stageScale;
              const pctX = (logicalX - layout.offsetX) / layout.drawW;
              const pctY = (logicalY - layout.offsetY) / layout.drawH;
              setBoxOrigin({ pctX, pctY });
            }
          }}
          onPointerUp={(e) => {
            setIsDraggingCanvas(false);
            
            // NEW: Handle Route Midpoint Drop
            if (activeRouteDrag && activeRouteDrag.type === 'midpoint') {
              if (routeDropTarget) {
                const newRoute = [...pendingRoute];
                const existingIdx = newRoute.indexOf(routeDropTarget);
                
                // If it already exists in the route, remove it first to prevent duplicates
                if (existingIdx !== -1) {
                  newRoute.splice(existingIdx, 1);
                  // Adjust sourceIndex if the removed item was before it
                  if (existingIdx <= activeRouteDrag.sourceIndex) {
                    activeRouteDrag.sourceIndex -= 1;
                  }
                }
                
                newRoute.splice(activeRouteDrag.sourceIndex + 1, 0, routeDropTarget);
                setPendingRoute(newRoute);
              }
              setActiveRouteDrag(null);
              setRouteDropTarget(null);
              return;
            }

            // Existing draw logic...
            // `!isEditingPending` (Phase 1): never complete a box over a polygon that's
            // already pending/being named — the shared gate that also blocks box-arming.
            if (toolMode === 'draw' && boxOrigin && !isEditingPending) {
              const stage = e.target.getStage();
              if (!stage) return;
              const lastSample = pointerStore.get();
              const pointer = stage.getPointerPosition()
                || (lastSample ? { x: lastSample.screenX, y: lastSample.screenY } : null);
              if (!pointer) {
                setBoxOrigin(null);
                return;
              }
              const logicalX = (pointer.x - stage.x()) / stageScale;
              const logicalY = (pointer.y - stage.y()) / stageScale;
              const pctX = (logicalX - layout.offsetX) / layout.drawW;
              const pctY = (logicalY - layout.offsetY) / layout.drawH;
              const dx = Math.abs(pctX - boxOrigin.pctX);
              const dy = Math.abs(pctY - boxOrigin.pctY);
              
              const startX = boxOrigin.pctX;
              const startY = boxOrigin.pctY;
              setBoxOrigin(null);
              
              if ((dx > 0.005 && dy > 0.005) && draftPoints.length === 0) {
                lastBoxEndRef.current = Date.now();
                if (warnIfUnwired(onPolygonComplete, 'onPolygonComplete:box')) {
                  onPolygonComplete([
                    { pctX: startX, pctY: startY },
                    { pctX: pctX, pctY: startY },
                    { pctX: pctX, pctY: pctY },
                    { pctX: startX, pctY: pctY }
                  ]);
                }
                setDraftPoints([]);
              }
            }

            // Capture-box drag complete (title-block read): emit the normalized
            // percent rect to the workbench handler. Requires a real drag (not a
            // bare click) so an accidental tap doesn't open the read popover.
            if (toolMode === 'capture_box' && boxOrigin) {
              const stage = e.target.getStage();
              const lastSample = pointerStore.get();
              const pointer = stage?.getPointerPosition()
                || (lastSample ? { x: lastSample.screenX, y: lastSample.screenY } : null);
              const origin = boxOrigin;
              setBoxOrigin(null);
              if (stage && pointer) {
                const logicalX = (pointer.x - stage.x()) / stageScale;
                const logicalY = (pointer.y - stage.y()) / stageScale;
                const pctX = (logicalX - layout.offsetX) / layout.drawW;
                const pctY = (logicalY - layout.offsetY) / layout.drawH;
                const x0 = Math.min(origin.pctX, pctX);
                const y0 = Math.min(origin.pctY, pctY);
                const x1 = Math.max(origin.pctX, pctX);
                const y1 = Math.max(origin.pctY, pctY);
                if (x1 - x0 > 0.01 && y1 - y0 > 0.01) {
                  lastBoxEndRef.current = Date.now();
                  onCaptureBox?.({ x0, y0, x1, y1 });
                }
              }
            }

            // Note: the grid AXIS (capture_line) is placed with two clicks in
            // handleStageClick, not a pointer-up drag — so there is no capture_line
            // branch here.
          }}
          onMouseMove={(e) => {
            const stage = e.target.getStage();
            if (!stage) return;
            const pos = stage.getPointerPosition();
            if (!pos) return;

            // Convert with the LIVE transform (not the debounced React state) so
            // previews track the cursor exactly even mid-gesture.
            const liveScale = stage.scaleX();
            const logX = (pos.x - stage.x()) / liveScale;
            const logY = (pos.y - stage.y()) / liveScale;
            const { offsetX, offsetY, drawW, drawH } = layoutRef.current;
            const pctX = drawW > 0 ? (logX - offsetX) / drawW : 0;
            const pctY = drawH > 0 ? (logY - offsetY) / drawH : 0;

            // Synchronous snap for the DraftPolygon cursor ghost. Computing this
            // inline (no debounce/await) guarantees lastSnapRef is fresh when
            // handleStageClick commits the point on the very next event.
            let snap: { pctX: number; pctY: number; snapped: boolean } | null = null;
            if ((toolMode === 'draw' || toolMode === 'calibrate' || toolMode === 'measure') && effectiveSnapping && drawW > 0 && drawH > 0) {
              // Interior hint: once ≥3 points are placed, the centroid of the trace so
              // far tells the snap which wall face is the room interior — so on a thick
              // wall it hugs the inside face instead of grabbing whichever is closest.
              const interior = draftPointsRef.current.length >= 3
                ? getCentroid(draftPointsRef.current)
                : null;
              // Grid-aware on the trace path: prefer real walls over confirmed grid lines.
              snap = getSnappedCoordinate(pctX, pctY, vectorTree, aspect, drawW, liveScale, mapSettings.snappingStrength || 15, gridAwareSnapping, interior);
              lastSnapRef.current = snap;
            } else {
              lastSnapRef.current = null;
            }

            // Single synchronous store write; listeners are notified once per frame.
            // No React state is touched on the plain pan/zoom path.
            pointerStore.set({ screenX: pos.x, screenY: pos.y, pctX, pctY, snap });

            // Routing midpoint drag targeting
            if (activeRouteDrag) {
              const closestId = nearestCentroidWithin(
                units, logX, logY, 40 / liveScale, layoutRef.current,
              );
              if (closestId !== routeDropTarget) {
                setRouteDropTarget(closestId);
              }
            }
          }}
          x={liveViewportRef.current.x}
          y={liveViewportRef.current.y}
          scaleX={liveViewportRef.current.scale}
          scaleY={liveViewportRef.current.scale}
          dragBoundFunc={(pos) => clampStagePosition(
            pos,
            stageRef.current?.scaleX() ?? 1,
            layoutRef.current,
            dimensions.width,
            dimensions.height,
          )}
          onDragStart={(e) => {
            const evt = e.evt;
            // Middle mouse button must ALWAYS pan the drawing, never move a shape.
            // A shape (the deepest draggable under the cursor) claims the drag
            // first, so Konva skips the stage's own pan; hand the drag back to the
            // stage here. The zero-delta `dragend` this fires on the shape is a
            // no-op (handlePolygonDragEnd guards dx===0&&dy===0; the pending
            // polygon resets to its origin). Covers selected units, the naming-
            // popup pending polygon, and gridline/node drags alike.
            if (evt && evt.button === 1 && e.target !== stageRef.current) {
              e.target.stopDrag();
              stageRef.current?.startDrag({ evt });
              return;
            }
            if (e.target === stageRef.current) {
              if (toolMode !== 'pan' && (!evt || evt.button !== 1)) {
                 e.target.stopDrag();
              }
            }
          }}
          onDragMove={(e) => {
            if (e.target !== stageRef.current) return;
            // Keep the live ref fresh DURING the drag — throttled commits below
            // re-render mid-drag, and the Stage props must reconcile to the value
            // the stage already has (snap-back invariant). Also keeps culling and
            // the deep-zoom settle timer tracking long pans.
            const s = e.target;
            liveViewportRef.current = { scale: s.scaleX(), x: s.x(), y: s.y() };
            viewportSync.push(liveViewportRef.current);
          }}
          onDragEnd={(e) => {
            if (e.target === stageRef.current) {
               setIsDraggingCanvas(false);
               liveViewportRef.current = { scale: e.target.scaleX(), x: e.target.x(), y: e.target.y() };
               viewportSync.push(liveViewportRef.current);
               viewportSync.flush();
            }
          }}
        >
          {/* Base layer: the giant PDF bitmap lives alone here, excluded from the
              hit graph (listening=false) and never redrawn by overlay/hover churn
              on the layers above. imageSmoothingEnabled=false keeps construction
              drawing lines crisp at deep zoom (persisted by Konva across resizes,
              replacing the old per-commit ref hack). */}
          <Layer listening={false} imageSmoothingEnabled={false}>
            {/* Background: PDF vector layer, or standard Image fallback */}
            {layout.drawW > 0 && layout.drawH > 0 && (
              activeSheetId ? (
                <PdfBaseLayer
                  sheetId={activeSheetId}
                  baseImageUrl={imageUrl}
                  pdfVersion={pdfVersion}
                  offsetX={layout.offsetX}
                  offsetY={layout.offsetY}
                  drawW={layout.drawW}
                  drawH={layout.drawH}
                  stageScale={stageScale}
                  onLoadingChange={setPdfLoading}
                  onSharpeningChange={setPdfSharpening}
                  onError={(err, retry) => { setPdfError(err); setPdfRetry(() => retry); }}
                  onDimensionsReady={(w, h) => { setOriginalWidth(w); setOriginalHeight(h); }}
                  viewportRect={visibleBoundingBox}
                />
              ) : image && (
                <KonvaImage
                  image={image}
                  x={layout.offsetX}
                  y={layout.offsetY}
                  width={layout.drawW}
                  height={layout.drawH}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              )
            )}
          </Layer>

          {/* Units layer: interactive content (unit polygons, status icons, legend). */}
          <Layer>
            {visibleUnits &&
              visibleUnits.map((unit) => (
                <MappedUnit
                  key={unit.id}
                  unit={unit}
                  isRouteDropTarget={routeDropTarget === unit.id || (toolMode === 'route' && routeSubMode === 'add' && hoveredUnit === unit.id && !pendingRoute.includes(unit.id))}
                  activeStatuses={displayStatuses}
                  lagMode={lagMode || makeReadyMode}
                  legendFilter={legendFilter}
                  isSelected={selectedUnitIds?.includes(unit.id)}
                  isHovered={hoveredUnit === unit.id}
                  temporalFilters={temporalFilters}
                  toolMode={toolMode}
                  layout={layout}
                  stageScale={stageScale}
                  vectorTree={vectorTree}
                  aspect={aspect}
                  enableSnapping={effectiveSnapping}
                  snappingStrength={mapSettings?.snappingStrength || 15}
                  isZoomedOut={isZoomedOut}
                  settings={settings}
                  activeDragNode={activeDragNode}
                  activeDragPolygon={activeDragPolygon}
                  isShiftDown={isShiftDown}
                  mixAlpha={mixAlpha}
                  toPixels={toPixels}
                  setHoveredUnit={setHoveredUnit}
                  setActiveDragPolygon={setActiveDragPolygon}
                  handlePolygonDragEnd={handlePolygonDragEnd}
                  handlePolygonClick={handlePolygonClick}
                  onSelectUnit={onSelectUnit}
                  onToolModeChange={onToolModeChange}
                  setContextMenu={setContextMenu}
                  onUpdateUnitIconOffset={onUpdateUnitIconOffset}
                  onAnchorEnter={handleAnchorEnter}
                  onAnchorLeave={handleAnchorLeave}
                  setHoveredIcon={setHoveredIcon}
                  setActiveDragNode={setActiveDragNode}
                  handleAnchorDragEnd={handleAnchorDragEnd}
                  handleAnchorClick={handleAnchorClick}
                  onInsertVertex={handleInsertSavedVertex}
                />
              ))}
          </Layer>

          {/* Overlay layer: ephemeral, high-churn previews and editing chrome.
              Per-frame redraws here never touch the units or PDF layers.
              Ref'd so the magnifier loupe can composite the live trace (this
              layer's DraftPolygon) onto its sharp PDF crop. */}
          <Layer ref={overlayLayerRef}>
            {/* Pointer-following previews are mounted only in their tool mode, so
                the pointer store has zero subscribers during plain pan/zoom. */}
            {toolMode === 'draw' && (
              <DraftPolygon
                draftPoints={draftPoints}
                pointerStore={pointerStore}
                boxOrigin={boxOrigin}
                stageScale={stageScale}
                layout={layout}
                enableSnapping={effectiveSnapping}
                isShiftDown={isShiftDown}
                toPixels={toPixels}
                openingEdges={openingCaptureEnabled ? draftOpeningEdges : undefined}
                openingArmed={!!armedOpeningType}
                activeOpeningRGB={OPENING_TYPE_RGB[armedOpeningType ?? activeOpeningType ?? 'door']}
              />
            )}

            {/* Calibration line (Phase 2b) — reuse the draft preview: cursor ghost +
                snap ring until the 2nd point, then the frozen 2-point line while the
                length prompt is open. */}
            {toolMode === 'calibrate' && (
              <DraftPolygon
                draftPoints={calibratePoints}
                pointerStore={pointerStore}
                boxOrigin={null}
                stageScale={stageScale}
                layout={layout}
                enableSnapping={effectiveSnapping && !calibratePrompt}
                isShiftDown={isShiftDown}
                toPixels={toPixels}
              />
            )}

            {/* Measure polyline (Phase 4) — reuse the draft preview: cursor ghost +
                snap ring while dropping the 2..N points of an ephemeral measurement. */}
            {toolMode === 'measure' && (
              <DraftPolygon
                draftPoints={measurePoints}
                pointerStore={pointerStore}
                boxOrigin={null}
                stageScale={stageScale}
                layout={layout}
                enableSnapping={effectiveSnapping}
                isShiftDown={isShiftDown}
                toPixels={toPixels}
              />
            )}

            {toolMode === 'capture_box' && (
              <CaptureBoxOverlay
                pointerStore={pointerStore}
                boxOrigin={boxOrigin}
                stageScale={stageScale}
                layout={layout}
                toPixels={toPixels}
              />
            )}

            {toolMode === 'capture_line' && (
              <CaptureLineOverlay
                pointerStore={pointerStore}
                lineOrigin={boxOrigin}
                stageScale={stageScale}
                layout={layout}
                toPixels={toPixels}
                snap={snapPoint}
              />
            )}

            {gridlineOverlays && gridlineOverlays.length > 0 && (
              <GridlineOverlay
                items={gridlineOverlays}
                stageScale={stageScale}
                layout={layout}
                toPixels={toPixels}
                editable={editableGridlines}
                selectMode={toolMode === 'select'}
                selectedSavedIndex={selectedGridlineIndex}
                onSelectGridline={onSelectGridline}
                onAdjustSavedGridline={onAdjustGridline}
                snap={snapPoint}
              />
            )}

            {/* Opening edges (Phase 4a): saved rooms' tagged passages + edit-after. */}
            {((openingOverlays && openingOverlays.length > 0) || openingEditTarget) && (
              <OpeningEdgeOverlay
                items={openingOverlays ?? []}
                stageScale={stageScale}
                layout={layout}
                toPixels={toPixels}
                editTarget={openingEditTarget ?? null}
                onToggleEdge={onToggleOpeningEdge}
              />
            )}

            {toolMode === 'stamp' && (
              <StampPreview
                selectedUnitId={selectedUnitIds?.length === 1 ? selectedUnitIds[0] : null}
                pointerStore={pointerStore}
                stageScale={stageScale}
                units={units}
                activeStatuses={activeStatuses}
                toPixels={toPixels}
              />
            )}

            <PendingPolygon
              pendingPolygonPoints={pendingPolygonPoints ?? null}
              activeDragNode={activeDragNode}
              activeDragPolygon={activeDragPolygon}
              settings={settings}
              stageScale={stageScale}
              layout={layout}
              isShiftDown={isShiftDown}
              vectorTree={vectorTree}
              aspect={aspect}
              enableSnapping={effectiveSnapping}
              snappingStrength={mapSettings?.snappingStrength || 15}
              isSelfIntersecting={pendingSelfIntersects}
              toPixels={toPixels}
              setActiveDragPolygon={setActiveDragPolygon}
              onPendingPolygonMove={handlePendingPolygonEdit}
              onInsertVertex={handleInsertPendingVertex}
              onDeleteVertex={handleDeletePendingVertex}
              setActiveDragNode={setActiveDragNode}
              onAnchorEnter={handleAnchorEnter}
              onAnchorLeave={handleAnchorLeave}
              setHoveredPendingPolygon={setHoveredPendingPolygon}
            />

            {(toolMode === 'route' || mapSettings?.showWalkSequence) && (
              <WalkRouteOverlay
                units={units}
                pendingRoute={pendingRoute}
                setPendingRoute={setPendingRoute}
                toolMode={toolMode}
                routeSubMode={routeSubMode}
                showWalkSequence={!!mapSettings?.showWalkSequence}
                layout={layout}
                stageScale={stageScale}
                hoveredRouteNode={hoveredRouteNode}
                setHoveredRouteNode={setHoveredRouteNode}
                setHoveredRouteSegment={setHoveredRouteSegment}
                setIsDraggingRouteNode={setIsDraggingRouteNode}
                activeRouteDrag={activeRouteDrag}
                setActiveRouteDrag={setActiveRouteDrag}
                routeDropTarget={routeDropTarget}
                setRouteDropTarget={setRouteDropTarget}
                pointerStore={pointerStore}
              />
            )}

            <MapLegend
              isVisible={legendPosition?.isVisible}
              pctX={legendPosition?.pctX}
              pctY={legendPosition?.pctY}
              scaleX={legendPosition?.scaleX}
              scaleY={legendPosition?.scaleY}
              rotation={legendPosition?.rotation}
              layout={layout}
              units={units}
              activities={activities}
              activeStatuses={activeStatuses}
              lagMode={lagMode}
              makeReadyMode={makeReadyMode}
              isSelected={isLegendSelected}
              onSelect={() => setIsLegendSelected(true)}
              onUpdate={(payload: any) => {
                onLegendDragEnd?.(payload);
              }}
            />
          </Layer>
        </Stage>
        </>
      )}

      {mapSettings?.showCrosshair && (
        <CrosshairOverlay pointerStore={pointerStore} style={mapSettings?.crosshairStyle} />
      )}

      {magnifierActive && (
        <LoupeOverlay
          pointerStore={pointerStore}
          stageRef={stageRef}
          overlayLayerRef={overlayLayerRef}
          layout={layout}
          magnification={magnifierZoom}
          patch={loupe.patch}
          requestPatch={loupe.requestPatch}
        />
      )}

      {/* Mini-map (Phase 5): bottom-right thumbnail of the whole sheet with a
          live viewport box; click recenters (eased), drag pans. Sits just above
          the zoom pill. Reuses the live viewport/layout refs for zero-re-render
          tracking — all rendering stays inside the overlay component (§3). */}
      {mapSettings?.showMiniMap && layout.drawW > 0 && layout.drawH > 0 && (
        <MiniMapOverlay
          thumbnailUrl={imageUrl ? withVersion(imageUrl, pdfVersion) : ''}
          aspect={layout.drawW / layout.drawH}
          liveViewportRef={liveViewportRef}
          layoutRef={layoutRef}
          sizeScale={mapSettings?.miniMapScale ?? 1}
          onRecenter={miniMapRecenter}
          onPanTo={miniMapPanTo}
          onPanEnd={miniMapPanEnd}
          onResize={miniMapResize}
        />
      )}

      {/* Lag Mode auto-enables the hover card so the schedule verdict is reachable
          without separately turning on "Show hover history". */}
      {(settings?.showHistoryHover || lagMode) && (
         <HoverHistoryTooltip
            hoveredUnit={hoveredUnit}
            getPointerPos={getTooltipPointerPos}
            units={units}
            rawStatuses={rawStatuses}
            trackingMode={trackingMode}
            activities={activities}
            dimensions={dimensions}
            toolMode={toolMode}
            contextMenu={contextMenu}
            applicabilityIndex={applicabilityIndex}
         />
      )}

      <CanvasContextMenu
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        dimensions={dimensions}
        onRenameUnit={onRenameUnit}
        onDuplicateUnit={onDuplicateUnit}
        handleFlip={handleFlip}
        handleRotatePolygon={handleRotatePolygon}
        onDeleteUnit={onDeleteUnit}
        onOpenActivityModal={onOpenActivityModal}
        onOpenStatusModal={onOpenStatusModal}
        onOpenHistoryModal={(id: string) => setHistoryModalUnitId(id)}
      />
    </div>
  );
});

FloorplanCanvas.displayName = 'FloorplanCanvas';

export default FloorplanCanvas;
