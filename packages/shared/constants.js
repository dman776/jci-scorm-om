// @ts-check
/** Shared, framework-free constants. Runs in Node AND the browser. */

export const QUESTION_TYPES = Object.freeze([
  'short_text', 'long_text', 'yes_no', 'single_select', 'multiple_select',
  'rating', 'checklist', 'numeric', 'url', 'datetime', 'acknowledgement', 'evidence_ref',
]);

export const MVP_QUESTION_TYPES = Object.freeze([
  'short_text', 'long_text', 'yes_no', 'rating', 'checklist', 'numeric', 'url',
]);

/** Multi-choice types whose "expected" options gate completion. */
export const EXPECTED_GATED_TYPES = Object.freeze(['checklist', 'multiple_select']);

export const RESPONSE_STATE = Object.freeze({ EMPTY: 'empty', PARTIAL: 'partial', COMPLETE: 'complete' });

export const SECTION_STATUS = Object.freeze({
  NOT_STARTED: 'not_started', IN_PROGRESS: 'in_progress',
  PARTIALLY_COMPLETE: 'partially_complete', COMPLETED: 'completed',
});

export const COMPLETION_STATUS = Object.freeze({ COMPLETED: 'completed', INCOMPLETE: 'incomplete', UNKNOWN: 'unknown' });
export const SUCCESS_STATUS = Object.freeze({ PASSED: 'passed', FAILED: 'failed', UNKNOWN: 'unknown' });
export const NAVIGATION = Object.freeze({ FREE: 'free', LINEAR: 'linear' });
export const COMPLETION_RULE = Object.freeze({ ALL_REQUIRED: 'all-required-sections' });

export const SUSPEND_DATA_LIMIT = 64000;
export const SUSPEND_DATA_WARN_RATIO = 0.8;

/** Default learner-facing heading on the section dashboard. */
export const DEFAULT_DASHBOARD_HEADING = 'Your observation workbook';

export const DEFAULT_SETTINGS = Object.freeze({
  language: 'en-US',
  navigation: NAVIGATION.FREE,
  completionRule: COMPLETION_RULE.ALL_REQUIRED,
  reportSuccess: false,
  dashboardHeading: DEFAULT_DASHBOARD_HEADING,
  allowPdfDownload: true,
});

export const RATING_SCALES = Object.freeze({ '1-5': [1, 2, 3, 4, 5], 'Low|Medium|High': ['Low', 'Medium', 'High'] });
export const APP_NAME = 'SCORM Observation Workbook Builder';
export const SCORM_VERSION = '2004 4th Edition';
