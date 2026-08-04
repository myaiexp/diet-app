// Vite build + vitest config for the Ruoka frontend

import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  // The app owns its vhost root (diet.mase.fi/), so no path prefix.
  base: '/',
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
