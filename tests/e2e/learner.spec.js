// @ts-check
/**
 * Playwright learner spec, driving the REAL runtime inside the mock-LMS
 * preview harness. Covers the partial-completion rules end to end.
 *
 * Prereqs (not bundled):
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 *   npm run test:e2e
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const workbook = JSON.parse(readFileSync(join(ROOT, 'samples', 'ae-install-ride-along.workbook.json'), 'utf8'));

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/preview', { data: workbook })).ok()).toBeTruthy();
});

test('expected checklist options and numeric bounds gate completion', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());
  await expect(page.locator('.sowb-section-card')).toHaveCount(3);

  // --- Section 1: answer everything but tick only ONE expected option.
  await page.locator('[data-open-section="s1"]').click();
  await page.locator('input[type="date"][data-q="q_s1_1"]').fill('2026-09-14');
  await page.locator('[data-next]').click();
  await page.locator('textarea[data-q="q_s1_2"]').fill('Reviewed scope and safety plan.');
  await page.locator('[data-next]').click();
  await page.locator('[data-q="q_s1_3"]').first().check(); // Scope review only
  await expect(page.locator('[data-answer-status]')).toHaveText('Some required items are not yet selected.');

  await page.locator('[data-back]').click();
  await expect(page.locator('[data-section-status="s1"]')).toHaveText('Partially Complete');

  // Ticking the second expected option completes the section.
  await page.locator('[data-open-section="s1"]').click();
  await page.locator('[data-q="q_s1_3"]').nth(1).check(); // Safety plan
  await page.locator('[data-back]').click();
  await expect(page.locator('[data-section-status="s1"]')).toHaveText('Completed');

  // --- Section 2: numeric below its minimum keeps it partial.
  await page.locator('[data-open-section="s2"]').click();
  await page.locator('input[data-q="q_s2_1"]').fill('Dana Ruiz');
  await page.locator('[data-next]').click();
  await page.locator('input[data-q="q_s2_2"]').fill('2');
  await expect(page.locator('[data-answer-status]')).toHaveText('Enter at least 4.');
  await page.locator('[data-next]').click();
  await page.locator('input[data-q="q_s2_3"][value="High"]').check();
  await page.locator('[data-next]').click();
  await page.locator('textarea[data-q="q_s2_4"]').fill('Learned the handoff checklist.');
  await page.locator('[data-back]').click();
  await expect(page.locator('[data-section-status="s2"]')).toHaveText('Partially Complete');

  // Meeting the minimum completes it.
  await page.locator('[data-open-section="s2"]').click();
  await page.locator('input[data-q="q_s2_2"]').fill('6');
  await page.locator('[data-back]').click();
  await expect(page.locator('[data-section-status="s2"]')).toHaveText('Completed');

  // --- Exit + resume returns to the section list with state intact.
  await page.locator('#exitResume').click();
  await expect(page.locator('.sowb-section-card')).toHaveCount(3);
  await expect(page.locator('[data-section-status="s1"]')).toHaveText('Completed');

  // --- Section 3 finishes the workbook.
  await page.locator('[data-open-section="s3"]').click();
  await page.locator('input[data-q="q_s3_1"][value="yes"]').check();
  await page.locator('[data-next]').click();
  await page.locator('input[data-q="q_s3_2"][value="4"]').check();
  await page.locator('[data-back]').click();

  expect(await page.evaluate(() => window.__LMS__.persistent['cmi.completion_status'])).toBe('completed');
  expect(await page.evaluate(() => window.__LMS__.persistent['cmi.progress_measure'])).toBe('1');
});

test('an invalid url stays partial and a valid one previews', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());
  await page.locator('[data-open-section="s3"]').click();
  await page.locator('[data-next]').click();
  await page.locator('[data-next]').click(); // the url question
  await page.locator('input[data-q="q_s3_3"]').fill('notaurl');
  await expect(page.locator('[data-answer-status]')).toHaveText('Enter a valid link starting with https://');
  await page.locator('input[data-q="q_s3_3"]').fill('https://jci.sharepoint.com/notes');
  await expect(page.locator('[data-answer-status]')).toHaveText('Answer saved');
  await expect(page.locator('[data-url-preview]')).toHaveAttribute('href', 'https://jci.sharepoint.com/notes');
});

test('the dashboard heading is author-configurable', async ({ page, request }) => {
  const custom = JSON.parse(JSON.stringify(workbook));
  custom.settings.dashboardHeading = 'Your Milestones';
  await request.post('/api/preview', { data: custom });
  await page.goto('/preview/harness.html?t=' + Date.now());
  await expect(page.locator('[data-dashboard-heading]')).toHaveText('Your Milestones');
});
