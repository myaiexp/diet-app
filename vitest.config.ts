// Repo-root vitest entry point: one run covering every workspace package
//
// Each package keeps its own config (db/api are node, web is jsdom, and each
// excludes its dist/), so this delegates rather than redefining anything —
// `projects` runs each package's own config in its own environment.
//
// It exists because a pnpm workspace with vitest declared only per package has
// no root `node_modules/.bin/vitest`, and everything that expects one entry
// point breaks on that: `vitest run <substring>` from the repo root, and
// helm's `test-suite` (which resolves the binary by walking up from the cwd,
// and whose remote rung runs `pnpm exec vitest` at the root). Without this the
// full suite could only be run as `pnpm -r test`, which no tooling knows about
// — so a full-suite run never survived the agent turn boundary. See idea #3539.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
