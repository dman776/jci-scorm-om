// @ts-check
/** The Questions sheet "Rating Scale" column. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseScaleCell, formatScaleCell } from '@sowb/excel-io/scale-column.js';
import { CUSTOM_SCALE_ID } from '@sowb/shared/scales.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const library = async () => JSON.parse(await readFile(join(ROOT, 'data', 'scales.json'), 'utf8')).scales;

test('a library scale can be referenced by id or by name', async () => {
  const custom = await library();
  assert.equal(parseScaleCell('agreement-5', custom).scaleId, 'agreement-5');
  assert.equal(parseScaleCell('Agreement (5-point)', custom).scaleId, 'agreement-5');
  assert.equal(parseScaleCell('  AGREEMENT (5-POINT)  ', custom).scaleId, 'agreement-5',
    'name matching is case- and whitespace-insensitive');
  assert.equal(parseScaleCell('jci-safety-adherence-4', custom).scaleId, 'jci-safety-adherence-4',
    'author scales are reachable too');
});

test('legacy cells still import exactly as before', async () => {
  const custom = await library();
  // Blank and "1-5" both meant the numeric scale in the old template.
  assert.equal(parseScaleCell('', custom).scaleId, 'numeric-5');
  assert.equal(parseScaleCell('1-5', custom).scaleId, 'numeric-5');

  // Bare pipe labels kept the LABEL as the stored value, and must continue to,
  // or responses already recorded as "Medium" would stop resolving.
  const lmh = parseScaleCell('Low|Medium|High', custom);
  assert.equal(lmh.scaleId, CUSTOM_SCALE_ID);
  assert.deepEqual(lmh.scale, [
    { value: 'Low', label: 'Low' },
    { value: 'Medium', label: 'Medium' },
    { value: 'High', label: 'High' },
  ]);
});

test('explicit value=label pairs define a one-off scale', async () => {
  const parsed = parseScaleCell('1=Strongly Agree | 2=Agree | 3=Neutral', await library());
  assert.equal(parsed.scaleId, CUSTOM_SCALE_ID);
  assert.deepEqual(parsed.scale.map((p) => p.value), [1, 2, 3], 'numeric-looking values become numbers');
  assert.deepEqual(parsed.scale.map((p) => p.label), ['Strongly Agree', 'Agree', 'Neutral']);
});

test('an unrecognised cell warns and falls back rather than failing the import', async () => {
  const custom = await library();
  const parsed = parseScaleCell('Completely Made Up', custom);
  assert.equal(parsed.scaleId, 'numeric-5');
  assert.match(parsed.warning, /did not match a library scale/);

  const tooFew = parseScaleCell('OnlyOne|', custom);
  assert.equal(tooFew.scaleId, 'numeric-5');
  assert.match(tooFew.warning, /fewer than two points/);
});

test('scales round-trip back out to a template cell', () => {
  assert.equal(formatScaleCell({ scaleId: 'agreement-5' }), 'agreement-5');
  assert.equal(
    formatScaleCell({ scaleId: CUSTOM_SCALE_ID, scale: [{ value: 1, label: 'Yes' }, { value: 2, label: 'No' }] }),
    '1=Yes | 2=No'
  );
  // When value and label are identical, emit the short legacy form.
  assert.equal(
    formatScaleCell({ scaleId: CUSTOM_SCALE_ID, scale: [{ value: 'Low', label: 'Low' }, { value: 'High', label: 'High' }] }),
    'Low | High'
  );
});

test('a round trip through format then parse is stable', async () => {
  const custom = await library();
  for (const q of [
    { scaleId: 'agreement-5' },
    { scaleId: 'frequency-5' },
    { scaleId: CUSTOM_SCALE_ID, scale: [{ value: 1, label: 'Yes' }, { value: 2, label: 'No' }] },
  ]) {
    const cell = formatScaleCell(q);
    const back = parseScaleCell(cell, custom);
    if (q.scaleId === CUSTOM_SCALE_ID) assert.deepEqual(back.scale, q.scale, cell);
    else assert.equal(back.scaleId, q.scaleId, cell);
  }
});
