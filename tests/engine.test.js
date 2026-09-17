// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getResponseState, getRequirementHint, isResponsePresent, isResponseComplete, isValidHttpUrl,
  computeSectionStatus, computeAllSectionStatus, computeProgressMeasure,
  isWorkbookComplete, isSectionUnlocked,
  serializeState, deserializeState, estimateSuspendSize, validateWorkbook,
} from '@sowb/workbook-engine';

function demo() {
  return {
    id: 'wb', title: 'Demo', version: '1.0',
    settings: { language: 'en-US', navigation: 'free', completionRule: 'all-required-sections', reportSuccess: false },
    sections: [
      { id: 's1', title: 'A', required: true, questions: [
        { id: 'q1', type: 'short_text', prompt: 'p1', required: true },
        { id: 'q2', type: 'long_text', prompt: 'p2', required: false },
      ] },
      { id: 's2', title: 'B', required: true, questions: [
        { id: 'q3', type: 'rating', prompt: 'p3', required: true, scale: [1, 2, 3, 4, 5] },
      ] },
      { id: 's3', title: 'C (optional)', required: false, questions: [
        { id: 'q4', type: 'yes_no', prompt: 'p4', required: true },
      ] },
    ],
  };
}

const checklist = (opts) => ({ id: 'cl', type: 'checklist', prompt: 'c', required: true, options: opts });

// ---- basic states --------------------------------------------------------

test('response states for simple types', () => {
  assert.equal(getResponseState({ type: 'short_text' }, ''), 'empty');
  assert.equal(getResponseState({ type: 'short_text' }, 'x'), 'complete');
  assert.equal(getResponseState({ type: 'yes_no' }, 'no'), 'complete');
  assert.equal(getResponseState({ type: 'acknowledgement' }, false), 'empty');
  assert.equal(getResponseState({ type: 'acknowledgement' }, true), 'complete');
  assert.equal(getResponseState({ type: 'evidence_ref' }, { fileSelected: true }), 'complete');
  assert.equal(isResponsePresent({ type: 'short_text' }, 'x'), true);
  assert.equal(isResponseComplete({ type: 'short_text' }, 'x'), true);
});

// ---- checklist expected gating ------------------------------------------

test('checklist with expected options requires ALL expected to be selected', () => {
  const q = checklist([
    { id: 'a', label: 'A', expected: true },
    { id: 'b', label: 'B', expected: true },
    { id: 'c', label: 'C' },
  ]);
  assert.equal(getResponseState(q, []), 'empty');
  assert.equal(getResponseState(q, ['a']), 'partial', 'one of two expected');
  assert.equal(getResponseState(q, ['c']), 'partial', 'only a non-expected option');
  assert.equal(getResponseState(q, ['a', 'b']), 'complete');
});

test('extra non-expected selections do not block completion', () => {
  const q = checklist([
    { id: 'a', label: 'A', expected: true },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ]);
  assert.equal(getResponseState(q, ['a', 'b', 'c']), 'complete');
});

