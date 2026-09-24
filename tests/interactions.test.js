// @ts-check
/**
 * cmi.interactions reporting: the per-type mapping and formatting, and the
 * real SessionCore writing interactions against MockLMS (which enforces the
 * SCORM array rules, so an out-of-order write fails here as it would in an LMS).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLMS } from '@sowb/mock-lms';
import { inlineScales } from '@sowb/shared/scales.js';
import { QUESTION_TYPES } from '@sowb/shared/constants.js';
import { validateWorkbook } from '@sowb/workbook-engine';
import { assembleRuntime } from '@sowb/scorm-runtime';
import {
  interactionType, formatLearnerResponse, interactionResult, interactionDescription,
  toScormTimestamp, INTERACTIONS_LIMIT,
} from '@sowb/workbook-engine/interactions.js';
import { SessionCore } from '../runtime-template/js/session.js';
import { ScormAdapter } from '../runtime-template/js/adapter.js';
import { loadWorkbook, loadWorkbookWith, loadCustomScales, answerAll } from './helpers/workbook.js';

const runtime = async (wb) => inlineScales(wb || await loadWorkbook(), await loadCustomScales());
function mk(workbook, lms) {
  const adapter = new ScormAdapter({ api: lms.newAttempt() });
  const session = new SessionCore({ workbook, adapter });
  session.init();
  return { session, adapter };
}
const interactionWrites = (adapter) => adapter.log.filter((l) => l.startsWith('SetValue(cmi.interactions.'));

// ---- mapping -------------------------------------------------------------

test('every question type maps to a specific interaction type', () => {
  for (const type of QUESTION_TYPES) {
    assert.notEqual(interactionType({ type }), 'other', `${type} has a mapping`);
  }
  assert.equal(interactionType({ type: 'yes_no' }), 'true-false');
  assert.equal(interactionType({ type: 'checklist' }), 'long-fill-in', 'labels are text');
  assert.equal(interactionType({ type: 'rating' }), 'likert');
  assert.equal(interactionType({ type: 'short_text' }), 'fill-in');
  assert.equal(interactionType({ type: 'url' }), 'long-fill-in');
});

test('learner_response uses SCORM formats and stored values', () => {
  const f = formatLearnerResponse;
  assert.equal(f({ type: 'yes_no' }, 'yes'), 'true');
  assert.equal(f({ type: 'yes_no' }, 'no'), 'false');
  assert.equal(f({ type: 'acknowledgement' }, true), 'true');
  const options = [{ id: 'o_scope', label: 'Scope review' }, { id: 'o_safety', label: 'Safety plan' }, { id: 'o_ride', label: 'Ride along' }];
  assert.equal(f({ type: 'single_select', options }, 'o_ride'), 'Ride along', 'the label, not the option id');
  assert.equal(f({ type: 'checklist', options }, ['o_safety', 'o_scope']), 'Scope review; Safety plan', 'authored order');
  assert.equal(f({ type: 'checklist', options }, ['o_scope', 'o_gone']), 'Scope review; o_gone', 'a deleted option still shows');
  assert.equal(f({ type: 'rating', scale: [1, 2, 3, 4, 5] }, '4'), '4', 'the value, never the label');
  assert.equal(f({ type: 'numeric' }, ' 6 '), '6');
  assert.equal(f({ type: 'datetime' }, '2026-09-14'), '2026-09-14');
  assert.equal(f({ type: 'evidence_ref' }, { fileSelected: true, fileName: 'notes.pdf' }), 'notes.pdf');
  assert.equal(f({ type: 'url' }, 'https://example.com/x'), 'https://example.com/x');
});

test('numeric input that is not a plain number is not reported', () => {
  assert.equal(formatLearnerResponse({ type: 'numeric' }, 'six'), null);
  assert.equal(formatLearnerResponse({ type: 'numeric' }, '1e30'), null);
});

test('free text cannot break the localized-string syntax', () => {
  assert.equal(formatLearnerResponse({ type: 'short_text' }, 'a[,]b'), 'a, b', '[,] would split fill-in values');
  assert.equal(formatLearnerResponse({ type: 'short_text' }, '{lang=fr}x', 'en-US'), '{lang=en-US}{lang=fr}x');
  assert.equal(formatLearnerResponse({ type: 'long_text' }, 'plain'), 'plain', 'no prefix unless needed');
});

test('text is truncated to the SPM by code point', () => {
  assert.equal(Array.from(formatLearnerResponse({ type: 'short_text' }, 'x'.repeat(300))).length, 250);
  assert.equal(formatLearnerResponse({ type: 'long_text' }, 'y'.repeat(5000)).length, 4000);
  const emoji = '😀'.repeat(300);
  assert.equal(formatLearnerResponse({ type: 'short_text' }, emoji), '😀'.repeat(250), 'no split surrogate');
  assert.equal(Array.from(interactionDescription({ prompt: 'p'.repeat(400) })).length, 250);
});

test('cleared answers produce an empty (or false) response', () => {
  assert.equal(formatLearnerResponse({ type: 'checklist', options: [] }, []), '');
  assert.equal(formatLearnerResponse({ type: 'short_text' }, ''), '');
  assert.equal(formatLearnerResponse({ type: 'acknowledgement' }, false), 'false');
  assert.equal(formatLearnerResponse({ type: 'numeric' }, ''), null, 'not representable as a real');
});

test('result is correct/incorrect only where a requirement exists', () => {
  const checklist = { type: 'checklist', options: [{ id: 'a', expected: true }, { id: 'b' }] };
  assert.equal(interactionResult(checklist, ['a', 'b']), 'correct', 'extra selections allowed');
  assert.equal(interactionResult(checklist, ['b']), 'incorrect', 'missing an expected option');
  const numeric = { type: 'numeric', min: 4, integerOnly: true };
  assert.equal(interactionResult(numeric, '6'), 'correct');
  assert.equal(interactionResult(numeric, '2'), 'incorrect');
  assert.equal(interactionResult({ type: 'url' }, 'not a url'), 'incorrect');
  assert.equal(interactionResult({ type: 'short_text' }, 'Dana'), 'neutral');
  assert.equal(interactionResult({ type: 'yes_no' }, 'no'), 'neutral', 'a survey answer is never wrong');
  assert.equal(interactionResult({ type: 'rating', scale: [1, 2, 3] }, '1'), 'neutral');
  assert.equal(interactionResult({ type: 'checklist', options: [{ id: 'a' }] }, ['a']), 'neutral', 'no expected options');
  assert.equal(interactionResult({ type: 'numeric' }, '2'), 'neutral', 'no bounds');
});

test('timestamps carry fractional seconds, which the Z requires', () => {
  assert.equal(toScormTimestamp(new Date('2026-09-24T13:05:09.123Z')), '2026-09-24T13:05:09.12Z');
});

// ---- session against MockLMS ---------------------------------------------

test('typing writes no interactions until the learner navigates', async () => {
  const { session, adapter } = mk(await runtime(), new MockLMS());
  session.openSection('s2');
  for (const partial of ['D', 'Da', 'Dan', 'Dana']) session.setResponse('q_s2_1', partial);
  assert.equal(interactionWrites(adapter).length, 0, 'nothing written per keystroke');
  session.nextPage();
  const ids = interactionWrites(adapter).filter((l) => l.includes('.learner_response'));
  assert.deepEqual(ids, ['SetValue(cmi.interactions.0.learner_response, Dana) -> true'], 'one write, final value');
});

test('answers are committed as complete interactions', async () => {
  const lms = new MockLMS();
  const { session } = mk(await runtime(), lms);
  session.openSection('s1');
  session.setResponse('q_s1_1', '2026-09-14');
  session.nextPage();
  session.setResponse('q_s1_3', ['o_sched']);
  session.suspendAndExit();

  const [date, checklist] = lms.interactions();
  assert.equal(lms.interactions().length, 2);
  assert.deepEqual(
    { ...date, timestamp: undefined },
    {
      id: 'q_s1_1', type: 'fill-in', description: 'Date of the install team meeting',
      'objectives.0.id': 's1', learner_response: '2026-09-14', result: 'neutral', timestamp: undefined,
    });
  assert.match(date.timestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\dZ$/);
  assert.equal(checklist.type, 'long-fill-in');
  assert.equal(checklist.learner_response, 'Schedule');
  assert.equal(checklist.result, 'incorrect', 'expected options missing');
});

test('resume updates the same entries and appends new ones in order', async () => {
  const wb = await runtime();
  const lms = new MockLMS();
  let { session } = mk(wb, lms);
  session.openSection('s2');
  session.setResponse('q_s2_1', 'Dana');
  session.nextPage();
  session.setResponse('q_s2_2', '2');
  session.suspendAndExit();
  assert.equal(lms.interactions()[1].result, 'incorrect', 'below min');

  ({ session } = mk(wb, lms));
  assert.equal(session.interactionCount(), 2, 'index rebuilt from the LMS');
  session.openSection('s2');
  session.setResponse('q_s2_2', '6');
  session.setResponse('q_s2_3', '4');
  session.suspendAndExit();

  const all = lms.interactions();
  assert.deepEqual(all.map((i) => i.id), ['q_s2_1', 'q_s2_2', 'q_s2_3'], 'no duplicates');
  assert.equal(all[1].learner_response, '6');
  assert.equal(all[1].result, 'correct');
  assert.equal(all[2].type, 'likert');
});

test('a blank answer never creates an interaction; clearing one updates it', async () => {
  const lms = new MockLMS();
  const { session } = mk(await runtime(), lms);
  session.openSection('s1');
  session.setResponse('q_s1_2', '');
  session.nextPage();
  assert.equal(lms.interactions().length, 0);

  session.setResponse('q_s1_3', ['o_scope']);
  session.nextPage();
  session.setResponse('q_s1_3', []);
  session.prevPage();
  const [entry] = lms.interactions();
  assert.equal(entry.learner_response, '');
  assert.equal(entry.result, 'incorrect');
});

test('a locked section writes nothing further', async () => {
  const wb = await runtime(await loadWorkbookWith((w) => { w.sections[0].lockWhenComplete = true; }));
  const lms = new MockLMS();
  const { session, adapter } = mk(wb, lms);
  session.openSection('s1');
  answerAll(session, { q_s1_1: '2026-09-14', q_s1_2: 'Notes.', q_s1_3: ['o_scope', 'o_safety'] });
  session.closeSection();
  const before = interactionWrites(adapter).length;
  assert.ok(before > 0);
  session.setResponse('q_s1_2', 'Changed.');
  session.openSection('s2');
  assert.equal(interactionWrites(adapter).length, before);
  assert.equal(lms.interactions()[1].learner_response, 'Notes.');
});

test('reportInteractions: false writes no interactions at all', async () => {
  const wb = await runtime(await loadWorkbookWith((w) => { w.settings.reportInteractions = false; }));
  const { session, adapter } = mk(wb, new MockLMS());
  session.openSection('s1');
  session.setResponse('q_s1_1', '2026-09-14');
  session.suspendAndExit();
  assert.deepEqual(adapter.log.filter((l) => l.includes('cmi.interactions')), []);
});

test('interactions stop at the SCORM limit', async () => {
  const wb = await loadWorkbookWith((w) => {
    w.sections = [{
      id: 'big', title: 'Big', required: true,
      questions: Array.from({ length: INTERACTIONS_LIMIT + 5 }, (_, i) => ({ id: `q${i}`, type: 'short_text', prompt: `Q${i}`, required: true })),
    }];
  });
  assert.ok(validateWorkbook(wb).warnings.some((x) => x.code === 'interactions-over-limit'));
  const lms = new MockLMS();
  const { session } = mk(await runtime(wb), lms);
  for (let i = 0; i < INTERACTIONS_LIMIT + 5; i++) session.setResponse(`q${i}`, 'x');
  session.suspendAndExit();
  assert.equal(lms.interactions().length, INTERACTIONS_LIMIT);
  assert.equal(lms.snapshot()['cmi.completion_status'], 'completed', 'suspend data still carries everything');
});

// ---- mock LMS rules, validation, packaging ------------------------------

test('MockLMS enforces the interactions array rules', () => {
  const api = new MockLMS().newAttempt();
  api.Initialize('');
  assert.equal(api.SetValue('cmi.interactions.1.id', 'q'), 'false');
  assert.equal(api.GetLastError(), '351');
  assert.equal(api.SetValue('cmi.interactions.0.type', 'choice'), 'false');
  assert.equal(api.GetLastError(), '408');
  assert.equal(api.SetValue('cmi.interactions.0.id', 'q'), 'true');
  assert.equal(api.GetValue('cmi.interactions._count'), '1');
  assert.equal(api.SetValue('cmi.interactions._count', '5'), 'false');
  assert.equal(api.SetValue('cmi.interactions.0.timestamp', '2026-09-24T13:05:09Z'), 'false', 'Z without .s');
  assert.equal(api.GetLastError(), '406');
  assert.equal(api.SetValue('cmi.interactions.0.timestamp', '2026-09-24T13:05:09.12Z'), 'true');
  assert.equal(api.SetValue('cmi.interactions.0.result', 'wrong'), 'false');
  assert.equal(api.SetValue('cmi.interactions.0.result', 'neutral'), 'true');
});

test('an entry created by an older package is retyped on update', async () => {
  const wb = await runtime();
  const lms = new MockLMS();
  const api = lms.newAttempt();
  api.Initialize('');
  api.SetValue('cmi.interactions.0.id', 'q_s1_3');
  api.SetValue('cmi.interactions.0.type', 'choice');
  api.SetValue('cmi.interactions.0.learner_response', 'o_scope');
  api.SetValue('cmi.exit', 'suspend');
  api.Terminate('');

  const { session } = mk(wb, lms);
  session.openSection('s1');
  session.setResponse('q_s1_3', ['o_scope', 'o_safety']);
  session.suspendAndExit();
  const [entry] = lms.interactions();
  assert.equal(lms.interactions().length, 1);
  assert.equal(entry.type, 'long-fill-in');
  assert.equal(entry.learner_response, 'Scope review; Safety plan');
  assert.equal(entry.result, 'correct', 'both expected options selected');
});

test('validation warns on identifiers an LMS may reject', async () => {
  const wb = await loadWorkbookWith((w) => {
    w.sections[1].questions[2] = { id: 'q_s2_3', type: 'rating', prompt: 'P', required: true, scale: ['Strongly Agree', 'Agree'] };
  });
  const warn = validateWorkbook(wb).warnings.find((x) => x.code === 'interaction-bad-identifier');
  assert.ok(warn && warn.message.includes('Strongly Agree'));
  wb.settings.reportInteractions = false;
  assert.ok(!validateWorkbook(wb).warnings.some((x) => x.code === 'interaction-bad-identifier'));
});

test('the exported package ships the interactions engine', async () => {
  const files = await assembleRuntime(await runtime());
  assert.ok(files['js/engine/interactions.js'].includes('export function formatLearnerResponse'));
  assert.ok(!files['js/engine/interactions.js'].includes('@sowb/'), 'no workspace import');
});
