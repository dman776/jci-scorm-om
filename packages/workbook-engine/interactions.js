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
 *  - result is 'correct' / 'incorrect' only for questions with a requirement
 *    to meet (expected checklist options, numeric bounds, url format). Every
 *    other question is a survey item with no right answer, so it is 'neutral'.
 *  - correct_responses is never written: a checklist allows extra selections,
 *    and the SCORM choice pattern demands an exact match.
 *
 * Copied verbatim into the exported package, so its only import is the equally
 * dependency-free completion module.
 */
import { getResponseState, COMPLETE, EMPTY } from './completion.js';

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
 * Does the question have a requirement an answer can fail? Mirrors the
 * PARTIAL cases in getResponseState.
 * @param {any} question
 */
export function hasRequirement(question) {
  switch (question.type) {
    case 'checklist':
    case 'multiple_select':
      return (question.options || []).some((o) => o.expected);
    case 'numeric':
      return !!question.integerOnly || isSet(question.min) || isSet(question.max);
    case 'url':
      return true;
    default:
      return false;
  }
}
const isSet = (v) => v !== undefined && v !== null && v !== '';

/**
 * @param {any} question
 * @param {any} value
 * @returns {'correct'|'incorrect'|'neutral'}
 */
export function interactionResult(question, value) {
  if (!hasRequirement(question)) return 'neutral';
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
