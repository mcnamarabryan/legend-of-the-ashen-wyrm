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
    /*
     * DO NOT WATCH THE DATABASE.
     *
     * The realm writes `data/realm.sqlite` on every command, by rename — which
     * to a file watcher looks like a file vanishing and reappearing several
     * times a second. Vite's watcher followed it and crashed the dev server with
     * `EIO: dirent not found, lstat 'data/realm.sqlite'`, taking the whole
     * client down mid-session.
     *
     * The client never reads that file, so ignoring it costs nothing and the
     * previous entry (`public/`) is kept.
     */
    watch: {
      ignored: ['**/data/**', '**/*.sqlite', '**/*.sqlite.tmp'],
    },
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
