// CLI: `migrate:check` — exit 1 when drizzle/ is broken or a migration is skipped
//
// Read-only. Exits 1 when drizzle/ is not one linear chain or a journal migration sits
// below the database's `when` gate, both of which drizzle-kit migrate reports as
// success. post-deploy.sh runs it so a deploy that left the schema behind its code
// fails loudly instead of 500ing later.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import drizzleConfig from '../drizzle.config.js';
import { checkMigrations } from '../src/migration-check.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

async function main(): Promise<void> {
  // The same DSN drizzle-kit migrate just used, so this inspects that database.
  const url = (drizzleConfig as { dbCredentials?: { url?: string } }).dbCredentials?.url;
  if (!url) {
    console.error('✖  drizzle.config.ts exposes no dbCredentials.url — nothing to check.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const refusal = await checkMigrations(MIGRATIONS, client);
    if (refusal) {
      console.error(refusal);
      process.exitCode = 1;
    } else {
      console.log('✓ migration chain consistent, nothing skipped');
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`✖  migrate:check failed: ${(err as Error).message}`);
  process.exit(1);
});
