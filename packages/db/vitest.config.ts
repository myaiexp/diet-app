// Vitest config — keep compiled dist copies of tests out of the run

import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // vitest 4 dropped **/dist/** from its default exclude; without this a stale
    // build's dist/__tests__/*.test.js runs alongside src and reports on old code.
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
