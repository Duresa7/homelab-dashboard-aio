import { defineConfig } from 'vitest/config';

// Server-side unit tests only. The client is exercised via the browser/build;
// these tests cover the pure server modules (e.g. sensors/parse.js) that have
// no I/O and can be asserted against captured/synthesized fixtures.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.js'],
  },
});
