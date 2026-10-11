// Repo-root vitest entry: one run of every workspace package through its own config, plus the merged coverage thresholds.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    // Coverage only merges across projects when configured here, at the root.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/__tests__/**',
        '**/*.d.ts',
        '**/*.config.ts',
        'packages/db/src/schema/**',
      ],
      // Measured with the real-Postgres suites on, rounded down. Raise these
      // when coverage climbs; never lower them to make a run pass.
      thresholds: { statements: 95, branches: 88, functions: 94, lines: 97 },
    },
  },
});
