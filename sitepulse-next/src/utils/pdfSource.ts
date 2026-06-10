/**
 * pdfSource — where floor-plan PDF bytes come from.
 *
 * The 'floorplans' bucket is public, so originals are fetched via their public
 * URL: that path is cacheable by the browser HTTP cache and Supabase's CDN,
 * unlike the authed storage.download() API. URLs carry ?v=<sheets.pdf_version>
 * (bumped by the backend on upload/re-attach) so long-lived caching can never
 * serve a stale drawing. When no version is available (pre-migration rows),
 * the fetch revalidates with the server instead (ETag/304) — never stale,
 * still skips full re-downloads.
 */

import { supabase } from '@/supabaseClient';

/** Append ?v= cache-buster to a public storage URL. */
export function withVersion(url: string, version: string | null | undefined): string {
  if (!version) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

/** Versioned public URL of a sheet's original PDF. */
export function getOriginalPdfUrl(sheetId: string, pdfVersion?: string | null): string {
  const { data } = supabase.storage
    .from('floorplans')
    .getPublicUrl(`originals/${sheetId}.pdf`);
  return withVersion(data.publicUrl, pdfVersion);
}

/**
 * Fetch a sheet's original PDF bytes. Public URL first (HTTP/CDN cacheable),
 * falling back to the authed storage API if that fails (non-public bucket
 * configs, transient CDN errors).
 */
export async function fetchOriginalPdfBytes(
  sheetId: string,
  pdfVersion: string | null | undefined,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  try {
    const res = await fetch(getOriginalPdfUrl(sheetId, pdfVersion), {
      signal,
      // Versioned URLs are immutable → plain caching. Unversioned → always
      // revalidate so a re-attached PDF can't be served stale from cache.
      cache: pdfVersion ? 'default' : 'no-cache',
    });
    if (res.ok) return await res.arrayBuffer();
  } catch (err) {
    if (signal?.aborted) throw err;
    // fall through to authed download
  }

  const { data: blob, error } = await supabase.storage
    .from('floorplans')
    .download(`originals/${sheetId}.pdf`);
  if (error || !blob) {
    throw new Error(error?.message || 'Original PDF not found for this level. Please attach a blueprint PDF in Settings.');
  }
  return blob.arrayBuffer();
}

/**
 * Fire-and-forget prefetch of sibling levels' PDFs into the browser HTTP
 * cache, so switching levels is fast even on first visit. Sequential to avoid
 * competing with anything the user does next; errors are ignored.
 */
export function prefetchOriginalPdfs(
  sheets: Array<{ id: string; base_image_url?: string | null; pdf_version?: string | null }>,
  activeSheetId: string | null,
): void {
  const candidates = sheets.filter((s) => s.id !== activeSheetId && s.base_image_url);
  void (async () => {
    for (const sheet of candidates) {
      try {
        const res = await fetch(getOriginalPdfUrl(sheet.id, sheet.pdf_version), {
          cache: sheet.pdf_version ? 'default' : 'no-cache',
          priority: 'low',
        } as RequestInit);
        if (res.ok) await res.blob(); // consume so the cache entry completes
      } catch {
        // offline / missing original — ignore
      }
    }
  })();
}
