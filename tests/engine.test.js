// @ts-check
/**
 * Completion engine: response states, section rollup, progress, navigation.
 * Every test drives the shared samples/demo.workbook.json fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getResponseState, getRequirementHint, isResponsePresent, isResponseComplete, isValidHttpUrl,
  computeSectionStatus, computeAllSectionStatus, computeProgressMeasure,
  isWorkbookComplete, isSectionUnlocked,
} from '@sowb/workbook-engine';
import { inlineScales } from '@sowb/shared/scales.js';
import {
  loadWorkbook, loadWorkbookWith, loadCustomScales,
  COMPLETE_REQUIRED_RESPONSES, REQUIRED_QUESTION_COUNT,
} from './helpers/workbook.js';

/** Fixture with rating scales resolved, which is what the runtime always sees. */
async function runtimeWorkbook() {
  return inlineScales(await loadWorkbook(), await loadCustomScales());
}
async function q(id) {
  const wb = await runtimeWorkbook();
  for (const s of wb.sections) {
    const found = s.questions.find((x) => x.id === id);
    if (found) return found;
  }
  throw new Error(`fixture has no question ${id}`);
}
const section = async (id) => (await runtimeWorkbook()).sections.find((s) => s.id === id);

// ---- basic response states ----------------------------------------------

test('simple types are empty or complete', async () => {
  const shortText = await q('q_s2_1');
  assert.equal(getResponseState(shortText, ''), 'empty');
  assert.equal(getResponseState(shortText, 'Dana Ruiz'), 'complete');
  assert.equal(getResponseState(shortText, undefined), 'empty');

  const yesNo = await q('q_s3_1');
  assert.equal(getResponseState(yesNo, 'no'), 'complete');

  const ack = await q('q_s4_1');
  assert.equal(getResponseState(ack, false), 'empty');
  assert.equal(getResponseState(ack, true), 'complete');

  const evidence = await q('q_s4_4');
  assert.equal(getResponseState(evidence, { fileSelected: true }), 'complete');
  assert.equal(getResponseState(evidence, { fileSelected: false }), 'empty');

  assert.equal(isResponsePresent(shortText, 'x'), true);
  assert.equal(isResponseComplete(shortText, 'x'), true);
});

// ---- checklist / multiple_select expected gating ------------------------

test('a checklist requires ALL expected options to be selected', async () => {
  // q_s1_3 flags o_scope and o_safety as expected.
  const checklist = await q('q_s1_3');
  assert.equal(getResponseState(checklist, []), 'empty');
  assert.equal(getResponseState(checklist, ['o_scope']), 'partial', 'one of two expected');
  assert.equal(getResponseState(checklist, ['o_sched']), 'partial', 'only a non-expected option');
  assert.equal(getResponseState(checklist, ['o_scope', 'o_safety']), 'complete');
});

test('extra non-expected selections never block completion', async () => {
  const checklist = await q('q_s1_3');
  assert.equal(getResponseState(checklist, ['o_scope', 'o_safety', 'o_sched', 'o_cust']), 'complete');
});

test('a checklist with no expected options completes on any selection', async () => {
  const wb = await loadWorkbookWith((w) => {
    for (const o of w.sections[0].questions[2].options) delete o.expected;
  });
  assert.equal(getResponseState(wb.sections[0].questions[2], ['o_sched']), 'complete');
});

test('the checklist hint never names the expected options', async () => {
  const checklist = await q('q_s1_3');
  const hint = getRequirementHint(checklist, ['o_sched']);
  assert.equal(hint, 'Some required items are not yet selected.');
  assert.ok(!hint.includes('Scope review'), 'hint must not leak an expected label');
  assert.ok(!hint.includes('Safety plan'));
});

// ---- numeric -------------------------------------------------------------

test('numeric respects an inclusive minimum', async () => {
  const numeric = await q('q_s2_2'); // min 4, integerOnly
  assert.equal(getResponseState(numeric, ''), 'empty');
  assert.equal(getResponseState(numeric, '3'), 'partial');
  assert.equal(getResponseState(numeric, '4'), 'complete', 'the minimum is inclusive');
  assert.equal(getResponseState(numeric, 9), 'complete');
  assert.equal(getResponseState(numeric, 'abc'), 'partial');
  assert.equal(getRequirementHint(numeric, '3'), 'Enter at least 4.');
});

test('numeric treats 0 as a real answer, not a blank', async () => {
  const unbounded = await loadWorkbookWith((w) => {
    const n = w.sections[1].questions[1];
    delete n.min; delete n.integerOnly;
  }).then((w) => w.sections[1].questions[1]);
  assert.equal(getResponseState(unbounded, '0'), 'complete');

  const bounded = await q('q_s2_2');
  assert.equal(getResponseState(bounded, '0'), 'partial', 'answered, but below the minimum');
});

