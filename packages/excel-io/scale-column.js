// @ts-check
/**
 * Parsing for the Questions sheet "Rating Scale" column.
 *
 * Accepted forms, in precedence order:
 *
 *   agreement-5                      a scale id from the library
 *   Agreement (5-point)              a scale NAME from the library (case-insensitive)
 *   1=Strongly Agree | 2=Agree       explicit value=label pairs (one-off scale)
 *   Low|Medium|High                  bare labels; the label doubles as the value,
 *                                    matching the legacy behaviour so older
 *                                    templates keep importing unchanged
 *   1-5                              shorthand for the built-in numeric-5
 *
 * Returning `{scaleId}` keeps the question pointing at the library so a later
 * edit to that scale propagates; returning `{scale}` pins a one-off.
 */
import { buildScaleIndex, listScales, CUSTOM_SCALE_ID } from '@sowb/shared/scales.js';

/**
 * @param {string} raw cell contents
 * @param {any[]} [customScales]
 * @returns {{scaleId?:string, scale?:any[], warning?:string}}
 */
export function parseScaleCell(raw, customScales = []) {
  const text = String(raw == null ? '' : raw).trim();
  const all = listScales(customScales);
  const index = buildScaleIndex(customScales);

  // Blank defaults to the numeric built-in, preserving old template behaviour.
  if (text === '') return { scaleId: 'numeric-5' };

  // Legacy shorthand.
  if (text.toLowerCase() === '1-5') return { scaleId: 'numeric-5' };

  // Exact id.
  if (index[text]) return { scaleId: text };

  // Name match, case-insensitive.
  const byName = all.find((s) => s.name.toLowerCase() === text.toLowerCase());
  if (byName) return { scaleId: byName.id };

  // Pipe-delimited points.
  if (text.includes('|')) {
    const parts = text.split('|').map((s) => s.trim()).filter(Boolean);
    const explicit = parts.every((p) => p.includes('='));
    const points = parts.map((part, i) => {
      if (explicit) {
        const eq = part.indexOf('=');
        const rawValue = part.slice(0, eq).trim();
        const label = part.slice(eq + 1).trim();
        return { value: isFinite(Number(rawValue)) && rawValue !== '' ? Number(rawValue) : rawValue, label };
      }
      // Bare labels: the label is also the value, matching what the old
      // runtime stored so existing responses keep resolving.
      return { value: part, label: part };
    });
    if (points.length < 2) {
      return { scaleId: 'numeric-5', warning: `Rating Scale "${text}" has fewer than two points; defaulted to Numeric 1-5.` };
    }
    return { scaleId: CUSTOM_SCALE_ID, scale: points };
  }

  return {
    scaleId: 'numeric-5',
    warning: `Rating Scale "${text}" did not match a library scale id or name; defaulted to Numeric 1-5.`,
  };
}

/**
 * Render a question's scale back out to a template cell, so export/import is
 * lossless for library-backed questions.
 * @param {any} question
 */
export function formatScaleCell(question) {
  if (question.scaleId && question.scaleId !== CUSTOM_SCALE_ID) return question.scaleId;
  const points = question.scale || [];
  if (!points.length) return '';
  return points.map((p) => {
    const value = p && typeof p === 'object' ? p.value : p;
    const label = p && typeof p === 'object' ? p.label : p;
    return String(value) === String(label) ? String(label) : `${value}=${label}`;
  }).join(' | ');
}
