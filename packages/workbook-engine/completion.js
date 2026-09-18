// @ts-check
/**
 * Completion + status engine. Pure functions shared verbatim by the authoring
 * preview and the exported runtime player, so authoring and the SCO can never
 * disagree about what "complete" means.
 *
 * STATE MODEL
 * -----------
 * A question has three states, because a response can exist and still fail its
 * requirement:
 *   empty    - no response at all
 *   partial  - a response exists but the constraint is unmet (numeric outside
 *              min/max, checklist missing an expected option, malformed url,
 *              rating value not present in its scale)
 *   complete - response exists AND satisfies the constraint
 *
 * Sections roll that up into four states. IN_PROGRESS means "you still have
 * blanks"; PARTIALLY_COMPLETE means "you filled everything in but fell short".
 *
 * NOTE: SCORM 2004 has no "partial" completion_status (only completed /
 * incomplete / unknown), so a partially complete section still reports the
 * workbook as incomplete. The nuance lives in the learner dashboard, the
 * progress measure, and the authoring UI.
 *
 * This file is copied verbatim into the exported package, so its only import
 * is the equally dependency-free scales module.
 */
import { resolveScalePoints, findScalePoint } from './scales.js';

// ---- response states ----
export const EMPTY = 'empty';
export const PARTIAL = 'partial';
export const COMPLETE = 'complete';

// ---- section states ----
export const NOT_STARTED = 'not_started';
export const IN_PROGRESS = 'in_progress';
export const PARTIALLY_COMPLETE = 'partially_complete';
export const COMPLETED = 'completed';

/**
 * Classify a single response as empty / partial / complete.
 * @param {any} question
 * @param {any} value
 * @returns {'empty'|'partial'|'complete'}
 */