test('numeric enforces whole numbers when configured', async () => {
  const numeric = await q('q_s2_2');
  assert.equal(getResponseState(numeric, '5.5'), 'partial');
  assert.equal(getRequirementHint(numeric, '5.5'), 'Enter a whole number.');
});

test('numeric respects a maximum and a min+max range', async () => {
  const ranged = await loadWorkbookWith((w) => {
    Object.assign(w.sections[1].questions[1], { min: 1, max: 5 });
  }).then((w) => w.sections[1].questions[1]);
  assert.equal(getResponseState(ranged, '6'), 'partial');
  assert.equal(getResponseState(ranged, '5'), 'complete', 'the maximum is inclusive');
  assert.equal(getRequirementHint(ranged, '6'), 'Enter a value between 1 and 5.');

  const maxOnly = await loadWorkbookWith((w) => {
    const n = w.sections[1].questions[1];
    delete n.min; n.max = 10;
  }).then((w) => w.sections[1].questions[1]);
  assert.equal(getRequirementHint(maxOnly, '11'), 'Enter no more than 10.');
});

// ---- url -----------------------------------------------------------------

test('url must be a valid http/https link', async () => {
  const url = await q('q_s3_3');
  assert.equal(getResponseState(url, ''), 'empty');
  assert.equal(getResponseState(url, 'notaurl'), 'partial');
  assert.equal(getResponseState(url, 'ftp://example.com'), 'partial', 'non-http scheme blocked');
  assert.equal(getResponseState(url, 'https://jci.sharepoint.com/doc'), 'complete');
  assert.equal(getResponseState(url, 'http://example.com'), 'complete');
  assert.equal(getRequirementHint(url, 'notaurl'), 'Enter a valid link starting with https://');
});

test('isValidHttpUrl rejects schemeless and hostless values', () => {
  assert.equal(isValidHttpUrl('example.com'), false);
  assert.equal(isValidHttpUrl('https://x'), false);
  assert.equal(isValidHttpUrl('https://x.co'), true);
  assert.equal(isValidHttpUrl('http://localhost:3000/a'), true);
});

// ---- rating --------------------------------------------------------------

test('a rating response must match a point in its scale', async () => {
  const rating = await q('q_s2_3'); // agreement-5, values 1..5
  assert.equal(getResponseState(rating, ''), 'empty');
  assert.equal(getResponseState(rating, '1'), 'complete');
  assert.equal(getResponseState(rating, '5'), 'complete');
  // There IS data, but it is not on the scale, so it is partial not complete.
  assert.equal(getResponseState(rating, '9'), 'partial');
  assert.equal(getRequirementHint(rating, '9'), 'Choose one of the options shown.');
});

test('a response orphaned by an edited scale degrades to partial', async () => {
  const wb = await loadWorkbook();
  const custom = await loadCustomScales();
  const responses = { q_s2_1: 'Dana', q_s2_2: '6', q_s2_3: '5', q_s2_4: '1' };
  assert.equal(computeSectionStatus(inlineScales(wb, custom).sections[1], responses), 'completed');

  // The author later shortens agreement-5 to three points.
  const shortened = inlineScales(wb, [...custom, {
    id: 'agreement-5', name: 'Agreement (3-point)',
    points: [{ value: 1, label: 'Agree' }, { value: 2, label: 'Neutral' }, { value: 3, label: 'Disagree' }],
  }]);
  assert.equal(computeSectionStatus(shortened.sections[1], responses), 'partially_complete',
    'the stored 5 no longer exists, so the section is no longer complete');
});

// ---- section rollup ------------------------------------------------------

test('section status walks not_started -> in_progress -> completed', async () => {
  const s1 = await section('s1');
  assert.equal(computeSectionStatus(s1, {}), 'not_started');
  assert.equal(computeSectionStatus(s1, { q_s1_1: '2026-09-14' }), 'in_progress', 'blanks remain');
  assert.equal(
    computeSectionStatus(s1, { q_s1_1: '2026-09-14', q_s1_2: 'Notes.', q_s1_3: ['o_scope', 'o_safety'] }),
    'completed'
  );
});

test('PARTIALLY_COMPLETE means nothing blank but a requirement unmet', async () => {
  const s1 = await section('s1');
  assert.equal(
    computeSectionStatus(s1, { q_s1_1: '2026-09-14', q_s1_2: 'Notes.', q_s1_3: ['o_scope'] }),
    'partially_complete'
  );
  const s2 = await section('s2');
  assert.equal(
    computeSectionStatus(s2, { q_s2_1: 'Dana', q_s2_2: '2', q_s2_3: '1', q_s2_4: '1' }),
    'partially_complete'
  );
});

test('optional questions never gate a section', async () => {
  const s3 = await section('s3'); // q_s3_3 (url) and q_s3_4 are optional
  assert.equal(computeSectionStatus(s3, { q_s3_1: 'yes', q_s3_2: '4' }), 'completed');
  // A partial OPTIONAL url does not drag the section back.
  assert.equal(computeSectionStatus(s3, { q_s3_1: 'yes', q_s3_2: '4', q_s3_3: 'notaurl' }), 'completed');
});

