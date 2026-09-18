// @ts-check
import { h } from '../ui.js';
import { newOptionId } from '../ids-browser.js';
import { renderRatingEditor } from './rating-editor.js';

const ALL_TYPES = [
  { value: 'short_text', label: 'Short text', mvp: true },
  { value: 'long_text', label: 'Long text / reflection', mvp: true },
  { value: 'yes_no', label: 'Yes / No', mvp: true },
  { value: 'numeric', label: 'Numeric', mvp: true },
  { value: 'url', label: 'URL / link', mvp: true },
  { value: 'rating', label: 'Rating', mvp: true },
  { value: 'checklist', label: 'Checklist', mvp: true },
  { value: 'single_select', label: 'Single select', mvp: false },
  { value: 'multiple_select', label: 'Multiple select', mvp: false },
  { value: 'datetime', label: 'Date', mvp: false },
  { value: 'acknowledgement', label: 'Acknowledgement', mvp: false },
  { value: 'evidence_ref', label: 'Evidence reference (metadata only)', mvp: false },
];
const CHOICE_TYPES = ['single_select', 'multiple_select', 'checklist'];
/** Types where an option flagged "expected" must be selected to complete. */
const EXPECTED_GATED = ['checklist', 'multiple_select'];

let selectedSectionId = null;
/** Scale library, fetched once and reused across re-renders. */
let scaleLibrary = null;

export async function renderEditor(mount, { store, api }) {
  // Load the library once so the rating picker has it synchronously afterwards.
  if (scaleLibrary === null) {
    try { scaleLibrary = await api.listScales(); } catch (_) { scaleLibrary = []; }
  }
  draw(mount, store, api);
}

function draw(mount, store, api) {
  const wb = store.workbook;
  if (!selectedSectionId || !wb.sections.find((s) => s.id === selectedSectionId)) {
    selectedSectionId = wb.sections[0] ? wb.sections[0].id : null;
  }
  const rerender = () => { mount.innerHTML = ''; draw(mount, store, api); };
  mount.innerHTML = '';
  mount.appendChild(h('div.editor-layout', [
    renderRail(wb, store, rerender),
    renderCenter(wb, store, rerender),
  ]));
}

function renderRail(wb, store, rerender) {
  return h('aside.section-rail', [
    h('div.rail-head', [
      h('h2.rail-title', 'Sections'),
      h('button.btn.small', {
        onclick: () => { store.addSection(); selectedSectionId = wb.sections[wb.sections.length - 1].id; rerender(); },
      }, '+ Add'),
    ]),
    wb.sections.length === 0
      ? h('p.rail-empty', 'No sections yet. Add your first section to start authoring.')
      : h('ul.rail-list', wb.sections.map((s, i) => h('li.rail-item' + (s.id === selectedSectionId ? '.active' : ''), {
        onclick: () => { selectedSectionId = s.id; rerender(); },
      }, [
        h('div.rail-item-main', [h('span.rail-num', String(i + 1)), h('span.rail-name', s.title || 'Untitled')]),
        h('div.rail-item-sub', [
          h('span.badge' + (s.required ? '.req' : '.opt'), s.required ? 'Required' : 'Optional'),
          h('span.rail-count', `${s.questions.length} item${s.questions.length === 1 ? '' : 's'}`),
        ]),
        h('div.rail-item-actions', [
          iconBtn('\u2191', 'Move up', (e) => { e.stopPropagation(); store.moveSection(s.id, -1); rerender(); }),
          iconBtn('\u2193', 'Move down', (e) => { e.stopPropagation(); store.moveSection(s.id, 1); rerender(); }),
          iconBtn('\u29c9', 'Duplicate', (e) => { e.stopPropagation(); store.duplicateSection(s.id); rerender(); }),
          iconBtn('\u2715', 'Delete', (e) => { e.stopPropagation(); if (confirm('Delete this section?')) { store.deleteSection(s.id); rerender(); } }),
        ]),
      ]))),
  ]);
}

