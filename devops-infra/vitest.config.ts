import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Policy and helper tests. The Docker-based validators run with `npm run validate`.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
