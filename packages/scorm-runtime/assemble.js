// @ts-check
/**
 * Runtime assembler. Produces the flat set of static files that make up the
 * learner runtime, used two ways:
 *   1. Served live by the authoring app for the Preview / Learner Simulation.
 *   2. Written into the exported SCORM ZIP at the package root.
 * Both paths call this function, so preview and the shipped package run
 * byte-identical player code.
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
 * @returns {Promise<Record<string,string>>}
 */
export async function assembleRuntime(workbook, opts = {}) {
  const read = (p) => readFile(p, 'utf8');
  const [indexTmpl, adapterJs, sessionJs, playerJs, pdfJs, reportJs, css, completionJs, suspendJs] = await Promise.all([
    read(join(TEMPLATE_DIR, 'index.html')),
    read(join(TEMPLATE_DIR, 'js', 'adapter.js')),
    read(join(TEMPLATE_DIR, 'js', 'session.js')),
    read(join(TEMPLATE_DIR, 'js', 'player.js')),
    read(join(TEMPLATE_DIR, 'js', 'pdf.js')),
    read(join(TEMPLATE_DIR, 'js', 'report.js')),
    read(join(TEMPLATE_DIR, 'css', 'player.css')),
    read(join(ENGINE_DIR, 'completion.js')),
    read(join(ENGINE_DIR, 'suspend.js')),
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
    'js/pdf.js': pdfJs,
    'js/report.js': reportJs,
    // Engine modules are copied verbatim (dependency-free) so the browser can
    // resolve ./engine/*.js with no bundler.
    'js/engine/completion.js': completionJs,
    'js/engine/suspend.js': suspendJs,
    'css/player.css': css,
  };
}

export const RUNTIME_STATIC_PATHS = [
  'index.html', 'js/adapter.js', 'js/session.js', 'js/player.js',
  'js/pdf.js', 'js/report.js', 'js/engine/completion.js', 'js/engine/suspend.js', 'css/player.css',
];

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeAttr(s) { return String(s).replace(/["'<>&]/g, (c) => ({ '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
