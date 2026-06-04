import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Vitest 4 replaced the standalone workspace file (`defineWorkspace`) with a
// `test.projects` array in the root config. Two projects: a Node project for the
// Express server and a jsdom project for the React client.
const here = path.dirname(fileURLToPath(import.meta.url));
const alias = { '@': path.resolve(here, 'client/src') };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['client/**/*.test.{ts,tsx}'],
          setupFiles: ['client/src/test/setup.ts'],
        },
      },
    ],
  },
});
