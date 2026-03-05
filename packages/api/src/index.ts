import { config } from 'dotenv';
config({ path: '../../.env' });

import { serve } from '@hono/node-server';
import { createDb } from '@diet-app/db';
import { createApp } from './app.js';

const db = createDb(process.env.DATABASE_URL!);
const app = createApp(db);
const PORT = parseInt(process.env.API_PORT ?? '3300', 10);

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});
