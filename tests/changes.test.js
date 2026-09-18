// @ts-check
/**
 * Verifies the two changes:
 *   1. The PDF download button moved to the dashboard header as an icon button.
 *   2. The learner name from cmi.learner_name appears in the PDF report.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installFakeDom } from './helpers/fake-dom.js';
import { MockLMS } from '@sowb/mock-lms';
import { normalizeLearnerName } from '../runtime-template/js/session.js';
import { buildResponseReport, reportFileName } from '../runtime-template/js/report.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let WorkbookPlayer, ScormAdapter, workbook, domBody;

before(async () => {
  ({ body: domBody } = installFakeDom());
  ({ WorkbookPlayer } = await import('../runtime-template/js/player.js'));
  ({ ScormAdapter } = await import('../runtime-template/js/adapter.js'));
  workbook = JSON.parse(await readFile(join(ROOT, 'samples', 'demo.workbook.json'), 'utf8'));
});

function mkPlayer(wb = workbook, lms = new MockLMS()) {
  const mount = document.createElement('div');
  const player = new WorkbookPlayer({ mount, workbook: wb, adapter: new ScormAdapter({ api: lms.newAttempt() }), debug: false });
  player.init();
  return { player, mount, lms };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const latin = (b) => Buffer.from(b).toString('latin1');

// ---- 1. button moved to the dashboard header ----------------------------

test('the PDF button now lives in the dashboard header, not the section view', () => {
  const { player, mount } = mkPlayer();

  // On the dashboard: present, and inside the header.
  const btn = mount.querySelector('[data-download-pdf]');
  assert.ok(btn, 'button rendered on the dashboard');
  const header = mount.querySelector('.sowb-header');
  assert.ok(header.querySelector('[data-download-pdf]'), 'button is inside the header');

  // Opening a section hides it, keeping the question view focused.
  player.openSection('s1');
  assert.equal(mount.querySelector('[data-download-pdf]'), null, 'not shown on the section view');

  // Returning to the dashboard brings it back.
  player.goToDashboard();
  assert.ok(mount.querySelector('[data-download-pdf]'), 'back on the dashboard');
});

test('the icon button carries an accessible name and a title', () => {
  const { mount } = mkPlayer();
  const btn = mount.querySelector('[data-download-pdf]');
  assert.equal(btn.tagName, 'BUTTON');
  assert.ok(btn.className.includes('sowb-icon-btn'));
  // The visible label is an icon, so the accessible name must carry the meaning.
  assert.equal(btn.getAttribute('aria-label'), 'Download all my responses as a PDF');
  assert.ok(/pdf/i.test(btn.getAttribute('title')));
  assert.ok(btn.innerHTML.includes('<svg'), 'renders an inline SVG icon');
});

test('the header button is suppressed when the workbook disables PDF export', () => {
  const off = clone(workbook);
  off.settings.allowPdfDownload = false;
  const { mount } = mkPlayer(off);
  assert.equal(mount.querySelector('[data-download-pdf]'), null);
  assert.equal(mount.querySelector('[data-pdf-fallback]'), null, 'no fallback host either');
});

test('clicking the header button downloads a whole-workbook PDF with a fallback', () => {
  const { player, mount } = mkPlayer();
  player.session.setResponse('q_s1_1', '2026-09-14');
  player.session.setResponse('q_s2_1', 'Dana Ruiz');
  player.render();

  const before = domBody.children.length;
  mount.querySelector('[data-download-pdf]').click();
  assert.equal(domBody.children.length, before, 'temporary anchor removed from the body');

  const fallback = mount.querySelector('[data-pdf-open]');
  assert.ok(fallback, 'fallback link rendered on the dashboard');
  assert.ok(String(fallback.getAttribute('href')).startsWith('blob:'));
  assert.equal(fallback.getAttribute('rel'), 'noopener noreferrer');

  const { bytes } = player.downloadResponsesPdf();
  const s = latin(bytes);
  assert.ok(s.includes('Install Team Meeting'), 'section 1 present');
  assert.ok(s.includes('Install Manager Shadow'), 'section 2 present');
  assert.ok(s.includes('Dana Ruiz'), 'answers from every section included');
});

// ---- 2. learner name from cmi.learner_name ------------------------------

test('the session reads cmi.learner_name at launch', () => {
  const lms = new MockLMS({ learnerName: 'Quinn, Darryl' });
  const { player } = mkPlayer(workbook, lms);
  assert.equal(player.learnerName, 'Darryl Quinn', 'flipped from "Last, First"');
});

test('learner name normalization handles common LMS formats', () => {
  assert.equal(normalizeLearnerName('Quinn, Darryl'), 'Darryl Quinn');
  assert.equal(normalizeLearnerName('Darryl Quinn'), 'Darryl Quinn', 'already natural order');
  assert.equal(normalizeLearnerName('  Quinn ,  Darryl '), 'Darryl Quinn', 'trims whitespace');
  assert.equal(normalizeLearnerName(''), '', 'absent name yields empty string');
  assert.equal(normalizeLearnerName(null), '');
  assert.equal(normalizeLearnerName('Cher'), 'Cher', 'single name untouched');
  // More than one comma is not a simple "Last, First" pair; leave it alone.
  assert.equal(normalizeLearnerName('Quinn, Darryl, Jr'), 'Quinn, Darryl, Jr');
});

test('the learner name appears in the PDF heading', () => {
  const lms = new MockLMS({ learnerName: 'Quinn, Darryl' });
  const { player } = mkPlayer(workbook, lms);
  player.session.setResponse('q_s1_1', '2026-09-14');
  const { bytes, learnerName } = player.downloadResponsesPdf();
  assert.equal(learnerName, 'Darryl Quinn');
  const s = latin(bytes);
  assert.ok(s.includes('Darryl Quinn'), 'name rendered in the document');
  assert.ok(s.includes('Learner: '), 'labelled learner row present');
  // Also personalizes the PDF metadata title.
  assert.ok(/\/Title \([^)]*Darryl Quinn/.test(s), 'name in the PDF /Title');
});

test('the PDF degrades gracefully when the LMS supplies no learner name', () => {
  const lms = new MockLMS({ learnerName: '' });
  const { player } = mkPlayer(workbook, lms);
  assert.equal(player.learnerName, '');
  const s = latin(player.downloadResponsesPdf().bytes);
  assert.ok(s.includes('My responses'), 'falls back to the generic subtitle');
  assert.ok(!s.includes('Learner: '), 'no empty learner row');
});

test('the filename includes the learner name when available', () => {
  assert.equal(
    reportFileName({ courseId: 'ascend-ae-install-ride-along' }, 'Darryl Quinn').replace(/\d{8}/, 'DATE'),
    'ascend-ae-install-ride-along_darryl-quinn_my-responses_DATE.pdf'
  );
  assert.equal(
    reportFileName({ courseId: 'ascend-ae-install-ride-along' }, '').replace(/\d{8}/, 'DATE'),
    'ascend-ae-install-ride-along_my-responses_DATE.pdf'
  );
});

test('the header greets the learner by name, and omits the line when absent', () => {
  const named = mkPlayer(workbook, new MockLMS({ learnerName: 'Quinn, Darryl' }));
  assert.equal(named.mount.querySelector('[data-learner-name]').textContent, 'Darryl Quinn');

  const anon = mkPlayer(workbook, new MockLMS({ learnerName: '' }));
  assert.equal(anon.mount.querySelector('[data-learner-name]'), null);
});

test('cmi.learner_name is read-only and never written back', () => {
  const lms = new MockLMS({ learnerName: 'Quinn, Darryl' });
  const api = lms.newAttempt();
  api.Initialize('');
  assert.equal(api.SetValue('cmi.learner_name', 'Someone Else'), 'false');
  assert.equal(api.GetLastError(), '404');

  // The SCO must never attempt to write it either.
  const { player } = mkPlayer(workbook, new MockLMS({ learnerName: 'Quinn, Darryl' }));
  player.session.setResponse('q_s1_1', '2026-09-14');
  assert.ok(!player.adapter.log.some((l) => l.startsWith('SetValue(cmi.learner_name')),
    'SCO never writes cmi.learner_name');
});

test('the learner name is not persisted into suspend data', () => {
  const lms = new MockLMS({ learnerName: 'Quinn, Darryl' });
  const { player } = mkPlayer(workbook, lms);
  player.session.setResponse('q_s1_1', '2026-09-14');
  const suspend = lms.snapshot()['cmi.suspend_data'];
  assert.ok(suspend.length > 0);
  // The LMS already owns learner identity; duplicating it would waste the
  // limited suspend-data budget.
  assert.ok(!suspend.includes('Darryl'), 'name absent from suspend data');
});

test('the name survives a resume because it is re-read from the LMS', () => {
  const lms = new MockLMS({ learnerName: 'Quinn, Darryl' });
  let p = mkPlayer(workbook, lms);
  p.player.session.setResponse('q_s1_1', '2026-09-14');
  p.player.session.suspendAndExit();

  p = mkPlayer(workbook, lms);
  assert.equal(p.player.learnerName, 'Darryl Quinn', 're-read on the new attempt');
  assert.equal(p.player.state.responses['q_s1_1'], '2026-09-14', 'state restored');
});
