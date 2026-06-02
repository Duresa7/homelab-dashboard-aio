import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Pure unit tests with no I/O, asserted against captured/synthesized fixtures:
// the server modules (e.g. sensors/parse.js) and pure client logic (e.g. the
// inventory data model / migration). React components are still exercised via
// the browser/build, not here, so the node environment is sufficient.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(here, 'client/src') },
  },
  test: {
    environment: 'node',
    include: ['server/**/*.test.js', 'client/**/*.test.ts'],
  },
});
