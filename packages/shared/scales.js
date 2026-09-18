// @ts-check
/**
 * Rating scale library.
 *
 * A scale is a named, reusable set of points. Each point has a VALUE (stored in
 * cmi.suspend_data and reported to facilitators) and a LABEL (what the learner
 * reads):
 *
 *   { id, name, description?, builtIn?, points: [{ value, label }, ...] }
 *
 * WHY VALUE AND LABEL ARE SEPARATE
 * --------------------------------
 * Responses persist the VALUE only. That keeps suspend data compact and, more
 * importantly, means an author can reword "Neutral" to "Neither agree nor
 * disagree" without invalidating learner responses already stored in the LMS.
 * Labels are presentation; values are data.
 *
 * HOW THE LIBRARY REACHES THE LEARNER
 * -----------------------------------
 * The exported SCORM package is self-contained and offline, so it can never
 * call back to the authoring server to look up a scale. A rating question
 * stores `scaleId`, and the publish step RESOLVES that id and inlines the
 * concrete points into the exported workbook JSON. Consequence worth knowing:
 * editing a library scale does not change already-published packages; they must
 * be republished.
 *
 * This module is dependency-free and runs in Node and the browser. It is copied
 * verbatim into the exported package as js/engine/scales.js.
 */

/**
 * @typedef {Object} ScalePoint
 * @property {number|string} value Stored in suspend data. Never change casually.
 * @property {string} label Shown to the learner.
 */

/**
 * @typedef {Object} RatingScale
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {boolean} [builtIn] Built-ins ship with the app and cannot be deleted.
 * @property {ScalePoint[]} points
 */

/** Scales that ship with the app. Authors can duplicate but not delete these. */
export const BUILT_IN_SCALES = Object.freeze([
  {
    id: 'numeric-5',
    name: 'Numeric 1-5',
    description: '1 through 5, unlabeled.',
    builtIn: true,
    points: [
      { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' },
      { value: 4, label: '4' }, { value: 5, label: '5' },
    ],
  },
  {
    id: 'agreement-5',
    name: 'Agreement (5-point)',
    description: 'Strongly Agree through Strongly Disagree.',
    builtIn: true,
    points: [
      { value: 5, label: 'Strongly Agree' },
      { value: 4, label: 'Agree' },
      { value: 3, label: 'Neutral' },
      { value: 2, label: 'Disagree' },
      { value: 1, label: 'Strongly Disagree' },
    ],
  },
  {
    id: 'frequency-5',
    name: 'Frequency (5-point)',
    description: 'Always through Never.',
    builtIn: true,
    points: [
      { value: 5, label: 'Always' },
      { value: 4, label: 'Almost Always' },
      { value: 3, label: 'Sometimes' },
      { value: 2, label: 'Rarely' },
      { value: 1, label: 'Never' },
    ],
  },
  {
    id: 'confidence-3',
    name: 'Confidence (Low / Medium / High)',
    description: 'Three-point confidence scale.',
    builtIn: true,
    points: [
      { value: 'Low', label: 'Low' },
      { value: 'Medium', label: 'Medium' },
      { value: 'High', label: 'High' },
    ],
  },
]);

/** Sentinel meaning "this question carries its own inline points". */
export const CUSTOM_SCALE_ID = '__custom__';

/**
 * Build a lookup of id -> scale from the built-ins plus author-defined scales.
 * Author scales win on id collision, so a workbook can override a built-in.
 * @param {RatingScale[]} [customScales]
 * @returns {Record<string, RatingScale>}
 */
export function buildScaleIndex(customScales = []) {
  /** @type {Record<string, any>} */
  const index = {};
  for (const s of BUILT_IN_SCALES) index[s.id] = s;
  for (const s of customScales || []) if (s && s.id) index[s.id] = s;
  return index;
}

/** All scales, built-ins first, as a flat list for pickers. */
export function listScales(customScales = []) {
  const custom = (customScales || []).filter((s) => s && s.id && !BUILT_IN_SCALES.some((b) => b.id === s.id));
  return [...BUILT_IN_SCALES, ...custom];
}

/**
 * Coerce whatever a question carries into canonical ScalePoint objects.
 *
 * BACKWARD COMPATIBILITY is the whole point of this function. Older workbooks
 * stored `scale` as a bare array and the runtime persisted responses as
 * `String(point)`. To avoid invalidating stored learner data we preserve the
 * original value exactly:
 *
 *   [1,2,3,4,5]                -> value 1..5     (response was "1".."5")
 *   ['Low','Medium','High']    -> value 'Low'..  (response was "Low"..)
 *   [{value,label}, ...]       -> passed through
 *
 * Note the asymmetry: a legacy numeric array yields numeric values, a legacy
 * string array yields STRING values. Renumbering the string form to 1..3 would
 * silently orphan every response already recorded in an LMS.
 *
 * @param {any} raw
 * @returns {ScalePoint[]}
 */
export function normalizeScalePoints(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {ScalePoint[]} */
  const out = [];
  for (const entry of raw) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry === 'object') {
      if (entry.value === undefined && entry.label === undefined) continue;
      const value = entry.value !== undefined ? entry.value : entry.label;
      const label = entry.label !== undefined ? String(entry.label) : String(value);
      out.push({ value, label });
      continue;
    }
    // Primitive: the value IS the entry, preserving legacy response strings.
    out.push({ value: entry, label: String(entry) });
  }
  return out;
}

