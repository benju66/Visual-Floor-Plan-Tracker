import { describe, it, expect, vi } from 'vitest';

vi.mock('@/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/floorplans/${path}` },
        }),
      }),
    },
  },
}));

import { withVersion, getOriginalPdfUrl } from './pdfSource';

describe('withVersion', () => {
  it('returns the url untouched when no version is given', () => {
    expect(withVersion('https://x/y.pdf', null)).toBe('https://x/y.pdf');
    expect(withVersion('https://x/y.pdf', undefined)).toBe('https://x/y.pdf');
  });

  it('appends ?v= to a clean url', () => {
    expect(withVersion('https://x/y.pdf', '2026-06-10')).toBe('https://x/y.pdf?v=2026-06-10');
  });

  it('appends &v= when the url already has a query string', () => {
    expect(withVersion('https://x/y.pdf?a=1', 'v1')).toBe('https://x/y.pdf?a=1&v=v1');
  });

  it('url-encodes the version (timestamps contain ":" and "+")', () => {
    expect(withVersion('https://x/y.pdf', '2026-06-10T12:00:00+00:00'))
      .toBe('https://x/y.pdf?v=2026-06-10T12%3A00%3A00%2B00%3A00');
  });
});

describe('getOriginalPdfUrl', () => {
  it('builds the public originals url for a sheet', () => {
    expect(getOriginalPdfUrl('abc-123')).toBe(
      'https://example.supabase.co/storage/v1/object/public/floorplans/originals/abc-123.pdf',
    );
  });

  it('appends the version when provided', () => {
    expect(getOriginalPdfUrl('abc-123', 'v9')).toMatch(/originals\/abc-123\.pdf\?v=v9$/);
  });
});
