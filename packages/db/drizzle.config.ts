import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
