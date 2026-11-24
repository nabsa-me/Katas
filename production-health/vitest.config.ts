import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Stops the run with the command to type when the Postgres from docker-compose.yml is not up.
    globalSetup: ['src/test-global-setup.ts'],
  },
});
