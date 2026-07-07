"use client";
import React from 'react';
import { Layer } from 'react-konva';
import type Konva from 'konva';
import DraftPolygon from '@/components/canvas/DraftPolygon';
import CaptureBoxOverlay from '@/components/canvas/CaptureBoxOverlay';
import CaptureLineOverlay from '@/components/canvas/CaptureLineOverlay';
import GridlineOverlay, { type GridlineOverlayItem } from '@/components/canvas/GridlineOverlay';
import OpeningEdgeOverlay, { type OpeningOverlayUnit, type OpeningEditTarget } from '@/components/canvas/OpeningEdgeOverlay';
import StampPreview from '@/components/canvas/StampPreview';
import PendingPolygon, { type PendingPolygonProps } from '@/components/canvas/PendingPolygon';
import WalkRouteOverlay, { type WalkRouteOverlayProps } from '@/components/canvas/WalkRouteOverlay';
import MapLegend, { type MapLegendProps } from '@/components/canvas/MapLegend';
import { OPENING_TYPE_RGB } from '@/utils/openingEdges';
import type { StampDef } from '@/utils/stampLibrary';
import type { StampTransform } from '@/utils/stampTransform';
import type { PointerStore } from '@/utils/pointerStore';
import type { Unit, StatusLog, CanvasLayout, LegendPosition, PercentPoint as Point, OpeningEdge, OpeningType } from '@/types/domain';
import type { ToolMode, RouteSubMode } from '@/store/useMapStore';
import type { MapSettings, SettingsState } from '@/store/useSettingsStore';

export interface CanvasOverlayLayerProps {
  /** The parent's overlayLayerRef — wired to the real Konva Layer node so the
   *  magnifier loupe can composite the live trace onto its sharp PDF crop. */
  layerRef: React.RefObject<Konva.Layer | null>;
  toolMode: ToolMode;
  layout: CanvasLayout;
  stageScale: number;
  pointerStore: PointerStore;
  effectiveSnapping: boolean;
  isShiftDown: boolean;
  toPixels: (points: Point[]) => number[];
  snapPoint: (p: Point) => Point;
  mapSettings: MapSettings;
  // ── Draw (trace + box) ──
  draftPoints: Point[];
  boxOrigin: Point | null;
  openingCaptureEnabled?: boolean;
  draftOpeningEdges: OpeningEdge[];
  armedOpeningType: OpeningType | null;
  activeOpeningType?: OpeningType;
  // ── Calibrate + measure ──
  calibratePoints: Point[];
  /** The frozen 2-point calibrate line while the length prompt is open (truthy ⇒ prompting). */
  calibratePrompt: { p1: Point; p2: Point } | null;
  measurePoints: Point[];
  // ── Workbench gridlines + openings ──
  gridlineOverlays?: GridlineOverlayItem[];
  editableGridlines?: boolean;
  selectedGridlineIndex?: number | null;
  onSelectGridline?: (index: number | null) => void;
  onAdjustGridline?: (index: number, p1: Point, p2: Point) => void;
  openingOverlays?: OpeningOverlayUnit[];
  openingEditTarget?: OpeningEditTarget | null;
  onToggleOpeningEdge?: (unitId: string, edgeIndex: number) => void;
  // ── Stamp preview ──
  selectedUnitIds: string[];
  armedStamp: StampDef | null;
  units: Unit[];
  /** The RAW active statuses (stamp preview + legend read original colors). */
  activeStatuses: StatusLog[];
  stampTransform: StampTransform;
  aspect: number;
  // ── Pending polygon ──
  pendingPolygonPoints?: Point[] | null;
  activeDragNode: PendingPolygonProps['activeDragNode'];
  activeDragPolygon: PendingPolygonProps['activeDragPolygon'];
  settings: PendingPolygonProps['settings'];
  vectorTree: PendingPolygonProps['vectorTree'];
  pendingSelfIntersects: boolean;
  setActiveDragPolygon: PendingPolygonProps['setActiveDragPolygon'];
  handlePendingPolygonEdit: (points: Point[]) => void;
  handleInsertPendingVertex: (edgeIndex: number) => void;
  handleDeletePendingVertex: (index: number) => void;
  setActiveDragNode: PendingPolygonProps['setActiveDragNode'];
  onAnchorEnter: (id: string) => void;
  onAnchorLeave: (id: string) => void;
  setHoveredPendingPolygon: (hovered: boolean) => void;
  // ── Walk route ──
  pendingRoute: string[];
  setPendingRoute: WalkRouteOverlayProps['setPendingRoute'];
  routeSubMode: RouteSubMode;
  hoveredRouteNode: string | null;
  setHoveredRouteNode: (id: string | null) => void;
  setHoveredRouteSegment: WalkRouteOverlayProps['setHoveredRouteSegment'];
  setIsDraggingRouteNode: (dragging: boolean) => void;
  activeRouteDrag: WalkRouteOverlayProps['activeRouteDrag'];
  setActiveRouteDrag: WalkRouteOverlayProps['setActiveRouteDrag'];
  routeDropTarget: string | null;
  setRouteDropTarget: (id: string | null) => void;
  // ── Legend ──
  legendPosition: LegendPosition;
  activities: MapLegendProps['activities'];
  lagMode: boolean;
  makeReadyMode: boolean;
  isLegendSelected: boolean;
  setIsLegendSelected: (selected: boolean) => void;
  onLegendDragEnd: SettingsState['setLegendPosition'];
}