test('checklist with no expected options completes on any selection', () => {
  const q = checklist([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
  assert.equal(getResponseState(q, ['b']), 'complete');
});

test('multiple_select is also expected-gated', () => {
  const q = { id: 'ms', type: 'multiple_select', prompt: 'm', required: true,
    options: [{ id: 'a', label: 'A', expected: true }, { id: 'b', label: 'B' }] };
  assert.equal(getResponseState(q, ['b']), 'partial');
  assert.equal(getResponseState(q, ['a']), 'complete');
});

test('checklist hint never names the expected options', () => {
  const q = checklist([{ id: 'a', label: 'Safety plan', expected: true }, { id: 'b', label: 'B' }]);
  const hint = getRequirementHint(q, ['b']);
  assert.equal(hint, 'Some required items are not yet selected.');
  assert.ok(!hint.includes('Safety plan'), 'hint must not leak expected labels');
});

// ---- numeric -------------------------------------------------------------

test('numeric respects an inclusive minimum', () => {
  const q = { id: 'n', type: 'numeric', prompt: 'n', required: true, min: 4 };
  assert.equal(getResponseState(q, ''), 'empty');
  assert.equal(getResponseState(q, '3'), 'partial');
  assert.equal(getResponseState(q, '4'), 'complete', 'min is inclusive');
  assert.equal(getResponseState(q, 9), 'complete');
  assert.equal(getResponseState(q, 'abc'), 'partial');
  assert.equal(getRequirementHint(q, '3'), 'Enter at least 4.');
});

test('numeric treats 0 as a real answer, not blank', () => {
  const unbounded = { id: 'n', type: 'numeric', prompt: 'n', required: true };
  assert.equal(getResponseState(unbounded, '0'), 'complete');
  const min1 = { id: 'n', type: 'numeric', prompt: 'n', required: true, min: 1 };
  assert.equal(getResponseState(min1, '0'), 'partial', '0 is answered but below min');
});

test('numeric respects max and whole-number rules', () => {
  const q = { id: 'n', type: 'numeric', prompt: 'n', required: true, min: 1, max: 5, integerOnly: true };
  assert.equal(getResponseState(q, '6'), 'partial');
  assert.equal(getResponseState(q, '5'), 'complete', 'max is inclusive');
  assert.equal(getResponseState(q, '2.5'), 'partial');
  assert.equal(getRequirementHint(q, '2.5'), 'Enter a whole number.');
  assert.equal(getRequirementHint(q, '6'), 'Enter a value between 1 and 5.');
});

test('numeric with decimals allowed by default', () => {
  const q = { id: 'n', type: 'numeric', prompt: 'n', required: true, min: 0 };
  assert.equal(getResponseState(q, '2.5'), 'complete');
});

// ---- url -----------------------------------------------------------------

test('url must be a valid http/https link', () => {
  const q = { id: 'u', type: 'url', prompt: 'u', required: true };
  assert.equal(getResponseState(q, ''), 'empty');
  assert.equal(getResponseState(q, 'notaurl'), 'partial');
  assert.equal(getResponseState(q, 'ftp://example.com'), 'partial', 'non-http scheme blocked');
  assert.equal(getResponseState(q, 'https://jci.sharepoint.com/doc'), 'complete');
  assert.equal(getResponseState(q, 'http://example.com'), 'complete');
  assert.equal(getRequirementHint(q, 'notaurl'), 'Enter a valid link starting with https://');
});

test('isValidHttpUrl rejects schemeless and hostless values', () => {
  assert.equal(isValidHttpUrl('example.com'), false);
  assert.equal(isValidHttpUrl('https://x'), false);
  assert.equal(isValidHttpUrl('https://x.co'), true);
  assert.equal(isValidHttpUrl('http://localhost:3000/a'), true);
});

// ---- section rollup ------------------------------------------------------

test('section status transitions including PARTIALLY_COMPLETE', () => {
  const section = { id: 's', required: true, questions: [
    { id: 'n', type: 'numeric', prompt: 'n', required: true, min: 4 },
    checklist([{ id: 'a', label: 'A', expected: true }, { id: 'b', label: 'B' }]),
  ] };
  assert.equal(computeSectionStatus(section, {}), 'not_started');
  // One answered, one still blank -> in progress (there are blanks).
  assert.equal(computeSectionStatus(section, { n: '5' }), 'in_progress');
  // Nothing blank, but both fail their requirement -> partially complete.
  assert.equal(computeSectionStatus(section, { n: '2', cl: ['b'] }), 'partially_complete');
  // Nothing blank, one still failing -> partially complete.
  assert.equal(computeSectionStatus(section, { n: '5', cl: ['b'] }), 'partially_complete');
  assert.equal(computeSectionStatus(section, { n: '5', cl: ['a'] }), 'completed');
});

test('partially complete section does not complete the workbook', () => {
  const wb = { settings: {}, sections: [
    { id: 's1', required: true, questions: [{ id: 'n', type: 'numeric', prompt: 'n', required: true, min: 4 }] },
  ] };
  const status = computeAllSectionStatus(wb, { n: '1' });
  assert.equal(status.s1, 'partially_complete');
  assert.equal(isWorkbookComplete(wb, status), false);
});

test('optional section completes on any answer', () => {
  const wb = demo();
  assert.equal(computeSectionStatus(wb.sections[2], {}), 'not_started');
  assert.equal(computeSectionStatus(wb.sections[2], { q4: 'yes' }), 'completed');
});

// ---- progress ------------------------------------------------------------

test('progress is question-level and ignores partial responses', () => {
  const wb = { settings: {}, sections: [
    { id: 's1', required: true, questions: [
      { id: 'a', type: 'short_text', prompt: 'a', required: true },
      { id: 'b', type: 'short_text', prompt: 'b', required: true },
      { id: 'c', type: 'numeric', prompt: 'c', required: true, min: 4 },
      { id: 'd', type: 'short_text', prompt: 'd', required: false },
    ] },
  ] };
  const st = (r) => computeAllSectionStatus(wb, r);
  assert.equal(computeProgressMeasure(wb, st({}), {}), 0);
  // 1 of 3 required questions complete -> 0.33, even though the section is not done.
  assert.equal(computeProgressMeasure(wb, st({ a: 'x' }), { a: 'x' }), 0.33);
  // A partial numeric response does not count.
  const r = { a: 'x', b: 'y', c: '2' };
  assert.equal(computeProgressMeasure(wb, st(r), r), 0.67);
  const r2 = { a: 'x', b: 'y', c: '4' };
  assert.equal(computeProgressMeasure(wb, st(r2), r2), 1);
});

test('optional sections are excluded from progress', () => {
  const wb = demo();
  const r = { q1: 'a', q3: '4' };
  assert.equal(computeProgressMeasure(wb, computeAllSectionStatus(wb, r), r), 1);
});

test('required section with no required questions counts as one unit', () => {
  const wb = { settings: {}, sections: [
    { id: 's1', required: true, questions: [{ id: 'a', type: 'short_text', prompt: 'a', required: false }] },
  ] };
  assert.equal(computeProgressMeasure(wb, computeAllSectionStatus(wb, {}), {}), 0);
  const r = { a: 'x' };
  assert.equal(computeProgressMeasure(wb, computeAllSectionStatus(wb, r), r), 1);
});

// ---- linear nav ----------------------------------------------------------

test('linear navigation does not unlock on a partially complete section', () => {
  const wb = { settings: { navigation: 'linear' }, sections: [
    { id: 's1', required: true, questions: [{ id: 'n', type: 'numeric', prompt: 'n', required: true, min: 4 }] },
    { id: 's2', required: true, questions: [{ id: 'x', type: 'short_text', prompt: 'x', required: true }] },
  ] };
  const partial = computeAllSectionStatus(wb, { n: '1' });
  assert.equal(partial.s1, 'partially_complete');
  assert.equal(isSectionUnlocked(wb, 's2', partial), false);
  const done = computeAllSectionStatus(wb, { n: '9' });
  assert.equal(isSectionUnlocked(wb, 's2', done), true);
});

// ---- suspend -------------------------------------------------------------

test('suspend round-trips the partially_complete status', () => {
  const state = {
    currentSection: 's2', currentPage: 1,
    responses: { q1: 'hello', n: '2' },
    sectionStatus: { s1: 'completed', s2: 'partially_complete', s3: 'in_progress', s4: 'not_started' },
  };
  const back = deserializeState(serializeState(state));
  assert.deepEqual(back, state);
  assert.ok(estimateSuspendSize(state) < 400);
});

test('deserialize tolerates garbage', () => {
  assert.deepEqual(deserializeState('not json'),
    { currentSection: '', currentPage: 0, responses: {}, sectionStatus: {} });
});

// ---- validation ----------------------------------------------------------

test('validation flags blocking errors', () => {
  const wb = demo();
  wb.sections[0].questions = [];
  const r = validateWorkbook(wb);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'empty-section'));
});

