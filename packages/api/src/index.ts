// API process entry: env, DB pool, HTTP server on :3300, graceful shutdown
import './load-env.js'; // loads repo-root .env (CWD-independent) before anything reads process.env

import { serve } from '@hono/node-server';
import { createDb } from '@diet-app/db';
import { createApp } from './app.js';
import { assertEnv } from './env.js';
import { parseCorsOrigins, parseAiConfig } from './config.js';
import { installShutdown } from './shutdown.js';

const db = createDb(assertEnv('DATABASE_URL'));
const app = createApp(db, {
  authToken: assertEnv('API_TOKEN'),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  ai: parseAiConfig(process.env),
});
const PORT = parseInt(process.env.API_PORT ?? '3300', 10);

const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});

// Every deploy restarts the unit; without this a cook or /complete in flight
// is cut mid-handler and its client sees a network error, not an answer.
installShutdown(server, () => db.$client.end());