function renderCenter(wb, store, rerender) {
  const section = wb.sections.find((s) => s.id === selectedSectionId);
  if (!section) {
    return h('div.editor-center', [h('div.empty-state', [
      h('h2', 'Author your observation workbook'),
      h('p', 'Create a section on the left, then add observation questions here. A section completes when every required question in it has a response that meets its requirement.'),
    ])]);
  }
  return h('div.editor-center', [
    h('div.card', [
      h('div.section-head', [
        h('label.field.grow', [
          h('span.field-label', 'Section title'),
          h('input', { type: 'text', value: section.title, oninput: (e) => store.update(() => { section.title = e.target.value; }) }),
          h('span.field-hint', 'Shown verbatim to the learner, e.g. "Month 1". No "Section N:" prefix is added.'),
        ]),
        h('label.check-row.nowrap', [
          h('input', { type: 'checkbox', checked: section.required, onchange: (e) => store.update(() => { section.required = e.target.checked; }) }),
          h('span', 'Required (gates completion)'),
        ]),
        h('label.check-row.nowrap', {
          title: 'A locked section can still be reopened and read; only its answers are frozen.',
        }, [
          h('input', {
            type: 'checkbox', checked: !!section.lockWhenComplete,
            onchange: (e) => { store.update(() => { section.lockWhenComplete = e.target.checked; }); rerender(); },
          }),
          h('span', 'Lock answers when complete'),
        ]),
      ]),
      section.lockWhenComplete ? h('p.block-hint', lockHint(section)) : null,
    ]),
    h('div.q-list', section.questions.map((q, qi) => renderQuestionCard(section, q, qi, store, rerender))),
    h('div.add-q-bar', [
      h('span.add-q-label', 'Add question:'),
      h('div.type-chips', ALL_TYPES.map((t) => h('button.chip' + (t.mvp ? '.mvp' : ''), {
        title: t.mvp ? 'MVP type' : 'Post-MVP type',
        onclick: () => { store.addQuestion(section.id, t.value); rerender(); },
      }, t.label))),
    ]),
  ]);
}

function renderQuestionCard(section, q, qi, store, rerender) {
  const typeMeta = ALL_TYPES.find((t) => t.value === q.type) || { label: q.type };
  return h('div.q-card', [
    h('div.q-card-head', [
      h('span.q-index', String(qi + 1)),
      h('span.q-type-tag', typeMeta.label),
      h('div.q-card-actions', [
        iconBtn('\u2191', 'Move up', () => { store.moveQuestion(section.id, q.id, -1); rerender(); }),
        iconBtn('\u2193', 'Move down', () => { store.moveQuestion(section.id, q.id, 1); rerender(); }),
        iconBtn('\u29c9', 'Duplicate', () => { store.duplicateQuestion(section.id, q.id); rerender(); }),
        iconBtn('\u2715', 'Delete', () => { if (confirm('Delete this question?')) { store.deleteQuestion(section.id, q.id); rerender(); } }),
      ]),
    ]),
    h('label.field', [
      h('span.field-label', 'Prompt'),
      h('input', { type: 'text', value: q.prompt, oninput: (e) => store.update(() => { q.prompt = e.target.value; }) }),
    ]),
    h('div.grid-2', [
      h('label.field', [
        h('span.field-label', 'Response type'),
        h('select', { onchange: (e) => { store.update(() => changeType(q, e.target.value)); rerender(); } },
          ALL_TYPES.map((t) => h('option', { value: t.value, selected: q.type === t.value }, t.label + (t.mvp ? '' : ' (post-MVP)')))),
      ]),
      h('label.check-row.mid', [
        h('input', { type: 'checkbox', checked: q.required, onchange: (e) => store.update(() => { q.required = e.target.checked; }) }),
        h('span', 'Required'),
      ]),
    ]),
    h('label.field', [
      h('span.field-label', 'Help text (optional)'),
      h('input', { type: 'text', value: q.helpText || '', oninput: (e) => store.update(() => { q.helpText = e.target.value; }) }),
    ]),
    CHOICE_TYPES.includes(q.type) ? renderOptions(q, store, rerender) : null,
    q.type === 'rating' ? renderRatingEditor(q, store, rerender, scaleLibrary || []) : null,
    q.type === 'numeric' ? renderNumeric(q, store, rerender) : null,
    q.type === 'url' ? renderUrlNote() : null,
  ]);
}

function renderOptions(q, store, rerender) {
  if (!q.options) q.options = [];
  const gated = EXPECTED_GATED.includes(q.type);
  const expectedCount = q.options.filter((o) => o.expected).length;
  return h('div.options-block', [
    h('span.field-label', 'Options'),
    gated
      ? h('p.block-hint', expectedCount
          ? `The learner must select all ${expectedCount} option${expectedCount === 1 ? '' : 's'} marked Expected for this question to count as complete. Expected options are never marked for the learner.`
          : 'Mark an option Expected to require the learner to select it. With none marked, any selection completes the question.')
      : h('p.block-hint', 'Expected gating applies only to checklist and multiple select.'),
    h('ul.opt-list', q.options.map((o) => h('li.opt-row', [
      h('input', { type: 'text', value: o.label, oninput: (e) => store.update(() => { o.label = e.target.value; }) }),
      h('label.opt-expected' + (o.expected ? '.on' : ''), {
        title: gated ? 'The learner must select this option to complete the question.' : 'Expected has no effect on this question type.',
      }, [
        h('input', { type: 'checkbox', checked: !!o.expected, disabled: !gated,
          onchange: (e) => { store.update(() => { o.expected = e.target.checked; }); rerender(); } }),
        h('span', 'Expected'),
      ]),
      iconBtn('\u2715', 'Remove option', () => { store.update(() => { q.options = q.options.filter((x) => x.id !== o.id); }); rerender(); }),
    ]))),
    h('button.btn.small.ghost', {
      onclick: () => { store.update(() => q.options.push({ id: newOptionId(), label: 'New option' })); rerender(); },
    }, '+ Add option'),
  ]);
}

