// @ts-check
/**
 * Rating question rendering.
 *
 * A rating is a single slider over the scale's points. The slider position is
 * an index into the points; the stored response is always the point's VALUE,
 * never its label. Labels are shown as tick captions (all of them when every
 * label is short, otherwise just the two ends) and the current point is read
 * out above the track, which also keeps long wording legible on a phone.
 *
 * Until the learner interacts, the slider is shown inactive and nothing is
 * stored, so an untouched slider never counts as an answer.
 *
 * Ships verbatim inside the exported package. No third-party code.
 */
import { resolveScalePoints } from './engine/scales.js';

/** Labels longer than this show only at the scale ends. */
const COMPACT_LABEL_MAX = 3;

/**
 * @param {any} question
 * @param {any} value current stored response
 * @param {(value:string)=>void} onChange
 * @param {string} labelledBy id of the prompt element
 * @returns {any}
 */
export function renderRating(question, value, onChange, labelledBy) {
  const points = orderLowToHigh(resolveScalePoints(question));
  const compact = points.length > 0 && points.every((p) => String(p.label).length <= COMPACT_LABEL_MAX);
  const last = Math.max(points.length - 1, 0);

  let index = points.findIndex((p) => String(p.value) === String(value));
  let answered = index >= 0;
  if (!answered) index = Math.floor(last / 2);

  const wrap = el('div', 'sowb-rating sowb-rating-slider');
  wrap.setAttribute('data-rating-layout', compact ? 'compact' : 'listed');

  const readout = el('div', 'sowb-rating-readout');
  readout.setAttribute('aria-hidden', 'true');
  const badge = el('span', 'sowb-rating-value');
  const text = el('span', 'sowb-rating-current');
  readout.appendChild(badge);
  readout.appendChild(text);

  const input = el('input', 'sowb-rating-range');
  input.type = 'range';
  input.min = '0';
  input.max = String(last);
  input.step = '1';
  input.value = String(index);
  input.setAttribute('data-q', question.id);
  input.setAttribute('aria-labelledby', labelledBy);

  function paint() {
    const point = points[index];
    wrap.className = 'sowb-rating sowb-rating-slider' + (answered ? ' answered' : '');
    if (!point) return;
    const raw = String(point.value);
    const label = String(point.label);
    input.setAttribute('data-value', answered ? raw : '');
    // Announce both value and wording ("4, Agree") but not "1, 1" for a bare number.
    input.setAttribute('aria-valuetext', answered ? (label === raw ? label : `${raw}, ${label}`) : 'No answer yet');
    badge.textContent = answered ? raw : '';
    text.textContent = answered ? (label === raw ? '' : label) : 'Drag or use arrow keys to answer';
  }

  function commit() {
    const point = points[Number(input.value)];
    if (!point) return;
    index = Number(input.value);
    const changed = !answered || String(point.value) !== String(value);
    answered = true;
    value = String(point.value);
    paint();
    if (changed) onChange(value);
  }
  // `input` fires while dragging and for keyboard steps; `click` covers a tap
  // on the thumb where it already sits, which moves nothing.
  input.addEventListener('input', commit);
  input.addEventListener('change', commit);
  input.addEventListener('click', () => { if (!answered) commit(); });

  // Every stop gets a tick mark and its own label, positioned to line up with
  // where the slider thumb sits at that stop.
  const ticks = el('div', 'sowb-rating-ticks');
  ticks.setAttribute('aria-hidden', 'true');
  ticks.setAttribute('style', `--last:${Math.max(last, 1)}`);
  points.forEach((point, i) => {
    const stop = el('span', 'sowb-rating-stop');
    stop.setAttribute('style', `--f:${last ? i / last : 0.5}`);
    stop.appendChild(el('span', 'sowb-rating-tick'));
    const label = el('span', 'sowb-rating-label');
    label.textContent = String(point.label);
    stop.appendChild(label);
    ticks.appendChild(stop);
  });

  wrap.appendChild(readout);
  wrap.appendChild(input);
  wrap.appendChild(ticks);

  // Anchor captions help orient the learner on a numeric scale that has
  // meaning at its ends.
  if (compact && (question.minLabel || question.maxLabel)) {
    const anchors = el('div', 'sowb-rating-anchors');
    const lo = el('span', 'sowb-rating-anchor');
    lo.textContent = question.minLabel || '';
    const hi = el('span', 'sowb-rating-anchor');
    hi.textContent = question.maxLabel || '';
    anchors.appendChild(lo);
    anchors.appendChild(hi);
    wrap.appendChild(anchors);
  }
  paint();
  return wrap;
}

/**
 * Slider order is lowest on the left, highest on the right. Numeric scales
 * sort by value (the library lists some high-to-low, e.g. 5 = Strongly Agree);
 * word-valued scales rank by their listed order, so they are left as authored.
 */
export function orderLowToHigh(points) {
  const numeric = points.length > 0 && points.every((p) => p.value !== '' && isFinite(Number(p.value)));
  return numeric ? [...points].sort((a, b) => Number(a.value) - Number(b.value)) : points;
}

function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}
