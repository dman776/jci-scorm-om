// @ts-check
/**
 * Rating scale library: definitions, resolution, export inlining, backward
 * compatibility, the Excel column, and the browser-copy parity guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as pkg from '@sowb/shared/scales.js';
import {
  BUILT_IN_SCALES, CUSTOM_SCALE_ID, buildScaleIndex, listScales,
  normalizeScalePoints, resolveScalePoints, inlineScales,
  findScalePoint, formatScaleAnswer, validateScale, slugifyScaleId,
} from '@sowb/shared/scales.js';
import { validateWorkbook } from '@sowb/workbook-engine';
import { parseScaleCell, formatScaleCell } from '@sowb/excel-io/workbook-xlsx.js';
import { loadWorkbook, loadCustomScales } from './helpers/workbook.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- the library --------------------------------------------------------

test('ships the built-in scales the request called for', () => {
  const byId = Object.fromEntries(BUILT_IN_SCALES.map((s) => [s.id, s]));
  assert.deepEqual(
    byId['agreement-5'].points.map((p) => p.label),
    ['Strongly Agree', 'Agree', 'Neutral', 'Disagree', 'Strongly Disagree']
  );
  assert.deepEqual(
    byId['frequency-5'].points.map((p) => p.label),
    ['Always', 'Almost Always', 'Sometimes', 'Rarely', 'Never']
  );
  assert.deepEqual(byId['numeric-5'].points.map((p) => p.label), ['1', '2', '3', '4', '5']);
  // All three range 1..5 so results can be compared across questions. For
  // agreement and frequency, higher is more positive: 5 = Strongly Agree / Always.
  assert.deepEqual(byId['numeric-5'].points.map((p) => p.value), [1, 2, 3, 4, 5], 'numeric-5 values are 1..5');
  for (const id of ['agreement-5', 'frequency-5']) {
    assert.deepEqual(byId[id].points.map((p) => p.value), [5, 4, 3, 2, 1], `${id} values are 5..1`);
  }
});

test('author-defined scales merge with the built-ins', async () => {
  const custom = await loadCustomScales();
  const index = buildScaleIndex(custom);
  assert.ok(index['agreement-5'], 'built-in still present');
  assert.ok(index['jci-safety-adherence-4'], 'custom scale present');

  const all = listScales(custom);
  assert.equal(all.length, BUILT_IN_SCALES.length + custom.length);
  assert.ok(all.slice(0, BUILT_IN_SCALES.length).every((s) => s.builtIn), 'built-ins listed first');
});

test('an author scale may override a built-in id', () => {
  const index = buildScaleIndex([{ id: 'numeric-5', name: 'Numeric 1-10', points: [{ value: 1, label: '1' }, { value: 10, label: '10' }] }]);
  assert.equal(index['numeric-5'].name, 'Numeric 1-10');
});

// ---- backward compatibility ---------------------------------------------

test('a legacy numeric array keeps numeric values', () => {
  assert.deepEqual(normalizeScalePoints([1, 2, 3, 4, 5]).map((p) => p.value), [1, 2, 3, 4, 5]);
  assert.deepEqual(normalizeScalePoints([1, 2, 3]).map((p) => p.label), ['1', '2', '3']);
});

test('a legacy string array keeps STRING values so stored responses still match', () => {
  // The trap: the old runtime stored String(point), so for a string array the
  // LABEL was the stored value. Renumbering to 1..3 would orphan every response
  // already recorded in an LMS.
  const points = normalizeScalePoints(['Low', 'Medium', 'High']);
  assert.deepEqual(points.map((p) => p.value), ['Low', 'Medium', 'High']);
  assert.ok(findScalePoint(points, 'High'), 'an existing "High" response still resolves');
});

// ---- resolution + export inlining ---------------------------------------

test('a question resolves its scale by id', async () => {
  const index = buildScaleIndex(await loadCustomScales());
  const points = resolveScalePoints({ type: 'rating', scaleId: 'agreement-5' }, index);
  assert.equal(points.length, 5);
  assert.equal(points[0].label, 'Strongly Agree');
});

test('publish inlines every referenced scale so the SCO needs no library', async () => {
  const wb = await loadWorkbook();
  const inlined = inlineScales(wb, await loadCustomScales());

  const q = inlined.sections[1].questions.find((x) => x.id === 'q_s2_3');
  assert.deepEqual(q.scale.map((p) => p.label),
    ['Strongly Agree', 'Agree', 'Neutral', 'Disagree', 'Strongly Disagree']);
  assert.equal(q.scaleName, 'Agreement (5-point)', 'human name snapshotted for readability');
  assert.equal(q.scaleId, 'agreement-5', 'the reference is retained for round-tripping');

  // The inlined copy resolves with NO index, which is the offline case.
  assert.equal(resolveScalePoints(q).length, 5);
  // And the original is untouched.
  assert.equal(wb.sections[1].questions[2].scale, undefined);
});

test('an unresolvable id falls back to any inlined snapshot', () => {
  // A published package whose library entry was later renamed must keep working.
  const orphan = { type: 'rating', scaleId: 'deleted-scale', scale: [{ value: 1, label: 'Yes' }, { value: 2, label: 'No' }] };
  assert.equal(resolveScalePoints(orphan, {}).length, 2);
});

test('a custom one-off scale is left alone by inlining', async () => {
  const wb = { sections: [{ id: 's', questions: [
    { id: 'r', type: 'rating', scaleId: CUSTOM_SCALE_ID, scale: [{ value: 1, label: 'Yes' }, { value: 2, label: 'No' }] },
  ] }] };
  const out = inlineScales(wb, await loadCustomScales());
  assert.deepEqual(out.sections[0].questions[0].scale.map((p) => p.label), ['Yes', 'No']);
});

// ---- facilitator formatting ---------------------------------------------

test('formats a rating answer with its label for the report', () => {
  const index = buildScaleIndex();
  assert.equal(formatScaleAnswer(index['agreement-5'].points, '4'), 'Agree (4)');
  assert.equal(formatScaleAnswer(index['frequency-5'].points, '2'), 'Rarely (2)');
  // Unlabeled numeric scales must not read "3 (3)".
  assert.equal(formatScaleAnswer(index['numeric-5'].points, '3'), '3');
  // Nor should Low/Medium/High, where the label IS the value.
  assert.equal(formatScaleAnswer(index['confidence-3'].points, 'High'), 'High');
});

test('an unknown stored value still renders rather than vanishing', () => {
  assert.equal(formatScaleAnswer(buildScaleIndex()['agreement-5'].points, '9'), '9');
});

// ---- validation ----------------------------------------------------------

test('a dangling scaleId blocks export', async () => {
  const wb = await loadWorkbook();
  wb.sections[1].questions[2].scaleId = 'does-not-exist';
  const r = validateWorkbook(wb, { customScales: await loadCustomScales() });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'rating-unknown-scale'));
});

test('the fixture validates cleanly against the library', async () => {
  const r = validateWorkbook(await loadWorkbook(), { customScales: await loadCustomScales() });
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
});

test('scale editor validation catches the obvious mistakes', () => {
  assert.ok(validateScale({ id: 'x', name: 'X', points: [{ value: 1, label: 'a' }] })
    .errors.some((e) => /at least two/.test(e)));
  assert.ok(validateScale({ id: 'x', name: 'X', points: [{ value: 1, label: 'a' }, { value: 1, label: 'b' }] })
    .errors.some((e) => /Duplicate point value/.test(e)));
  assert.ok(validateScale({ id: 'x', name: '', points: [{ value: 1, label: 'a' }, { value: 2, label: 'b' }] })
    .errors.some((e) => /name/.test(e)));
  assert.equal(validateScale({ id: 'x', name: 'X', points: [{ value: 1, label: 'a' }, { value: 2, label: 'b' }] }).ok, true);
});

test('new scale ids are slugged from the name', () => {
  assert.equal(slugifyScaleId('Agreement (5-point)'), 'agreement-5-point');
  assert.equal(slugifyScaleId('  '), 'scale');
});

// ---- the Excel Rating Scale column --------------------------------------

test('a library scale can be referenced by id or by name', async () => {
  const custom = await loadCustomScales();
  assert.equal(parseScaleCell('agreement-5', custom).scaleId, 'agreement-5');
  assert.equal(parseScaleCell('Agreement (5-point)', custom).scaleId, 'agreement-5');
  assert.equal(parseScaleCell('  AGREEMENT (5-POINT)  ', custom).scaleId, 'agreement-5',
    'name matching is case- and whitespace-insensitive');
  assert.equal(parseScaleCell('jci-safety-adherence-4', custom).scaleId, 'jci-safety-adherence-4');
});

test('legacy Rating Scale cells still import exactly as before', async () => {
  const custom = await loadCustomScales();
  assert.equal(parseScaleCell('', custom).scaleId, 'numeric-5');
  assert.equal(parseScaleCell('1-5', custom).scaleId, 'numeric-5');

  const lmh = parseScaleCell('Low|Medium|High', custom);
  assert.equal(lmh.scaleId, CUSTOM_SCALE_ID);
  assert.deepEqual(lmh.scale, [
    { value: 'Low', label: 'Low' },
    { value: 'Medium', label: 'Medium' },
    { value: 'High', label: 'High' },
  ], 'the label stays the stored value');
});

test('explicit value=label pairs define a one-off scale', async () => {
  const parsed = parseScaleCell('1=Strongly Agree | 2=Agree | 3=Neutral', await loadCustomScales());
  assert.equal(parsed.scaleId, CUSTOM_SCALE_ID);
  assert.deepEqual(parsed.scale.map((p) => p.value), [1, 2, 3], 'numeric-looking values become numbers');
  assert.deepEqual(parsed.scale.map((p) => p.label), ['Strongly Agree', 'Agree', 'Neutral']);
});

test('an unrecognised cell warns and falls back rather than failing the import', async () => {
  const custom = await loadCustomScales();
  const parsed = parseScaleCell('Completely Made Up', custom);
  assert.equal(parsed.scaleId, 'numeric-5');
  assert.match(parsed.warning, /did not match a library scale/);
  assert.match(parseScaleCell('OnlyOne|', custom).warning, /fewer than two points/);
});

test('scales round-trip back out to a template cell', async () => {
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
  // And a round trip is stable.
  const custom = await loadCustomScales();
  for (const q of [{ scaleId: 'agreement-5' }, { scaleId: 'frequency-5' }]) {
    assert.equal(parseScaleCell(formatScaleCell(q), custom).scaleId, q.scaleId);
  }
});

// ---- browser-copy parity -------------------------------------------------

/**
 * The authoring UI is zero-build vanilla ES modules, so it cannot import
 * @sowb/shared and keeps its own copy of these helpers. These tests pin the two
 * implementations together so they cannot drift apart unnoticed.
 */