/**
 * Overlay layer (FloorplanCanvas Decomposition — Phase 10): ephemeral,
 * high-churn previews and editing chrome. Per-frame redraws here never touch
 * the units or PDF layers. The parent's `layerRef` is attached to the real
 * Konva Layer node so the magnifier loupe can composite the live trace (this
 * layer's DraftPolygon) onto its sharp PDF crop.
 */
export default function CanvasOverlayLayer({
  layerRef,
  toolMode,
  layout,
  stageScale,
  pointerStore,
  effectiveSnapping,
  isShiftDown,
  toPixels,
  snapPoint,
  mapSettings,
  draftPoints,
  boxOrigin,
  openingCaptureEnabled,
  draftOpeningEdges,
  armedOpeningType,
  activeOpeningType,
  calibratePoints,
  calibratePrompt,
  measurePoints,
  gridlineOverlays,
  editableGridlines,
  selectedGridlineIndex,
  onSelectGridline,
  onAdjustGridline,
  openingOverlays,
  openingEditTarget,
  onToggleOpeningEdge,
  selectedUnitIds,
  armedStamp,
  units,
  activeStatuses,
  stampTransform,
  aspect,
  pendingPolygonPoints,
  activeDragNode,
  activeDragPolygon,
  settings,
  vectorTree,
  pendingSelfIntersects,
  setActiveDragPolygon,
  handlePendingPolygonEdit,
  handleInsertPendingVertex,
  handleDeletePendingVertex,
  setActiveDragNode,
  onAnchorEnter,
  onAnchorLeave,
  setHoveredPendingPolygon,
  pendingRoute,
  setPendingRoute,
  routeSubMode,
  hoveredRouteNode,
  setHoveredRouteNode,
  setHoveredRouteSegment,
  setIsDraggingRouteNode,
  activeRouteDrag,
  setActiveRouteDrag,
  routeDropTarget,
  setRouteDropTarget,
  legendPosition,
  activities,
  lagMode,
  makeReadyMode,
  isLegendSelected,
  setIsLegendSelected,
  onLegendDragEnd,
}: CanvasOverlayLayerProps) {
  return (
    <Layer ref={layerRef}>
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
        onAnchorEnter={onAnchorEnter}
        onAnchorLeave={onAnchorLeave}
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
        onUpdate={(payload) => {
          onLegendDragEnd?.(payload);
        }}
      />
    </Layer>
  );
}
