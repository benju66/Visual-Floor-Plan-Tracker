"use client";
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks which registered elements are at/near the scroll viewport, via ONE
 * shared IntersectionObserver. Built for the desktop List (`StatusTable`) so an
 * expanded location only runs its per-location history query (`useUnitHistory`)
 * when its row is on/near screen — turning "expand all" from N-simultaneous
 * requests into a viewport-bounded handful (List View Performance — Phase 2).
 * It also sets up Phase 4: viewport-only work is what virtualization generalizes.
 *
 * Usage: attach `observeRef(id)` (a STABLE per-id ref callback) to each row's
 * element, then read `nearIds` during render to decide what to fetch. When
 * IntersectionObserver is unavailable (SSR / jsdom / very old browsers)
 * `supported` is false and callers MUST treat every id as near — so behavior
 * degrades to "always fetch", never "never fetch".
 *
 * `rootMargin` grows the viewport box so rows just outside it pre-load (default
 * 400px above/below), avoiding a visible fetch-on-scroll lag. `root: null` (the
 * viewport) is deliberate: the List nests scroll containers, and viewport-rooted
 * observation is still clipped correctly by intervening scrollers per spec —
 * without us hunting for the exact scroll parent (Phase 4 supersedes this).
 */
export function useViewportPresence(rootMargin = '400px 0px') {
  // Capability latched once. Server → false; client → true. Nothing is expanded
  // on first render, so this false→true flip never diverges the rendered DOM.
  const [supported] = useState(() => typeof IntersectionObserver !== 'undefined');
  const [nearIds, setNearIds] = useState<Set<string>>(() => new Set());

  const observerRef = useRef<IntersectionObserver | null>(null);
  const elToId = useRef(new Map<Element, string>());
  const idToEl = useRef(new Map<string, Element>());
  const refCbCache = useRef(new Map<string, (el: HTMLElement | null) => void>());

  // One observer for the component's lifetime; re-created only if rootMargin changes.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        setNearIds((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const id = elToId.current.get(entry.target);
            if (!id) continue;
            if (entry.isIntersecting) {
              if (!next.has(id)) { next.add(id); changed = true; }
            } else if (next.has(id)) {
              next.delete(id); changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root: null, rootMargin },
    );
    observerRef.current = io;
    // Pick up any elements registered before the observer existed (first paint).
    idToEl.current.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      observerRef.current = null;
    };
  }, [rootMargin]);

  // Register/unregister an element for an id (idempotent). Stable identity so it
  // can live in the ref-callback cache below.
  const registerEl = useCallback((id: string, el: HTMLElement | null) => {
    const prev = idToEl.current.get(id);
    if (prev && prev !== el) {
      observerRef.current?.unobserve(prev);
      elToId.current.delete(prev);
      idToEl.current.delete(id);
    }
    if (el) {
      if (idToEl.current.get(id) === el) return; // already registered
      idToEl.current.set(id, el);
      elToId.current.set(el, id);
      observerRef.current?.observe(el);
    }
    // Note: an unmounting element is NOT dropped from `nearIds` — a stale id there
    // is inert (`.has(id)` is only ever queried for currently-rendered ids), and
    // skipping the setState avoids a re-render storm when a filter unmounts many
    // rows at once. A scrolled-away (still-mounted) element IS removed, via the
    // observer's isIntersecting=false path above — that's what bounds concurrency.
  }, []);

  // A STABLE ref callback per id, so React doesn't churn observe/unobserve on
  // every render (an inline arrow changes identity each render, which makes React
  // fire the callback with null-then-node — re-registering constantly).
  const observeRef = useCallback((id: string) => {
    let cb = refCbCache.current.get(id);
    if (!cb) {
      cb = (el: HTMLElement | null) => registerEl(id, el);
      refCbCache.current.set(id, cb);
    }
    return cb;
  }, [registerEl]);

  return { observeRef, nearIds, supported };
}
