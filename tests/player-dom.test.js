// @ts-check
/**
 * Headless DOM smoke test for the real WorkbookPlayer using a tiny fake DOM.
 * Playwright (tests/e2e/learner.spec.js) is the full browser check; this
 * catches render regressions without a browser.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installFakeDom } from './helpers/fake-dom.js';
import { MockLMS } from '@sowb/mock-lms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let WorkbookPlayer, ScormAdapter, workbook;

before(async () => {
  installFakeDom();
  ({ WorkbookPlayer } = await import('../runtime-template/js/player.js'));
  ({ ScormAdapter } = await import('../runtime-template/js/adapter.js'));
  workbook = JSON.parse(await readFile(join(ROOT, 'samples', 'ae-install-ride-along.workbook.json'), 'utf8'));
});

function mkPlayer(wb = workbook, lms = new MockLMS()) {
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

test('dashboard renders sections with status pills', () => {
  const { mount } = mkPlayer();
  assert.equal(mount.querySelectorAll('.sowb-section-card').length, 3);
  assert.equal(mount.querySelector('[data-section-status="s1"]').textContent, 'Not Started');
});

// ---- configurable heading -----------------------------------------------

test('dashboard heading uses the default when unset', () => {
  const wb = JSON.parse(JSON.stringify(workbook));
  delete wb.settings.dashboardHeading;
  const { mount } = mkPlayer(wb);
  assert.equal(mount.querySelector('[data-dashboard-heading]').textContent, 'Your observation workbook');
});

test('dashboard heading is author-configurable', () => {
  const wb = JSON.parse(JSON.stringify(workbook));
  wb.settings.dashboardHeading = 'Your Milestones';
  const { mount, player } = mkPlayer(wb);
  assert.equal(mount.querySelector('[data-dashboard-heading]').textContent, 'Your Milestones');
  assert.equal(player.dashboardHeading, 'Your Milestones');
});

test('a blank heading falls back to the default', () => {
  const wb = JSON.parse(JSON.stringify(workbook));
  wb.settings.dashboardHeading = '   ';
  const { mount } = mkPlayer(wb);
  assert.equal(mount.querySelector('[data-dashboard-heading]').textContent, 'Your observation workbook');
});

// ---- partial states in the UI -------------------------------------------

test('checklist missing an expected option shows a neutral partial hint', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s1');
  player.session.setResponse('q_s1_1', '2026-09-14');
  player.session.setResponse('q_s1_2', 'Notes.');
  player.state.currentPage = 2;
  player.render();

  // Select one expected option only.
  const boxes = mount.querySelectorAll('[data-q="q_s1_3"]');
  boxes[0].checked = true;
  boxes[0].dispatch('change');

  const status = mount.querySelector('[data-answer-status]');
  assert.equal(status.textContent, 'Some required items are not yet selected.');
  assert.ok(status.className.includes('partial'));
  // The hint must not reveal which options are expected.
  assert.ok(!status.textContent.includes('Safety plan'));

  player.goToDashboard();
  assert.equal(mount.querySelector('[data-section-status="s1"]').textContent, 'Partially Complete');
  assert.equal(mount.querySelector('[data-open-section="s1"]').textContent, 'Continue');
});

test('numeric below minimum shows the bound hint, and meeting it clears', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s2');
  player.state.currentPage = 1; // the numeric question
  player.render();

  type(mount, 'q_s2_2', '2');
  let status = mount.querySelector('[data-answer-status]');
  assert.equal(status.textContent, 'Enter at least 4.');
  assert.ok(status.className.includes('partial'));

  type(mount, 'q_s2_2', '4');
  status = mount.querySelector('[data-answer-status]');
  assert.equal(status.textContent, 'Answer saved');
  assert.ok(status.className.includes('ok'));
});

test('numeric input carries min and step attributes', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s2');
  player.state.currentPage = 1;
  player.render();
  const input = mount.querySelector('[data-q="q_s2_2"]');
  assert.equal(input.type, 'number');
  assert.equal(input.getAttribute('min'), '4');
  assert.equal(input.getAttribute('step'), '1', 'integerOnly -> step 1');
});

test('url question rejects malformed input and previews a valid link', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s3');
  player.state.currentPage = 2; // the url question
  player.render();

  type(mount, 'q_s3_3', 'notaurl');
  let status = mount.querySelector('[data-answer-status]');
  assert.equal(status.textContent, 'Enter a valid link starting with https://');

  type(mount, 'q_s3_3', 'https://jci.sharepoint.com/notes');
  status = mount.querySelector('[data-answer-status]');
  assert.equal(status.textContent, 'Answer saved');
  const link = mount.querySelector('[data-url-preview]');
  assert.equal(link.getAttribute('href'), 'https://jci.sharepoint.com/notes');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(link.getAttribute('target'), '_blank');
});

test('expected options are not visually marked for the learner', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s1');
  player.state.currentPage = 2;
  player.render();
  const labels = mount.querySelectorAll('.sowb-choice');
  // Every choice renders identically; nothing flags which are expected.
  for (const l of labels) {
    assert.ok(!l.className.includes('expected'));
    assert.ok(!l.textContent.includes('*'));
  }
});

// ---- resume --------------------------------------------------------------

test('resume ALWAYS lands on the section dashboard', () => {
  const lms = new MockLMS();
  let mount = document.createElement('div');
  let player = new WorkbookPlayer({ mount, workbook, adapter: new ScormAdapter({ api: lms.newAttempt() }), debug: false });
  player.init();
  player.openSection('s2');
  assert.equal(player.view, 'section');
  player.session.suspendAndExit();

  mount = document.createElement('div');
  player = new WorkbookPlayer({ mount, workbook, adapter: new ScormAdapter({ api: lms.newAttempt() }), debug: false });
  player.init();
  assert.equal(player.view, 'dashboard');
  assert.equal(mount.querySelectorAll('.sowb-section-card').length, 3);
  assert.equal(player.state.currentSection, 's2');
});

test('every question type renders without error', () => {
  const wb = {
    id: 'types', title: 'Types', version: '1.0',
    settings: { language: 'en-US', navigation: 'free', completionRule: 'all-required-sections', reportSuccess: false },
    sections: [{ id: 'sx', title: 'All', required: true, questions: [
      { id: 'a', type: 'short_text', prompt: 'a', required: true },
      { id: 'b', type: 'long_text', prompt: 'b', required: false },
      { id: 'c', type: 'yes_no', prompt: 'c', required: true },
      { id: 'd', type: 'rating', prompt: 'd', required: true, scale: [1, 2, 3, 4, 5] },
      { id: 'e', type: 'checklist', prompt: 'e', required: false, options: [{ id: 'o1', label: 'x', expected: true }, { id: 'o2', label: 'y' }] },
      { id: 'f', type: 'single_select', prompt: 'f', required: false, options: [{ id: 'o3', label: 'p' }, { id: 'o4', label: 'q' }] },
      { id: 'g', type: 'datetime', prompt: 'g', required: false },
      { id: 'h', type: 'acknowledgement', prompt: 'h', required: false },
      { id: 'i', type: 'numeric', prompt: 'i', required: true, min: 1, max: 10 },
      { id: 'j', type: 'url', prompt: 'j', required: false },
      { id: 'k', type: 'multiple_select', prompt: 'k', required: false, options: [{ id: 'o5', label: 'm' }, { id: 'o6', label: 'n' }] },
      { id: 'l', type: 'evidence_ref', prompt: 'l', required: false },
    ] }],
  };
  const { player, mount } = mkPlayer(wb);
  player.openSection('sx');
  for (let i = 0; i < wb.sections[0].questions.length; i++) {
    assert.ok(mount.querySelector('.sowb-question'), 'rendered page ' + i);
    player.nextPage();
  }
});
