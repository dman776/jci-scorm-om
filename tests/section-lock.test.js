// @ts-check
/**
 * Opt-in answer locking (`section.lockWhenComplete`).
 *
 * Covers the three layers the feature spans: the pure rule in the engine, the
 * commit + persistence in SessionCore, and the read-only rendering in the
 * player. The fixture turns the flag on for s1 only, so every test also proves
 * an unflagged section is untouched.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { shouldLockSection, isSectionLocked, validateWorkbook } from '@sowb/workbook-engine';
import { serializeState, deserializeState } from '@sowb/workbook-engine/suspend.js';
import { MockLMS } from '@sowb/mock-lms';
import { inlineScales } from '@sowb/shared/scales.js';
import { installFakeDom } from './helpers/fake-dom.js';
import { loadWorkbook, loadCustomScales, clone } from './helpers/workbook.js';

let SessionCore, ScormAdapter, WorkbookPlayer, lockWb;

before(async () => {
  installFakeDom();
  ({ SessionCore } = await import('../runtime-template/js/session.js'));
  ({ ScormAdapter } = await import('../runtime-template/js/adapter.js'));
  ({ WorkbookPlayer } = await import('../runtime-template/js/player.js'));
  // The runtime always sees scales already inlined by publish/preview.
  const wb = inlineScales(await loadWorkbook(), await loadCustomScales());
  lockWb = clone(wb);
  lockWb.sections[0].lockWhenComplete = true; // s1 only; s2..s4 stay editable.
});

const mkSession = (wb = lockWb, lms = new MockLMS()) => ({
  session: new SessionCore({ workbook: wb, adapter: new ScormAdapter({ api: lms.newAttempt() }) }),
  lms,
});

function mkPlayer(wb = lockWb, lms = new MockLMS()) {
  const mount = document.createElement('div');
  const player = new WorkbookPlayer({ mount, workbook: wb, adapter: new ScormAdapter({ api: lms.newAttempt() }) });
  player.init();
  return { player, mount, lms };
}

/** Every required answer in s1, which is what makes the section COMPLETED. */
function completeS1(target) {
  target.setResponse('q_s1_1', '2026-09-14');
  target.setResponse('q_s1_2', 'Reviewed scope, safety, roles and schedule.');
  target.setResponse('q_s1_3', ['o_scope', 'o_safety']);
}

// ---- the pure rule -------------------------------------------------------

test('the lock rule needs both the flag and a completed status', () => {
  const on = { id: 's1', lockWhenComplete: true };
  const off = { id: 's1' };
  assert.equal(shouldLockSection(on, 'completed'), true);
  assert.equal(shouldLockSection(on, 'partially_complete'), false);
  assert.equal(shouldLockSection(on, 'in_progress'), false);
  assert.equal(shouldLockSection(off, 'completed'), false, 'locking is opt-in');
  assert.equal(shouldLockSection(undefined, 'completed'), false);
});

test('a section is locked only once its id has been committed', () => {
  const section = { id: 's1', lockWhenComplete: true };
  assert.equal(isSectionLocked(section, 'completed', []), false, 'completed is not yet committed');
  assert.equal(isSectionLocked(section, 'completed', ['s1']), true);
  assert.equal(isSectionLocked(section, 'completed', undefined), false);
});

test('a committed lock lifts if the author republishes with more required work', () => {
  // Otherwise the learner is stranded: a section frozen below COMPLETED can
  // never finish, so the workbook can never report complete.
  const section = { id: 's1', lockWhenComplete: true };
  assert.equal(isSectionLocked(section, 'in_progress', ['s1']), false);
  // Same for dropping the flag entirely on republish.
  assert.equal(isSectionLocked({ id: 's1' }, 'completed', ['s1']), false);
});

// ---- committing the lock -------------------------------------------------

test('answers stay editable while the learner is still inside the section', () => {
  const { session } = mkSession();
  session.init();
  session.openSection('s1');
  completeS1(session);

  assert.equal(session.state.sectionStatus.s1, 'completed');
  assert.equal(session.isLocked('s1'), false, 'still inside, so still editable');
  // The whole point: the answer that completed the section can still be fixed.
  session.setResponse('q_s1_2', 'Corrected after a typo.');
  assert.equal(session.state.responses.q_s1_2, 'Corrected after a typo.');
});

test('leaving a completed section commits the lock', () => {
  const { session } = mkSession();
  session.init();
  session.openSection('s1');
  completeS1(session);
  session.closeSection();

  assert.equal(session.isLocked('s1'), true);
  assert.deepEqual(session.state.lockedSections, ['s1']);
});

test('leaving an incomplete section commits nothing', () => {
  const { session } = mkSession();
  session.init();
  session.openSection('s1');
  session.setResponse('q_s1_1', '2026-09-14');
  session.closeSection();

  assert.equal(session.isLocked('s1'), false);
  assert.deepEqual(session.state.lockedSections, []);
});

test('moving straight to another section still counts as leaving', () => {
  const { session } = mkSession();
  session.init();
  session.openSection('s1');
  completeS1(session);
  session.openSection('s2');

  assert.equal(session.isLocked('s1'), true);
});

test('exiting from inside a completed section commits the lock', () => {
  const { session } = mkSession();
  session.init();
  session.openSection('s1');
  completeS1(session);
  session.suspendAndExit();

  assert.equal(session.isLocked('s1'), true);
});

