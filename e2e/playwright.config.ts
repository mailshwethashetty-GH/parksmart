import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE } from './harness/constants';

/**
 * One serial story through the pilot week (docs/10 key flows) on a single harness, then
 * performance checks. The harness clock only moves forward, so workers = 1.
 * Build the web app first: `pnpm test:e2e` does both.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: E2E_BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    // No transitions mid-check: axe reads colors, and the app honours reduced motion.
    reducedMotion: 'reduce',
  },
  webServer: {
    command: 'pnpm exec tsx e2e/harness/server.ts',
    cwd: '..',
    url: `${E2E_BASE}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