export function getResponseState(question, value) {
  if (value === undefined || value === null) return EMPTY;

  switch (question.type) {
    case 'multiple_select':
    case 'checklist': {
      if (!Array.isArray(value) || value.length === 0) return EMPTY;
      const expected = (question.options || []).filter((o) => o.expected).map((o) => o.id);
      if (expected.length === 0) return COMPLETE;
      // Every expected option must be selected. Extra, non-expected selections
      // are allowed and do not block completion.
      const chosen = new Set(value);
      return expected.every((id) => chosen.has(id)) ? COMPLETE : PARTIAL;
    }

    case 'numeric': {
      const raw = String(value).trim();
      if (raw === '') return EMPTY;
      const n = Number(raw);
      if (!isFinite(n)) return PARTIAL;
      if (question.integerOnly && !Number.isInteger(n)) return PARTIAL;
      if (isNum(question.min) && n < Number(question.min)) return PARTIAL;
      if (isNum(question.max) && n > Number(question.max)) return PARTIAL;
      return COMPLETE;
    }

    case 'url': {
      const raw = String(value).trim();
      if (raw === '') return EMPTY;
      return isValidHttpUrl(raw) ? COMPLETE : PARTIAL;
    }

    case 'rating': {
      const raw = String(value).trim();
      if (raw === '') return EMPTY;
      // The runtime only ever sees INLINED points: publish and preview resolve
      // scaleId to concrete points before the player loads, so no library
      // lookup is needed (and none is possible offline inside the LMS).
      const points = resolveScalePoints(question);
      if (points.length === 0) return COMPLETE; // nothing to validate against
      // A stored value no longer in the scale (the author edited the scale
      // after the learner answered) is PARTIAL: there is data, but it no
      // longer satisfies the question.
      return findScalePoint(points, raw) ? COMPLETE : PARTIAL;
    }

    case 'yes_no':
      return (value === 'yes' || value === 'no' || value === true || value === false) ? COMPLETE : EMPTY;

    case 'acknowledgement':
      return value === true ? COMPLETE : EMPTY;

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

/** Does any response exist at all (partial counts)? */
export function isResponsePresent(q, v) { return getResponseState(q, v) !== EMPTY; }
/** Does the response fully satisfy the question's requirement? */
export function isResponseComplete(q, v) { return getResponseState(q, v) === COMPLETE; }

/**
 * Neutral, learner-safe explanation of why a response is not yet complete.
 * For checklists this deliberately never names which options are expected.
 * Returns '' when the response is empty or already complete.
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
      const hasMin = isNum(question.min), hasMax = isNum(question.max);
      if (hasMin && hasMax) return `Enter a value between ${question.min} and ${question.max}.`;
      if (hasMin) return `Enter at least ${question.min}.`;
      if (hasMax) return `Enter no more than ${question.max}.`;
      return 'Enter a valid number.';
    }
    case 'url': return 'Enter a valid link starting with https://';
    case 'rating': return 'Choose one of the options shown.';
    default: return 'This response is not yet complete.';
  }
}

/**
 * Compute a section's status from the current responses.
 * @returns {'not_started'|'in_progress'|'partially_complete'|'completed'}
 */
export function computeSectionStatus(section, responses) {
  const questions = section.questions || [];
  const required = questions.filter((q) => q.required);
  const anyTouched = questions.some((q) => getResponseState(q, responses[q.id]) !== EMPTY);

  // A section with no required questions completes as soon as any answer is
  // recorded; if nothing is answered it is simply Not Started.
  if (required.length === 0) return anyTouched ? COMPLETED : NOT_STARTED;

  const states = required.map((q) => getResponseState(q, responses[q.id]));
  if (states.every((s) => s === COMPLETE)) return COMPLETED;
  if (!anyTouched) return NOT_STARTED;
  if (states.some((s) => s === EMPTY)) return IN_PROGRESS;
  return PARTIALLY_COMPLETE;
}

/** Recompute the full sectionStatus map. */
export function computeAllSectionStatus(workbook, responses) {
  /** @type {Record<string,string>} */
  const map = {};
  for (const section of workbook.sections || []) map[section.id] = computeSectionStatus(section, responses);
  return map;
}

/**
 * Question-level progress (0..1) for cmi.progress_measure, restricted to
 * REQUIRED sections. Each required question is one unit, satisfied when its
 * response state is complete. A required section with no required questions
 * contributes one unit, satisfied when the section completes.
 *
 * Question-level counting makes the bar move as the learner works and lets
 * partial responses register as "not yet counted" rather than all-or-nothing.
 */
export function computeProgressMeasure(workbook, sectionStatus, responses) {
  const requiredSections = (workbook.sections || []).filter((s) => s.required);
  if (requiredSections.length === 0) return 1;

  const res = responses || {};
  let total = 0, done = 0;
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
  return Math.round((done / total) * 100) / 100;
}

/** True only when every REQUIRED section is completed. */
export function isWorkbookComplete(workbook, sectionStatus) {
  const requiredSections = (workbook.sections || []).filter((s) => s.required);
  if (requiredSections.length === 0) return false; // guarded separately by validation
  return requiredSections.every((s) => sectionStatus[s.id] === COMPLETED);
}

/**
 * Under linear navigation a section is unlocked only when every preceding
 * REQUIRED section is completed. Partially complete does not unlock.
 */
export function isSectionUnlocked(workbook, sectionId, sectionStatus) {
  if (!workbook.settings || workbook.settings.navigation !== 'linear') return true;
  const sections = workbook.sections || [];
  const idx = sections.findIndex((s) => s.id === sectionId);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i++) {
    const prev = sections[i];
    if (prev.required && sectionStatus[prev.id] !== COMPLETED) return false;
  }
  return true;
}

/**
 * ANSWER LOCKING (opt-in per section via `lockWhenComplete`)
 *
 * Locking is committed state, not a pure function of status, which is why the
 * runtime records locked section ids in learner state and these are two
 * functions rather than one. A section the learner is still inside stays
 * editable even once every requirement is satisfied: a long_text answer counts
 * as complete on its FIRST character, so locking on status alone would freeze
 * the section mid-sentence. The runtime commits the lock when the learner
 * leaves the section instead.
 */

/** Does leaving this section right now commit its lock? */
export function shouldLockSection(section, status) {
  return !!(section && section.lockWhenComplete) && status === COMPLETED;
}

/**
 * Are this section's answers final?
 *
 * Deliberately re-checks the current flag and status rather than trusting the
 * committed id alone. If the author republishes with an extra required
 * question, a locked section drops out of COMPLETED and must become editable
 * again, or the learner is stranded in a workbook that can never complete. A
 * learner can never reach that state on their own, because locked answers
 * cannot change and so the status cannot fall.
 */
export function isSectionLocked(section, status, lockedSections) {
  if (!shouldLockSection(section, status)) return false;
  return (lockedSections || []).includes(section.id);
}

/** Structural URL check only. Never performs a network call (the SCO is offline). */
export function isValidHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  let parsed;
  try { parsed = new URL(raw); } catch (_) { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname || '';
  return host === 'localhost' || host.includes('.');
}

function isNum(v) { return v !== undefined && v !== null && v !== '' && isFinite(Number(v)); }
