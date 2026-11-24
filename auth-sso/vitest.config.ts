import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit and integration tests only; the Playwright specs (`*.spec.ts`) run with `npm run e2e`.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
