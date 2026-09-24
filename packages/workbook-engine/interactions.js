// @ts-check
/**
 * Maps workbook questions onto SCORM 2004 cmi.interactions so LMS reports can
 * show each answer. Report-only: cmi.suspend_data stays the source of truth for
 * resume, and nothing here is ever read back into learner state.
 *
 *  - Choice questions report option LABELS as text, because LMS reports (Workday
 *    Learning among them) print learner_response verbatim and an option id
 *    means nothing to a reader. Ratings report the scale value, as suspend
 *    data does.
 *  - result is 'correct' / 'incorrect' only for questions with something to
 *    check: a requirement (expected checklist options, numeric bounds, url
 *    format) or an Expected answer (single select options, yes/no answer,
 *    rating minimum). Expected answers are report-only and never gate
 *    completion. Every other question is a survey item with no right answer,
 *    so it is 'neutral'.
 *  - correct_responses is never written: a checklist allows extra selections,
 *    and the SCORM choice pattern demands an exact match.
 *
 * Copied verbatim into the exported package, so its only imports are the
 * equally dependency-free completion and scales modules.
 */
import { getResponseState, COMPLETE, EMPTY } from './completion.js';
import { resolveScalePoints, findScalePoint } from './scales.js';

/** SCORM 2004 smallest permitted maximums (SPM). */
export const INTERACTIONS_LIMIT = 250;
export const FILL_IN_LIMIT = 250;
export const LONG_FILL_IN_LIMIT = 4000;
export const DESCRIPTION_LIMIT = 250;

/** Question type -> cmi.interactions.n.type. */
export const INTERACTION_TYPES = Object.freeze({
  yes_no: 'true-false',
  acknowledgement: 'true-false',
  single_select: 'long-fill-in',
  multiple_select: 'long-fill-in',
  checklist: 'long-fill-in',
  rating: 'likert',
  numeric: 'numeric',
  short_text: 'fill-in',
  long_text: 'long-fill-in',
  url: 'long-fill-in',
  datetime: 'fill-in',
  evidence_ref: 'fill-in',
});

/** @param {any} question */
export function interactionType(question) {
  return INTERACTION_TYPES[question.type] || 'other';
}

/** Separates selected option labels in a multi-select response. */
export const OPTION_SEPARATOR = '; ';

/**
 * Characters safe in a SCORM short_identifier_type (likert values)
 * across LMSs. Stricter than the spec's URI syntax on purpose.
 */
const SAFE_IDENTIFIER = /^[A-Za-z0-9._~:-]+$/;
export function isSafeIdentifier(s) { return SAFE_IDENTIFIER.test(String(s)); }

/**
 * learner_response for a question's current value, or null when there is
 * nothing representable to write. A cleared answer yields '' ('false' for a
 * true-false) so an interaction already in the LMS stops showing stale data.
 * @param {any} question
 * @param {any} value
 * @param {string} [lang]
 * @returns {string|null}
 */
export function formatLearnerResponse(question, value, lang = 'en-US') {
  const type = interactionType(question);
  const empty = getResponseState(question, value) === EMPTY;
  switch (type) {
    case 'true-false':
      if (empty) return question.type === 'acknowledgement' ? 'false' : null;
      return value === 'yes' || value === true ? 'true' : 'false';

    case 'likert':
      return empty ? null : String(value).trim();

    case 'numeric': {
      if (empty) return null;
      const n = Number(String(value).trim());
      const s = String(n);
      // real(10,7): a finite plain decimal, no exponent form.
      return isFinite(n) && !/e/i.test(s) ? s : null;
    }

    case 'fill-in': {
      if (empty) return '';
      const text = question.type === 'evidence_ref' ? value.fileName || '' : String(value);
      // [,] separates multiple fill-in values; learner text must not split.
      return localized(text.replace(/\[,\]/g, ', '), FILL_IN_LIMIT, lang);
    }

    case 'long-fill-in': {
      if (empty) return localized('', LONG_FILL_IN_LIMIT, lang);
      const text = CHOICE_TYPES.includes(question.type) ? optionLabels(question, value) : String(value);
      return localized(text, LONG_FILL_IN_LIMIT, lang);
    }

    default:
      return empty ? '' : truncate(JSON.stringify(value), LONG_FILL_IN_LIMIT);
  }
}

const CHOICE_TYPES = ['single_select', 'multiple_select', 'checklist'];

