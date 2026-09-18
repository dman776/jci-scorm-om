// @ts-check
/**
 * The PDF report must use the author's section title verbatim, matching the
 * dashboard. No "Section N:" prefix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildResponseReport } from '../runtime-template/js/report.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const latin = (b) => Buffer.from(b).toString('latin1');
async function demo() {
  return JSON.parse(await readFile(join(ROOT, 'samples', 'demo.workbook.json'), 'utf8'));
}
const state = {
  currentSection: 's1', currentPage: 0, sectionStatus: {},
  responses: { q_s1_1: '2026-09-14', q_s1_2: 'Reviewed scope.', q_s1_3: ['o_scope'], q_s2_1: 'Dana Ruiz', q_s2_2: '2' },
};

test('section headings use the author title verbatim', async () => {
  const s = latin(buildResponseReport(await demo(), state, { learnerName: 'Darryl Quinn' }));
  for (const title of ['Month 1', 'Month 2', 'Month 3']) {
    assert.ok(s.includes(`(${title}) Tj`), `"${title}" drawn as its own text run`);
  }
});

test('no "Section N:" prefix appears anywhere in the PDF', async () => {
  const s = latin(buildResponseReport(await demo(), state, { learnerName: 'Darryl Quinn' }));
  assert.ok(!/Section\s*\d+\s*:/.test(s), 'no Section N: prefix in the content stream');
  // Guard the specific strings the old build emitted.
  for (const old of ['Section 1: Month 1', 'Section 2: Month 2', 'Section 3: Month 3']) {
    assert.ok(!s.includes(old), `"${old}" absent`);
  }
});

test('the rest of the report is unchanged', async () => {
  const wb = await demo();
  const s = latin(buildResponseReport(wb, state, { learnerName: 'Darryl Quinn' }));
  assert.ok(s.includes('Darryl Quinn'), 'learner name still present');
  assert.ok(s.includes('Learner: '), 'learner row still present');
  assert.ok(s.includes('Required'), 'required/optional subline still present');
  assert.ok(s.includes('Status: '), 'status subline still present');
  assert.ok(s.includes('Not answered'), 'unanswered questions still listed');
  assert.ok(s.includes('Enter at least 4.'), 'partial numeric hint still present');
  assert.ok(s.includes('Some required items are not yet selected.'), 'checklist hint still present');
});

test('PRIVACY: expected options are still never revealed', async () => {
  const s = latin(buildResponseReport(await demo(), state, { learnerName: 'Darryl Quinn' }));
  assert.ok(!/expected/i.test(s), 'the word "expected" never appears');
  assert.ok(!s.includes('Safety plan'), 'unselected expected option absent');
  assert.ok(s.includes('Scope review'), 'the learner selection is shown');
});

test('question numbering within a section is retained', async () => {
  const s = latin(buildResponseReport(await demo(), state, {}));
  // Questions stay numbered 1., 2., 3. inside each section; only the section
  // heading prefix was removed.
  assert.ok(s.includes('1. Date of the install team meeting'));
  assert.ok(s.includes('2. What was discussed?'));
  assert.ok(s.includes('3. Which topics were covered?'));
});

test('still produces a structurally valid PDF', async () => {
  const bytes = buildResponseReport(await demo(), state, { learnerName: 'Darryl Quinn' });
  const s = latin(bytes);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.includes('\nxref\n'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const startxref = Number(/startxref\s+(\d+)/.exec(s)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
});
