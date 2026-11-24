import { defineConfig, devices } from '@playwright/test';
import { LOCAL_SERVICES } from './src/lib/local-services.ts';

export default defineConfig({
  testDir: 'src',
  // `*.spec.ts` for Playwright, `*.test.ts` for Vitest: each runner only picks up its own files.
  testMatch: '**/*.spec.ts',
  globalSetup: './src/lib/require-mock-oidc.ts',
  // The specs share one provider and log different users in; one worker keeps the run simple and light.
  workers: 1,
  use: {
    baseURL: LOCAL_SERVICES.appUrl,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The production build, as the Next.js testing guide recommends.
    command: 'npm run build && npm run start',
    url: LOCAL_SERVICES.appUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      OIDC_ISSUER: LOCAL_SERVICES.issuer,
      OIDC_CLIENT_ID: 'katas-web',
      APP_URL: LOCAL_SERVICES.appUrl,
      // A local-only value for the test run; real secrets come from the environment, never from the repo.
      SESSION_SECRET: 'e2e-only-session-secret-for-local-test-runs',
    },
  },
});
