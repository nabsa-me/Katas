import { defineConfig, devices } from '@playwright/test';

const PORT = 5803;

export default defineConfig({
  testDir: 'src',
  testMatch: '**/*.spec.ts',
  // The development server compiles each route on its first request: one worker keeps timings stable.
  workers: 1,
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The development server on purpose: React only reports attribute mismatches in development builds.
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // A server time zone different from the browser's, as in production, so locale bugs show up locally.
    env: { TZ: 'UTC' },
  },
});
