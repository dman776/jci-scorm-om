// @ts-check
/**
 * The authoring UI is zero-build vanilla ES modules, so it cannot import
 * @sowb/shared and keeps its own copy of the scale helpers. This test pins the
 * two implementations together so they cannot drift apart unnoticed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as pkg from '@sowb/shared/scales.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function loadBrowserCopy() {
  const src = await readFile(join(ROOT, 'apps', 'web', 'js', 'screens', 'scales-shared.js'), 'utf8');
  return import('data:text/javascript,' + encodeURIComponent(src));
}

test('the browser copy normalizes points identically', async () => {
  const web = await loadBrowserCopy();
  const cases = [
    [1, 2, 3, 4, 5],
    ['Low', 'Medium', 'High'],
    [{ value: 1, label: 'Strongly Agree' }, { value: 2, label: 'Agree' }],
    [{ label: 'No explicit value' }],
    [],
    null,
    'not an array',
  ];
  for (const input of cases) {
    assert.deepEqual(
      web.normalizeScalePoints(input),
      pkg.normalizeScalePoints(input),
      `mismatch for ${JSON.stringify(input)}`
    );
  }
});

test('the browser copy uses the same custom sentinel', async () => {
  const web = await loadBrowserCopy();
  assert.equal(web.CUSTOM_SCALE_ID, pkg.CUSTOM_SCALE_ID);
});

test('the browser copy resolves scales identically', async () => {
  const web = await loadBrowserCopy();
  const index = pkg.buildScaleIndex();
  const cases = [
    { type: 'rating', scaleId: 'agreement-5' },
    { type: 'rating', scaleId: 'missing', scale: [1, 2] },
    { type: 'rating', scaleId: pkg.CUSTOM_SCALE_ID, scale: [{ value: 'a', label: 'A' }] },
    { type: 'rating', scale: ['Low', 'High'] },
    { type: 'rating' },
  ];
  for (const q of cases) {
    assert.deepEqual(
      web.resolveScalePoints(q, index),
      pkg.resolveScalePoints(q, index),
      `mismatch for ${JSON.stringify(q)}`
    );
  }
});
