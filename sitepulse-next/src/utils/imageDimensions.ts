/**
 * Read an image's natural (intrinsic) pixel dimensions in the browser.
 *
 * This is the SINGLE source of the pixel basis for all scale/area math. Drawing
 * scale (`sheets.scale_units_per_px`) and polygon area (`computeAreaFromUnitsPerPx`)
 * are only consistent if calibration and area computation measure against the SAME
 * pixel size — namely the natural size of the sheet's `base_image_url` (the
 * server-converted PNG). The pixel basis cancels out of the final real-world area
 * ONLY when both sides use it; mixing bases (e.g. the client-side pdf.js render,
 * which is a different scale than the PNG) makes areas wrong by that ratio squared.
 *
 * Resolves `null` when the source is missing/unloadable or has no intrinsic size,
 * so callers degrade to an un-scaled/area-less result — never throws, never blocks.
 */
export function loadImageDimensions(
  src: string | null | undefined,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () =>
      resolve(
        img.naturalWidth && img.naturalHeight
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null,
      );
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
