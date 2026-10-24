import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vite serves the CLIENT only.
 *
 * The game server is a separate process (`npm run server`), and dev requests to
 * /api are proxied to it. That separation is the security boundary: nothing in
 * src/ can import the rules engine at build time without the bundler failing,
 * because the rules no longer live there.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
});
