// @ts-check
/**
 * Workbook validation. Produces structured errors (block export) and warnings
 * (advisory). Pure and dependency-free apart from shared constants.
 */
import {
  QUESTION_TYPES, SUSPEND_DATA_LIMIT, SUSPEND_DATA_WARN_RATIO, EXPECTED_GATED_TYPES,
} from '@sowb/shared/constants.js';
import { buildScaleIndex, resolveScalePoints, CUSTOM_SCALE_ID } from '@sowb/shared/scales.js';

const CHOICE_TYPES = ['single_select', 'multiple_select', 'checklist'];

/**
 * @param {any} workbook
 * @param {{ estimatedSuspendSize?: number, customScales?: any[] }} [opts]
 * @returns {{ ok: boolean, errors: {code:string,message:string,ref?:string}[], warnings: {code:string,message:string,ref?:string}[] }}
 */
export function validateWorkbook(workbook, opts = {}) {
  const errors = [];
  const warnings = [];

  if (!workbook || typeof workbook !== 'object') {
    return { ok: false, errors: [{ code: 'no-workbook', message: 'No workbook provided.' }], warnings };
  }
  if (!workbook.title || !workbook.title.trim()) {
    errors.push({ code: 'missing-title', message: 'Workbook must have a title.' });
  }

  const scaleIndex = buildScaleIndex(opts.customScales || workbook.ratingScales || []);
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

  if (sections.length > 0 && !sections.some((s) => s.required)) {
    errors.push({ code: 'no-required-section', message: 'Workbook has no required sections, so completion can never be reached.' });
  }

  const seenQuestionIds = new Set();
  for (const section of sections) {
    const questions = section.questions || [];
    if (questions.length === 0) {
      errors.push({ code: 'empty-section', message: `Section "${section.title || section.id}" has no questions.`, ref: section.id });
    }
    if (section.required && questions.length > 0 && !questions.some((q) => q.required)) {
      warnings.push({
        code: 'required-section-no-required-questions',
        message: `Required section "${section.title || section.id}" contains only optional questions; it will auto-complete on any answer.`,
        ref: section.id,
      });
    }
    // Locking plus no required questions strands the learner: the section
    // completes on their first answer, then freezes with the rest still blank.
    if (section.lockWhenComplete && questions.length > 0 && !questions.some((q) => q.required)) {
      warnings.push({
        code: 'lock-no-required-questions',
        message: `Section "${section.title || section.id}" locks when complete but has no required questions, so it locks as soon as the learner answers anything and leaves, with the other items still blank.`,
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
      if (CHOICE_TYPES.includes(q.type) && (q.options || []).length < 2) {
        errors.push({ code: 'choice-needs-options', message: `Choice question "${q.id}" needs at least two options.`, ref: q.id });
      }

      // ---- rating scales ----
      if (q.type === 'rating') {
        const usesLibrary = q.scaleId && q.scaleId !== CUSTOM_SCALE_ID;
        if (usesLibrary && !scaleIndex[q.scaleId]) {
          // A dangling reference would silently publish an empty scale, so it
          // blocks export rather than degrading quietly.
          errors.push({
            code: 'rating-unknown-scale',
            message: `Rating question "${q.id}" references rating scale "${q.scaleId}", which is not in the library.`,
            ref: q.id,
          });
        }
        const points = resolveScalePoints(q, scaleIndex);
        if (points.length < 2) {
          errors.push({ code: 'rating-needs-scale', message: `Rating question "${q.id}" needs a scale of at least two points.`, ref: q.id });
        }
        const seenValues = new Set();
        for (const p of points) {
          const key = String(p.value);
          if (seenValues.has(key)) {
            errors.push({ code: 'rating-duplicate-value', message: `Rating question "${q.id}" has duplicate scale value "${key}".`, ref: q.id });
          }
          seenValues.add(key);
          if (!String(p.label).trim()) {
            errors.push({ code: 'rating-missing-label', message: `Rating question "${q.id}" has a scale point with no label.`, ref: q.id });
          }
        }
        if (!usesLibrary && points.length >= 2) {
          warnings.push({
            code: 'rating-inline-scale',
            message: `Rating question "${q.id}" uses a one-off scale. Consider adding it to the rating scale library so other questions can reuse it.`,
            ref: q.id,
          });
        }
      }

      // ---- numeric bounds ----
      if (q.type === 'numeric') {
        const hasMin = isNum(q.min), hasMax = isNum(q.max);
        if (hasMin && hasMax && Number(q.min) > Number(q.max)) {
          errors.push({ code: 'numeric-bad-range', message: `Numeric question "${q.id}" has a minimum (${q.min}) greater than its maximum (${q.max}).`, ref: q.id });
        }
        if (q.min !== undefined && q.min !== '' && !hasMin) {
          errors.push({ code: 'numeric-bad-min', message: `Numeric question "${q.id}" has a non-numeric minimum.`, ref: q.id });
        }
        if (q.max !== undefined && q.max !== '' && !hasMax) {
          errors.push({ code: 'numeric-bad-max', message: `Numeric question "${q.id}" has a non-numeric maximum.`, ref: q.id });
        }
      }

      // ---- expected-option gating ----
      if (EXPECTED_GATED_TYPES.includes(q.type)) {
        const options = q.options || [];
        const expected = options.filter((o) => o.expected);
        if (expected.length && expected.length === options.length && options.length > 1) {
          warnings.push({ code: 'all-options-expected', message: `Question "${q.id}" marks every option as expected, so the learner must select all of them.`, ref: q.id });
        }
        if (expected.length && !q.required) {
          warnings.push({ code: 'expected-on-optional', message: `Optional question "${q.id}" has expected options; they gate the question but the question does not gate the section.`, ref: q.id });
        }
      } else if ((q.options || []).some((o) => o.expected)) {
        warnings.push({ code: 'expected-ignored', message: `Question "${q.id}" has expected options, but expected gating only applies to checklist and multiple select.`, ref: q.id });
      }

      // evidence_ref must never be configured to store a binary in SCORM.
      if (q.type === 'evidence_ref' && q.storeFileInScorm) {
        errors.push({ code: 'evidence-stores-file', message: `Evidence question "${q.id}" is configured to store a file in SCORM. Evidence questions may record metadata only.`, ref: q.id });
      }
      if ((CHOICE_TYPES.includes(q.type) || q.type === 'evidence_ref') && !(q.helpText && q.helpText.trim())) {
        warnings.push({ code: 'missing-help-text', message: `Question "${q.id}" is a complex item with no help text.`, ref: q.id });
      }
    }
  }

  if (workbook.settings && workbook.settings.navigation === 'linear' && sections.length > 0 && !sections.some((s) => s.required)) {
    warnings.push({ code: 'linear-no-completion', message: 'Linear navigation has no completion-eligible required section reachable.' });
  }

  const size = opts.estimatedSuspendSize || 0;
  if (size > SUSPEND_DATA_LIMIT) {
    errors.push({ code: 'suspend-over-limit', message: `Estimated suspend data (${size} bytes) exceeds the SCORM 2004 limit of ${SUSPEND_DATA_LIMIT} bytes.` });
  } else if (size > SUSPEND_DATA_LIMIT * SUSPEND_DATA_WARN_RATIO) {
    warnings.push({ code: 'suspend-near-limit', message: `Estimated suspend data (${size} bytes) is approaching the SCORM 2004 limit of ${SUSPEND_DATA_LIMIT} bytes.` });
  }

  return { ok: errors.length === 0, errors, warnings };
}

function isNum(v) { return v !== undefined && v !== null && v !== '' && isFinite(Number(v)); }
