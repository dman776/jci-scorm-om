// @ts-check
/**
 * SCORM 2004 4th Edition export target. Given a workbook it produces the file
 * map for a self-contained content package (runtime + workbook.js + manifest).
 * Packaging into a ZIP is done by packager.js.
 */
import { assembleRuntime } from '@sowb/scorm-runtime';
import { buildManifest } from '../manifest.js';

/** @type {import('../index.js').ExportTarget} */
export const scorm2004Target = {
  id: 'scorm2004',
  label: 'SCORM 2004 4th Edition',
  async buildFileMap(workbook, opts = {}) {
    const runtime = await assembleRuntime(workbook, { debug: !!opts.debug });
    // The manifest must list every file in the package (except itself).
    return { ...runtime, 'imsmanifest.xml': buildManifest(workbook, Object.keys(runtime)) };
  },
};