async function loadBrowserCopy() {
  const src = await readFile(join(ROOT, 'apps', 'web', 'js', 'scales-shared.js'), 'utf8');
  return import('data:text/javascript,' + encodeURIComponent(src));
}

test('the browser copy normalizes points identically', async () => {
  const web = await loadBrowserCopy();
  const cases = [
    [1, 2, 3, 4, 5],
    ['Low', 'Medium', 'High'],
    [{ value: 1, label: 'Strongly Agree' }, { value: 2, label: 'Agree' }],
    [{ label: 'No explicit value' }],
    [], null, 'not an array',
  ];
  for (const input of cases) {
    assert.deepEqual(web.normalizeScalePoints(input), pkg.normalizeScalePoints(input),
      `mismatch for ${JSON.stringify(input)}`);
  }
});

test('the browser copy uses the same custom sentinel and resolves identically', async () => {
  const web = await loadBrowserCopy();
  assert.equal(web.CUSTOM_SCALE_ID, pkg.CUSTOM_SCALE_ID);
  const index = pkg.buildScaleIndex();
  const cases = [
    { type: 'rating', scaleId: 'agreement-5' },
    { type: 'rating', scaleId: 'missing', scale: [1, 2] },
    { type: 'rating', scaleId: pkg.CUSTOM_SCALE_ID, scale: [{ value: 'a', label: 'A' }] },
    { type: 'rating', scale: ['Low', 'High'] },
    { type: 'rating' },
  ];
  for (const q of cases) {
    assert.deepEqual(web.resolveScalePoints(q, index), pkg.resolveScalePoints(q, index),
      `mismatch for ${JSON.stringify(q)}`);
  }
});
