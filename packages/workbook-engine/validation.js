// @ts-check
/**
 * Workbook validation. Produces structured errors (block export) and warnings
 * (advisory). Pure and dependency-free.
 */

import {
  QUESTION_TYPES, SUSPEND_DATA_LIMIT, SUSPEND_DATA_WARN_RATIO, EXPECTED_GATED_TYPES,
} from '@sowb/shared/constants.js';

const CHOICE_TYPES = ['single_select', 'multiple_select', 'checklist'];

/**
 * @param {import('@sowb/shared').Workbook} workbook
 * @param {{ estimatedSuspendSize?: number }} [opts]
 * @returns {{ ok: boolean, errors: {code:string,message:string,ref?:string}[], warnings: {code:string,message:string,ref?:string}[] }}
 */
export function validateWorkbook(workbook, opts = {}) {
  /** @type {{code:string,message:string,ref?:string}[]} */
  const errors = [];
  /** @type {{code:string,message:string,ref?:string}[]} */
  const warnings = [];

  if (!workbook || typeof workbook !== 'object') {
    return { ok: false, errors: [{ code: 'no-workbook', message: 'No workbook provided.' }], warnings };
  }

  if (!workbook.title || !workbook.title.trim()) {
    errors.push({ code: 'missing-title', message: 'Workbook must have a title.' });
  }

  const sections = workbook.sections || [];
  if (sections.length === 0) {
    errors.push({ code: 'no-sections', message: 'Workbook must contain at least one section.' });
  }

  const seenSectionIds = new Set();
  for (const section of sections) {
    if (seenSectionIds.has(section.id)) {
      errors.push({ code: 'dup-section-id', message: `Duplicate section id "${section.id}".`, ref: section.id });
    }
    seenSectionIds.add(section.id);
  }

  const requiredSections = sections.filter((s) => s.required);
  if (sections.length > 0 && requiredSections.length === 0) {
    errors.push({ code: 'no-required-section', message: 'Workbook has no required sections, so completion can never be reached.' });
  }

  const seenQuestionIds = new Set();
  for (const section of sections) {
    const questions = section.questions || [];
    if (questions.length === 0) {
      errors.push({ code: 'empty-section', message: `Section "${section.title || section.id}" has no questions.`, ref: section.id });
    }

    const requiredQuestions = questions.filter((q) => q.required);
    if (section.required && questions.length > 0 && requiredQuestions.length === 0) {
      warnings.push({
        code: 'required-section-no-required-questions',
        message: `Required section "${section.title || section.id}" contains only optional questions; it will auto-complete on any answer.`,
        ref: section.id,
      });
    }

    for (const q of questions) {
      if (seenQuestionIds.has(q.id)) {
        errors.push({ code: 'dup-question-id', message: `Duplicate question id "${q.id}".`, ref: q.id });
      }
      seenQuestionIds.add(q.id);

      if (!q.type || !QUESTION_TYPES.includes(q.type)) {
        errors.push({ code: 'bad-question-type', message: `Question "${q.id}" has an invalid or missing response type.`, ref: q.id });
      }
      if (!q.prompt || !q.prompt.trim()) {
        errors.push({ code: 'missing-prompt', message: `Question "${q.id}" is missing a prompt.`, ref: q.id });
      }

      if (CHOICE_TYPES.includes(q.type)) {
        const options = q.options || [];
        if (options.length < 2) {
          errors.push({ code: 'choice-needs-options', message: `Choice question "${q.id}" needs at least two options.`, ref: q.id });
        }
      }

      if (q.type === 'rating' && (!q.scale || q.scale.length < 2)) {
        errors.push({ code: 'rating-needs-scale', message: `Rating question "${q.id}" needs a scale of at least two points.`, ref: q.id });
      }

      // ---- numeric bounds ----
      if (q.type === 'numeric') {
        const hasMin = isNum(q.min);
        const hasMax = isNum(q.max);
        if (hasMin && hasMax && Number(q.min) > Number(q.max)) {
          errors.push({
            code: 'numeric-bad-range',
            message: `Numeric question "${q.id}" has a minimum (${q.min}) greater than its maximum (${q.max}).`,
            ref: q.id,
          });
        }
        if (q.min !== undefined && q.min !== '' && !hasMin) {
          errors.push({ code: 'numeric-bad-min', message: `Numeric question "${q.id}" has a non-numeric minimum.`, ref: q.id });
        }
        if (q.max !== undefined && q.max !== '' && !hasMax) {
          errors.push({ code: 'numeric-bad-max', message: `Numeric question "${q.id}" has a non-numeric maximum.`, ref: q.id });
        }
        if (q.integerOnly && hasMin && !Number.isInteger(Number(q.min))) {
          warnings.push({ code: 'numeric-int-min', message: `Numeric question "${q.id}" is whole-numbers-only but its minimum is not a whole number.`, ref: q.id });
        }
      }

      // ---- expected-option gating ----
      if (EXPECTED_GATED_TYPES.includes(q.type)) {
        const options = q.options || [];
        const expected = options.filter((o) => o.expected);
        if (expected.length && expected.length === options.length && options.length > 1) {
          warnings.push({
            code: 'all-options-expected',
            message: `Question "${q.id}" marks every option as expected, so the learner must select all of them.`,
            ref: q.id,
          });
        }
        if (expected.length && !q.required) {
          warnings.push({
            code: 'expected-on-optional',
            message: `Optional question "${q.id}" has expected options; they gate the question but the question does not gate the section.`,
            ref: q.id,
          });
        }
      } else if ((q.options || []).some((o) => o.expected)) {
        warnings.push({
          code: 'expected-ignored',
          message: `Question "${q.id}" has expected options, but expected gating only applies to checklist and multiple select.`,
          ref: q.id,
        });
      }

      // evidence_ref must never be configured to store a binary in SCORM.
      if (q.type === 'evidence_ref' && (/** @type {any} */ (q)).storeFileInScorm) {
        errors.push({
          code: 'evidence-stores-file',
          message: `Evidence question "${q.id}" is configured to store a file in SCORM. Evidence questions may record metadata only.`,
          ref: q.id,
        });
      }

      if ((CHOICE_TYPES.includes(q.type) || q.type === 'evidence_ref') && !(q.helpText && q.helpText.trim())) {
        warnings.push({ code: 'missing-help-text', message: `Question "${q.id}" is a complex item with no help text.`, ref: q.id });
      }
    }
  }

  if (workbook.settings?.navigation === 'linear' && sections.length > 0) {
    if (!sections.some((s) => s.required)) {
      warnings.push({ code: 'linear-no-completion', message: 'Linear navigation has no completion-eligible required section reachable.' });
    }
  }

  const size = opts.estimatedSuspendSize || 0;
  if (size > SUSPEND_DATA_LIMIT) {
    errors.push({ code: 'suspend-over-limit', message: `Estimated suspend data (${size} bytes) exceeds the SCORM 2004 limit of ${SUSPEND_DATA_LIMIT} bytes.` });
  } else if (size > SUSPEND_DATA_LIMIT * SUSPEND_DATA_WARN_RATIO) {
    warnings.push({ code: 'suspend-near-limit', message: `Estimated suspend data (${size} bytes) is approaching the SCORM 2004 limit of ${SUSPEND_DATA_LIMIT} bytes.` });
  }

  return { ok: errors.length === 0, errors, warnings };
}

function isNum(v) {
  return v !== undefined && v !== null && v !== '' && isFinite(Number(v));
}
