import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewportPresence } from './useViewportPresence';

/**
 * These pin the two load-bearing contracts of the viewport tracker (List View
 * Performance — Phase 2):
 *   1. When IntersectionObserver is unavailable, it degrades to "always fetch"
 *      (supported=false), never "never fetch" — so audits can't silently stop.
 *   2. `observeRef(id)` is a STABLE per-id callback, so React doesn't churn
 *      observe/unobserve on every render.
 *   3. With an observer present, an intersecting element lands in `nearIds` and a
 *      leaving element drops out — the mechanism that bounds concurrent fetches.
 */

// A drivable IntersectionObserver stub: records observed elements and lets a test
// fire intersection entries synchronously.
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  cb: IntersectionObserverCallback;
  observed = new Set<Element>();
  root = null;
  rootMargin = '';
  thresholds: number[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.observed.clear(); }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  fire(entries: Array<{ target: Element; isIntersecting: boolean }>) {
    this.cb(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeIntersectionObserver.instances = [];
});

describe('useViewportPresence', () => {
  it('degrades to "always fetch" when IntersectionObserver is unavailable', () => {
    // jsdom has no IntersectionObserver by default — assert the guardrail: callers
    // read `supported` and treat unsupported as "near", so nothing stops fetching.
    expect(typeof IntersectionObserver).toBe('undefined');
    const { result } = renderHook(() => useViewportPresence());
    expect(result.current.supported).toBe(false);
    expect(result.current.nearIds.size).toBe(0);
  });

  it('returns a stable ref callback per id across renders', () => {
    const { result, rerender } = renderHook(() => useViewportPresence());
    const a1 = result.current.observeRef('unit-a');
    const b1 = result.current.observeRef('unit-b');
    rerender();
    expect(result.current.observeRef('unit-a')).toBe(a1);
    expect(result.current.observeRef('unit-b')).toBe(b1);
    expect(a1).not.toBe(b1);
  });

  it('tracks near-viewport ids via the observer (enter adds, leave removes)', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const { result } = renderHook(() => useViewportPresence());
    expect(result.current.supported).toBe(true);

    const io = FakeIntersectionObserver.instances[0];
    const elA = document.createElement('tbody');
    const elB = document.createElement('tbody');

    // Registering observes the element on the live observer.
    act(() => {
      result.current.observeRef('a')(elA);
      result.current.observeRef('b')(elB);
    });
    expect(io.observed.has(elA)).toBe(true);
    expect(io.observed.has(elB)).toBe(true);

    // A only enters the viewport → only A is near.
    act(() => { io.fire([{ target: elA, isIntersecting: true }]); });
    expect(result.current.nearIds.has('a')).toBe(true);
    expect(result.current.nearIds.has('b')).toBe(false);

    // A scrolls away → it drops out (this is what bounds concurrent fetches).
    act(() => { io.fire([{ target: elA, isIntersecting: false }]); });
    expect(result.current.nearIds.has('a')).toBe(false);

    // Detaching (ref → null) unobserves without disturbing the near set.
    act(() => { result.current.observeRef('b')(null); });
    expect(io.observed.has(elB)).toBe(false);
  });
});
