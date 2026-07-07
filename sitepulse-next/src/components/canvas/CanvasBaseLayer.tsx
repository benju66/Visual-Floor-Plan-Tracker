"use client";
import React from 'react';
import { Layer, Image as KonvaImage } from 'react-konva';
import { PdfBaseLayer } from '@/components/canvas/PdfBaseLayer';
import type { CanvasLayout } from '@/types/domain';
import type { VisibleBox } from '@/utils/canvasLayout';

export interface CanvasBaseLayerProps {
  layout: CanvasLayout;
  activeSheetId: string | null;
  imageUrl: string;
  /** sheets.pdf_version of the active sheet — cache-busts public PDF/PNG URLs */
  pdfVersion?: string | null;
  stageScale: number;
  /** Legacy raster fallback for sheets without a PDF (the parent's useImage result). */
  image: HTMLImageElement | undefined;
  visibleBoundingBox: VisibleBox | null;
  onLoadingChange: (isLoading: boolean) => void;
  onSharpeningChange: (isSharpening: boolean) => void;
  onError: (error: string | null, retry: () => void) => void;
  onDimensionsReady: (width: number, height: number) => void;
}

/**
 * Base layer (FloorplanCanvas Decomposition — Phase 10): the giant PDF bitmap
 * lives alone here, excluded from the hit graph (listening=false) and never
 * redrawn by overlay/hover churn on the layers above. imageSmoothingEnabled=false
 * keeps construction drawing lines crisp at deep zoom (persisted by Konva across
 * resizes, replacing the old per-commit ref hack).
 */
export default function CanvasBaseLayer({
  layout,
  activeSheetId,
  imageUrl,
  pdfVersion,
  stageScale,
  image,
  visibleBoundingBox,
  onLoadingChange,
  onSharpeningChange,
  onError,
  onDimensionsReady,
}: CanvasBaseLayerProps) {
  return (
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
            onLoadingChange={onLoadingChange}
            onSharpeningChange={onSharpeningChange}
            onError={onError}
            onDimensionsReady={onDimensionsReady}
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
  );
}
