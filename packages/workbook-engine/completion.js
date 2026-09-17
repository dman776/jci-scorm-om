// @ts-check
/**
 * Completion + status engine. Pure, dependency-free functions shared verbatim
 * by the authoring preview and the exported runtime player, so authoring and
 * the SCO can never disagree about what "complete" means.
 *
 * STATE MODEL
 * -----------
 * A question is no longer answered/unanswered. It has three states, because a
 * response can exist and still fail its requirement:
 *   empty    - no response at all
 *   partial  - a response exists but the constraint is unmet
 *              (numeric outside min/max, checklist missing an expected option,
 *               malformed url)
 *   complete - response exists AND satisfies the constraint
 *
 * Sections roll that up into four states. The useful distinction is that
 * IN_PROGRESS means "you still have blanks" while PARTIALLY_COMPLETE means
 * "you filled everything in but fell short of a requirement".
 *
 * NOTE: SCORM 2004 has no "partial" completion_status (only completed /
 * incomplete / unknown), so a partially complete section still reports as
 * incomplete to the LMS. The nuance lives in the learner dashboard, the
 * progress measure, and the authoring UI.
 *
 * This file must run unchanged in the browser. No Node-only APIs, no imports.
 */

// ---- response states ----
export const EMPTY = 'empty';
export const PARTIAL = 'partial';
export const COMPLETE = 'complete';

// ---- section states ----
export const NOT_STARTED = 'not_started';
export const IN_PROGRESS = 'in_progress';
export const PARTIALLY_COMPLETE = 'partially_complete';
export const COMPLETED = 'completed';

const EXPECTED_GATED = ['checklist', 'multiple_select'];

/**
 * Classify a single response as empty / partial / complete.
 * @param {import('@sowb/shared').Question} question
 * @param {any} value
 * @returns {'empty'|'partial'|'complete'}
 */
export function getResponseState(question, value) {
  if (value === undefined || value === null) return EMPTY;
  const type = question.type;

  switch (type) {
    case 'multiple_select':
    case 'checklist': {
      if (!Array.isArray(value) || value.length === 0) return EMPTY;
      const expected = (question.options || []).filter((o) => o.expected).map((o) => o.id);
      // No expected options flagged -> any selection completes the item.
      if (expected.length === 0) return COMPLETE;
      // Every expected option must be selected. Extra, non-expected
      // selections are allowed and do not block completion.
      const chosen = new Set(value);
      return expected.every((id) => chosen.has(id)) ? COMPLETE : PARTIAL;
    }

    case 'numeric': {
      const raw = String(value).trim();
      if (raw === '') return EMPTY;
      const n = Number(raw);
      if (!isFinite(n)) return PARTIAL;
      if (question.integerOnly && !Number.isInteger(n)) return PARTIAL;
      // Bounds are inclusive and each is independently optional.
      if (isNum(question.min) && n < Number(question.min)) return PARTIAL;
      if (isNum(question.max) && n > Number(question.max)) return PARTIAL;
      return COMPLETE;
    }

    case 'url': {
      const raw = String(value).trim();
      if (raw === '') return EMPTY;
      return isValidHttpUrl(raw) ? COMPLETE : PARTIAL;
    }

    case 'yes_no':
      if (value === 'yes' || value === 'no' || value === true || value === false) return COMPLETE;
      return EMPTY;

    case 'acknowledgement':
      return value === true ? COMPLETE : EMPTY;

    case 'rating':
      return String(value).trim() === '' ? EMPTY : COMPLETE;

    case 'evidence_ref':
      return value && value.fileSelected ? COMPLETE : EMPTY;

    case 'short_text':
    case 'long_text':
    case 'datetime':
    case 'single_select':
    default:
      return String(value).trim().length > 0 ? COMPLETE : EMPTY;
  }
}

/**
 * Back-compat helper: does any response exist at all (partial counts)?
 * @param {import('@sowb/shared').Question} question
 * @param {any} value
 */
export function isResponsePresent(question, value) {
  return getResponseState(question, value) !== EMPTY;
}

/**
 * Does the response fully satisfy the question's requirement?
 * @param {import('@sowb/shared').Question} question
 * @param {any} value
 */
export function isResponseComplete(question, value) {
  return getResponseState(question, value) === COMPLETE;
}

/**
 * Neutral, learner-safe explanation of why a response is not yet complete.
 * For checklists this deliberately never names which options are expected.
 * Returns '' when the response is empty or already complete.
 * @param {import('@sowb/shared').Question} question
 * @param {any} value
 * @returns {string}
 */
