// @ts-check
/**
 * Runtime assembler. Produces the flat set of static files that make up the
 * learner runtime. This SAME set is used two ways:
 *   1. Served live by the authoring app for the Preview / Learner Simulation.
 *   2. Written into the exported SCORM ZIP at the package root.
 *
 * Because both paths call this function, the preview and the shipped package
 * are guaranteed to run byte-identical player code.
 *
 * The js/engine/*.js entries are copied from the workspace packages,
 * NOT from runtime-template/js/engine (those are Node-resolution shims). The
 * copied files are dependency-free, so the browser resolves them with no
 * bundler and the offline SCO never needs a workspace package.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEMPLATE_DIR = join(ROOT, 'runtime-template');
const ENGINE_DIR = join(ROOT, 'packages', 'workbook-engine');
const SHARED_DIR = join(ROOT, 'packages', 'shared');

/**
 * @param {any} workbook
 * @param {{ debug?: boolean }} [opts]
 * @returns {Promise<Record<string,string>>} map of relative path -> file content
 */
export async function assembleRuntime(workbook, opts = {}) {
  const read = (p) => readFile(p, 'utf8');
  const [
    indexTmpl, adapterJs, sessionJs, playerJs, ratingJs, pdfJs, reportJs, css,
    completionJs, suspendJs, interactionsJs, scalesJs,
  ] = await Promise.all([
    read(join(TEMPLATE_DIR, 'index.html')),
    read(join(TEMPLATE_DIR, 'js', 'adapter.js')),
    read(join(TEMPLATE_DIR, 'js', 'session.js')),
    read(join(TEMPLATE_DIR, 'js', 'player.js')),
    read(join(TEMPLATE_DIR, 'js', 'rating.js')),
    read(join(TEMPLATE_DIR, 'js', 'pdf.js')),
    read(join(TEMPLATE_DIR, 'js', 'report.js')),
    read(join(TEMPLATE_DIR, 'css', 'player.css')),
    read(join(ENGINE_DIR, 'completion.js')),
    read(join(ENGINE_DIR, 'suspend.js')),
    read(join(ENGINE_DIR, 'interactions.js')),
    read(join(SHARED_DIR, 'scales.js')),
  ]);

  const lang = (workbook.settings && workbook.settings.language) || 'en-US';
  const index = indexTmpl
    .replace(/{{LANG}}/g, escapeAttr(lang))
    .replace(/{{TITLE}}/g, escapeHtml(workbook.title || 'Observation Workbook'))
    .replace(/{{DEBUG}}/g, opts.debug ? 'true' : 'false');

  return {
    'index.html': index,
    'js/workbook.js': `window.__WORKBOOK__ = ${JSON.stringify(workbook)};\n`,
    'js/adapter.js': adapterJs,
    'js/session.js': sessionJs,
    'js/player.js': playerJs,
    'js/rating.js': ratingJs,
    'js/pdf.js': pdfJs,
    'js/report.js': reportJs,
    'js/engine/completion.js': completionJs,
    'js/engine/suspend.js': suspendJs,
    'js/engine/interactions.js': interactionsJs,
    'js/engine/scales.js': scalesJs,
    'css/player.css': css,
  };
}

/**
 * Static runtime paths (everything except the per-workbook workbook.js). The
 * preview server serves from this list, so it must stay in step with what
 * assembleRuntime emits; a test asserts that.
 */
export const RUNTIME_STATIC_PATHS = [
  'index.html',
  'js/adapter.js',
  'js/session.js',
  'js/player.js',
  'js/rating.js',
  'js/pdf.js',
  'js/report.js',
  'js/engine/completion.js',
  'js/engine/suspend.js',
  'js/engine/interactions.js',
  'js/engine/scales.js',
  'css/player.css',
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/["'<>&]/g, (c) => ({ '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}
