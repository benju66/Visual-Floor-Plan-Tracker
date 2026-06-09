"use client";

import { useEffect, useRef, memo } from 'react';
import { Image as KonvaImage } from 'react-konva';
import { usePdfRenderer, type ViewportRect } from '@/hooks/usePdfRenderer';

export interface PdfBaseLayerProps {
  sheetId: string;
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
  stageScale: number;
  onLoadingChange?: (isLoading: boolean) => void;
  onError?: (error: string | null, retry: () => void) => void;
  onDimensionsReady?: (width: number, height: number) => void;
  viewportRect: ViewportRect | null;
}

const BASE_RENDER_SCALE = 2.0;

function PdfBaseLayerInner({
  sheetId,
  offsetX,
  offsetY,
  drawW,
  drawH,
  stageScale,
  onLoadingChange,
  onError,
  onDimensionsReady,
  viewportRect,
}: PdfBaseLayerProps) {
  const imageRef = useRef<any>(null);

  const {
    imageBitmap,
    pageWidth,
    pageHeight,
    isLoading,
    error,
    retry,
    viewportBitmap,
    viewportPosition,
  } = usePdfRenderer(
    sheetId,
    BASE_RENDER_SCALE,
    stageScale,
    viewportRect,
  );

  // Bubble loading state
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current !== isLoading) {
      prevLoadingRef.current = isLoading;
      onLoadingChange?.(isLoading);
    }
  }, [isLoading, onLoadingChange]);

  // Bubble error state
  const prevErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevErrorRef.current !== error) {
      prevErrorRef.current = error;
      onError?.(error, retry);
    }
  }, [error, retry, onError]);

  // Bubble dimensions
  useEffect(() => {
    if (pageWidth > 0 && pageHeight > 0) {
      onDimensionsReady?.(pageWidth, pageHeight);
    }
  }, [pageWidth, pageHeight, onDimensionsReady]);

  // Force Konva redraw when bitmap changes
  useEffect(() => {
    if (imageRef.current) {
      imageRef.current.getLayer()?.batchDraw();
    }
  }, [imageBitmap, viewportBitmap]);

  if (!imageBitmap) return null;

  return (
    <>
      {/* Base full-page bitmap */}
      <KonvaImage
        ref={imageRef}
        image={imageBitmap as any}
        x={offsetX}
        y={offsetY}
        width={drawW}
        height={drawH}
        listening={false}
        perfectDrawEnabled={false}
      />
      {/* High-res viewport overlay — sharp crop of visible region */}
      {viewportBitmap && viewportPosition && (
        <KonvaImage
          image={viewportBitmap as any}
          x={offsetX + viewportPosition.x * drawW}
          y={offsetY + viewportPosition.y * drawH}
          width={viewportPosition.width * drawW}
          height={viewportPosition.height * drawH}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </>
  );
}

export const PdfBaseLayer = memo(PdfBaseLayerInner);
