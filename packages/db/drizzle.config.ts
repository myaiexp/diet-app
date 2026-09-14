import { defineConfig } from 'drizzle-kit';
import { loadRepoEnv } from './src/load-env.js';

// drizzle-kit resolves schema/out against the CWD by design, but the .env load
// need not be: scripts/db-migrate.ts imports this file too, from any CWD.
loadRepoEnv();

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
