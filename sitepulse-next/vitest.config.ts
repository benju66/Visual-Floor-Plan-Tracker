import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest config for SitePulse frontend.
// - jsdom environment so component/hook tests can render against a DOM.
// - resolve.tsconfigPaths resolves the `@/*` alias from tsconfig (native Vite).
// - Globals are OFF on purpose: import { describe, it, expect } from 'vitest'
//   in each test so `tsc --noEmit` stays clean without extra global types.
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'src/workers/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Seed coverage targets the pure logic layer. Expand `include` as the
      // suite grows into hooks/components.
      include: ['src/utils/**', 'src/types/**'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
  },
});
