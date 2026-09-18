// @ts-check
/**
 * Headless mock-LMS suspend/resume simulation. Drives the REAL runtime
 * SessionCore (the same code shipped in the exported package) against MockLMS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockLMS } from '@sowb/mock-lms';
import { inlineScales } from '@sowb/shared/scales.js';
import { SessionCore, normalizeLearnerName } from '../runtime-template/js/session.js';
import { ScormAdapter } from '../runtime-template/js/adapter.js';
import { loadWorkbook, loadCustomScales, COMPLETE_REQUIRED_RESPONSES, answerAll } from './helpers/workbook.js';

async function runtimeWorkbook() {
  return inlineScales(await loadWorkbook(), await loadCustomScales());
}
const mk = (workbook, lms) => new SessionCore({ workbook, adapter: new ScormAdapter({ api: lms.newAttempt() }) });

test('suspend then resume restores responses, cursor, and status', async () => {
  const workbook = await runtimeWorkbook();
  const lms = new MockLMS();

  let session = mk(workbook, lms);
  assert.equal(session.init().entry, 'ab-initio');

  session.openSection('s1');
  session.setResponse('q_s1_1', '2026-09-14');
  session.nextPage();
  session.setResponse('q_s1_2', 'Reviewed the customer scope and safety plan with the crew.');
  session.openSection('s2');
  session.setResponse('q_s2_1', 'Dana Ruiz');

  assert.equal(session.state.sectionStatus.s1, 'in_progress', 'checklist still blank');
  session.suspendAndExit();

  const snap = lms.snapshot();
  assert.equal(snap['cmi.exit'], 'suspend');
  assert.equal(snap['cmi.completion_status'], 'incomplete');
  assert.equal(snap['cmi.location'], 's2:0');
  assert.ok(snap['cmi.suspend_data'].includes('safety plan'), 'response value persisted');
  assert.ok(!snap['cmi.suspend_data'].includes('What was discussed'), 'prompt text NOT persisted');

  session = mk(workbook, lms);
  assert.equal(session.init().entry, 'resume');
  assert.equal(session.state.responses['q_s2_1'], 'Dana Ruiz');
  assert.equal(session.state.currentSection, 's2');

  answerAll(session);
  assert.equal(session.isComplete(), true);
  const snap2 = lms.snapshot();
  assert.equal(snap2['cmi.completion_status'], 'completed');
  assert.equal(snap2['cmi.progress_measure'], '1');
  assert.equal(lms.launchCount, 2);
});

test('reopening a COMPLETED section starts at question 1 for review', async () => {
  const workbook = await runtimeWorkbook();
  const session = mk(workbook, new MockLMS());
  session.init();

  session.openSection('s1');
  session.setResponse('q_s1_1', '2026-09-14');
  session.nextPage();
  session.setResponse('q_s1_2', 'Notes.');
  session.nextPage();
  session.setResponse('q_s1_3', ['o_scope', 'o_safety']);
  assert.equal(session.state.sectionStatus.s1, 'completed');
  assert.equal(session.state.currentPage, 2, 'left off on the last page');

  session.openSection('s1');
  assert.equal(session.state.currentPage, 0, 'review rewinds to question 1');
});

test('an IN-PROGRESS section still resumes at its saved page', async () => {
  const session = mk(await runtimeWorkbook(), new MockLMS());
  session.init();
  session.openSection('s1');
  session.setResponse('q_s1_1', '2026-09-14');
  session.nextPage();
  assert.notEqual(session.state.sectionStatus.s1, 'completed');
  session.openSection('s1');
  assert.equal(session.state.currentPage, 1, 'Continue lands in place');
});

test('a checklist missing an expected option keeps the section partially complete', async () => {
  const lms = new MockLMS();
  const session = mk(await runtimeWorkbook(), lms);
  session.init();
  session.setResponse('q_s1_1', '2026-09-14');
  session.setResponse('q_s1_2', 'Notes.');
  session.setResponse('q_s1_3', ['o_scope', 'o_sched']); // missing o_safety

  assert.equal(session.state.sectionStatus.s1, 'partially_complete');
  session.save();
  assert.equal(lms.snapshot()['cmi.completion_status'], 'incomplete');

  session.setResponse('q_s1_3', ['o_scope', 'o_sched', 'o_safety']);
  assert.equal(session.state.sectionStatus.s1, 'completed');
});

test('a numeric below its minimum keeps the section partially complete', async () => {
  const session = mk(await runtimeWorkbook(), new MockLMS());
  session.init();
  session.setResponse('q_s2_1', 'Dana Ruiz');
  session.setResponse('q_s2_2', '2');
  session.setResponse('q_s2_3', '1');
  session.setResponse('q_s2_4', '1');
  assert.equal(session.state.sectionStatus.s2, 'partially_complete');
  session.setResponse('q_s2_2', '4');
  assert.equal(session.state.sectionStatus.s2, 'completed');
});

test('partial responses survive suspend/resume and still block completion', async () => {
  const workbook = await runtimeWorkbook();
  const lms = new MockLMS();
  let session = mk(workbook, lms);
  session.init();
  session.setResponse('q_s2_2', '1');
  session.setResponse('q_s1_3', ['o_scope']);
  session.suspendAndExit();

  session = mk(workbook, lms);
  session.init();
  assert.equal(session.state.responses['q_s2_2'], '1');
  assert.deepEqual(session.state.responses['q_s1_3'], ['o_scope']);
  assert.equal(session.isComplete(), false);
});

test('progress measure advances per question, not per section', async () => {
  const session = mk(await runtimeWorkbook(), new MockLMS());
  session.init();
  assert.equal(session.progress(), 0);
  session.setResponse('q_s1_1', '2026-09-14');
  const after = session.progress();
  assert.ok(after > 0 && after < 1);
  session.setResponse('q_s2_2', '1'); // partial
  assert.equal(session.progress(), after, 'partial does not count');
  session.setResponse('q_s2_2', '9');
  assert.ok(session.progress() > after);
});

// ---- learner name --------------------------------------------------------

test('the session reads cmi.learner_name at launch', async () => {
  const session = mk(await runtimeWorkbook(), new MockLMS({ learnerName: 'Quinn, Darryl' }));
  assert.equal(session.init().learnerName, 'Darryl Quinn', 'flipped from "Last, First"');
  assert.equal(session.learnerName(), 'Darryl Quinn');
});

test('learner name normalization handles common LMS formats', () => {
  assert.equal(normalizeLearnerName('Quinn, Darryl'), 'Darryl Quinn');
  assert.equal(normalizeLearnerName('Darryl Quinn'), 'Darryl Quinn', 'already natural order');
  assert.equal(normalizeLearnerName('  Quinn ,  Darryl '), 'Darryl Quinn', 'trims whitespace');
  assert.equal(normalizeLearnerName(''), '');
  assert.equal(normalizeLearnerName(null), '');
  assert.equal(normalizeLearnerName('Cher'), 'Cher', 'single name untouched');
  // More than one comma is not a simple "Last, First" pair; leave it alone.
  assert.equal(normalizeLearnerName('Quinn, Darryl, Jr'), 'Quinn, Darryl, Jr');
});

test('cmi.learner_name is read-only and never written back', async () => {
  const lms = new MockLMS({ learnerName: 'Quinn, Darryl' });
  const api = lms.newAttempt();
  api.Initialize('');
  assert.equal(api.SetValue('cmi.learner_name', 'Someone Else'), 'false');
  assert.equal(api.GetLastError(), '404');

  const session = mk(await runtimeWorkbook(), new MockLMS({ learnerName: 'Quinn, Darryl' }));
  session.init();
  session.setResponse('q_s1_1', '2026-09-14');
  assert.ok(!session.adapter.log.some((l) => l.startsWith('SetValue(cmi.learner_name')),
    'the SCO never writes cmi.learner_name');
});

test('the learner name is not persisted into suspend data', async () => {
  const lms = new MockLMS({ learnerName: 'Quinn, Darryl' });
  const session = mk(await runtimeWorkbook(), lms);
  session.init();
  session.setResponse('q_s1_1', '2026-09-14');
  const suspend = lms.snapshot()['cmi.suspend_data'];
  assert.ok(suspend.length > 0);
  // The LMS already owns learner identity; duplicating it would waste the
  // limited suspend-data budget.
  assert.ok(!suspend.includes('Darryl'), 'name absent from suspend data');
});

test('the name survives a resume because it is re-read from the LMS', async () => {
  const workbook = await runtimeWorkbook();
  const lms = new MockLMS({ learnerName: 'Quinn, Darryl' });
  let session = mk(workbook, lms);
  session.init();
  session.setResponse('q_s1_1', '2026-09-14');
  session.suspendAndExit();

  session = mk(workbook, lms);
  session.init();
  assert.equal(session.learnerName(), 'Darryl Quinn', 're-read on the new attempt');
  assert.equal(session.state.responses['q_s1_1'], '2026-09-14', 'state restored');
});

test('read-only cmi.entry cannot be written by the SCO', () => {
  const api = new MockLMS().newAttempt();
  api.Initialize('');
  assert.equal(api.SetValue('cmi.entry', 'resume'), 'false');
  assert.equal(api.GetLastError(), '404');
});
