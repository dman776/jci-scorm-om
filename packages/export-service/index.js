// @ts-check
/**
 * Export service public API. Owns the export-target registry so a future cmi5
 * target can be added without changing callers.
 *
 * @typedef {Object} ExportTarget
 * @property {string} id
 * @property {string} label
 * @property {(workbook: import('@sowb/shared').Workbook, opts?: {debug?:boolean}) => Promise<Record<string,string>>} buildFileMap
 */

import { validateWorkbook, estimateSuspendSize } from '@sowb/workbook-engine';
import { scorm2004Target } from './targets/scorm2004.js';
import { zipFileMap } from './packager.js';

/** @type {Record<string, ExportTarget>} */
const TARGETS = {
  [scorm2004Target.id]: scorm2004Target,
  // cmi5Target intentionally NOT registered in the MVP.
};

/** @param {string} id */
export function getTarget(id) {
  const t = TARGETS[id];
  if (!t) throw new Error(`Unknown export target "${id}". Available: ${Object.keys(TARGETS).join(', ')}`);
  return t;
}

export function listTargets() {
  return Object.values(TARGETS).map((t) => ({ id: t.id, label: t.label }));
}

/**
 * Full publish pipeline: validate -> build file map -> zip.
 * @param {import('@sowb/shared').Workbook} workbook
 * @param {{ target?: string, debug?: boolean }} [opts]
 */
export async function publishWorkbook(workbook, opts = {}) {
  const targetId = opts.target || 'scorm2004';
  const target = getTarget(targetId);

  const estimatedSuspendSize = estimateWorstCaseSuspend(workbook);
  const report = validateWorkbook(workbook, { estimatedSuspendSize });
  if (!report.ok) {
    const err = new Error('Workbook failed validation and cannot be exported.');
    /** @type {any} */ (err).report = report;
    throw err;
  }

  const fileMap = await target.buildFileMap(workbook, { debug: !!opts.debug });
  const zip = await zipFileMap(fileMap);
  const zipName = `${(workbook.courseId || workbook.id || 'observation-workbook')}_SCORM2004.zip`;

  return { zip, zipName, fileMap, report, target: targetId };
}

/**
 * Rough worst-case suspend estimate: assume every question answered with a
 * medium value. Good enough to warn authors before real usage.
 * @param {import('@sowb/shared').Workbook} workbook
 */
export function estimateWorstCaseSuspend(workbook) {
  /** @type {Record<string, any>} */
  const responses = {};
  /** @type {Record<string, string>} */
  const sectionStatus = {};
  for (const s of workbook.sections || []) {
    sectionStatus[s.id] = 'in_progress';
    for (const q of s.questions || []) {
      if (q.type === 'long_text') responses[q.id] = 'x'.repeat(400);
      else if (q.type === 'short_text') responses[q.id] = 'x'.repeat(80);
      else if (q.type === 'url') responses[q.id] = 'https://example.sharepoint.com/' + 'x'.repeat(80);
      else if (q.type === 'multiple_select' || q.type === 'checklist') responses[q.id] = (q.options || []).map((o) => o.id);
      else responses[q.id] = 'xxxxxxxx';
    }
  }
  return estimateSuspendSize({
    currentSection: (workbook.sections[0] || {}).id || '',
    currentPage: 0,
    responses,
    sectionStatus,
  });
}

export { validateWorkbook } from '@sowb/workbook-engine';
export { zipFileMap, unzipToMap } from './packager.js';
export { buildManifest } from './manifest.js';
