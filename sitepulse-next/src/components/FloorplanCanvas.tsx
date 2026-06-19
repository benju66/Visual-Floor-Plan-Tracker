"use client";
import React, { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import { Check } from 'lucide-react';
import ZoomIndicator from '@/components/canvas/ZoomIndicator';
import ViewportControls from '@/components/canvas/ViewportControls';
import ContextActionDock from '@/components/canvas/ContextActionDock';
import CanvasContextMenu from '@/components/CanvasContextMenu';
import MappedUnit from '@/components/canvas/MappedUnit';
import DraftPolygon from '@/components/canvas/DraftPolygon';
import StampPreview from '@/components/canvas/StampPreview';
import PendingPolygon from '@/components/canvas/PendingPolygon';
import MapLegend from '@/components/canvas/MapLegend';
import CrosshairOverlay from '@/components/canvas/CrosshairOverlay';
import WalkRouteOverlay from '@/components/canvas/WalkRouteOverlay';
import HoverHistoryTooltip from '@/components/HoverHistoryTooltip';
import { distToSegment, getCentroid, getSnappedCoordinate, mixAlpha, nearestCentroidWithin } from '@/utils/geometry';
import { isolateWalls } from '@/utils/wallIsolation';
import { detectRoomPolygon } from '@/utils/regionDetect';
import { simplifyPolygon } from '@/utils/polygonSimplify';
import { computeUnitVariance, varianceFill } from '@/utils/progressAnalytics';
import { classifyWheelIntent, clampStagePosition, createViewportSync, dampToward } from '@/utils/viewport';
import { createPointerStore } from '@/utils/pointerStore';
import { getToolCursor } from '@/utils/cursor';
import RBush from 'rbush';
import { useMapStore } from '@/store/useMapStore';
import { useUIStore } from '@/store/useUIStore';
import { useSettingsStore, useHydratedStore } from '@/store/useSettingsStore';
import { useUnits, useMilestones, useUpdateWalkSequence } from '@/hooks/useProjectQueries';
import { useSnappingVectors } from '@/hooks/useSnappingVectors';
import { PdfBaseLayer } from '@/components/canvas/PdfBaseLayer';
import { useParams } from 'next/navigation';
import type { StatusLog, Unit, PercentPoint as Point } from '@/types/domain';
import { applicableMilestones } from '@/utils/applicability';
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
  onPolygonComplete: (points: Point[]) => void;
  onRenameUnit?: (unitId: string | null) => void;
  onDeleteUnit?: (unitId: string | string[] | null) => void;
  onInstantStamp?: (unitId: string, points: Point[]) => void;
  pendingPolygonPoints?: Point[] | null;
  onPendingPolygonMove?: (points: Point[]) => void;
  onAddNodeToSegment?: (unitId: string, segmentIndex: number, newPoint: Point) => void;
  onPendingPolygonComplete?: () => void;
  onOpenMilestoneModal?: (unitId: string | null) => void;
  onOpenStatusModal?: (unitId: string | null) => void;
  applicabilityIndex?: ApplicabilityIndex;
  /**
   * Label-display mode (the Drawing Library workbench). Workbench sheets carry no
   * status, so units would otherwise render as a transparent fill + faint gray
   * outline that vanishes into the drawing. When true, each labeled room gets a
   * visible tint + accent outline and its name drawn on top, so labelers can see
   * what's already done. Defaults to off — the live map is unaffected.
   */
  labelMode?: boolean;
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
  onRenameUnit,
  onDeleteUnit,
  onInstantStamp,
  pendingPolygonPoints,
  onPendingPolygonMove,
  onOpenMilestoneModal,
  onOpenStatusModal,
  applicabilityIndex,
  labelMode,
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
  const legendFilter = useSettingsStore(s => s.filterMilestone);
  
  const setHistoryModalUnitId = useUIStore(s => s.setHistoryModalUnitId);
  
  const settings = useHydratedStore(s => s.settings, { showHistoryHover: false } as ProjectSettings);
  const mapSettings = useHydratedStore(s => s.mapSettings, { showCrosshair: false } as MapSettings);
  const legendPosition = useHydratedStore(s => s.legendPosition, { isVisible: false } as any);
  const onLegendDragEnd = useSettingsStore(s => s.setLegendPosition);

  const params = useParams();
  const projectId = params?.projectId as string;

  const { data: allMilestones = [] } = useMilestones(projectId);
  const milestones = allMilestones.filter(m => m.track === trackingMode);
  const { data: units = [], isLoading: isLoadingUnits } = useUnits(activeSheetId);

  // ── Lag Mode: re-skin bottleneck statuses with schedule-variance colors ──
  // Purely visual: only the copies passed to the canvas renderers are recolored,
  // so write paths (BulkActionDock bottlenecks, quick modals) never see lag colors.
  const lagMode = !!mapSettings?.colorByVariance;
  // Stable for the component's lifetime — matches how the dashboard modules and
  // history modal source "today", and keeps the memo dep array honest.
  const today = useMemo(() => new Date(), []);
  const displayStatuses = useMemo(() => {
    if (!lagMode) return activeStatuses;
    const logsByUnit = new Map<string, StatusLog[]>();
    for (const log of rawStatuses) {
      if (log.track !== trackingMode || !log.unit_id) continue;
      const arr = logsByUnit.get(log.unit_id);
      if (arr) arr.push(log);
      else logsByUnit.set(log.unit_id, [log]);
    }
    const unitById = new Map(units.map(u => [u.id, u]));
    return activeStatuses.map(s => {
      // Variance skips milestones that are N/A for this unit, matching the bottleneck.
      const unit = unitById.get(s.unit_id as string);
      const unitMilestones = unit && applicabilityIndex
        ? applicableMilestones(milestones, unit, applicabilityIndex)
        : milestones;
      const info = computeUnitVariance(logsByUnit.get(s.unit_id as string) || [], unitMilestones, today);
      return { ...s, status_color: varianceFill(info) };
    });
  // `milestones` is derived from allMilestones+trackingMode (both in deps); listing
  // the derived array would change identity every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lagMode, activeStatuses, rawStatuses, allMilestones, trackingMode, today, units, applicabilityIndex]);
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
      tree.load(rawVectors);
      setVectorTree(tree);
    }, 10);
    return () => clearTimeout(timeoutId);
  }, [rawVectors]);

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

  const unitsRef = useRef(units);
  useEffect(() => { unitsRef.current = units; }, [units]);

  const selectedUnitIdsRef = useRef(selectedUnitIds);
  useEffect(() => { selectedUnitIdsRef.current = selectedUnitIds; }, [selectedUnitIds]);

  const onUpdateUnitPolygonRef = useRef(onUpdateUnitPolygon);
  useEffect(() => { onUpdateUnitPolygonRef.current = onUpdateUnitPolygon; }, [onUpdateUnitPolygon]);

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
          if (toolMode === 'draw' && draftPointsRef.current.length > 0) {
            e.stopImmediatePropagation();
            setDraftPoints([]);
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
              onUpdateUnitPolygonRef.current?.(unit.id, newPoints);
            }
          });
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (toolMode === 'draw' && draftPointsRef.current.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setDraftPoints(prev => prev.slice(0, -1));
        }
      }
      
      if (toolMode === 'draw' && e.key === 'Enter') {
        if (!isInputActive && draftPointsRef.current.length > 2) {
          e.stopImmediatePropagation();
          onPolygonComplete(draftPointsRef.current);
          setDraftPoints([]);
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
        if (e.key === '4') onToolModeChange('fill_room');

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
    if (toolMode !== 'draw') setDraftPoints([]);
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

  // Fill-from-walls: a transient on-canvas hint when detection can't propose a
  // room (open region / no vectors). Ephemeral UI only — auto-clears.
  const [fillHint, setFillHint] = useState<string | null>(null);
  const fillHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFillHint = useCallback((msg: string) => {
    setFillHint(msg);
    if (fillHintTimer.current) clearTimeout(fillHintTimer.current);
    fillHintTimer.current = setTimeout(() => setFillHint(null), 2600);
  }, []);

  // Click inside a room → derive a polygon from the extracted wall vectors, then
  // route it through the SAME pending-polygon → name → save pipeline a hand trace
  // uses. The proposal is always editable before save (never auto-committed).
  const fillRoomAt = useCallback(
    (pctX: number, pctY: number) => {
      if (!rawVectors || rawVectors.length === 0) {
        showFillHint('No wall data on this drawing — trace it manually.');
        return;
      }
      const segments = rawVectors.map(v => v.lineData);
      // Keep nearly all segments: for SEALING a room, a missing wall is fatal
      // while clutter (furniture/text) is harmless (it just becomes an ignored
      // island). Only drop near-degenerate strokes.
      const walls = isolateWalls(segments, { aspect, minLength: 0.002 });
      const detected = detectRoomPolygon(walls, { pctX, pctY }, { aspect });
      if (!detected) {
        // The wall count distinguishes "loaded but leaking" from "no vectors".
        showFillHint(`Couldn't find an enclosed room here (${walls.length} wall lines) — trace it manually.`);
        return;
      }
      let poly = simplifyPolygon(detected);
      // Snap the proposed corners onto the real walls for crisp edges (reuses the
      // same aspect-aware snapping the freehand trace uses).
      if (mapSettings?.enableSnapping && vectorTree) {
        const strength = (mapSettings.snappingStrength || 15) * 1.6;
        // The detected room's centroid is its interior — bias each corner snap to
        // the inner wall face so the proposal hugs the inside, like a hand trace.
        const interior = getCentroid(poly);
        poly = poly.map(p => {
          const snap = getSnappedCoordinate(p.pctX, p.pctY, vectorTree, aspect, layout.drawW, stageScale, strength, interior);
          return snap.snapped ? { pctX: snap.pctX, pctY: snap.pctY } : p;
        });
      }
      if (poly.length < 3) {
        showFillHint("Couldn't form a clean room — trace it manually.");
        return;
      }
      onPolygonComplete(poly);
    },
    [rawVectors, vectorTree, aspect, layout.drawW, stageScale, mapSettings, onPolygonComplete, showFillHint],
  );

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
        
        onInstantStamp?.(selectedUnitIds[0], translatedPoints);
      }
    } else if (toolMode === 'draw') {
      if (Date.now() - lastBoxEndRef.current < 200) return;
      if (e.evt.shiftKey && draftPoints.length > 0) {
        const lastPoint = draftPoints[draftPoints.length - 1];
        const dx = Math.abs(pctX - lastPoint.pctX);
        const dy = Math.abs(pctY - lastPoint.pctY);
        if (dx > dy) pctY = lastPoint.pctY;
        else pctX = lastPoint.pctX;
      } else if (mapSettings?.enableSnapping && lastSnapRef.current?.snapped) {
        // Consume the last snap computed by onMouseMove — avoids double-computation
        // and guarantees the committed point matches the visual snap ring.
        pctX = lastSnapRef.current.pctX;
        pctY = lastSnapRef.current.pctY;
      }
      setDraftPoints([...draftPoints, { pctX, pctY }]);
    } else if (toolMode === 'fill_room') {
      fillRoomAt(pctX, pctY);
    } else if (['select', 'multi_select', 'add_node', 'delete_node'].includes(toolMode)) {
      if (e.target === stage || e.target.nodeType === 'Image' || e.target.attrs?.id === 'bg-rect') {
        onClearSelection();
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
  }, [toolMode]);

  const finishDrawing = () => {
    if (draftPoints.length > 2) {
      onPolygonComplete(draftPoints);
      setDraftPoints([]);
    }
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
        onUpdateUnitPolygon?.(unit.id, newPoints);
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
      onPendingPolygonMove?.(newPoints);
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
    
    
    onUpdateUnitPolygon?.(unit.id, newPoints);
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

    onUpdateUnitPolygon?.(unit.id, newPoints);
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
      onUpdateUnitPolygon?.(unit.id, newPoints);
    }
  };

  const handleAnchorDragEnd = (e: any, unitId: string, index: number, overridePct?: Point) => {
    if (!['select', 'add_node'].includes(toolMode)) return;
    const node = e.target;

    // MappedUnit computes the snapped position synchronously and passes it as
    // overridePct; fall back to the raw node position otherwise.
    let pctX = overridePct ? overridePct.pctX : (node.x() - layout.offsetX) / layout.drawW;
    let pctY = overridePct ? overridePct.pctY : (node.y() - layout.offsetY) / layout.drawH;

    if (!overridePct && mapSettings?.enableSnapping) {
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
    onUpdateUnitPolygon?.(unitId, newPoints);
  };

  const handleAnchorClick = (e: any, unitId: string, index: number) => {
    e.cancelBubble = true;
    if (toolMode !== 'delete_node') return;
    const unit = units.find(u => u.id === unitId);
    if (!unit || !unit.polygon_coordinates || unit.polygon_coordinates.length <= 3) return;
    
    const newPoints = [...unit.polygon_coordinates];
    newPoints.splice(index, 1);
    onUpdateUnitPolygon?.(unitId, newPoints);
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

  // Apply computedCursor to the Konva-generated container (it sits above the outer
  // wrapper div for the canvas area). This effect is now the ONLY writer of the
  // container cursor, so re-running on string change is sufficient — nothing else
  // can leave a value behind for it to miss.
  useEffect(() => {
    if (stageRef.current) {
      const container = stageRef.current.container();
      if (container) {
        container.style.cursor = computedCursor;
      }
    }
  }, [computedCursor]);

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
      {/* Fill-from-walls hint — transient, only when a proposal couldn't be made */}
      {fillHint && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="bg-slate-900/85 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg backdrop-blur-sm">
            {fillHint}
          </div>
        </div>
      )}

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

      <ViewportControls 
        resetView={resetView} 
        handleZoom={handleZoom} 
      />

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
        onOpenMilestoneModal={onOpenMilestoneModal}
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
            } else if (toolMode === 'draw' && (!e.evt || e.evt.button === 0) && draftPoints.length === 0) {
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
            if (toolMode === 'draw' && boxOrigin) {
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
                onPolygonComplete([
                  { pctX: startX, pctY: startY },
                  { pctX: pctX, pctY: startY },
                  { pctX: pctX, pctY: pctY },
                  { pctX: startX, pctY: pctY }
                ]);
                setDraftPoints([]);
              }
            }
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
            if (toolMode === 'draw' && mapSettings?.enableSnapping && drawW > 0 && drawH > 0) {
              // Interior-aware snap: once a few points are down, their centroid is a
              // reliable "inside the room" reference, so the snap favors the inner
              // wall face the tracer is meant to follow (AGENTS.md §5).
              const interior = draftPoints.length >= 3 ? getCentroid(draftPoints) : null;
              snap = getSnappedCoordinate(pctX, pctY, vectorTree, aspect, drawW, liveScale, mapSettings.snappingStrength || 15, interior);
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
            if (e.target === stageRef.current) {
              const evt = e.evt;
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
                  lagMode={lagMode}
                  legendFilter={legendFilter}
                  isSelected={selectedUnitIds?.includes(unit.id)}
                  isHovered={hoveredUnit === unit.id}
                  temporalFilters={temporalFilters}
                  toolMode={toolMode}
                  layout={layout}
                  stageScale={stageScale}
                  vectorTree={vectorTree}
                  aspect={aspect}
                  enableSnapping={mapSettings?.enableSnapping}
                  snappingStrength={mapSettings?.snappingStrength || 15}
                  isZoomedOut={isZoomedOut}
                  settings={settings}
                  labelMode={labelMode}
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
                />
              ))}
          </Layer>

          {/* Overlay layer: ephemeral, high-churn previews and editing chrome.
              Per-frame redraws here never touch the units or PDF layers. */}
          <Layer>
            {/* Pointer-following previews are mounted only in their tool mode, so
                the pointer store has zero subscribers during plain pan/zoom. */}
            {toolMode === 'draw' && (
              <DraftPolygon
                draftPoints={draftPoints}
                pointerStore={pointerStore}
                boxOrigin={boxOrigin}
                stageScale={stageScale}
                layout={layout}
                enableSnapping={!!mapSettings?.enableSnapping}
                isShiftDown={isShiftDown}
                toPixels={toPixels}
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
              toPixels={toPixels}
              setActiveDragPolygon={setActiveDragPolygon}
              onPendingPolygonMove={onPendingPolygonMove}
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
              milestones={milestones}
              activeStatuses={activeStatuses}
              lagMode={lagMode}
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
        <CrosshairOverlay pointerStore={pointerStore} />
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
            milestones={milestones}
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
        onOpenMilestoneModal={onOpenMilestoneModal}
        onOpenStatusModal={onOpenStatusModal}
        onOpenHistoryModal={(id: string) => setHistoryModalUnitId(id)}
      />
    </div>
  );
});

FloorplanCanvas.displayName = 'FloorplanCanvas';

export default FloorplanCanvas;
