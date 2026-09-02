// Guard: every dotenv config() call passes quiet, or it prints an ad (idea #3239)
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * dotenv 17 ships a TIPS array and prints one at random on every config() call
 * — including `tip: ⌁ auth for agents [www.vestauth.com]`, a third-party ad. It
 * lands on stdout of every seed, migration and CLI run, and in any log that
 * captures them. `quiet: true` suppresses it.
 *
 * The site list is derived, not hard-coded: a new file importing dotenv fails
 * this test until it opts out of the noise too.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'drizzle', '.git']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|mts|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

const dotenvSites = sourceFiles(join(repoRoot, 'packages')).filter((f) =>
  /(from|import\()\s*'dotenv'/.test(readFileSync(f, 'utf8')),
);

describe('dotenv quiet', () => {
  test('finds the dotenv call sites at all (guard would pass vacuously otherwise)', () => {
    expect(dotenvSites.length).toBeGreaterThanOrEqual(6);
  });

  test('every config() call opts out of the tip line', () => {
    const noisy: string[] = [];
    for (const file of dotenvSites) {
      const src = readFileSync(file, 'utf8');
      for (const call of src.matchAll(/\bconfig\(\{([^}]*)\}/g)) {
        if (!/\bquiet\s*:\s*true\b/.test(call[1]!)) {
          noisy.push(`${relative(repoRoot, file)}: config({${call[1]!.trim()}})`);
        }
      }
    }
    expect(noisy).toEqual([]);
  });
});
