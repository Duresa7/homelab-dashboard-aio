import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Vitest 4 replaced the standalone workspace file (`defineWorkspace`) with a
// `test.projects` array in the root config. Two projects: a Node project for the
// Express server and a jsdom project for the React client.
const here = path.dirname(fileURLToPath(import.meta.url));

// zxcvbn-ts v4's CJS builds are broken under a Node test runner: the language
// `.cjs` files call `require('@zxcvbn-ts/dictionary-compression/decompress')(...)`,
// but that resolves to `{ default: fn }` (esbuild interop) and throws "decompress is
// not a function". Vitest externalizes node_modules and loads each package's `main`
// (the .cjs), so it hits the bug. Pinning each package to its ESM `.mjs` entry makes
// Vitest load the working ESM graph instead. Tests only — the browser build already
// resolves the `module`/.mjs entry.
const zxcvbnEsm = (pkg: string) =>
  path.resolve(here, `node_modules/@zxcvbn-ts/${pkg}/dist/index.mjs`);
const alias = {
  '@': path.resolve(here, 'client/src'),
  '@zxcvbn-ts/core': zxcvbnEsm('core'),
  '@zxcvbn-ts/language-common': zxcvbnEsm('language-common'),
  '@zxcvbn-ts/language-en': zxcvbnEsm('language-en'),
};

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
