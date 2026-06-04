import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const serverPort = env.PORT || '3001';

  return {
    root: here,
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(here, 'src'),
      },
    },
    server: {
      port: Number(process.env.PORT) || 5173,
      host: true,
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          // Keep the original Host header so it matches the browser Origin.
          // With changeOrigin:true the server's same-origin write guard
          // (server/src/state/index.js) sees Host=:3001 vs Origin=:5173 and
          // rejects every PUT/DELETE with 403 — silently dropping edits made
          // on the dev site. Same Host as Origin → writes persist in dev.
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: path.resolve(repoRoot, 'dist'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
              return 'react-vendor';
            return 'vendor';
          },
        },
      },
    },
  };
});
