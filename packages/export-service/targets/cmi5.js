// @ts-check
/**
 * cmi5 export target (FORWARD-COMPATIBILITY STUB, not built in the MVP).
 *
 * The export-target abstraction exists so the SAME authored workbook JSON can
 * later publish to cmi5 without re-authoring. A cmi5 package would emit a
 * cmi5.xml course structure and swap the SCORM adapter for an xAPI/AICC launch
 * adapter, referencing evidence by IRI rather than embedding binaries.
 *
 * Intentionally not registered in the MVP.
 */
/** @type {import('../index.js').ExportTarget} */
export const cmi5Target = {
  id: 'cmi5',
  label: 'cmi5 (planned)',
  async buildFileMap() {
    throw new Error('cmi5 export target is not implemented in the MVP. See targets/cmi5.js for the planned design.');
  },
};