/** Selected option labels, in authored order. Unknown ids fall back to the id. */
function optionLabels(question, value) {
  const chosen = (Array.isArray(value) ? value : [value]).map(String);
  const options = question.options || [];
  const known = options.filter((o) => chosen.includes(String(o.id)));
  const unknown = chosen.filter((id) => !options.some((o) => String(o.id) === id));
  return [...known.map((o) => String(o.label || o.id)), ...unknown].join(OPTION_SEPARATOR);
}

/**
 * Can an answer to this question be wrong? True for the PARTIAL cases in
 * getResponseState, and for a configured Expected answer.
 * @param {any} question
 */
export function hasRequirement(question) {
  switch (question.type) {
    case 'checklist':
    case 'multiple_select':
    case 'single_select':
      return (question.options || []).some((o) => o.expected);
    case 'numeric':
      return !!question.integerOnly || isSet(question.min) || isSet(question.max);
    case 'url':
      return true;
    case 'yes_no':
      return YES_NO.includes(question.expectedAnswer);
    case 'rating':
      return !!expectedMinPoint(question);
    default:
      return false;
  }
}
const isSet = (v) => v !== undefined && v !== null && v !== '';
const YES_NO = ['yes', 'no'];

/**
 * Does a (non-empty) answer match the question's Expected answer? null when
 * the type has no Expected answer configured, so the completion state decides.
 * @param {any} question
 * @param {any} value
 * @returns {boolean|null}
 */
export function expectedAnswerMet(question, value) {
  switch (question.type) {
    case 'single_select': {
      const expected = (question.options || []).filter((o) => o.expected).map((o) => String(o.id));
      return expected.length ? expected.includes(String(value)) : null;
    }
    case 'yes_no': {
      if (!YES_NO.includes(question.expectedAnswer)) return null;
      const answer = value === true ? 'yes' : value === false ? 'no' : value;
      return answer === question.expectedAnswer;
    }
    case 'rating': {
      // One points array for both lookups: word scales rank by position in it.
      const points = resolveScalePoints(question);
      const min = isSet(question.expectedMin) ? findScalePoint(points, question.expectedMin) : null;
      if (!min) return null;
      const chosen = findScalePoint(points, value);
      return !!chosen && ratingRank(points, chosen) >= ratingRank(points, min);
    }
    default:
      return null;
  }
}

/** The scale point named by question.expectedMin, or null. */
function expectedMinPoint(question) {
  if (!isSet(question.expectedMin)) return null;
  return findScalePoint(resolveScalePoints(question), question.expectedMin);
}

/**
 * Position of a point on its scale, higher = better. Numeric values compare
 * as numbers (Strongly Agree = 5 outranks Agree = 4 whatever the listed
 * order); word values (Low / Medium / High) rank by listed order, low first.
 */
export function ratingRank(points, point) {
  const numeric = points.every((p) => p.value !== '' && isFinite(Number(p.value)));
  return numeric ? Number(point.value) : points.indexOf(point);
}

/**
 * @param {any} question
 * @param {any} value
 * @returns {'correct'|'incorrect'|'neutral'}
 */
export function interactionResult(question, value) {
  if (!hasRequirement(question)) return 'neutral';
  if (getResponseState(question, value) === EMPTY) return 'incorrect';
  const met = expectedAnswerMet(question, value);
  if (met !== null) return met ? 'correct' : 'incorrect';
  return getResponseState(question, value) === COMPLETE ? 'correct' : 'incorrect';
}

/** Prompt text for cmi.interactions.n.description. */
export function interactionDescription(question, lang = 'en-US') {
  return localized(String(question.prompt || ''), DESCRIPTION_LIMIT, lang);
}

/**
 * SCORM time(second,10,0): YYYY-MM-DDThh:mm:ss.ssZ. The spec's pattern,
 * YYYY[-MM[-DD[Thh[:mm[:ss[.s[TZD]]]]]]], only allows a time zone after
 * fractional seconds, so "...:ssZ" is rejected by strict LMSs.
 */
export function toScormTimestamp(date = new Date()) {
  return date.toISOString().slice(0, 22) + 'Z';
}

/**
 * A localized_string_type value. Plain text is written as-is (LMS reports may
 * show a {lang=..} prefix literally); a prefix is added only when the text
 * itself starts with "{", which the LMS would otherwise parse as a delimiter.
 */
function localized(text, limit, lang) {
  if (!text.startsWith('{')) return truncate(text, limit);
  const prefix = `{lang=${lang}}`;
  return prefix + truncate(text, limit);
}

/** Truncate by code point so a surrogate pair is never split. */
function truncate(text, limit) {
  const chars = Array.from(text);
  return chars.length > limit ? chars.slice(0, limit).join('') : text;
}
