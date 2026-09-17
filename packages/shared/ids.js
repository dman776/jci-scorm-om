// @ts-check
import { customAlphabet } from 'nanoid';

// Lowercase alnum, no ambiguous chars. Ids are used in JSON, manifest, and
// compact suspend-data serialization, so keep them short and url/xml safe.
const alphabet = '0123456789abcdefghijkmnpqrstuvwxyz';
const nano = customAlphabet(alphabet, 8);

/** @param {string} [prefix] */
export function newId(prefix = '') {
  return prefix ? `${prefix}${nano()}` : nano();
}

export const newSectionId = () => newId('s_');
export const newQuestionId = () => newId('q_');
export const newOptionId = () => newId('o_');

/** Deterministic slug for human-authored ids (workbook id, course id). */
export function slugify(text) {
  return String(text || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || newId('wb_');
}
