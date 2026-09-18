// @ts-check
/**
 * Headless DOM tests for the real WorkbookPlayer using a tiny fake DOM.
 * Playwright (tests/e2e) is the full browser check; this catches render and
 * wiring regressions without a browser.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './helpers/fake-dom.js';
import { MockLMS } from '@sowb/mock-lms';
import { inlineScales } from '@sowb/shared/scales.js';
import { loadWorkbook, loadCustomScales, clone, SECTION_TITLES } from './helpers/workbook.js';

let WorkbookPlayer, ScormAdapter, domBody, runtimeWb;

before(async () => {
  ({ body: domBody } = installFakeDom());
  ({ WorkbookPlayer } = await import('../runtime-template/js/player.js'));
  ({ ScormAdapter } = await import('../runtime-template/js/adapter.js'));
  // The runtime always sees scales already inlined by publish/preview.
  runtimeWb = inlineScales(await loadWorkbook(), await loadCustomScales());
});

function mkPlayer(wb = runtimeWb, lms = new MockLMS()) {
  const mount = document.createElement('div');
  const player = new WorkbookPlayer({ mount, workbook: wb, adapter: new ScormAdapter({ api: lms.newAttempt() }), debug: false });
  player.init();
  return { player, mount, lms };
}
const type = (mount, qid, value) => {
  const el = mount.querySelector(`[data-q="${qid}"]`);
  el.value = value;
  el.dispatch('input');
  return el;
};

// ---- dashboard -----------------------------------------------------------

test('the dashboard lists every section with a status pill', () => {
  const { mount } = mkPlayer();
  assert.equal(mount.querySelectorAll('.sowb-section-card').length, 4);
  assert.equal(mount.querySelector('[data-section-status="s1"]').textContent, 'Not Started');
});

test('section cards show the author title verbatim, with no "Section N:" prefix', () => {
  const { mount } = mkPlayer();
  const names = mount.querySelectorAll('.sowb-section-name').map((n) => n.textContent);
  assert.deepEqual(names, SECTION_TITLES);
  for (const name of names) {
    assert.ok(!/^Section\s*\d+\s*:/.test(name), `"${name}" has no prefix`);
  }
  // The accessible name mirrors the visible label.
  assert.equal(mount.querySelector('[data-open-section="s1"]').getAttribute('aria-label'), 'Open Month 1');
});

test('the dashboard heading is author-configurable, with a default fallback', async () => {
  assert.equal(mkPlayer().mount.querySelector('[data-dashboard-heading]').textContent, 'Your Milestones');

  const blank = clone(runtimeWb); blank.settings.dashboardHeading = '   ';
  assert.equal(mkPlayer(blank).mount.querySelector('[data-dashboard-heading]').textContent, 'Your observation workbook');

  const missing = clone(runtimeWb); delete missing.settings.dashboardHeading;
  assert.equal(mkPlayer(missing).mount.querySelector('[data-dashboard-heading]').textContent, 'Your observation workbook');
});

// ---- partial states ------------------------------------------------------

test('a checklist missing an expected option shows the neutral partial hint', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s1');
  player.session.setResponse('q_s1_1', '2026-09-14');
  player.session.setResponse('q_s1_2', 'Notes.');
  player.state.currentPage = 2;
  player.render();

  const boxes = mount.querySelectorAll('[data-q="q_s1_3"]');
  boxes[0].checked = true;
  boxes[0].dispatch('change');

  const status = mount.querySelector('[data-answer-status]');
  assert.equal(status.textContent, 'Some required items are not yet selected.');
  assert.ok(!status.textContent.includes('Safety plan'), 'the hint must not name expected options');

  player.goToDashboard();
  assert.equal(mount.querySelector('[data-section-status="s1"]').textContent, 'Partially Complete');
});

test('expected options are not visually marked for the learner', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s1');
  player.state.currentPage = 2;
  player.render();
  for (const label of mount.querySelectorAll('.sowb-choice')) {
    assert.ok(!label.className.includes('expected'));
    assert.ok(!label.textContent.includes('*'));
  }
});

test('numeric below its minimum shows the bound hint, and meeting it clears', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s2');
  player.state.currentPage = 1;
  player.render();
  type(mount, 'q_s2_2', '2');
  assert.equal(mount.querySelector('[data-answer-status]').textContent, 'Enter at least 4.');
  type(mount, 'q_s2_2', '4');
  assert.equal(mount.querySelector('[data-answer-status]').textContent, 'Answer saved');
});

test('url rejects malformed input and previews a valid link', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s3');
  player.state.currentPage = 2;
  player.render();
  type(mount, 'q_s3_3', 'notaurl');
  assert.equal(mount.querySelector('[data-answer-status]').textContent, 'Enter a valid link starting with https://');
  type(mount, 'q_s3_3', 'https://jci.sharepoint.com/notes');
  assert.equal(mount.querySelector('[data-answer-status]').textContent, 'Answer saved');
  const link = mount.querySelector('[data-url-preview]');
  assert.equal(link.getAttribute('href'), 'https://jci.sharepoint.com/notes');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
});

// ---- rating rendering ----------------------------------------------------

test('a labeled scale renders its wording, not bare numbers', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s2');
  player.state.currentPage = 2; // agreement-5
  player.render();
  assert.deepEqual(
    mount.querySelectorAll('.sowb-rating-label').map((n) => n.textContent),
    ['Strongly Agree', 'Agree', 'Neutral', 'Disagree', 'Strongly Disagree']
  );
  assert.equal(mount.querySelector('[data-rating-layout]').getAttribute('data-rating-layout'), 'listed');
  // The value badge accompanies the wording.
  assert.deepEqual(mount.querySelectorAll('.sowb-rating-value').map((n) => n.textContent), ['1', '2', '3', '4', '5']);
});

test('a short-labeled scale renders as compact chips with end captions', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s3');
  player.state.currentPage = 1; // numeric-5 with minLabel/maxLabel
  player.render();
  assert.equal(mount.querySelector('[data-rating-layout]').getAttribute('data-rating-layout'), 'compact');
  assert.deepEqual(mount.querySelectorAll('.sowb-rating-anchor').map((n) => n.textContent), ['Not at all', 'Expert']);
});

test('rating stores the scale VALUE, never the label', () => {
  const { player, mount, lms } = mkPlayer();
  player.openSection('s2');
  player.state.currentPage = 2;
  player.render();
  const radios = mount.querySelectorAll('[data-q="q_s2_3"]');
  assert.deepEqual(radios.map((r) => r.value), ['1', '2', '3', '4', '5']);
  radios[1].dispatch('change');
  assert.equal(player.state.responses.q_s2_3, '2');
  assert.ok(!lms.snapshot()['cmi.suspend_data'].includes('Agree'), 'labels never reach suspend data');
});

test('the rating accessible name carries both value and wording', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s2');
  player.state.currentPage = 2;
  player.render();
  assert.equal(mount.querySelectorAll('[data-q="q_s2_3"]')[1].getAttribute('aria-label'), '2, Agree');

  // For an unlabeled numeric scale, "1, 1" would be noise.
  player.openSection('s3');
  player.state.currentPage = 1;
  player.render();
  assert.equal(mount.querySelectorAll('[data-q="q_s3_2"]')[0].getAttribute('aria-label'), '1');
});

// ---- resume + review rewind ---------------------------------------------

test('resume ALWAYS lands on the section dashboard', () => {
  const lms = new MockLMS();
  let p = mkPlayer(runtimeWb, lms);
  p.player.openSection('s2');
  assert.equal(p.player.view, 'section');
  p.player.session.suspendAndExit();

  p = mkPlayer(runtimeWb, lms);
  assert.equal(p.player.view, 'dashboard');
  assert.equal(p.mount.querySelectorAll('.sowb-section-card').length, 4);
  assert.equal(p.player.state.currentSection, 's2', 'the cursor is preserved for Continue');
});

test('a COMPLETED section reopens at question 1 for review', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s1');
  player.session.setResponse('q_s1_1', '2026-09-14');
  player.nextPage();
  player.session.setResponse('q_s1_2', 'Notes.');
  player.nextPage();
  player.session.setResponse('q_s1_3', ['o_scope', 'o_safety']);
  assert.equal(player.state.currentPage, 2, 'left off on the last page');
  assert.equal(player.state.sectionStatus.s1, 'completed');

  player.goToDashboard();
  assert.equal(mount.querySelector('[data-open-section="s1"]').textContent, 'Review');
  player.openSection('s1');
  assert.equal(player.state.currentPage, 0, 'review starts at question 1');
});

test('an IN-PROGRESS section still resumes at its saved page', () => {
  const { player } = mkPlayer();
  player.openSection('s1');
  player.session.setResponse('q_s1_1', '2026-09-14');
  player.nextPage();
  assert.equal(player.state.currentPage, 1);
  assert.notEqual(player.state.sectionStatus.s1, 'completed');
  player.goToDashboard();
  player.openSection('s1');
  assert.equal(player.state.currentPage, 1, 'Continue lands in place');
});

// ---- learner name + PDF --------------------------------------------------

test('the header greets the learner by name, and omits the line when absent', () => {
  const named = mkPlayer(runtimeWb, new MockLMS({ learnerName: 'Quinn, Darryl' }));
  assert.equal(named.mount.querySelector('[data-learner-name]').textContent, 'Darryl Quinn');
  const anon = mkPlayer(runtimeWb, new MockLMS({ learnerName: '' }));
  assert.equal(anon.mount.querySelector('[data-learner-name]'), null);
});

test('the PDF button lives in the dashboard header, not the section view', () => {
  const { player, mount } = mkPlayer();
  const btn = mount.querySelector('[data-download-pdf]');
  assert.ok(btn, 'present on the dashboard');
  assert.ok(mount.querySelector('.sowb-header').querySelector('[data-download-pdf]'), 'inside the header');
  assert.equal(btn.getAttribute('aria-label'), 'Download all my responses as a PDF');
  assert.ok(btn.innerHTML.includes('<svg'), 'renders an inline SVG icon');

  player.openSection('s1');
  assert.equal(mount.querySelector('[data-download-pdf]'), null, 'hidden on the section view');
  player.goToDashboard();
  assert.ok(mount.querySelector('[data-download-pdf]'), 'back on the dashboard');
});

test('the PDF button is suppressed when the workbook disables it', () => {
  const off = clone(runtimeWb);
  off.settings.allowPdfDownload = false;
  const { mount } = mkPlayer(off);
  assert.equal(mount.querySelector('[data-download-pdf]'), null);
  assert.equal(mount.querySelector('[data-pdf-fallback]'), null, 'no fallback host either');
});

test('PDF export defaults ON for workbooks authored before the setting existed', () => {
  const legacy = clone(runtimeWb);
  delete legacy.settings.allowPdfDownload;
  const { player, mount } = mkPlayer(legacy);
  assert.equal(player.pdfEnabled, true);
  assert.ok(mount.querySelector('[data-download-pdf]'));
});

test('clicking the button downloads a whole-workbook PDF and offers a fallback', () => {
  const { player, mount } = mkPlayer();
  player.session.setResponse('q_s1_1', '2026-09-14');
  player.session.setResponse('q_s2_1', 'Dana Ruiz');
  player.render();

  const before = domBody.children.length;
  mount.querySelector('[data-download-pdf]').click();
  assert.equal(domBody.children.length, before, 'temporary anchor removed from the body');

  // The visible fallback exists for sandboxed iframes that block downloads.
  const fallback = mount.querySelector('[data-pdf-open]');
  assert.ok(fallback, 'fallback link rendered');
  assert.ok(String(fallback.getAttribute('href')).startsWith('blob:'));
  assert.equal(fallback.getAttribute('rel'), 'noopener noreferrer');

  const { bytes } = player.downloadResponsesPdf();
  const s = Buffer.from(bytes).toString('latin1');
  for (const title of SECTION_TITLES) assert.ok(s.includes(title), `${title} present in the PDF`);
  assert.ok(s.includes('Dana Ruiz'), 'answers from every section are included');
});

// ---- every question type renders ----------------------------------------

test('every question type renders without error', () => {
  const { player, mount } = mkPlayer();
  for (const section of runtimeWb.sections) {
    player.openSection(section.id);
    for (let i = 0; i < section.questions.length; i++) {
      assert.ok(mount.querySelector('.sowb-question'), `${section.id} page ${i} rendered`);
      player.nextPage();
    }
  }
});