export function getRequirementHint(question, value) {
  if (getResponseState(question, value) !== PARTIAL) return '';
  switch (question.type) {
    case 'checklist':
    case 'multiple_select':
      return 'Some required items are not yet selected.';
    case 'numeric': {
      const raw = String(value).trim();
      if (!isFinite(Number(raw))) return 'Enter a number.';
      if (question.integerOnly && !Number.isInteger(Number(raw))) return 'Enter a whole number.';
      const hasMin = isNum(question.min);
      const hasMax = isNum(question.max);
      if (hasMin && hasMax) return `Enter a value between ${question.min} and ${question.max}.`;
      if (hasMin) return `Enter at least ${question.min}.`;
      if (hasMax) return `Enter no more than ${question.max}.`;
      return 'Enter a valid number.';
    }
    case 'url':
      return 'Enter a valid link starting with https://';
    default:
      return 'This response is not yet complete.';
  }
}

/**
 * Compute a section's status from the current responses.
 * @param {import('@sowb/shared').Section} section
 * @param {Record<string, any>} responses
 * @returns {'not_started'|'in_progress'|'partially_complete'|'completed'}
 */
export function computeSectionStatus(section, responses) {
  const questions = section.questions || [];
  const required = questions.filter((q) => q.required);
  const anyTouched = questions.some((q) => getResponseState(q, responses[q.id]) !== EMPTY);

  if (required.length === 0) {
    // A section with no required questions completes as soon as any answer is
    // recorded; if nothing is answered it is simply Not Started.
    return anyTouched ? COMPLETED : NOT_STARTED;
  }

  const states = required.map((q) => getResponseState(q, responses[q.id]));
  if (states.every((s) => s === COMPLETE)) return COMPLETED;
  if (!anyTouched) return NOT_STARTED;
  // Still has blanks in required questions -> genuinely in progress.
  if (states.some((s) => s === EMPTY)) return IN_PROGRESS;
  // Nothing blank, but at least one requirement unmet.
  return PARTIALLY_COMPLETE;
}

/**
 * Recompute the full sectionStatus map.
 * @param {import('@sowb/shared').Workbook} workbook
 * @param {Record<string, any>} responses
 * @returns {Record<string, string>}
 */
export function computeAllSectionStatus(workbook, responses) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const section of workbook.sections || []) {
    map[section.id] = computeSectionStatus(section, responses);
  }
  return map;
}

/**
 * Question-level progress (0..1) for cmi.progress_measure.
 *
 * Counting units, restricted to REQUIRED sections (optional sections never
 * gate completion, so including them would keep progress below 1):
 *   - each required question in a required section is one unit, satisfied
 *     when its response state is complete;
 *   - a required section with NO required questions contributes one unit,
 *     satisfied when the section itself is completed.
 *
 * Question-level counting makes the bar move as the learner works and lets
 * partial responses register as "not yet counted" rather than all-or-nothing
 * per section.
 * @param {import('@sowb/shared').Workbook} workbook
 * @param {Record<string, string>} sectionStatus
 * @param {Record<string, any>} [responses]
 * @returns {number}
 */
export function computeProgressMeasure(workbook, sectionStatus, responses) {
  const requiredSections = (workbook.sections || []).filter((s) => s.required);
  if (requiredSections.length === 0) return 1;

  const res = responses || {};
  let total = 0;
  let done = 0;

  for (const section of requiredSections) {
    const requiredQuestions = (section.questions || []).filter((q) => q.required);
    if (requiredQuestions.length === 0) {
      total += 1;
      if (sectionStatus[section.id] === COMPLETED) done += 1;
      continue;
    }
    for (const q of requiredQuestions) {
      total += 1;
      if (getResponseState(q, res[q.id]) === COMPLETE) done += 1;
    }
  }

  if (total === 0) return 1;
  return round2(done / total);
}

/**
 * Is the whole workbook complete? True only when every REQUIRED section is
 * completed.
 * @param {import('@sowb/shared').Workbook} workbook
 * @param {Record<string, string>} sectionStatus
 * @returns {boolean}
 */
export function isWorkbookComplete(workbook, sectionStatus) {
  const requiredSections = (workbook.sections || []).filter((s) => s.required);
  if (requiredSections.length === 0) return false; // guarded separately by validation
  return requiredSections.every((s) => sectionStatus[s.id] === COMPLETED);
}

/**
 * Under linear navigation, a section is unlocked only when every preceding
 * REQUIRED section is completed. Partially complete does not unlock.
 * @param {import('@sowb/shared').Workbook} workbook
 * @param {string} sectionId
 * @param {Record<string, string>} sectionStatus
 * @returns {boolean}
 */
export function isSectionUnlocked(workbook, sectionId, sectionStatus) {
  if (workbook.settings?.navigation !== 'linear') return true;
  const sections = workbook.sections || [];
  const idx = sections.findIndex((s) => s.id === sectionId);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i++) {
    const prev = sections[i];
    if (prev.required && sectionStatus[prev.id] !== COMPLETED) return false;
  }
  return true;
}

// ---- helpers -------------------------------------------------------------

/** Structural URL check only. Never performs a network call (SCO runs offline). */
export function isValidHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  // Require a dotted host or localhost so "https://x" is rejected.
  const host = parsed.hostname || '';
  return host === 'localhost' || host.includes('.');
}

function isNum(v) {
  return v !== undefined && v !== null && v !== '' && isFinite(Number(v));
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
