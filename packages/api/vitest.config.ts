// Vitest config — resolve @diet-app/db from source, keep dist copies out of the run

import { fileURLToPath } from 'node:url';
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // @diet-app/db's package.json points main/types at dist/, so without this
      // every api test file that imports the schema fails to collect
      // ("Failed to resolve entry for package") until someone runs
      // `pnpm --filter @diet-app/db build` — which a fresh checkout or Helm
      // worktree never has. Aliasing to src also means the suite can never
      // assert against a stale build. Runtime still uses dist/ (see
      // docs/testing.md); this is a test-time mapping only.
      '@diet-app/db': fileURLToPath(new URL('../db/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // vitest 4 dropped **/dist/** from its default exclude; without this a stale
    // build's dist/__tests__/*.test.js runs alongside src and reports on old code.
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
