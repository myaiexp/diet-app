// Guard: pnpm settings must live where pnpm 11 still reads them (idea #3195)
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * pnpm 11 no longer reads the `pnpm` field in package.json ("The following keys
 * were ignored: pnpm.overrides"). This repo is pinned to pnpm 10 by
 * `packageManager`, so the breakage is latent rather than live — which is what
 * makes it worth a guard: the day a host installs with pnpm 11 the drizzle-kit
 * override silently stops applying, with no error at install time. Settings
 * belong in pnpm-workspace.yaml, which both pnpm 10 and 11 read.
 * See docs/testing.md "drizzle-kit override".
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as Record<
  string,
  unknown
>;
const workspace = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');

describe('pnpm settings location', () => {
  test('package.json carries no `pnpm` field — pnpm 11 ignores it', () => {
    expect(pkg.pnpm).toBeUndefined();
  });

  test('pnpm-workspace.yaml carries the drizzle-kit override', () => {
    expect(workspace).toMatch(/^overrides:$/m);
    // The `drizzle-kit>` parent selector is load-bearing: a flat
    // '@esbuild-kit/esm-loader' key would not rewrite drizzle-kit's own dep.
    expect(workspace).toMatch(
      /^\s+'drizzle-kit>@esbuild-kit\/esm-loader':\s*npm:tsx@\^4$/m,
    );
  });
});
