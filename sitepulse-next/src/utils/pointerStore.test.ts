import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPointerStore, type PointerSample } from './pointerStore';

const sample = (over: Partial<PointerSample> = {}): PointerSample => ({
  screenX: 10,
  screenY: 20,
  pctX: 0.1,
  pctY: 0.2,
  snap: null,
  ...over,
});

describe('createPointerStore', () => {
  // Manual rAF stub: callbacks run only when flushFrames() is called, mirroring
  // the real browser contract of at-most-one notify per frame.
  let rafQueue: Map<number, FrameRequestCallback>;
  let nextHandle: number;
  const flushFrames = () => {
    const callbacks = [...rafQueue.values()];
    rafQueue.clear();
    callbacks.forEach((cb) => cb(performance.now()));
  };

  beforeEach(() => {
    rafQueue = new Map();
    nextHandle = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const handle = nextHandle++;
      rafQueue.set(handle, cb);
      return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      rafQueue.delete(handle);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('get() returns the sample synchronously, before any frame fires', () => {
    const store = createPointerStore();
    const s = sample();
    store.set(s);
    expect(store.get()).toBe(s);
  });

  it('coalesces multiple sets in one frame into a single notification with the latest sample', () => {
    const store = createPointerStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(sample({ screenX: 1 }));
    store.set(sample({ screenX: 2 }));
    const last = sample({ screenX: 3 });
    store.set(last);

    expect(listener).not.toHaveBeenCalled();
    expect(rafQueue.size).toBe(1);

    flushFrames();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(last);
  });

  it('notifies again on the next frame after a new set', () => {
    const store = createPointerStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(sample());
    flushFrames();
    store.set(sample());
    flushFrames();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('schedules no frame when there are no listeners', () => {
    const store = createPointerStore();
    store.set(sample());
    expect(rafQueue.size).toBe(0);
  });

  it('unsubscribe stops notifications', () => {
    const store = createPointerStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.set(sample());
    flushFrames();
    expect(listener).not.toHaveBeenCalled();
  });

  it('dispose cancels a pending frame and drops listeners', () => {
    const store = createPointerStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(sample());
    expect(rafQueue.size).toBe(1);

    store.dispose();
    expect(rafQueue.size).toBe(0);
    flushFrames();
    expect(listener).not.toHaveBeenCalled();
  });
});
