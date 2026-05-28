import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@lib': path.resolve(import.meta.dirname, 'lib'),
      '@tests': path.resolve(import.meta.dirname, 'tests'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup/jest-dom.ts'],
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'lib/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['lib/**/*.ts', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'lib/**/*.test.ts',
        'lib/**/__fixtures__/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/main.tsx', // app entry — no logic to cover
        'src/types/**', // ambient declarations
      ],
      // Per-path gates. lib/** is the game/realtime core — held at 80%.
      // src/** (React surfaces) is gated as a ratchet just below its current
      // floor so it can no longer silently regress (finding F3); raise toward
      // 80% as GameTable4P/MP reducer coverage grows.
      thresholds: {
        'lib/**': { lines: 80, functions: 80, branches: 80, statements: 80 },
        'src/**': { lines: 75, functions: 68, branches: 65, statements: 73 },
      },
    },
  },
});
