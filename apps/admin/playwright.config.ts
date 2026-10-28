/**
 * End-to-end tests of the admin console against the real API and worker (pnpm e2e). Build the
 * console first (pnpm build); Postgres and Redis must be running.
 */
import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.output/results',
  timeout: 120_000,
  retries: CI ? 1 : 0,
  workers: 1,
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/.output/report' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3102',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node ../api/scripts/e2e-server.mjs',
      url: 'http://localhost:3100/health',
      env: { E2E_WITH_WORKER: '1' },
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm start',
      url: 'http://localhost:3102/login',
      env: { PORT: '3102', API_URL: 'http://localhost:3100', ADMIN_DEV_SIGN_IN: 'true' },
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
