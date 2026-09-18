// @ts-check
/**
 * Playwright learner spec, driving the REAL runtime inside the mock-LMS
 * preview harness.
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workbook = JSON.parse(readFileSync(join(ROOT, 'samples', 'demo.workbook.json'), 'utf8'));

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/preview', { data: workbook })).ok()).toBeTruthy();
});

test('section cards show author titles and the custom heading', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());
  await expect(page.locator('[data-dashboard-heading]')).toHaveText('Your Milestones');
  await expect(page.locator('.sowb-section-card')).toHaveCount(4);
  await expect(page.locator('.sowb-section-name').first()).toHaveText('Month 1');
  // No "Section N:" prefix anywhere.
  const names = await page.locator('.sowb-section-name').allTextContents();
  for (const n of names) expect(n).not.toMatch(/^Section\s*\d+\s*:/);
});

test('expected checklist options and numeric bounds gate completion', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());

  await page.locator('[data-open-section="s1"]').click();
  await page.locator('input[type="date"][data-q="q_s1_1"]').fill('2026-09-14');
  await page.locator('[data-next]').click();
  await page.locator('textarea[data-q="q_s1_2"]').fill('Reviewed scope and safety plan.');
  await page.locator('[data-next]').click();
  await page.locator('[data-q="q_s1_3"]').first().check(); // Scope review only
  await expect(page.locator('[data-answer-status]')).toHaveText('Some required items are not yet selected.');

  await page.locator('[data-back]').click();
  await expect(page.locator('[data-section-status="s1"]')).toHaveText('Partially Complete');

  // A PARTIALLY COMPLETE section resumes in place, so Continue lands back on
  // the checklist rather than at question 1.
  await expect(page.locator('[data-open-section="s1"]')).toHaveText('Continue');
  await page.locator('[data-open-section="s1"]').click();
  await expect(page.locator('.sowb-counter')).toHaveText('Question 3 of 3');
  await page.locator('[data-q="q_s1_3"]').nth(1).check(); // Safety plan
  await page.locator('[data-back]').click();
  await expect(page.locator('[data-section-status="s1"]')).toHaveText('Completed');

  // A COMPLETED section reopens at question 1 for review.
  await expect(page.locator('[data-open-section="s1"]')).toHaveText('Review');
  await page.locator('[data-open-section="s1"]').click();
  await expect(page.locator('.sowb-counter')).toHaveText('Question 1 of 3');
  await page.locator('[data-back]').click();

  // Numeric below its minimum keeps section 2 partial.
  await page.locator('[data-open-section="s2"]').click();
  await page.locator('input[data-q="q_s2_1"]').fill('Dana Ruiz');
  await page.locator('[data-next]').click();
  await page.locator('input[data-q="q_s2_2"]').fill('2');
  await expect(page.locator('[data-answer-status]')).toHaveText('Enter at least 4.');
  await page.locator('input[data-q="q_s2_2"]').fill('6');
  await expect(page.locator('[data-answer-status]')).toHaveText('Answer saved');
});

test('a labeled rating scale renders its wording and stores the value', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());
  await page.locator('[data-open-section="s2"]').click();
  await page.locator('[data-next]').click();
  await page.locator('[data-next]').click(); // the agreement-5 question

  await expect(page.locator('[data-rating-layout]')).toHaveAttribute('data-rating-layout', 'listed');
  await expect(page.locator('.sowb-rating-label').first()).toHaveText('Strongly Agree');
  await page.locator('[data-q="q_s2_3"][data-value="2"]').check();
  await expect(page.locator('[data-answer-status]')).toHaveText('Answer saved');

  const stored = await page.evaluate(() => window.__PLAYER__.state.responses.q_s2_3);
  expect(stored).toBe('2');
});

test('exit and resume returns to the section list with state intact', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());
  await page.locator('[data-open-section="s1"]').click();
  await page.locator('input[type="date"][data-q="q_s1_1"]').fill('2026-09-14');
  await page.locator('#exitResume').click();

  await expect(page.locator('.sowb-section-card')).toHaveCount(4);
  const restored = await page.evaluate(() => window.__PLAYER__.state.responses.q_s1_1);
  expect(restored).toBe('2026-09-14');
});

test('the learner can download a PDF from the dashboard header', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());
  const button = page.locator('[data-download-pdf]');
  await expect(button).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  // The fallback is always offered for sandboxed frames that block downloads.
  await expect(page.locator('[data-pdf-open]')).toBeVisible();

  // It is hidden inside a section so the question view stays focused.
  await page.locator('[data-open-section="s1"]').click();
  await expect(page.locator('[data-download-pdf]')).toHaveCount(0);
});

test('the PDF button is hidden when the workbook disables it', async ({ page, request }) => {
  const off = JSON.parse(JSON.stringify(workbook));
  off.settings.allowPdfDownload = false;
  await request.post('/api/preview', { data: off });
  await page.goto('/preview/harness.html?t=' + Date.now());
  await expect(page.locator('[data-download-pdf]')).toHaveCount(0);
});
