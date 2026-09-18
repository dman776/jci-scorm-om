// @ts-check
/**
 * Browser-side copy of the scale helpers.
 *
 * The authoring UI is zero-build vanilla ES modules, so it cannot import
 * @sowb/shared. These are the same pure functions; tests/scale-parity.test.js
 * pins this file to packages/shared/scales.js so they cannot drift apart.
 */
export const CUSTOM_SCALE_ID = '__custom__';

export function normalizeScalePoints(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry === 'object') {
      if (entry.value === undefined && entry.label === undefined) continue;
      const value = entry.value !== undefined ? entry.value : entry.label;
      out.push({ value, label: entry.label !== undefined ? String(entry.label) : String(value) });
      continue;
    }
    out.push({ value: entry, label: String(entry) });
  }
  return out;
}

export function buildScaleIndex(scales = []) {
  const index = {};
  for (const s of scales || []) if (s && s.id) index[s.id] = s;
  return index;
}

export function resolveScalePoints(question, scaleIndex = {}) {
  if (!question) return [];
  const id = question.scaleId;
  if (id && id !== CUSTOM_SCALE_ID) {
    const scale = scaleIndex[id];
    if (scale) return normalizeScalePoints(scale.points);
    return normalizeScalePoints(question.scale);
  }
  return normalizeScalePoints(question.scale);
}
