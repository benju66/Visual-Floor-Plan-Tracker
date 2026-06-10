import { useSyncExternalStore } from 'react';

/**
 * One pointer measurement, captured in the Stage onMouseMove handler against the
 * LIVE Konva transform (stage.x()/scaleX()), never the debounced React state.
 *
 * Every `set()` must receive a NEW object — `useSyncExternalStore` detects changes
 * by snapshot identity.
 */
export interface PointerSample {
  /** Stage container pixels — crosshair, tooltip anchoring, pointer-up fallback. */
  screenX: number;
  screenY: number;
  /** Normalized [0–1] sheet coordinates — draft ghost, stamp preview, route ghost. */
  pctX: number;
  pctY: number;
  /** Draw-mode snap result for the current position (null outside draw+snapping). */
  snap: { pctX: number; pctY: number; snapped: boolean } | null;
}

export interface PointerStore {
  /** Synchronous read — always returns the latest sample, even before notify fires. */
  get(): PointerSample | null;
  /** Synchronous write; listener notification is coalesced to one per animation frame. */
  set(sample: PointerSample | null): void;
  subscribe(listener: () => void): () => void;
  /** Cancel any pending notification frame and drop all listeners. */
  dispose(): void;
}

/**
 * Tiny external store for the pointer position. Keeping the pointer out of React
 * state means mouse movement over the canvas causes ZERO React re-renders unless
 * a leaf consumer (draft ghost, stamp preview, crosshair…) is mounted — and those
 * re-render at most once per frame.
 */
export function createPointerStore(): PointerStore {
  let current: PointerSample | null = null;
  let frame: number | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    frame = null;
    listeners.forEach((l) => l());
  };

  return {
    get: () => current,
    set(sample) {
      current = sample;
      if (frame === null && listeners.size > 0) {
        frame = requestAnimationFrame(notify);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      listeners.clear();
    },
  };
}

const getServerSnapshot = () => null;

/** Subscribe a component to the pointer store (re-renders at most once per frame). */
export function usePointerSample(store: PointerStore): PointerSample | null {
  return useSyncExternalStore(store.subscribe, store.get, getServerSnapshot);
}
