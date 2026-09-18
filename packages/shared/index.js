// @ts-check
/**
 * @typedef {Object} WorkbookSettings
 * @property {string} language
 * @property {'free'|'linear'} navigation
 * @property {'all-required-sections'} completionRule
 * @property {boolean} reportSuccess
 * @property {string} [dashboardHeading] Learner-facing heading on the section dashboard.
 * @property {boolean} [allowPdfDownload] Show the learner a "download my responses" PDF button.
 */

/**
 * @typedef {Object} QuestionOption
 * @property {string} id
 * @property {string} label
 * @property {boolean} [expected] For checklist/multiple_select the learner MUST select every expected option.
 */

/**
 * @typedef {Object} Question
 * @property {string} id
 * @property {string} type
 * @property {string} prompt
 * @property {boolean} required
 * @property {string} [helpText]
 * @property {QuestionOption[]} [options]
 * @property {string} [scaleId] Rating: id of a library scale.
 * @property {any[]} [scale] Rating: inline points (custom, or inlined at publish).
 * @property {string} [scaleName] Rating: snapshot of the library scale's name.
 * @property {string} [minLabel] Rating: caption under the low end of a compact scale.
 * @property {string} [maxLabel] Rating: caption under the high end.
 * @property {number} [min] Numeric: inclusive lower bound.
 * @property {number} [max] Numeric: inclusive upper bound.
 * @property {boolean} [integerOnly] Numeric: reject decimals.
 */

/**
 * @typedef {Object} Section
 * @property {string} id
 * @property {string} title
 * @property {boolean} required
 * @property {Question[]} questions
 */

/**
 * @typedef {Object} Workbook
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} version
 * @property {string} [author]
 * @property {string} [courseId]
 * @property {string} [estimatedDuration]
 * @property {WorkbookSettings} settings
 * @property {Section[]} sections
 */

/**
 * @typedef {Object} LearnerState
 * @property {string} currentSection
 * @property {number} currentPage
 * @property {Record<string, any>} responses
 * @property {Record<string, string>} sectionStatus
 */

export * from './constants.js';
export * from './ids.js';
export * from './scales.js';

/** A blank workbook used by the "New Workbook" action. */
export function blankWorkbook() {
  return {
    id: '', title: 'Untitled Observation Workbook', description: '', version: '1.0',
    author: '', courseId: '', estimatedDuration: '',
    settings: {
      language: 'en-US', navigation: 'free', completionRule: 'all-required-sections',
      reportSuccess: false, dashboardHeading: 'Your observation workbook', allowPdfDownload: true,
    },
    sections: [],
  };
}
