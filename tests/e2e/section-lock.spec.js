// @ts-check
/**
 * Opt-in answer locking, in a real browser against the REAL runtime inside the
 * mock-LMS preview harness.
 *
 * tests/section-lock.test.js already covers the rule, the commit and the
 * persistence headlessly. What only a browser can prove is the part that
 * matters to a learner: that a locked control genuinely refuses input.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workbook = JSON.parse(readFileSync(join(ROOT, 'samples', 'demo.workbook.json'), 'utf8'));
workbook.sections[0].lockWhenComplete = true; // s1 only; s2..s4 stay editable.

test.beforeEach(async ({ request }) => {
  expect((await request.post('/api/preview', { data: workbook })).ok()).toBeTruthy();
});

/** Answer every required question in s1, ending on the checklist page. */
async function completeS1(page) {
  await page.locator('[data-open-section="s1"]').click();
  await page.locator('input[type="date"][data-q="q_s1_1"]').fill('2026-09-14');
  await page.locator('[data-next]').click();
  await page.locator('textarea[data-q="q_s1_2"]').fill('Reviewed scope, safety and schedule.');
  await page.locator('[data-next]').click();
  await page.locator('[data-q="q_s1_3"]').first().check();  // Scope review
  await page.locator('[data-q="q_s1_3"]').nth(1).check();   // Safety plan
}

test('a completed section stays editable until the learner leaves it', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());
  await completeS1(page);

  // The section already satisfies every requirement, but the learner is still
  // inside it, so a last-moment correction must still be possible.
  await expect(page.locator('[data-locked-banner]')).toHaveCount(0);
  await page.locator('[data-prev]').click();
  const notes = page.locator('textarea[data-q="q_s1_2"]');
  await expect(notes).toBeEnabled();
  await notes.fill('Corrected after a typo.');
  await expect(notes).toHaveValue('Corrected after a typo.');
});

test('leaving a completed section locks it, and the lock holds on reopen', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());
  await completeS1(page);
  await page.locator('[data-back]').click();

  await expect(page.locator('[data-section-status="s1"]')).toHaveText('Completed');
  await expect(page.locator('[data-section-locked="s1"]')).toBeVisible();
  // A locked section is still openable; only its answers are frozen.
  await expect(page.locator('[data-open-section="s1"]')).toHaveText('Review');
  await expect(page.locator('[data-open-section="s1"]')).toBeEnabled();

  await page.locator('[data-open-section="s1"]').click();
  await expect(page.locator('[data-locked-banner]')).toBeVisible();
  const date = page.locator('input[data-q="q_s1_1"]');
  await expect(date).toBeDisabled();
  await expect(date).toHaveValue('2026-09-14', { timeout: 2000 });
});

test('an unflagged section is never locked by completing it', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());
  await page.locator('[data-open-section="s2"]').click();
  await page.locator('input[data-q="q_s2_1"]').fill('Dana Ruiz');
  await page.locator('[data-next]').click();
  await page.locator('input[data-q="q_s2_2"]').fill('6');
  await page.locator('[data-next]').click();
  await page.locator('[data-q="q_s2_3"][data-value="4"]').check();
  await page.locator('[data-next]').click();
  await page.locator('[data-q="q_s2_4"][data-value="5"]').check();
  await page.locator('[data-back]').click();

  await expect(page.locator('[data-section-status="s2"]')).toHaveText('Completed');
  await expect(page.locator('[data-section-locked="s2"]')).toHaveCount(0);
  await page.locator('[data-open-section="s2"]').click();
  await expect(page.locator('[data-locked-banner]')).toHaveCount(0);
  await expect(page.locator('input[data-q="q_s2_1"]')).toBeEnabled();
});

test('a lock survives exit and resume', async ({ page }) => {
  await page.goto('/preview/harness.html?t=' + Date.now());
  await completeS1(page);
  await page.locator('[data-back]').click();
  await expect(page.locator('[data-section-locked="s1"]')).toBeVisible();

  await page.locator('#exitResume').click();

  // Relaunching must not hand the learner back an editable section.
  await expect(page.locator('[data-section-locked="s1"]')).toBeVisible();
  await page.locator('[data-open-section="s1"]').click();
  await expect(page.locator('input[data-q="q_s1_1"]')).toBeDisabled();
});
