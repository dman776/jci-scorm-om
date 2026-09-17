// @ts-check
/**
 * Runtime assembler. Produces the flat set of static files that make up the
 * learner runtime. This SAME set is used two ways:
 *   1. Served live by the authoring app for the Preview / Learner Simulation.
 *   2. Written into the exported SCORM ZIP at the package root.
 *
 * Because both paths call this function, the preview and the shipped package
 * are guaranteed to run byte-identical player code.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const TEMPLATE_DIR = join(ROOT, 'runtime-template');
const ENGINE_DIR = join(ROOT, 'packages', 'workbook-engine');

/**
 * @param {import('@sowb/shared').Workbook} workbook
 * @param {{ debug?: boolean }} [opts]
 * @returns {Promise<Record<string,string>>} map of relative path -> file content
 */
export async function assembleRuntime(workbook, opts = {}) {
  const [indexTmpl, adapterJs, sessionJs, playerJs, css, completionJs, suspendJs] = await Promise.all([
    readFile(join(TEMPLATE_DIR, 'index.html'), 'utf8'),
    readFile(join(TEMPLATE_DIR, 'js', 'adapter.js'), 'utf8'),
    readFile(join(TEMPLATE_DIR, 'js', 'session.js'), 'utf8'),
    readFile(join(TEMPLATE_DIR, 'js', 'player.js'), 'utf8'),
    readFile(join(TEMPLATE_DIR, 'css', 'player.css'), 'utf8'),
    readFile(join(ENGINE_DIR, 'completion.js'), 'utf8'),
    readFile(join(ENGINE_DIR, 'suspend.js'), 'utf8'),
  ]);

  const lang = (workbook.settings && workbook.settings.language) || 'en-US';
  const index = indexTmpl
    .replace(/{{LANG}}/g, escapeAttr(lang))
    .replace(/{{TITLE}}/g, escapeHtml(workbook.title || 'Observation Workbook'))
    .replace(/{{DEBUG}}/g, opts.debug ? 'true' : 'false');

  const workbookJs = `window.__WORKBOOK__ = ${JSON.stringify(workbook)};\n`;

  return {
    'index.html': index,
    'js/workbook.js': workbookJs,
    'js/adapter.js': adapterJs,
    'js/session.js': sessionJs,
    'js/player.js': playerJs,
    // Engine modules are copied verbatim (they are dependency-free) so the
    // browser can resolve ./engine/*.js with no bundler.
    'js/engine/completion.js': completionJs,
    'js/engine/suspend.js': suspendJs,
    'css/player.css': css,
  };
}

export const RUNTIME_STATIC_PATHS = [
  'index.html', 'js/adapter.js', 'js/session.js', 'js/player.js',
  'js/engine/completion.js', 'js/engine/suspend.js', 'css/player.css',
];

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/["'<>&]/g, (c) => ({ '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}
