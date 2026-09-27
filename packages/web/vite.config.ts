// Vite build + vitest config for the Ruoka frontend

import { fileURLToPath } from 'node:url';
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  // The app owns its vhost root (diet.mase.fi/), so no path prefix.
  base: '/',
  resolve: {
    alias: {
      // The API's contract vocabularies (enum tuples, servings cap, base
      // units), compiled from source into the bundle so the client never keeps
      // a hand-mirrored copy. vocab.ts is import-free by rule, so this pulls in
      // that one file and nothing else of the API. Mirrored by `paths` in
      // tsconfig.json.
      '@diet-app/api/vocab': fileURLToPath(new URL('../api/src/vocab.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // Dev only: same-origin /api in production is nginx's job, and it also
    // injects the bearer token the browser never holds. Locally the API wants
    // that header, so pass API_TOKEN through when proxying.
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN ?? 'http://127.0.0.1:3300',
        changeOrigin: false,
        headers: process.env.API_TOKEN
          ? { Authorization: `Bearer ${process.env.API_TOKEN}` }
          : {},
      },
    },
  },
  test: {
    environment: 'jsdom',
    // vitest 4 dropped **/dist/** from its default exclude; without this a
    // stale build's copies would run alongside src.
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
