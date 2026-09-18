// @ts-check
/**
 * Rating question rendering.
 *
 * Split out of player.js because labeled scales need real layout thought: five
 * numeric boxes work fine in a row, but "Strongly Agree ... Strongly Disagree"
 * does not. The renderer picks a layout from the content:
 *
 *   compact  - every label is short (numbers). Chips in a row.
 *   listed   - any label is long. One row per point, value badge + label,
 *              which also reads correctly on a phone and for screen readers.
 *
 * Ships verbatim inside the exported package. No third-party code.
 */
import { resolveScalePoints } from './engine/scales.js';

/** Labels longer than this force the stacked layout. */
const COMPACT_LABEL_MAX = 3;

/**
 * @param {any} question
 * @param {any} value current stored response
 * @param {(value:string)=>void} onChange
 * @param {string} labelledBy id of the prompt element
 * @returns {any}
 */
export function renderRating(question, value, onChange, labelledBy) {
  const points = resolveScalePoints(question);
  const compact = points.length > 0 && points.every((p) => String(p.label).length <= COMPACT_LABEL_MAX);

  const group = el('div', compact ? 'sowb-rating sowb-rating-compact' : 'sowb-rating sowb-rating-listed');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', labelledBy);
  group.setAttribute('data-rating-layout', compact ? 'compact' : 'listed');

  points.forEach((point) => {
    const raw = String(point.value);
    const label = String(point.label);
    const item = el('label', compact ? 'sowb-rating-item' : 'sowb-rating-row');

    const input = el('input');
    input.type = 'radio';
    input.name = question.id;
    input.value = raw;
    input.checked = String(value) === raw;
    input.setAttribute('data-q', question.id);
    input.setAttribute('data-value', raw);
    // When the label differs from the value, the accessible name must carry
    // both so a screen reader announces "2, Agree" rather than a bare number.
    input.setAttribute('aria-label', label === raw ? label : `${raw}, ${label}`);
    input.addEventListener('change', () => onChange(raw));
    item.appendChild(input);

    if (compact) {
      const span = el('span', 'sowb-rating-label');
      span.textContent = label;
      item.appendChild(span);
    } else {
      // Show the value as a small badge so the learner can see the underlying
      // scale position, then the wording next to it.
      const badge = el('span', 'sowb-rating-value');
      badge.textContent = raw;
      badge.setAttribute('aria-hidden', 'true');
      const span = el('span', 'sowb-rating-label');
      span.textContent = label;
      item.appendChild(badge);
      item.appendChild(span);
    }
    group.appendChild(item);
  });

  // Anchor captions help orient the learner on a compact numeric scale that
  // has meaning at its ends.
  if (compact && (question.minLabel || question.maxLabel)) {
    const anchors = el('div', 'sowb-rating-anchors');
    const lo = el('span', 'sowb-rating-anchor');
    lo.textContent = question.minLabel || '';
    const hi = el('span', 'sowb-rating-anchor');
    hi.textContent = question.maxLabel || '';
    anchors.appendChild(lo);
    anchors.appendChild(hi);
    const wrap = el('div', 'sowb-rating-wrap');
    wrap.appendChild(group);
    wrap.appendChild(anchors);
    return wrap;
  }
  return group;
}

function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}
