// Load the repo-root .env for the db CLIs, independent of the CWD
//
// Resolved relative to THIS module: src/ (tsx: seed, import-products) and
// dist/ (node: seed-demo.mjs imports the built copy) sit at the same depth
// under packages/db, so one relative path reaches the repo root from either.
// A CWD-relative '../../.env' loads nothing when the CLI is started from
// anywhere but packages/db, and DATABASE_URL then reads as unset. Mirrors
// packages/api/src/load-env.ts, which does the same for the API server.
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT_ENV = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');

export function loadRepoEnv(): void {
  // quiet: dotenv 17 otherwise prints a random tip (including a third-party ad)
  // on every call, into the output of every seed and import run.
  config({ path: REPO_ROOT_ENV, quiet: true });
}
