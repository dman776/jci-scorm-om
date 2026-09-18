// @ts-check
/**
 * Rating question editor block, used by the Sections screen.
 *
 * A picker over the global scale library, plus a "Custom for this question"
 * escape hatch and a live preview of exactly what the learner will see.
 */
import { h } from '../ui.js';
import { CUSTOM_SCALE_ID, normalizeScalePoints, resolveScalePoints, buildScaleIndex } from '../scales-shared.js';

/**
 * @param {any} q the rating question being edited
 * @param {any} store authoring store
 * @param {Function} rerender
 * @param {any[]} scaleLibrary all scales (built-in + author), from the server
 */
export function renderRatingEditor(q, store, rerender, scaleLibrary) {
  const library = scaleLibrary || [];
  const index = buildScaleIndex(library);
  const usingCustom = !q.scaleId || q.scaleId === CUSTOM_SCALE_ID;
  const points = resolveScalePoints(q, index);
  const missing = q.scaleId && q.scaleId !== CUSTOM_SCALE_ID && !index[q.scaleId];

  return h('div.rating-block', [
    h('span.field-label', 'Rating scale'),
    h('label.field', [
      h('select', {
        onchange: (e) => { store.update(() => applyScale(q, e.target.value, index)); rerender(); },
      }, [
        ...library.map((s) => h('option', { value: s.id, selected: q.scaleId === s.id },
          s.name + (s.builtIn ? '' : ' (custom)'))),
        h('option', { value: CUSTOM_SCALE_ID, selected: usingCustom }, 'Custom for this question only'),
      ]),
      h('span.field-hint', usingCustom
        ? 'These points apply to this question alone. Add them to the Rating Scales library if other questions need the same wording.'
        : 'Managed on the Rating Scales screen. Editing it there updates every question using it, but already-published packages keep the wording they were built with.'),
    ]),

    missing ? h('p.block-error', `This question references "${q.scaleId}", which is no longer in the library. Pick another scale, or it will block export.`) : null,

    usingCustom ? renderCustomPoints(q, store, rerender) : null,

    // Anchor captions only make sense when the points themselves are terse.
    points.length && points.every((p) => String(p.label).length <= 3)
      ? h('div.anchor-block', [
          h('span.field-label', 'End captions (optional)'),
          h('p.field-hint', 'Shown under the two ends of a short numeric scale, e.g. "Not at all" and "Expert".'),
          h('div.grid-2', [
            h('label.field', [
              h('span.field-label', 'Low end'),
              h('input', { type: 'text', value: q.minLabel || '', oninput: (e) => store.update(() => { q.minLabel = e.target.value; }) }),
            ]),
            h('label.field', [
              h('span.field-label', 'High end'),
              h('input', { type: 'text', value: q.maxLabel || '', oninput: (e) => store.update(() => { q.maxLabel = e.target.value; }) }),
            ]),
          ]),
        ])
      : null,

    renderPreview(points, q),
  ]);
}

function renderCustomPoints(q, store, rerender) {
  if (!Array.isArray(q.scale) || !q.scale.length) {
    q.scale = [{ value: 1, label: '' }, { value: 2, label: '' }];
  }
  const points = normalizeScalePoints(q.scale);
  return h('div.points-block', [
    h('p.field-hint', 'VALUE is stored in the LMS; LABEL is what the learner reads.'),
    h('div.point-rows', points.map((p, i) => h('div.point-row', [
      h('input.point-value', { type: 'text', value: String(p.value), title: 'Stored value',
        oninput: (e) => store.update(() => { q.scale[i] = { ...points[i], value: coerce(e.target.value) }; }) }),
      h('input.point-label', { type: 'text', value: p.label, placeholder: 'Label',
        oninput: (e) => store.update(() => { q.scale[i] = { ...points[i], label: e.target.value }; }) }),
      h('button.icon-btn', { title: 'Remove point',
        onclick: () => { store.update(() => { q.scale = points.filter((_, j) => j !== i); }); rerender(); } }, '\u2715'),
    ]))),
    h('button.btn.small.ghost', {
      onclick: () => { store.update(() => { q.scale = [...points, { value: points.length + 1, label: '' }]; }); rerender(); },
    }, '+ Add point'),
  ]);
}

/** Live preview so the author sees the learner's view without leaving the editor. */
function renderPreview(points, q) {
  if (!points.length) return null;
  const compact = points.every((p) => String(p.label).length <= 3);
  return h('div.scale-preview', [
    h('span.field-label', 'Learner preview'),
    h('div.preview-body' + (compact ? '.compact' : '.listed'),
      points.map((p) => h('span.preview-point', [
        h('span.preview-value', String(p.value)),
        String(p.label) === String(p.value) ? null : h('span.preview-label', p.label),
      ]))),
    compact && (q.minLabel || q.maxLabel)
      ? h('div.preview-anchors', [h('span', q.minLabel || ''), h('span', q.maxLabel || '')])
      : null,
  ]);
}

/**
 * Switching scales keeps a snapshot of the concrete points on the question, so
 * the workbook still renders if the library entry later disappears.
 */
function applyScale(q, scaleId, index) {
  if (scaleId === CUSTOM_SCALE_ID) {
    const current = resolveScalePoints(q, index);
    q.scaleId = CUSTOM_SCALE_ID;
    q.scale = current.length ? current : [{ value: 1, label: '' }, { value: 2, label: '' }];
    delete q.scaleName;
    return;
  }
  const scale = index[scaleId];
  q.scaleId = scaleId;
  if (scale) {
    q.scale = normalizeScalePoints(scale.points);
    q.scaleName = scale.name;
  }
}

function coerce(raw) {
  const s = String(raw).trim();
  if (s !== '' && isFinite(Number(s))) return Number(s);
  return s;
}
