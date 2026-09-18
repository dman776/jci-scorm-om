// @ts-check
/**
 * Shared, framework-free constants. Imported by both the Node authoring side
 * and the browser runtime player, so this file must stay dependency-free and
 * use only syntax valid in both environments.
 */

/** Supported question / response type ids. */
export const QUESTION_TYPES = Object.freeze([
  'short_text', 'long_text', 'yes_no', 'single_select', 'multiple_select',
  'rating', 'checklist', 'numeric', 'url', 'datetime', 'acknowledgement', 'evidence_ref',
]);

/** Types shipped in the MVP. Others are authorable but flagged as post-MVP. */
export const MVP_QUESTION_TYPES = Object.freeze([
  'short_text', 'long_text', 'yes_no', 'rating', 'checklist', 'numeric', 'url',
]);

/** Multi-choice types whose "expected" options gate completion. */
export const EXPECTED_GATED_TYPES = Object.freeze(['checklist', 'multiple_select']);

/**
 * Per-question response state. A question can be answered yet still not satisfy
 * its requirement (numeric below min, checklist missing an expected option,
 * malformed url), which is what PARTIAL represents.
 */
export const RESPONSE_STATE = Object.freeze({ EMPTY: 'empty', PARTIAL: 'partial', COMPLETE: 'complete' });

/** Section status model. */
export const SECTION_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  PARTIALLY_COMPLETE: 'partially_complete',
  COMPLETED: 'completed',
});

/** SCORM 2004 completion_status values used by the SCO. */
export const COMPLETION_STATUS = Object.freeze({ COMPLETED: 'completed', INCOMPLETE: 'incomplete', UNKNOWN: 'unknown' });
export const SUCCESS_STATUS = Object.freeze({ PASSED: 'passed', FAILED: 'failed', UNKNOWN: 'unknown' });
export const NAVIGATION = Object.freeze({ FREE: 'free', LINEAR: 'linear' });
export const COMPLETION_RULE = Object.freeze({ ALL_REQUIRED: 'all-required-sections' });

/**
 * SCORM 2004 4th Edition guarantees at least 64000 characters of
 * cmi.suspend_data. We budget conservatively and warn before the ceiling.
 */
export const SUSPEND_DATA_LIMIT = 64000;
export const SUSPEND_DATA_WARN_RATIO = 0.8;

/** Default learner-facing heading on the section dashboard. */
export const DEFAULT_DASHBOARD_HEADING = 'Your observation workbook';

/** Default workbook settings applied to a fresh workbook. */
export const DEFAULT_SETTINGS = Object.freeze({
  language: 'en-US',
  navigation: NAVIGATION.FREE,
  completionRule: COMPLETION_RULE.ALL_REQUIRED,
  reportSuccess: false,
  dashboardHeading: DEFAULT_DASHBOARD_HEADING,
  allowPdfDownload: true,
});

export const APP_NAME = 'SOWB-It';
/** What the name stands for, used wherever the tool introduces itself. */
export const APP_FULL_NAME = 'SCORM Observation Workbook Builder Internal Tool';
export const SCORM_VERSION = '2004 4th Edition';
