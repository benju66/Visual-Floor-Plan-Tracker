import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPdfBytes,
  putPdfBytes,
  invalidatePdfBytes,
  clearPdfByteCache,
} from './pdfByteCache';

const buf = (size: number) => new ArrayBuffer(size);

describe('pdfByteCache', () => {
  beforeEach(() => {
    clearPdfByteCache();
  });

  it('returns null on a miss', () => {
    expect(getPdfBytes('missing')).toBeNull();
  });

  it('stores and retrieves the same buffer instance', () => {
    const a = buf(8);
    putPdfBytes('sheet-a', a);
    expect(getPdfBytes('sheet-a')).toBe(a);
  });

  it('evicts the least-recently-used entry past the cap of 6', () => {
    for (let i = 0; i < 7; i++) putPdfBytes(`sheet-${i}`, buf(i + 1));
    expect(getPdfBytes('sheet-0')).toBeNull();
    expect(getPdfBytes('sheet-1')).not.toBeNull();
    expect(getPdfBytes('sheet-6')).not.toBeNull();
  });

  it('bumps recency on get, protecting the entry from eviction', () => {
    for (let i = 0; i < 6; i++) putPdfBytes(`sheet-${i}`, buf(i + 1));
    getPdfBytes('sheet-0'); // sheet-0 is now most-recently-used
    putPdfBytes('sheet-6', buf(7)); // evicts sheet-1, not sheet-0
    expect(getPdfBytes('sheet-0')).not.toBeNull();
    expect(getPdfBytes('sheet-1')).toBeNull();
  });

  it('overwrites an existing key without growing the cache', () => {
    const first = buf(1);
    const second = buf(2);
    putPdfBytes('a', first);
    putPdfBytes('a', second);
    expect(getPdfBytes('a')).toBe(second);
  });

  it('invalidates a single sheet', () => {
    putPdfBytes('a', buf(1));
    putPdfBytes('b', buf(2));
    invalidatePdfBytes('a');
    expect(getPdfBytes('a')).toBeNull();
    expect(getPdfBytes('b')).not.toBeNull();
  });
});
