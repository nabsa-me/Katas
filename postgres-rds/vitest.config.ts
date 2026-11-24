import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Fails the whole run with the start command when Postgres is not up.
    globalSetup: ['src/lib/global-setup.ts'],
    // Each test file creates its own database, so files can run in parallel. Seeding and
    // migrations against a real server take longer than Vitest's defaults allow.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
