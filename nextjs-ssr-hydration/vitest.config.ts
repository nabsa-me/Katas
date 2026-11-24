import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests for pure logic. Browser tests are Playwright `*.spec.ts` files.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
