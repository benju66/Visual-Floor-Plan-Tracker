// Reusable integration-test harness for components/hooks that use React Query.
//
// This is NOT a test file (no `.test.` in the name) — it's a helper imported by
// tests. It provides a fresh QueryClient per render (retries off, no cache bleed
// between tests) so component/hook tests can render against the data layer
// without a real network or database.
//
// ─────────────────────────────────────────────────────────────────────────────
// Supabase-mock recipe (no `msw` — it is intentionally NOT installed).
// Mirror the chainable-stub style from `src/hooks/useSnappingVectors.test.tsx`:
//
//   import { describe, it, expect, vi, beforeEach } from 'vitest';
//   import { renderWithQuery } from '@/test/renderWithQuery';
//
//   const getSession = vi.fn();
//   const maybeSingle = vi.fn();
//   const upsert = vi.fn();
//   const eq = vi.fn(() => ({ maybeSingle }));
//   const select = vi.fn(() => ({ eq }));
//   const from = vi.fn(() => ({ select, upsert }));
//
//   vi.mock('@/supabaseClient', () => ({
//     supabase: {
//       auth: { getSession: () => getSession() },
//       from: () => from(),
//     },
//   }));
//
//   // Then, in the test:
//   beforeEach(() => {
//     getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
//     maybeSingle.mockResolvedValue({ data: { /* row */ } });
//     upsert.mockResolvedValue({ error: null });
//   });
//   // renderWithQuery(<MyComponent />)  — or renderHook(..., { wrapper })
//
// Shape the chain to match the query under test (add `.order()`, `.insert()`,
// `.single()`, etc. as needed). Reset the fns in `beforeEach` to avoid bleed.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A QueryClient tuned for tests: no retries (failures surface immediately) and
 * `gcTime: 0` so nothing lingers between tests.
 */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * Render `ui` inside a fresh `QueryClientProvider`. Returns the RTL result plus
 * the `client` (handy for asserting cache state or seeding queries).
 */
export function renderWithQuery(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  const client = makeTestQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, ...render(ui, { wrapper: Wrapper, ...options }) };
}
