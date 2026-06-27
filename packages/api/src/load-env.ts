// Load the repo-root .env into process.env, resolved relative to THIS module
// rather than the CWD. The compiled dist/ (prod: `node dist/index.js`) and the
// source src/ (dev: `tsx watch src/index.ts`) sit at the same depth under
// packages/api, so one relative path reaches the repo root from either —
// replacing the previous CWD- and load-order-sensitive double config() calls.
// Imported for side effect at the very top of index.ts, before anything reads
// process.env.
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRootEnv = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
config({ path: repoRootEnv });
