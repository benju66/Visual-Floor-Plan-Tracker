import { describe, it, expect } from 'vitest';
import { loadImageDimensions } from './imageDimensions';

describe('loadImageDimensions', () => {
  // The degrade-to-area-less contract: a missing source must resolve `null`
  // (never throw, never hang) so callers save labels area-less on un-scaled or
  // image-less sheets. This resolves synchronously without touching the network.
  it('resolves null for a missing source', async () => {
    expect(await loadImageDimensions(null)).toBeNull();
    expect(await loadImageDimensions(undefined)).toBeNull();
    expect(await loadImageDimensions('')).toBeNull();
  });
});