test('validation rejects numeric min greater than max', () => {
  const wb = demo();
  wb.sections[0].questions.push({ id: 'nq', type: 'numeric', prompt: 'n', required: true, min: 10, max: 2 });
  const r = validateWorkbook(wb);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'numeric-bad-range'));
});

test('validation warns when every option is expected', () => {
  const wb = demo();
  wb.sections[0].questions.push(checklist([
    { id: 'a', label: 'A', expected: true }, { id: 'b', label: 'B', expected: true },
  ]));
  const r = validateWorkbook(wb);
  assert.ok(r.warnings.some((w) => w.code === 'all-options-expected'));
});

test('validation warns when expected is set on a non-gated type', () => {
  const wb = demo();
  wb.sections[0].questions.push({ id: 'ss', type: 'single_select', prompt: 's', required: true,
    options: [{ id: 'a', label: 'A', expected: true }, { id: 'b', label: 'B' }] });
  const r = validateWorkbook(wb);
  assert.ok(r.warnings.some((w) => w.code === 'expected-ignored'));
});

test('validation rejects evidence storing a file in SCORM', () => {
  const wb = demo();
  wb.sections[0].questions.push({ id: 'qe', type: 'evidence_ref', prompt: 'e', required: false, storeFileInScorm: true });
  assert.ok(validateWorkbook(wb).errors.some((e) => e.code === 'evidence-stores-file'));
});

test('validation warns near, and errors over, the suspend limit', () => {
  const wb = demo();
  assert.ok(validateWorkbook(wb, { estimatedSuspendSize: 60000 }).warnings.some((w) => w.code === 'suspend-near-limit'));
  assert.ok(validateWorkbook(wb, { estimatedSuspendSize: 70000 }).errors.some((e) => e.code === 'suspend-over-limit'));
});