/**
 * Resolve the concrete points for a rating question.
 *
 * Precedence:
 *   1. An explicit `scaleId` that resolves in the index.
 *   2. Inline `scale` points on the question (custom, or already inlined).
 *   3. Empty, which validation reports as an error.
 *
 * @param {any} question
 * @param {Record<string, any>} [scaleIndex]
 * @returns {ScalePoint[]}
 */
export function resolveScalePoints(question, scaleIndex = {}) {
  if (!question) return [];
  const id = question.scaleId;
  if (id && id !== CUSTOM_SCALE_ID) {
    const scale = scaleIndex[id];
    if (scale) return normalizeScalePoints(scale.points);
    // Unresolved id: fall back to any inlined snapshot so a published package
    // keeps working even if the library entry was later renamed or removed.
    return normalizeScalePoints(question.scale);
  }
  return normalizeScalePoints(question.scale);
}

/**
 * Inline concrete points onto every rating question so the exported package
 * needs no library. Returns a NEW workbook; the input is untouched.
 *
 * `scaleId` is retained so the authoring app can still show which library entry
 * a question came from after a round-trip through JSON export/import.
 *
 * @param {any} workbook
 * @param {RatingScale[]} [customScales]
 * @returns {any}
 */
export function inlineScales(workbook, customScales = []) {
  const index = buildScaleIndex(customScales);
  const copy = JSON.parse(JSON.stringify(workbook));
  for (const section of copy.sections || []) {
    for (const question of section.questions || []) {
      if (question.type !== 'rating') continue;
      question.scale = resolveScalePoints(question, index);
      if (question.scaleId && index[question.scaleId]) {
        // Snapshot the human name so a facilitator reading the exported JSON
        // can tell which scale was used.
        question.scaleName = index[question.scaleId].name;
      }
    }
  }
  return copy;
}

/**
 * Find the point matching a stored response value. Comparison uses the string
 * form because SCORM round-trips everything as text.
 * @param {ScalePoint[]} points
 * @param {any} value
 * @returns {ScalePoint|null}
 */
export function findScalePoint(points, value) {
  if (value === undefined || value === null || value === '') return null;
  const target = String(value);
  for (const p of points || []) if (String(p.value) === target) return p;
  return null;
}

/**
 * Human-readable rendering of a stored rating response, used by the PDF report.
 * Avoids the silly "1 (1)" case when a scale is unlabeled.
 * @param {ScalePoint[]} points
 * @param {any} value
 * @returns {string}
 */
export function formatScaleAnswer(points, value) {
  const point = findScalePoint(points, value);
  if (!point) return String(value === undefined || value === null ? '' : value);
  const label = String(point.label);
  const raw = String(point.value);
  return label === raw ? label : `${label} (${raw})`;
}

/**
 * Validate a scale definition for the library editor.
 * @param {RatingScale} scale
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateScale(scale) {
  const errors = [];
  if (!scale || typeof scale !== 'object') return { ok: false, errors: ['No scale provided.'] };
  if (!scale.id || !String(scale.id).trim()) errors.push('Scale must have an id.');
  if (!scale.name || !String(scale.name).trim()) errors.push('Scale must have a name.');

  const points = normalizeScalePoints(scale.points);
  if (points.length < 2) errors.push('Scale needs at least two points.');

  const seen = new Set();
  for (const p of points) {
    const key = String(p.value);
    if (seen.has(key)) errors.push(`Duplicate point value "${key}".`);
    seen.add(key);
    if (!String(p.label).trim()) errors.push(`Point "${key}" is missing a label.`);
  }
  return { ok: errors.length === 0, errors };
}

/** Slug helper for new scale ids created in the authoring UI. */
export function slugifyScaleId(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'scale';
}
