"use client";
import React, { useEffect, useRef, useCallback, useState } from 'react';
import OpenSeadragon from 'openseadragon';

export interface TileRendererProps {
  /** Public URL to the DZI manifest XML */
  tileManifestUrl: string;
  /** Tiles base URL (folder containing output_files/) */
  tilesBaseUrl: string;
  /** Natural image dimensions from the sheets table (set during tile generation) */
  imageWidth: number;
  imageHeight: number;
  /** Container dimensions */
  containerWidth: number;
  containerHeight: number;
  /** Current Konva stage viewport state — TileRenderer syncs to these */
  stageScale: number;
  stagePosition: { x: number; y: number };
  /** Layout calculated by FloorplanCanvas (used for coordinate alignment) */
  layout: { offsetX: number; offsetY: number; drawW: number; drawH: number; stageW: number; stageH: number };
  /** Callback to report when the viewer is ready */
  onReady?: () => void;
}

/**
 * TileRenderer renders a DZI tile pyramid via OpenSeadragon into a background canvas
 * that is visually aligned with the Konva <Stage> overlay.
 * 
 * The Konva stage is the "source of truth" for viewport state (scale/position).
 * This component listens to prop changes and syncs the OpenSeadragon viewport accordingly.
 * OpenSeadragon handles all tile fetching, caching, and progressive loading internally.
 */
const TileRenderer: React.FC<TileRendererProps> = ({
  tileManifestUrl,
  tilesBaseUrl,
  imageWidth,
  imageHeight,
  containerWidth,
  containerHeight,
  stageScale,
  stagePosition,
  layout,
  onReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const isSyncingRef = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize OpenSeadragon viewer
  useEffect(() => {
    if (!containerRef.current || !tileManifestUrl || !imageWidth || !imageHeight) return;

    // Destroy previous viewer if any
    if (viewerRef.current) {
      viewerRef.current.destroy();
      viewerRef.current = null;
    }

    const viewer = OpenSeadragon({
      element: containerRef.current,
      tileSources: {
        Image: {
          xmlns: "http://schemas.microsoft.com/deepzoom/2008",
          Url: tilesBaseUrl,
          Format: "webp",
          Overlap: "0",
          TileSize: "256",
          Size: {
            Width: String(imageWidth),
            Height: String(imageHeight),
          }
        }
      },
      // Disable all built-in OSD UI — we use our own Konva-based controls
      showNavigationControl: false,
      showNavigator: false,
      showZoomControl: false,
      showHomeControl: false,
      showFullPageControl: false,
      showRotationControl: false,
      // Disable all mouse/touch interactions — Konva stage handles these
      gestureSettingsMouse: { scrollToZoom: false, clickToZoom: false, dblClickToZoom: false, dragToPan: false },
      gestureSettingsTouch: { scrollToZoom: false, clickToZoom: false, dblClickToZoom: false, dragToPan: false, pinchToZoom: false },
      gestureSettingsPen: { scrollToZoom: false, clickToZoom: false, dblClickToZoom: false, dragToPan: false },
      // Performance
      immediateRender: true,
      imageLoaderLimit: 4,
      maxZoomPixelRatio: 4,
      smoothTileEdgesMinZoom: 1.1,
      // Prevent OSD from intercepting pointer events — let them pass through to Konva
      mouseNavEnabled: false,
    });

    viewerRef.current = viewer;

    viewer.addHandler('open', () => {
      setIsInitialized(true);
      onReady?.();
    });

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      setIsInitialized(false);
    };
    // Only re-init when the tile source changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileManifestUrl, tilesBaseUrl, imageWidth, imageHeight]);

  // Sync OpenSeadragon viewport to match Konva stage state
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !isInitialized || !layout.drawW || !layout.drawH) return;

    isSyncingRef.current = true;

    try {
      const viewport = viewer.viewport;
      
      // Calculate the aspect-ratio-fitted image position in the OSD coordinate system.
      // OSD uses a coordinate system where the image width = 1.0
      // We need to translate Konva's pixel-based stagePosition/stageScale into OSD viewport coords.
      
      const imageAspect = imageWidth / imageHeight;
      
      // In OSD coordinates, the image goes from (0,0) to (1, 1/aspect)
      // The Konva stage maps the image to layout.offsetX, layout.offsetY with drawW×drawH
      
      // Current visible area in Konva logical coords (before stage transform):
      const viewLeft = (-stagePosition.x / stageScale);
      const viewTop = (-stagePosition.y / stageScale);
      const viewWidth = containerWidth / stageScale;
      const viewHeight = containerHeight / stageScale;
      
      // Convert to image-relative coordinates (0-1 range, relative to the drawn image)
      const imgLeft = (viewLeft - layout.offsetX) / layout.drawW;
      const imgTop = (viewTop - layout.offsetY) / layout.drawH;
      const imgRight = (viewLeft + viewWidth - layout.offsetX) / layout.drawW;
      const imgBottom = (viewTop + viewHeight - layout.offsetY) / layout.drawH;
      
      // Convert to OSD viewport coordinates
      // In OSD, x goes 0..1 for image width, y goes 0..(1/aspect) for image height
      const osdLeft = imgLeft;
      const osdTop = imgTop / imageAspect;
      const osdRight = imgRight;
      const osdBottom = imgBottom / imageAspect;
      
      const osdRect = new OpenSeadragon.Rect(
        osdLeft,
        osdTop, 
        osdRight - osdLeft,
        osdBottom - osdTop
      );
      
      viewport.fitBounds(osdRect, true); // true = immediately, no animation
    } catch (e) {
      // Viewport may not be ready yet
    } finally {
      isSyncingRef.current = false;
    }
  }, [stageScale, stagePosition, layout, containerWidth, containerHeight, imageWidth, imageHeight, isInitialized]);

  // Resize the OSD container when dimensions change
  useEffect(() => {
    if (!viewerRef.current || !containerWidth || !containerHeight) return;
    viewerRef.current.viewport?.resize(
      new OpenSeadragon.Point(containerWidth, containerHeight),
      true
    );
  }, [containerWidth, containerHeight]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: containerWidth || '100%',
        height: containerHeight || '100%',
        // Let pointer events pass through to the Konva stage behind/on top
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
};

export default TileRenderer;
