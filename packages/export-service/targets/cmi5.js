// @ts-check
/**
 * cmi5 export target (FORWARD-COMPATIBILITY STUB, not built in the MVP).
 *
 * The export-target abstraction exists so the SAME authored workbook JSON can
 * later publish to cmi5 without re-authoring. A cmi5 package would instead emit:
 *   - a cmi5.xml course structure (AU per workbook, or block/AU per section),
 *   - the same static runtime, swapping the SCORM adapter for an xAPI/AICC
 *     Launch adapter that reads the launch query (endpoint, auth, actor,
 *     registration) and PUTs the state document + POSTs xAPI statements,
 *   - one xAPI statement per observed activity, referencing externally stored
 *     evidence by IRI (never embedding binaries), enabling manager verification.
 *
 * Because the authoring model already keeps prompts/options out of suspend data
 * and treats evidence as metadata-only, no authoring changes are required to
 * add this target later. It is intentionally not registered in the MVP.
 */

/** @type {import('../index.js').ExportTarget} */
export const cmi5Target = {
  id: 'cmi5',
  label: 'cmi5 (planned)',
  async buildFileMap() {
    throw new Error('cmi5 export target is not implemented in the MVP. See targets/cmi5.js for the planned design.');
  },
};