test('a section without the flag never locks', () => {
  const { session } = mkSession();
  session.init();
  session.openSection('s2');
  session.setResponse('q_s2_1', 'Dana Ruiz');
  session.setResponse('q_s2_2', '6');
  session.setResponse('q_s2_3', '4');
  session.setResponse('q_s2_4', '5');
  session.closeSection();

  assert.equal(session.state.sectionStatus.s2, 'completed');
  assert.equal(session.isLocked('s2'), false);
  assert.deepEqual(session.state.lockedSections, []);
});

// ---- enforcement ---------------------------------------------------------

test('a locked section refuses every write', () => {
  const { session } = mkSession();
  session.init();
  session.openSection('s1');
  completeS1(session);
  session.closeSection();

  const before = session.state.responses.q_s1_2;
  const result = session.setResponse('q_s1_2', 'A later edit that must not land.');
  assert.equal(result.locked, true, 'the caller is told the write was refused');
  assert.equal(session.state.responses.q_s1_2, before, 'the stored answer is unchanged');
});

test('locking one section leaves the others writable', () => {
  const { session } = mkSession();
  session.init();
  session.openSection('s1');
  completeS1(session);
  session.closeSection();

  session.openSection('s2');
  session.setResponse('q_s2_1', 'Dana Ruiz');
  assert.equal(session.state.responses.q_s2_1, 'Dana Ruiz');
});

test('reopening a locked section still lets the learner read it', () => {
  const { session } = mkSession();
  session.init();
  session.openSection('s1');
  completeS1(session);
  session.closeSection();

  assert.equal(session.openSection('s1'), true, 'a locked section is still openable');
  assert.equal(session.state.currentSection, 's1');
});

// ---- persistence ---------------------------------------------------------

test('a lock survives suspend and resume', async () => {
  const lms = new MockLMS();
  const first = mkSession(lockWb, lms).session;
  first.init();
  first.openSection('s1');
  completeS1(first);
  first.closeSection();
  first.suspendAndExit();

  const resumed = mkSession(lockWb, lms).session;
  assert.equal(resumed.init().entry, 'resume');
  assert.equal(resumed.isLocked('s1'), true, 'the learner cannot edit by relaunching');
  const before = resumed.state.responses.q_s1_2;
  resumed.setResponse('q_s1_2', 'Edited after relaunch.');
  assert.equal(resumed.state.responses.q_s1_2, before);
});

test('suspend data round-trips the locked set', () => {
  const state = { currentSection: 's1', currentPage: 0, responses: {}, sectionStatus: {}, lockedSections: ['s1'] };
  assert.deepEqual(deserializeState(serializeState(state)).lockedSections, ['s1']);
});

test('suspend data written before this feature resumes unlocked', () => {
  // A v2 payload carries no `l` key at all.
  const v2 = JSON.stringify({ v: 2, cs: 's1', cp: 0, r: { q_s1_1: '2026-09-14' }, ss: { s1: 'c' } });
  const restored = deserializeState(v2);
  assert.deepEqual(restored.lockedSections, []);
  assert.equal(restored.responses.q_s1_1, '2026-09-14', 'the rest still restores');
});

// ---- the learner's view --------------------------------------------------

test('a locked section renders read-only with an explanation', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s1');
  completeS1(player);
  player.goToDashboard();
  player.openSection('s1');

  assert.ok(mount.querySelector('[data-locked-banner]'), 'the learner is told why');
  const input = mount.querySelector('[data-q="q_s1_1"]');
  assert.equal(input.disabled, true, 'the control is inert');
});

test('an unlocked section renders its controls as usual', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s1');
  player.setResponse('q_s1_1', '2026-09-14');
  player.render();

  assert.equal(mount.querySelector('[data-locked-banner]'), null);
  assert.equal(mount.querySelector('[data-q="q_s1_1"]').disabled, false);
});

test('a change fired on a locked control cannot alter the stored answer', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s1');
  completeS1(player);
  player.goToDashboard();
  player.openSection('s1');

  const input = mount.querySelector('[data-q="q_s1_1"]');
  input.value = '2026-12-25';
  input.dispatch('input');
  assert.equal(player.state.responses.q_s1_1, '2026-09-14', 'the session refuses the write');
});

test('the dashboard says which sections are final, and still offers Review', () => {
  const { player, mount } = mkPlayer();
  player.openSection('s1');
  completeS1(player);
  player.goToDashboard();

  assert.ok(mount.querySelector('[data-section-locked="s1"]'), 's1 is marked locked');
  assert.equal(mount.querySelector('[data-section-locked="s2"]'), null, 's2 is not');
  const open = mount.querySelector('[data-open-section="s1"]');
  assert.equal(open.disabled, false, 'a locked section can still be reopened');
  assert.equal(open.textContent, 'Review');
});

// ---- authoring guardrail -------------------------------------------------

test('locking a section with no required questions warns the author', async () => {
  const wb = clone(await loadWorkbook());
  const section = wb.sections[0];
  section.lockWhenComplete = true;
  for (const q of section.questions) q.required = false;

  const { warnings } = validateWorkbook(wb, { customScales: await loadCustomScales() });
  assert.ok(warnings.some((w) => w.code === 'lock-no-required-questions'),
    'such a section locks on the first answer, stranding the rest blank');
});
