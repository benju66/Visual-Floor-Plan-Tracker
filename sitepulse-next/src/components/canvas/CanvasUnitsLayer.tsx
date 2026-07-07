"use client";
import React from 'react';
import { Layer } from 'react-konva';
import MappedUnit, { type MappedUnitProps } from '@/components/canvas/MappedUnit';
import { mixAlpha } from '@/utils/geometry';
import type { Unit, StatusLog, CanvasLayout } from '@/types/domain';
import type { ToolMode, RouteSubMode } from '@/store/useMapStore';
import type { MapSettings } from '@/store/useSettingsStore';

export interface CanvasUnitsLayerProps {
  visibleUnits: Unit[];
  routeDropTarget: string | null;
  toolMode: ToolMode;
  routeSubMode: RouteSubMode;
  hoveredUnit: string | null;
  pendingRoute: string[];
  /** The (possibly lag/make-ready-recolored) display copies — never the raw statuses. */
  displayStatuses: StatusLog[];
  lagMode: boolean;
  makeReadyMode: boolean;
  legendFilter: string | null;
  selectedUnitIds: string[];
  temporalFilters: MappedUnitProps['temporalFilters'];
  mapSettings: MapSettings;
  layout: CanvasLayout;
  stageScale: number;
  vectorTree: MappedUnitProps['vectorTree'];
  aspect: number;
  effectiveSnapping: boolean;
  isZoomedOut: boolean;
  settings: MappedUnitProps['settings'];
  activeDragNode: MappedUnitProps['activeDragNode'];
  activeDragPolygon: MappedUnitProps['activeDragPolygon'];
  isShiftDown: boolean;
  toPixels: MappedUnitProps['toPixels'];
  setHoveredUnit: MappedUnitProps['setHoveredUnit'];
  setActiveDragPolygon: MappedUnitProps['setActiveDragPolygon'];
  handlePolygonDragEnd: MappedUnitProps['handlePolygonDragEnd'];
  handlePolygonClick: MappedUnitProps['handlePolygonClick'];
  onSelectUnit: MappedUnitProps['onSelectUnit'];
  onToolModeChange: MappedUnitProps['onToolModeChange'];
  setContextMenu: MappedUnitProps['setContextMenu'];
  onUpdateUnitIconOffset: MappedUnitProps['onUpdateUnitIconOffset'];
  onAnchorEnter: MappedUnitProps['onAnchorEnter'];
  onAnchorLeave: MappedUnitProps['onAnchorLeave'];
  setHoveredIcon: MappedUnitProps['setHoveredIcon'];
  setActiveDragNode: MappedUnitProps['setActiveDragNode'];
  handleAnchorDragEnd: MappedUnitProps['handleAnchorDragEnd'];
  handleAnchorClick: MappedUnitProps['handleAnchorClick'];
  onInsertVertex: MappedUnitProps['onInsertVertex'];
}

/**
 * Units layer (FloorplanCanvas Decomposition — Phase 10): interactive content
 * (unit polygons, status icons, legend). A pure pass-through mount of the
 * culled `visibleUnits` — the MappedUnit prop list is deliberately unchanged
 * from the pre-split JSX (note `activeStatuses={displayStatuses}` and
 * `lagMode={lagMode || makeReadyMode}`, the Phase 9 recolor feed).
 */
export default function CanvasUnitsLayer({
  visibleUnits,
  routeDropTarget,
  toolMode,
  routeSubMode,
  hoveredUnit,
  pendingRoute,
  displayStatuses,
  lagMode,
  makeReadyMode,
  legendFilter,
  selectedUnitIds,
  temporalFilters,
  mapSettings,
  layout,
  stageScale,
  vectorTree,
  aspect,
  effectiveSnapping,
  isZoomedOut,
  settings,
  activeDragNode,
  activeDragPolygon,
  isShiftDown,
  toPixels,
  setHoveredUnit,
  setActiveDragPolygon,
  handlePolygonDragEnd,
  handlePolygonClick,
  onSelectUnit,
  onToolModeChange,
  setContextMenu,
  onUpdateUnitIconOffset,
  onAnchorEnter,
  onAnchorLeave,
  setHoveredIcon,
  setActiveDragNode,
  handleAnchorDragEnd,
  handleAnchorClick,
  onInsertVertex,
}: CanvasUnitsLayerProps) {
  return (
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
            onAnchorEnter={onAnchorEnter}
            onAnchorLeave={onAnchorLeave}
            setHoveredIcon={setHoveredIcon}
            setActiveDragNode={setActiveDragNode}
            handleAnchorDragEnd={handleAnchorDragEnd}
            handleAnchorClick={handleAnchorClick}
            onInsertVertex={onInsertVertex}
          />
        ))}
    </Layer>
  );
}
