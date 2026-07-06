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
import StampDrawer from '@/components/canvas/StampDrawer';
import { buildStampPolygon } from '@/utils/stampTransform';
import type { StampDef } from '@/utils/stampLibrary';
import PendingPolygon from '@/components/canvas/PendingPolygon';
import CaptureBoxOverlay from '@/components/canvas/CaptureBoxOverlay';
import CaptureLineOverlay from '@/components/canvas/CaptureLineOverlay';
import GridlineOverlay, { type GridlineOverlayItem } from '@/components/canvas/GridlineOverlay';
import OpeningEdgeOverlay, { type OpeningOverlayUnit, type OpeningEditTarget } from '@/components/canvas/OpeningEdgeOverlay';
import { OPENING_TYPE_RGB } from '@/utils/openingEdges';
import MapLegend from '@/components/canvas/MapLegend';
import CrosshairOverlay from '@/components/canvas/CrosshairOverlay';
import LoupeOverlay from '@/components/canvas/LoupeOverlay';
import MiniMapOverlay from '@/components/canvas/MiniMapOverlay';
import { useLoupeRenderer } from '@/hooks/useLoupeRenderer';
import { withVersion } from '@/utils/pdfSource';
import WalkRouteOverlay from '@/components/canvas/WalkRouteOverlay';
import HoverHistoryTooltip from '@/components/HoverHistoryTooltip';
import { getCentroid, getSnappedCoordinate, isFinitePolygon, mixAlpha, nearestCentroidWithin } from '@/utils/geometry';
import { isSelfIntersecting } from '@/utils/polygonValidity';
import { computeUnitVariance, varianceFill, orderedTrackActivities } from '@/utils/progressAnalytics';
import { unitMakeReady, makeReadyFill, slotKey } from '@/utils/activityReadiness';
import { clampStagePosition } from '@/utils/viewport';
import { computeLayout, computeVisibleBox, cullVisibleUnits } from '@/utils/canvasLayout';
import { useCanvasViewport } from '@/hooks/useCanvasViewport';
import { useCanvasSnapping } from '@/hooks/useCanvasSnapping';
import { useGeometryGestures } from '@/hooks/useGeometryGestures';
import { useTraceTool } from '@/hooks/useTraceTool';
import { createPointerStore } from '@/utils/pointerStore';
import { getToolCursor } from '@/utils/cursor';
import { warnIfUnwired } from '@/utils/wiringGuard';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore, useHydratedStore } from '@/store/useSettingsStore';
import { useUnits, useActivities, useUpdateWalkSequence, useSheetById, useUpdateSheetScale } from '@/hooks/useProjectQueries';
import { useActivityDependencies } from '@/hooks/useActivityDependencies';
import { unitsPerPxFromCalibration, parseFeetInches } from '@/utils/scale';
import { FRACTION_LABELS, type FractionDenominator } from '@/utils/measure';
import { loadImageDimensions } from '@/utils/imageDimensions';
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
  /** Instant-stamp an ARMED drawer stamp (no source unit) — Stamp & Fast Markup Phase 2. */
  onInstantStampShape?: (stamp: StampDef, points: Point[]) => void;
  /** Opt-in "name each stamp" drop (Stamp & Fast Markup Phase 3): route the snapped/
   *  transformed polygon through the naming popover instead of instant-create. `source`
   *  is the armed stamp's or the selected room's name + type, normalized here. */
  onStampWithNaming?: (source: { name: string; subtypeId: string | null; unitType: string | null }, points: Point[]) => void;
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
  onInstantStampShape,
  onStampWithNaming,
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
  // Stamp & Fast Markup — Phase 1: transient rotate/flip the next stamp drops with.
  const stampTransform = useMapStore(s => s.stampTransform);
  const rotateStamp = useMapStore(s => s.rotateStamp);
  const flipStamp = useMapStore(s => s.flipStamp);
  const resetStampTransform = useMapStore(s => s.resetStampTransform);
  // Stamp & Fast Markup — Phase 2: the armed drawer stamp (source when nothing selected).
  const armedStamp = useMapStore(s => s.armedStamp);
  const clearArmedStamp = useMapStore(s => s.clearArmedStamp);

  const temporalFilters = useSettingsStore(s => s.temporalFilters);
  const legendFilter = useSettingsStore(s => s.filterActivity);
  
  const setHistoryModalUnitId = useUIStore(s => s.setHistoryModalUnitId);
  
  const settings = useHydratedStore(s => s.settings, { showHistoryHover: false } as ProjectSettings);
  const mapSettings = useHydratedStore(s => s.mapSettings, { showCrosshair: false } as MapSettings);
  // Stamp & Fast Markup — Phase 3: when ON, a stamp drop routes through the naming popover
  // (pre-filled + re-arming) instead of dropping instantly. Default OFF ⇒ Phase 1/2 behavior.
  const nameEachStamp = !!mapSettings?.nameEachStamp;
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
  const spaceWasPanRef = useRef<ToolMode | null>(null);

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
  // suspended (`effectiveSnapping`, derived in useCanvasSnapping below) so node
  // placement follows the cursor exactly; the user's toolbar snap preference is
  // untouched and resumes when it's off.
  const magnifierZoom = mapSettings?.magnifierZoom ?? 3;
  const magnifierActive = !!mapSettings?.showMagnifier;
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

  const lastBoxEndRef = useRef(0);
  // Tracks the last snap result from onMouseMove — consumed by handleStageClick to guarantee
  // the committed draft point matches the visual snap indicator pixel-perfectly.
  const lastSnapRef = useRef<{ pctX: number; pctY: number; snapped: boolean } | null>(null);

  // Callback refs for functions the window keydown effect reads — synced each
  // render (next to computedCursor) so the once-per-toolMode handler always
  // sees the freshest identities.
  const handleZoomRef = useRef<(direction: number) => void>(() => {});
  const resetViewRef = useRef<() => void>(() => {});
  const zoomToFitRef = useRef<(unitId: string) => void>(() => {});
  // Geometry gestures (useGeometryGestures, called later): arrow-nudge write +
  // pending-edit undo/redo application. Same callback-ref pattern as handleZoom.
  const nudgeSelectedRef = useRef<(dx: number, dy: number) => void>(() => {});
  const undoRedoPendingEditRef = useRef<(isRedo: boolean) => void>(() => {});

  // (The window keydown/keyup/blur + container-size effect now sits below the
  // useTraceTool call, so its draw branches can read that hook's returns —
  // same seam as the Phase 2/4 callback refs. Phase 8 extracts it wholesale.)

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
    // (The matching leave-`draw` draft reset moved into useTraceTool — Phase 5.)
    // Clear any half-placed calibration line + length prompt whenever we leave the
    // calibrate tool, so a stale point/prompt never bleeds into another mode.
    if (toolMode !== 'calibrate') { setCalibratePoints([]); setCalibratePrompt(null); setCalibrateInput(''); setCalibrateError(false); }
    // Drop the ephemeral measure run whenever we leave the measure tool (the fraction
    // preference is intentionally kept). Nothing here persists.
    if (toolMode !== 'measure') { setMeasurePoints([]); }
    // Drop the transient stamp orientation whenever we leave the stamp tool so a stale
    // rotate/flip never bleeds into the next stamp session (Stamp & Fast Markup — Phase 1).
    // Phase 2: also disarm the drawer stamp so it never lingers outside stamp mode.
    if (toolMode !== 'stamp') { resetStampTransform(); clearArmedStamp(); }
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

  const layout = useMemo(
    () => computeLayout(dimensions.width, dimensions.height, originalWidth, originalHeight),
    [originalWidth, originalHeight, dimensions.width, dimensions.height],
  );

  useEffect(() => { layoutRef.current = layout; }, [layout]);

  // The camera engine (FloorplanCanvas Decomposition — Phase 2): stageScale/
  // stagePosition state + the liveViewportRef mirror + viewportSync pacer, the
  // wheel path (instant + smooth glide), animate/zoom/reset/fit/zoom-level, and
  // the mini-map navigation callbacks. The Stage's own drag handlers below keep
  // writing liveViewportRef + pushing through viewportSync (same seam as before).
  const {
    stageScale,
    stagePosition,
    liveViewportRef,
    viewportSync,
    handleWheel,
    animateViewport,
    handleZoom: viewportHandleZoom,
    resetView,
    zoomToFit,
    zoomToLevel,
    miniMapRecenter,
    miniMapPanTo,
    miniMapPanEnd,
    miniMapResize,
  } = useCanvasViewport({
    stageRef,
    layout,
    layoutRef,
    dimensions,
    units,
    activeSheetId,
    smoothWheelZoom: mapSettings?.smoothWheelZoom !== false,
  });

  // The zoom buttons / +- keys also dismiss any open context menu — component UI
  // state the viewport hook doesn't own, so the wrapper lives here (same behavior
  // as before the extraction).
  const handleZoom = (direction: number) => {
    setContextMenu(null);
    viewportHandleZoom(direction);
  };

  // The snapping engine (FloorplanCanvas Decomposition — Phase 3): the raw-vector
  // fetch + deferred RBush build (the tree lives in hook state, never the Query
  // cache — AGENTS.md §5), the grid-aware + magnifier-suspend flags, the
  // render-time `aspect` ratio, and the `snapPoint` lookup. Everything below that
  // consumes these (onMouseMove snap + snap ring, stamp anchors, the
  // draw/calibrate/measure click branches, the overlay props) reads the hook's
  // returns unchanged.
  const { vectorTree, snapPoint, effectiveSnapping, gridAwareSnapping, aspect } = useCanvasSnapping({
    activeSheetId,
    confirmedGridlines,
    layoutRef,
    layoutDrawW: layout.drawW,
    stageScale,
    enableSnapping: mapSettings?.enableSnapping,
    snappingStrength: mapSettings?.snappingStrength,
    gridAwareSnappingSetting: mapSettings?.gridAwareSnapping,
    magnifierActive,
  });

  // The geometry-edit gesture engine (FloorplanCanvas Decomposition — Phase 4):
  // flip/rotate, whole-shape + node drag commits, delete-node click, add/insert/
  // delete vertex, the pending-edit undo history (seed/record/apply), and the
  // arrow-nudge write. The window keydown effect above reaches nudgeSelected /
  // undoRedoPendingEdit through the callback refs (synced below, next to
  // handleZoomRef); handlePolygonClick below routes its add_node branch to
  // handleAddNodeToPolygon. The write-callback props and their signatures are
  // unchanged; the refs passed in stay owned + synced by this component.
  const {
    handleFlip,
    handleRotatePolygon,
    handlePolygonDragEnd,
    handleAnchorDragEnd,
    handleAnchorClick,
    handleAddNodeToPolygon,
    handleInsertPendingVertex,
    handleDeletePendingVertex,
    handleInsertSavedVertex,
    handlePendingPolygonEdit,
    nudgeSelected,
    undoRedoPendingEdit,
  } = useGeometryGestures({
    toolMode,
    layout,
    stageScale,
    units,
    selectedUnitIds,
    pendingPolygonPoints,
    isEditingPending,
    vectorTree,
    aspect,
    effectiveSnapping,
    snappingStrength: mapSettings?.snappingStrength,
    onUpdateUnitPolygon,
    onPendingPolygonMove,
    unitsRef,
    selectedUnitIdsRef,
    onUpdateUnitPolygonRef,
    pendingPolygonPointsRef,
  });

  // The click-trace + box-draw tool (FloorplanCanvas Decomposition — Phase 5):
  // the draft polygon (placed vertices + workbench opening tags) with its sync
  // refs, the draw branch of the stage click, both finish paths (Finish button
  // + the Enter body), the box-drag arm/complete handlers, and the opening
  // hold-key effect. The window keydown effect below consumes draftPointsRef
  // and the stable clearDraft / undoLastDraftVertex / finishDrawingViaEnter;
  // handleStageClick and the Stage pointer handlers route their draw branches
  // here. boxOrigin / lastBoxEndRef / lastSnapRef stay owned by this component
  // (shared with the capture/calibrate/measure tools).
  const {
    draftPoints,
    draftOpeningEdges,
    draftPointsRef,
    armedOpeningType,
    finishDrawing,
    finishDrawingViaEnter,
    clearDraft,
    undoLastDraftVertex,
    handleDrawClick,
    handleBoxPointerDown,
    handleBoxPointerUp,
  } = useTraceTool({
    toolMode,
    layout,
    stageScale,
    isEditingPending,
    effectiveSnapping,
    openingCaptureEnabled,
    onPolygonComplete,
    pointerStore,
    boxOrigin,
    setBoxOrigin,
    lastBoxEndRef,
    lastSnapRef,
  });

  // Window-level keyboard shortcuts + container sizing (checkSize/resize).
  // Deliberately AFTER the tool hooks so the draw branches can consume
  // useTraceTool's returns directly (same seam as the Phase 2/4 callback
  // refs) — Phase 8 extracts this whole effect into useCanvasKeyboard.
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
            clearDraft();
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
        const currentLayout = layoutRef.current;

        if (currentLayout && currentLayout.drawW && currentLayout.drawH) {
          const nudgePx = 1;
          const dx = e.key === 'ArrowLeft' ? -nudgePx / currentLayout.drawW : e.key === 'ArrowRight' ? nudgePx / currentLayout.drawW : 0;
          const dy = e.key === 'ArrowUp' ? -nudgePx / currentLayout.drawH : e.key === 'ArrowDown' ? nudgePx / currentLayout.drawH : 0;

          // The per-unit map + persist live in useGeometryGestures.nudgeSelected.
          nudgeSelectedRef.current(dx, dy);
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
        // History step + replay live in useGeometryGestures.undoRedoPendingEdit.
        undoRedoPendingEditRef.current(e.shiftKey);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (toolMode === 'draw' && draftPointsRef.current.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          // Vertex pop + stale opening-tag prune live in useTraceTool.undoLastDraftVertex.
          undoLastDraftVertex();
        }
      }

      if (toolMode === 'draw' && e.key === 'Enter') {
        if (!isInputActive && draftPointsRef.current.length > 2) {
          e.stopImmediatePropagation();
          // The :draw-enter guard + completion + draft clear live in
          // useTraceTool.finishDrawingViaEnter.
          finishDrawingViaEnter();
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

        // Stamp & Fast Markup — Phase 1: rotate/flip the ghost before dropping. Gated to
        // stamp mode so these stay free elsewhere (R = rotate CW, Shift+R = rotate CCW,
        // H = flip horizontal, V = flip vertical; NOT F, which is "fit selection").
        if (toolMode === 'stamp') {
          const k = e.key.toLowerCase();
          if (k === 'r') { e.preventDefault(); rotateStamp(e.shiftKey ? 'left' : 'right'); }
          else if (k === 'h') { e.preventDefault(); flipStamp('horizontal'); }
          else if (k === 'v') { e.preventDefault(); flipStamp('vertical'); }
        }

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

  const visibleBoundingBox = useMemo(
    () => computeVisibleBox(layout, stagePosition, stageScale, dimensions),
    [stagePosition, stageScale, dimensions, layout],
  );

  const visibleUnits = useMemo(
    () => cullVisibleUnits(units, visibleBoundingBox, layout.drawW, toolMode),
    [units, visibleBoundingBox, layout.drawW, toolMode],
  );

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

    if (toolMode === 'stamp' && !isEditingPending && armedStamp && armedStamp.points.length > 0) {
      // Phase 2: an armed drawer stamp is the source (no room selected). Its points are
      // centroid-normalized; snap the anchor + apply the transform exactly like below so
      // StampPreview and this commit build the identical polygon. `!isEditingPending`
      // (Phase 3): while a named stamp's pending polygon awaits Enter, a stray canvas
      // click must not drop a SECOND stamp on top of it.
      const anchor = snapPoint({ pctX, pctY });
      const stampedPoints = buildStampPolygon(armedStamp.points, stampTransform, aspect, anchor);
      if (isFinitePolygon(stampedPoints)) {
        if (nameEachStamp) {
          // Phase 3 (opt-in): route through the naming popover, pre-filled from the stamp,
          // then re-arm. The armed stamp is left set so the next click drops it again.
          if (warnIfUnwired(onStampWithNaming, 'onStampWithNaming:armed')) {
            onStampWithNaming?.({ name: armedStamp.name, subtypeId: armedStamp.subtypeId ?? null, unitType: armedStamp.unitType ?? null }, stampedPoints);
          }
        } else if (warnIfUnwired(onInstantStampShape, 'onInstantStamp:armed')) {
          onInstantStampShape?.(armedStamp, stampedPoints);
        }
      }
    } else if (toolMode === 'stamp' && !isEditingPending && selectedUnitIds?.length === 1) {
      const sourceUnit = units.find(u => u.id === selectedUnitIds[0]);
      if (sourceUnit && sourceUnit.polygon_coordinates && sourceUnit.polygon_coordinates.length > 0) {
        // Snap the drop anchor with the same engine tracing uses, then apply the active
        // rotate/flip — StampPreview and this commit build the identical polygon.
        const anchor = snapPoint({ pctX, pctY });
        const stampedPoints = buildStampPolygon(sourceUnit.polygon_coordinates, stampTransform, aspect, anchor);

        // Never persist a corrupt shape from a bad transform/snap.
        if (isFinitePolygon(stampedPoints)) {
          if (nameEachStamp) {
            // Phase 3 (opt-in): pre-fill the popover from the source room; selection
            // persists so the next click stamps it again.
            if (warnIfUnwired(onStampWithNaming, 'onStampWithNaming:unit')) {
              onStampWithNaming?.({ name: sourceUnit.unit_number, subtypeId: sourceUnit.subtype_id ?? null, unitType: sourceUnit.unit_type ?? null }, stampedPoints);
            }
          } else if (warnIfUnwired(onInstantStamp, 'onInstantStamp:stamp')) {
            onInstantStamp?.(selectedUnitIds[0], stampedPoints);
          }
        }
      }
    } else if (toolMode === 'draw' && !isEditingPending) {
      // `!isEditingPending` (Phase 1): while a freshly-traced polygon is open for naming
      // we're still nominally in draw mode, but a click on the canvas (or on a pending
      // anchor, whose click bubbles up to the Stage) must NOT start a SECOND draft on top
      // of it — that left stray draft dots over the shape being named. The add-vertex
      // tool only arms again once the pending polygon is saved or cancelled.
      // Vertex placement (box-debounce, Shift-ortho, snap-consume, opening tag)
      // lives in useTraceTool (Phase 5).
      handleDrawClick(e, pctX, pctY);
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
      // Nearest-segment vertex insert — moved to useGeometryGestures (Phase 4);
      // this click handler keeps only the tool routing + selection sync above.
      handleAddNodeToPolygon(e, unit);
    }
  };

  // Stable identity (keyed on layout) so memoized children don't re-render on
  // unrelated parent renders.
  const toPixels = useCallback((pointsArray: Point[]) => {
    const { offsetX, offsetY, drawW, drawH } = layout;
    return pointsArray.flatMap((p) => [
      offsetX + p.pctX * drawW,
      offsetY + p.pctY * drawH,
    ]);
  }, [layout]);

  // Keep keyboard shortcut callback refs in sync
  handleZoomRef.current = handleZoom;
  resetViewRef.current = resetView;
  zoomToFitRef.current = zoomToFit;
  nudgeSelectedRef.current = nudgeSelected;
  undoRedoPendingEditRef.current = undoRedoPendingEdit;

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
        stampTransform={stampTransform}
        onRotateStamp={rotateStamp}
        onFlipStamp={flipStamp}
        hasArmedStamp={!!armedStamp}
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

      {/* Stamp & Fast Markup — Phase 2: the recent/saved stamp drawer. Arm a shape here
          and drop it with no room selected. Persisted in this browser (useSettingsStore). */}
      <StampDrawer units={units} />

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
            } else if (toolMode === 'draw') {
              // Box-drag arming (incl. the pending-polygon suppression guard)
              // lives in useTraceTool (Phase 5).
              handleBoxPointerDown(e);
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

            // Draw-mode box completion (press-drag-release → 4-corner room, incl.
            // the `!isEditingPending` guard) lives in useTraceTool (Phase 5).
            handleBoxPointerUp(e);

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
                  shadeUnstatused={!!mapSettings?.shadeLocations}
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
                armedPoints={armedStamp?.points ?? null}
                pointerStore={pointerStore}
                stageScale={stageScale}
                units={units}
                activeStatuses={activeStatuses}
                toPixels={toPixels}
                transform={stampTransform}
                aspect={aspect}
                snap={snapPoint}
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
