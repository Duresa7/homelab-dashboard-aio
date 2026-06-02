import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const alias = { '@': path.resolve(here, 'client/src') };

export default defineWorkspace([
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
]);
