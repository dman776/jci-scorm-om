// @ts-check
/**
 * Headless mock-LMS suspend/resume simulation. Drives the REAL runtime
 * SessionCore (the same code shipped in the exported package) against MockLMS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MockLMS } from '@sowb/mock-lms';
import { SessionCore } from '../runtime-template/js/session.js';
import { ScormAdapter } from '../runtime-template/js/adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

async function demoWorkbook() {
  return JSON.parse(await readFile(join(ROOT, 'samples', 'ae-install-ride-along.workbook.json'), 'utf8'));
}
const mk = (workbook, lms) => new SessionCore({ workbook, adapter: new ScormAdapter({ api: lms.newAttempt() }) });

/** Complete every required question in the demo workbook. */
function answerAll(session) {
  session.setResponse('q_s1_1', '2026-09-14');
  session.setResponse('q_s1_2', 'Reviewed scope and safety.');
  session.setResponse('q_s1_3', ['o_scope', 'o_safety']); // both expected
  session.setResponse('q_s2_1', 'Dana Ruiz');
  session.setResponse('q_s2_2', '6');                      // min 4
  session.setResponse('q_s2_3', 'High');
  session.setResponse('q_s2_4', 'Learned the handoff checklist.');
  session.setResponse('q_s3_1', 'yes');
  session.setResponse('q_s3_2', '4');
}

test('suspend then resume restores responses, cursor, and status', async () => {
  const workbook = await demoWorkbook();
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
  assert.equal(session.isComplete(), false);
  session.suspendAndExit();

  const snap = lms.snapshot();
  assert.equal(snap['cmi.exit'], 'suspend');
  assert.equal(snap['cmi.completion_status'], 'incomplete');
  assert.equal(snap['cmi.location'], 's2:0');
  assert.ok(snap['cmi.suspend_data'].includes('safety plan'), 'response value persisted');
  assert.ok(!snap['cmi.suspend_data'].includes('What was discussed'), 'prompt text NOT persisted');

  session = mk(workbook, lms);
  const info = session.init();
  assert.equal(info.entry, 'resume');
  assert.equal(session.state.responses['q_s2_1'], 'Dana Ruiz');
  assert.equal(session.state.currentSection, 's2');

  answerAll(session);
  assert.equal(session.isComplete(), true);
  const snap2 = lms.snapshot();
  assert.equal(snap2['cmi.completion_status'], 'completed');
  assert.equal(snap2['cmi.progress_measure'], '1');
  assert.equal(lms.launchCount, 2);
});

test('a checklist missing an expected option keeps the section partially complete', async () => {
  const workbook = await demoWorkbook();
  const lms = new MockLMS();
  const session = mk(workbook, lms);
  session.init();

  // Answer every s1 question, but tick only ONE of the two expected options.
  session.setResponse('q_s1_1', '2026-09-14');
  session.setResponse('q_s1_2', 'Notes.');
  session.setResponse('q_s1_3', ['o_scope', 'o_sched']); // missing o_safety (expected)

  assert.equal(session.state.sectionStatus.s1, 'partially_complete',
    'nothing blank, but an expected option is missing');
  assert.equal(session.isComplete(), false);
  session.save();
  assert.equal(lms.snapshot()['cmi.completion_status'], 'incomplete');

  // Ticking the remaining expected option completes the section.
  session.setResponse('q_s1_3', ['o_scope', 'o_sched', 'o_safety']);
  assert.equal(session.state.sectionStatus.s1, 'completed');
});

test('a numeric below its minimum keeps the section partially complete', async () => {
  const workbook = await demoWorkbook();
  const lms = new MockLMS();
  const session = mk(workbook, lms);
  session.init();

  // s2 requires: short_text, numeric(min 4), rating, long_text.
  session.setResponse('q_s2_1', 'Dana Ruiz');
  session.setResponse('q_s2_2', '2'); // below the minimum of 4
  session.setResponse('q_s2_3', 'High');
  session.setResponse('q_s2_4', 'Learned a lot.');

  assert.equal(session.state.sectionStatus.s2, 'partially_complete');
  session.setResponse('q_s2_2', '4'); // inclusive minimum
  assert.equal(session.state.sectionStatus.s2, 'completed');
});

test('partial responses survive a suspend/resume cycle and still block completion', async () => {
  const workbook = await demoWorkbook();
  const lms = new MockLMS();

  let session = mk(workbook, lms);
  session.init();
  session.setResponse('q_s2_2', '1'); // partial numeric
  session.setResponse('q_s1_3', ['o_scope']); // partial checklist
  session.suspendAndExit();

  session = mk(workbook, lms);
  session.init();
  assert.equal(session.state.responses['q_s2_2'], '1', 'partial numeric value restored');
  assert.deepEqual(session.state.responses['q_s1_3'], ['o_scope'], 'partial checklist restored');
  assert.equal(session.isComplete(), false);
});

test('progress measure advances per question, not per section', async () => {
  const workbook = await demoWorkbook();
  const lms = new MockLMS();
  const session = mk(workbook, lms);
  session.init();
  assert.equal(session.progress(), 0);

  session.setResponse('q_s1_1', '2026-09-14');
  const afterOne = session.progress();
  assert.ok(afterOne > 0 && afterOne < 1, `expected partial progress, got ${afterOne}`);

  // A partial numeric must NOT increase progress.
  const before = session.progress();
  session.setResponse('q_s2_2', '1');
  assert.equal(session.progress(), before, 'partial response does not count toward progress');

  // Satisfying it does.
  session.setResponse('q_s2_2', '9');
  assert.ok(session.progress() > before);
});

test('read-only cmi.entry cannot be written by the SCO', () => {
  const lms = new MockLMS();
  const api = lms.newAttempt();
  api.Initialize('');
  assert.equal(api.SetValue('cmi.entry', 'resume'), 'false');
  assert.equal(api.GetLastError(), '404');
});

test('reopening a COMPLETED section starts at question 1 for review', async () => {
  const workbook = await demoWorkbook();
  const lms = new MockLMS();
  const session = mk(workbook, lms);
  session.init();

  // Complete s1, finishing on its last page.
  session.openSection('s1');
  session.setResponse('q_s1_1', '2026-09-14');
  session.nextPage();
  session.setResponse('q_s1_2', 'Notes.');
  session.nextPage();
  session.setResponse('q_s1_3', ['o_scope', 'o_safety']);
  assert.equal(session.state.sectionStatus.s1, 'completed');
  assert.equal(session.state.currentPage, 2, 'left off on the last page');

  // Reopening it for review rewinds to question 1.
  session.openSection('s1');
  assert.equal(session.state.currentPage, 0);
});

test('an IN-PROGRESS section still resumes at its saved page', async () => {
  const workbook = await demoWorkbook();
  const lms = new MockLMS();
  const session = mk(workbook, lms);
  session.init();

  session.openSection('s1');
  session.setResponse('q_s1_1', '2026-09-14');
  session.nextPage(); // now on page 1, section incomplete
  assert.notEqual(session.state.sectionStatus.s1, 'completed');

  session.openSection('s1');
  assert.equal(session.state.currentPage, 1, 'Continue lands in place');
});