import { config } from 'dotenv';
config({ path: '../../.env' });     // dev: relative to packages/api/src
config({ path: '.env' });           // prod: WorkingDirectory is project root

import { serve } from '@hono/node-server';
import { createDb } from '@diet-app/db';
import { createApp } from './app.js';
import { assertEnv } from './env.js';
import { parseCorsOrigins } from './config.js';

const db = createDb(assertEnv('DATABASE_URL'));
const app = createApp(db, {
  authToken: assertEnv('API_TOKEN'),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
});
const PORT = parseInt(process.env.API_PORT ?? '3300', 10);

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});
