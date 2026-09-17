// @ts-check
import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the learner runtime spec. Boots the authoring app and
 * drives the real Preview harness (mock LMS + real player.js).
 * Run: npm run test:e2e
 * Requires: npm i -D @playwright/test && npx playwright install chromium
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true },
  webServer: {
    command: 'node apps/server/index.js',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 20000,
  },
});
