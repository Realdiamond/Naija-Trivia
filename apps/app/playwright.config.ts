/**
 * End-to-end tests of the web build against the real API (pnpm e2e). Build first with
 * EXPO_PUBLIC_API_URL=http://localhost:3100 pnpm build:web; Postgres and Redis must be running.
 */
import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.output/results',
  timeout: 60_000,
  retries: CI ? 1 : 0,
  workers: 1,
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/.output/report' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8082',
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'phone-chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'node ../api/scripts/e2e-server.mjs',
      url: 'http://localhost:3100/health',
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: 'node e2e/serve.mjs 8082',
      url: 'http://localhost:8082',
      reuseExistingServer: !CI,
    },
  ],
});