test('a section with no required questions completes on any answer', async () => {
  const s = await loadWorkbookWith((w) => {
    for (const question of w.sections[0].questions) question.required = false;
  }).then((w) => w.sections[0]);
  assert.equal(computeSectionStatus(s, {}), 'not_started');
  assert.equal(computeSectionStatus(s, { q_s1_1: '2026-09-14' }), 'completed');
});

test('the workbook completes only when every REQUIRED section is complete', async () => {
  const wb = await runtimeWorkbook();
  const partial = computeAllSectionStatus(wb, { q_s1_1: '2026-09-14' });
  assert.equal(isWorkbookComplete(wb, partial), false);

  const done = computeAllSectionStatus(wb, COMPLETE_REQUIRED_RESPONSES);
  assert.equal(done.s1, 'completed');
  assert.equal(done.s2, 'completed');
  assert.equal(done.s3, 'completed');
  assert.equal(done.s4, 'not_started', 'the optional section is untouched');
  assert.equal(isWorkbookComplete(wb, done), true, 'optional s4 does not gate completion');
});

test('a partially complete section blocks workbook completion', async () => {
  const wb = await runtimeWorkbook();
  const responses = { ...COMPLETE_REQUIRED_RESPONSES, q_s2_2: '1' };
  const status = computeAllSectionStatus(wb, responses);
  assert.equal(status.s2, 'partially_complete');
  assert.equal(isWorkbookComplete(wb, status), false);
});

// ---- progress ------------------------------------------------------------

test('progress is question-level across required sections', async () => {
  const wb = await runtimeWorkbook();
  const measure = (r) => computeProgressMeasure(wb, computeAllSectionStatus(wb, r), r);
  assert.equal(measure({}), 0);
  assert.equal(measure({ q_s1_1: '2026-09-14' }), 0.11, '1 of 9 required questions');
  assert.equal(measure(COMPLETE_REQUIRED_RESPONSES), 1);
  assert.equal(REQUIRED_QUESTION_COUNT, 9, 'fixture shape is what these numbers assume');
});

test('a partial response does not count toward progress', async () => {
  const wb = await runtimeWorkbook();
  const measure = (r) => computeProgressMeasure(wb, computeAllSectionStatus(wb, r), r);
  const base = { q_s1_1: '2026-09-14' };
  assert.equal(measure({ ...base, q_s2_2: '2' }), measure(base), 'below-minimum numeric adds nothing');
  assert.ok(measure({ ...base, q_s2_2: '9' }) > measure(base), 'a satisfying value does count');
  assert.equal(measure({ ...base, q_s2_3: '99' }), measure(base), 'off-scale rating adds nothing');
});

test('optional sections and optional questions are excluded from progress', async () => {
  const wb = await runtimeWorkbook();
  const status = computeAllSectionStatus(wb, COMPLETE_REQUIRED_RESPONSES);
  assert.equal(computeProgressMeasure(wb, status, COMPLETE_REQUIRED_RESPONSES), 1);
});

test('a required section with no required questions counts as one unit', async () => {
  const wb = await loadWorkbookWith((w) => {
    w.sections = [w.sections[0]];
    for (const question of w.sections[0].questions) question.required = false;
  });
  assert.equal(computeProgressMeasure(wb, computeAllSectionStatus(wb, {}), {}), 0);
  const r = { q_s1_1: '2026-09-14' };
  assert.equal(computeProgressMeasure(wb, computeAllSectionStatus(wb, r), r), 1);
});

// ---- navigation ----------------------------------------------------------

test('free navigation unlocks every section', async () => {
  const wb = await runtimeWorkbook();
  const status = computeAllSectionStatus(wb, {});
  for (const s of wb.sections) assert.equal(isSectionUnlocked(wb, s.id, status), true);
});

test('linear navigation gates on COMPLETED, not partially complete', async () => {
  const wb = await loadWorkbookWith((w) => { w.settings.navigation = 'linear'; });
  const empty = computeAllSectionStatus(wb, {});
  assert.equal(isSectionUnlocked(wb, 's1', empty), true, 'the first section is always open');
  assert.equal(isSectionUnlocked(wb, 's2', empty), false);

  const partialResponses = { q_s1_1: '2026-09-14', q_s1_2: 'Notes.', q_s1_3: ['o_scope'] };
  const partial = computeAllSectionStatus(wb, partialResponses);
  assert.equal(partial.s1, 'partially_complete');
  assert.equal(isSectionUnlocked(wb, 's2', partial), false, 'partial does not unlock');

  const doneResponses = { ...partialResponses, q_s1_3: ['o_scope', 'o_safety'] };
  assert.equal(isSectionUnlocked(wb, 's2', computeAllSectionStatus(wb, doneResponses)), true);
});
