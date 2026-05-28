import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end browser tests.
 *
 * `webServer` boots `npm run dev` (Vite + the api middleware plugin from
 * scripts/vite-api-plugin.ts). The same Node process serves the SPA and
 * the API + SSE routes — no separate `vercel dev` needed. Memory backend
 * is used because no Upstash env is provided; state lives in the same
 * process as the test server, so tests stay deterministic.
 *
 * To run a single project quickly:
 *   npx playwright test --project=chromium
 *
 * To debug a flow visually:
 *   PWDEBUG=1 npx playwright test --project=chromium tests/e2e/landing.spec.ts
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // shared memory backend → tests would step on each other if parallelised
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // iPhone 14 Pro landscape — exercises the OrientationLock pass-through.
      // Restricted to the orientation spec because (a) other journey/landing
      // specs touch modal flows that race against the OrientationLock
      // input-bypass swap on small viewports, and (b) the chromium-desktop
      // project already covers their happy paths at desktop sizing.
      name: 'mobile-landscape',
      use: { ...devices['iPhone 14 Pro landscape'] },
      testMatch: /orientation\.spec\.ts/,
    },
    {
      // iPhone 14 Pro portrait — exercises the OrientationLock CSS rotate.
      name: 'mobile-portrait',
      use: { ...devices['iPhone 14 Pro'] },
      testMatch: /orientation\.spec\.ts/,
    },
    {
      // Modal flows (sign-in/join/create) at mobile sizing — finding F4
      // (modals were only ever exercised at desktop sizing). Uses the
      // chromium engine with an iPhone-14-Pro-landscape viewport + touch so
      // CI runs it on the already-installed chromium (iPhone WebKit devices
      // aren't installed in CI). Landscape dims skip the OrientationLock CSS
      // rotate, keeping modal + input interactions stable.
      name: 'mobile-modals',
      use: {
        browserName: 'chromium',
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
      testMatch: /mobile-modals\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env['CI'],
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 30_000,
  },
});
