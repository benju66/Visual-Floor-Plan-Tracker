// Global test setup, loaded once before any test file (see vitest.config.ts).
//
// jest-dom adds DOM matchers (toBeInTheDocument, toHaveTextContent, ...) to
// expect(). It's a side-effect import; the seed (logic-only) tests don't use
// these matchers yet, but component/hook tests added later will.
import '@testing-library/jest-dom/vitest';

// jsdom does not implement ResizeObserver, but several components measure with
// it — StatusTable's sticky-header height and @tanstack/react-virtual's
// scroll-rect/element measurement (List View Performance — Phase 4). A no-op
// stub is safe: jsdom has no real layout, so measured sizes are 0 either way,
// and the app already treats a 0 header height / estimate-only virtualization
// as valid (all blocks fall inside the overscan window in tests).
//
// We deliberately do NOT stub IntersectionObserver — the Phase-2 viewport-gated
// audit and its `StatusTable.memo.test.tsx` rely on it being ABSENT in jsdom to
// exercise the fail-open ("treat every row as near") path.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
