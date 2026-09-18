// @ts-check
/**
 * Regression tests for the rating wiring.
 *
 * These exist because rating.js sat in the repo unused: player.js still called
 * the old _ratingGroup, and assemble.js shipped neither rating.js nor the
 * scales engine shim. Each test below fails against that state.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assembleRuntime, RUNTIME_STATIC_PATHS } from '@sowb/scorm-runtime';
import { inlineScales } from '@sowb/shared/scales.js';
import { installFakeDom } from './helpers/fake-dom.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const loadWorkbook = async () => JSON.parse(await readFile(join(ROOT, 'samples', 'demo.workbook.json'), 'utf8'));

let WorkbookPlayer;
before(async () => {
  installFakeDom();
  ({ WorkbookPlayer } = await import('../runtime-template/js/player.js'));
});

// ---- the wiring itself ---------------------------------------------------

test('player.js delegates rating rendering to rating.js', async () => {
  const src = await readFile(join(ROOT, 'runtime-template', 'js', 'player.js'), 'utf8');
  assert.match(src, /import \{ renderRating \} from '\.\/rating\.js'/, 'imports the renderer');
  assert.match(src, /case 'rating':.*renderRating\(/s, 'the rating case calls it');
});

test('the old _ratingGroup is gone, not just bypassed', async () => {
  const src = await readFile(join(ROOT, 'runtime-template', 'js', 'player.js'), 'utf8');
  assert.ok(!src.includes('_ratingGroup'),
    'dead rating code left behind is a trap: it still looks authoritative and silently drops labels');
});

test('the package ships rating.js and the scales engine module', async () => {
  const files = await assembleRuntime(inlineScales(await loadWorkbook(), []));
  assert.ok(files['js/rating.js'], 'rating.js shipped');
  assert.ok(files['js/engine/scales.js'], 'scales shim shipped');
});

test('RUNTIME_STATIC_PATHS stays in step with what is emitted', async () => {
  const files = await assembleRuntime(inlineScales(await loadWorkbook(), []));
  const emitted = Object.keys(files).filter((n) => n !== 'js/workbook.js').sort();
  assert.deepEqual(emitted, [...RUNTIME_STATIC_PATHS].sort(),
    'the preview server serves from this list, so a mismatch 404s in Preview only');
});

test('every relative import inside the package resolves', async () => {
  const files = await assembleRuntime(inlineScales(await loadWorkbook(), []));
  for (const [path, source] of Object.entries(files)) {
    if (!path.endsWith('.js')) continue;
    for (const m of source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      const stack = path.split('/').slice(0, -1);
      for (const seg of m[1].split('/')) {
        if (seg === '.') continue;
        else if (seg === '..') stack.pop();
        else stack.push(seg);
      }
      assert.ok(files[stack.join('/')], `${path} imports ${m[1]} which is not in the package`);
    }
  }
});

test('the shipped scales module has no workspace imports', async () => {
  const files = await assembleRuntime(inlineScales(await loadWorkbook(), []));
  const src = files['js/engine/scales.js'];
  const specs = [...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const spec of specs) {
    assert.ok(spec.startsWith('./') || spec.startsWith('../'),
      `scales.js imports "${spec}"; the SCO is offline and cannot resolve workspace packages`);
  }
});

// ---- what the learner actually sees --------------------------------------

function renderPlayer(wb) {
  const mount = document.createElement('div');
  const player = new WorkbookPlayer({ mount, workbook: wb, adapter: stubAdapter() });
  player.init();
  player.openSection('s1');
  return { player, mount };
}

test('a labeled scale renders its wording, not bare numbers', async () => {
  const wb = inlineScales(await loadWorkbook(), []);
  const { mount } = renderPlayer(wb);
  const labels = mount.querySelectorAll('.sowb-rating-label').map((n) => n.textContent);
  assert.deepEqual(labels, ['Strongly Agree', 'Agree', 'Neutral', 'Disagree', 'Strongly Disagree'],
    'the old _ratingGroup rendered "1".."5" here');
  assert.equal(mount.querySelector('[data-rating-layout]').getAttribute('data-rating-layout'), 'listed');
});

test('the stored value is the scale value, never the label', async () => {
  const wb = inlineScales(await loadWorkbook(), []);
  const { player, mount } = renderPlayer(wb);
  const radios = mount.querySelectorAll('[data-q="q1"]');
  assert.deepEqual(radios.map((r) => r.value), ['5', '4', '3', '2', '1']);
  radios[1].dispatch('change');
  assert.equal(player.state.responses.q1, '4', 'stores the value');
});

test('a scaleId with no inline points still renders after publish', async () => {
  // This is the case the old code broke on: it read q.scale directly and fell
  // back to a hardcoded [1,2,3,4,5], losing the authored scale entirely.
  const wb = await loadWorkbook();
  assert.equal(wb.sections[0].questions[0].scale, undefined, 'authored with only a scaleId');
  const published = inlineScales(wb, []);
  const { mount } = renderPlayer(published);
  assert.equal(mount.querySelectorAll('.sowb-rating-label').length, 5);
});

test('a legacy inline scale still renders unchanged', async () => {
  const wb = inlineScales(await loadWorkbook(), []);
  const { player, mount } = renderPlayer(wb);
  player.state.currentPage = 2; // the Low/Medium/High question
  player.render();
  const radios = mount.querySelectorAll('[data-q="q3"]');
  assert.deepEqual(radios.map((r) => r.value), ['Low', 'Medium', 'High'],
    'legacy values stay strings so responses already in the LMS keep resolving');
});

function stubAdapter() {
  const data = {};
  return {
    initialize: () => true,
    getValue: (e) => data[e] || '',
    setValue: (e, v) => { data[e] = String(v); return 'true'; },
    commit: () => 'true',
    terminate: () => 'true',
    usingFallback: false,
    log: [],
  };
}