function renderNumeric(q, store, rerender) {
  const numOrEmpty = (v) => (v === undefined || v === null || v === '' ? '' : String(v));
  const setBound = (key, raw) => {
    const s = String(raw).trim();
    if (s === '') delete q[key];
    else if (isFinite(Number(s))) q[key] = Number(s);
  };
  const invalid = isNum(q.min) && isNum(q.max) && Number(q.min) > Number(q.max);
  return h('div.numeric-block', [
    h('span.field-label', 'Numeric rule'),
    h('p.block-hint', 'Bounds are inclusive and each is optional. A value outside the range counts as a partial response and does not complete the question.'),
    h('div.grid-2', [
      h('label.field', [h('span.field-label', 'Minimum'),
        h('input', { type: 'number', value: numOrEmpty(q.min), placeholder: 'none',
          oninput: (e) => { store.update(() => setBound('min', e.target.value)); rerender(); } })]),
      h('label.field', [h('span.field-label', 'Maximum'),
        h('input', { type: 'number', value: numOrEmpty(q.max), placeholder: 'none',
          oninput: (e) => { store.update(() => setBound('max', e.target.value)); rerender(); } })]),
    ]),
    h('label.check-row', [
      h('input', { type: 'checkbox', checked: !!q.integerOnly, onchange: (e) => store.update(() => { q.integerOnly = e.target.checked; }) }),
      h('span', 'Whole numbers only'),
    ]),
    invalid ? h('p.block-error', 'Minimum is greater than maximum. This blocks export.') : null,
    h('p.block-hint', previewRule(q)),
  ]);
}

function renderUrlNote() {
  return h('div.url-block', [
    h('span.field-label', 'Link rule'),
    h('p.block-hint', 'The learner must enter a valid http:// or https:// link. Anything else counts as a partial response and does not complete the question. Valid links render as a clickable preview.'),
  ]);
}

/** States exactly when the lock bites, including the no-required-questions trap. */
function lockHint(section) {
  const required = (section.questions || []).filter((q) => q.required).length;
  if (required === 0) {
    return 'Careful: this section has no required questions, so it completes on the learner’s very first answer and locks as soon as they leave, with every other item still blank.';
  }
  return `The learner edits freely while inside this section. It locks when they leave it with all ${required} required question${required === 1 ? '' : 's'} complete, and cannot be reopened for editing.`;
}

function previewRule(q) {
  const hasMin = isNum(q.min), hasMax = isNum(q.max);
  const whole = q.integerOnly ? ' Whole numbers only.' : '';
  if (hasMin && hasMax) return `Learner sees: "Enter a value between ${q.min} and ${q.max}."${whole}`;
  if (hasMin) return `Learner sees: "Enter at least ${q.min}."${whole}`;
  if (hasMax) return `Learner sees: "Enter no more than ${q.max}."${whole}`;
  return 'No bounds set: any number completes this question.' + whole;
}

function changeType(q, type) {
  q.type = type;
  if (CHOICE_TYPES.includes(type)) {
    if (!q.options || !q.options.length) q.options = [{ id: newOptionId(), label: 'Option 1' }, { id: newOptionId(), label: 'Option 2' }];
    delete q.scaleId; delete q.scale; delete q.scaleName; delete q.minLabel; delete q.maxLabel;
    delete q.min; delete q.max; delete q.integerOnly;
  } else if (type === 'rating') {
    if (!q.scaleId && !(q.scale && q.scale.length)) q.scaleId = 'numeric-5';
    delete q.options; delete q.min; delete q.max; delete q.integerOnly;
  } else if (type === 'numeric') {
    delete q.options; delete q.scaleId; delete q.scale; delete q.scaleName; delete q.minLabel; delete q.maxLabel;
  } else {
    delete q.options; delete q.scaleId; delete q.scale; delete q.scaleName;
    delete q.minLabel; delete q.maxLabel; delete q.min; delete q.max; delete q.integerOnly;
  }
}

function isNum(v) { return v !== undefined && v !== null && v !== '' && isFinite(Number(v)); }
function iconBtn(glyph, title, onclick) { return h('button.icon-btn', { title, onclick }, glyph); }
