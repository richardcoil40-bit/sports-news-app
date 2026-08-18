import path from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Scoped to src/lib/ deliberately. That directory is plain TypeScript with no
 * React or React Native imports (enforced by the no-restricted-imports rule in
 * eslint.config.js), so it runs under a plain Node environment — no jest-expo,
 * no Metro transform, no React Native mocks.
 *
 * Testing components or hooks would need that heavier harness. If that day
 * comes, add it alongside this rather than folding these tests into it.
 *
 * .mts so Vite loads it as ESM; a .ts config here is read as CommonJS.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/lib/**/*.test.ts'],
  },
});
