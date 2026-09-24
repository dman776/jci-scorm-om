// @ts-check
/**
 * Export service public API. Owns the export-target registry so a future cmi5
 * target can be added without changing callers.
 *
 * @typedef {Object} ExportTarget
 * @property {string} id
 * @property {string} label
 * @property {(workbook: any, opts?: {debug?:boolean}) => Promise<Record<string,string>>} buildFileMap
 */
import { validateWorkbook, estimateSuspendSize } from '@sowb/workbook-engine';
import { inlineScales } from '@sowb/shared/scales.js';
import { scorm2004Target } from './targets/scorm2004.js';
import { zipFileMap } from './packager.js';

/** @type {Record<string, ExportTarget>} */
const TARGETS = {
  [scorm2004Target.id]: scorm2004Target,
  // cmi5Target intentionally NOT registered in the MVP.
};

export function getTarget(id) {
  const t = TARGETS[id];
  if (!t) throw new Error(`Unknown export target "${id}". Available: ${Object.keys(TARGETS).join(', ')}`);
  return t;
}
export function listTargets() { return Object.values(TARGETS).map((t) => ({ id: t.id, label: t.label })); }

/**
 * Full publish pipeline: resolve scales -> validate -> build file map -> zip.
 *
 * Scale resolution happens HERE, not in the runtime: the exported SCO is
 * offline and can never look a scale up, so every rating question's points are
 * inlined before the package is built.
 *
 * @param {any} workbook
 * @param {{ target?: string, debug?: boolean, customScales?: any[], now?: Date }} [opts]
 */
export async function publishWorkbook(workbook, opts = {}) {
  const target = getTarget(opts.target || 'scorm2004');
  const customScales = opts.customScales || [];

  // Validate the AUTHORED workbook so a dangling scaleId is reported against
  // what the author actually wrote.
  const estimatedSuspendSize = estimateWorstCaseSuspend(workbook, customScales);
  const report = validateWorkbook(workbook, { estimatedSuspendSize, customScales });
  if (!report.ok) {
    const err = new Error('Workbook failed validation and cannot be exported.');
    /** @type {any} */ (err).report = report;
    throw err;
  }

  const resolved = inlineScales(workbook, customScales);
  const fileMap = await target.buildFileMap(resolved, { debug: !!opts.debug });
  const zip = await zipFileMap(fileMap);
  const zipName = `${(workbook.courseId || workbook.id || 'observation-workbook')}_SCORM2004_${localDate(opts.now || new Date())}.zip`;
  return { zip, zipName, fileMap, report, target: target.id, workbook: resolved };
}

/** YYYY-MM-DD in local time, so an evening export is not stamped tomorrow. */
export function localDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Rough worst-case suspend estimate: assume every question answered with a
 * medium value. Good enough to warn authors before real usage.
 */
export function estimateWorstCaseSuspend(workbook, customScales = []) {
  const resolved = inlineScales(workbook, customScales);
  /** @type {Record<string, any>} */
  const responses = {};
  /** @type {Record<string, string>} */
  const sectionStatus = {};
  for (const s of resolved.sections || []) {
    sectionStatus[s.id] = 'in_progress';
    for (const q of s.questions || []) {
      if (q.type === 'long_text') responses[q.id] = 'x'.repeat(400);
      else if (q.type === 'short_text') responses[q.id] = 'x'.repeat(80);
      else if (q.type === 'url') responses[q.id] = 'https://example.sharepoint.com/' + 'x'.repeat(80);
      else if (q.type === 'multiple_select' || q.type === 'checklist') responses[q.id] = (q.options || []).map((o) => o.id);
      else if (q.type === 'rating') responses[q.id] = String((q.scale && q.scale[0] && q.scale[0].value) || '1');
      else responses[q.id] = 'xxxxxxxx';
    }
  }
  return estimateSuspendSize({
    currentSection: (resolved.sections[0] || {}).id || '',
    currentPage: 0,
    responses,
    sectionStatus,
  });
}

export { validateWorkbook } from '@sowb/workbook-engine';
export { zipFileMap, unzipToMap } from './packager.js';
export { buildManifest } from './manifest.js';
