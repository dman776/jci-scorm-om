// @ts-check
/**
 * @typedef {Object} WorkbookSettings
 * @property {string} language
 * @property {'free'|'linear'} navigation
 * @property {'all-required-sections'} completionRule
 * @property {boolean} reportSuccess
 * @property {string} [dashboardHeading] Learner-facing heading on the section dashboard.
 */

/**
 * @typedef {Object} QuestionOption
 * @property {string} id
 * @property {string} label
 * @property {boolean} [expected] For checklist/multiple_select, the learner MUST
 *   select every expected option for the question to count as complete.
 */

/**
 * @typedef {Object} Question
 * @property {string} id
 * @property {string} type
 * @property {string} prompt
 * @property {boolean} required
 * @property {string} [helpText]
 * @property {QuestionOption[]} [options]
 * @property {(number|string)[]} [scale]  For rating questions.
 * @property {number} [min]  For numeric questions (inclusive).
 * @property {number} [max]  For numeric questions (inclusive).
 * @property {boolean} [integerOnly] For numeric questions.
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

/** A blank workbook used by the "New Workbook" action. */
export function blankWorkbook() {
  return {
    id: '',
    title: 'Untitled Observation Workbook',
    description: '',
    version: '1.0',
    author: '',
    courseId: '',
    estimatedDuration: '',
    settings: {
      language: 'en-US',
      navigation: 'free',
      completionRule: 'all-required-sections',
      reportSuccess: false,
      dashboardHeading: 'Your observation workbook',
    },
    sections: [],
  };
}
