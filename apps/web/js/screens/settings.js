// @ts-check
import { h } from '../ui.js';

const DEFAULT_HEADING = 'Your observation workbook';

export function renderSettings(mount, { store }) {
  const wb = store.workbook;

  const textField = (label, get, set, opts = {}) => h('label.field', [
    h('span.field-label', label),
    opts.textarea
      ? h('textarea', { rows: 3, value: get() || '', oninput: (e) => store.update(() => set(e.target.value)) })
      : h('input', { type: 'text', value: get() || '', placeholder: opts.placeholder || '', oninput: (e) => store.update(() => set(e.target.value)) }),
    opts.hint ? h('span.field-hint', opts.hint) : null,
  ]);
  const selectField = (label, get, set, options) => h('label.field', [
    h('span.field-label', label),
    h('select', { onchange: (e) => store.update(() => set(e.target.value)) },
      options.map((o) => h('option', { value: o.value, selected: get() === o.value }, o.label))),
  ]);

  mount.appendChild(h('div.screen-inner', [
    h('h1.screen-title', 'Workbook Settings'),
    h('p.screen-sub', 'Metadata and behavior for this observation workbook. These values feed the SCORM manifest and the runtime.'),

    h('div.card', [
      h('h2.card-title', 'Metadata'),
      h('div.grid-2', [
        textField('Title', () => wb.title, (v) => (wb.title = v)),
        textField('Version', () => wb.version, (v) => (wb.version = v)),
        textField('Author', () => wb.author, (v) => (wb.author = v)),
        textField('Course ID', () => wb.courseId, (v) => (wb.courseId = v), { hint: 'Used for the SCORM identifier and file names. Letters, numbers, dashes.' }),
        textField('Language', () => wb.settings.language, (v) => (wb.settings.language = v)),
        textField('Estimated Duration', () => wb.estimatedDuration, (v) => (wb.estimatedDuration = v), { hint: 'e.g. "3 months"' }),
      ]),
      textField('Description', () => wb.description, (v) => (wb.description = v), { textarea: true }),
    ]),

    h('div.card', [
      h('h2.card-title', 'Learner experience'),
      textField('Dashboard heading', () => wb.settings.dashboardHeading, (v) => (wb.settings.dashboardHeading = v), {
        placeholder: DEFAULT_HEADING,
        hint: `Heading shown above the section list in the learner runtime, e.g. "Your Milestones". Leave blank to use "${DEFAULT_HEADING}".`,
      }),
      h('label.check-row', [
        h('input', {
          type: 'checkbox', checked: wb.settings.allowPdfDownload !== false,
          onchange: (e) => store.update(() => { wb.settings.allowPdfDownload = e.target.checked; }),
        }),
        h('span', 'Allow learners to download a PDF of their responses'),
      ]),
      h('p.field-hint', 'Adds a button in the runtime header that exports the learner\u2019s answers for the ENTIRE workbook as a PDF. The PDF never reveals which checklist options were marked Expected.'),
    ]),

    h('div.card', [
      h('h2.card-title', 'Behavior'),
      h('div.grid-2', [
        selectField('Navigation', () => wb.settings.navigation, (v) => (wb.settings.navigation = v), [
          { value: 'free', label: 'Free - open any unlocked section' },
          { value: 'linear', label: 'Linear - finish a section to unlock the next' },
        ]),
        selectField('Completion Rule', () => wb.settings.completionRule, (v) => (wb.settings.completionRule = v), [
          { value: 'all-required-sections', label: 'All required sections complete' },
        ]),
      ]),
      h('label.check-row', [
        h('input', { type: 'checkbox', checked: !!wb.settings.reportSuccess, onchange: (e) => store.update(() => { wb.settings.reportSuccess = e.target.checked; }) }),
        h('span', 'Also report cmi.success_status (most observation workbooks report completion only)'),
      ]),
      h('label.check-row', [
        h('input', { type: 'checkbox', checked: wb.settings.reportInteractions !== false, onchange: (e) => store.update(() => { wb.settings.reportInteractions = e.target.checked; }) }),
        h('span', 'Report each answer to the LMS as a cmi.interactions entry'),
      ]),
      h('p.field-hint', 'Lets LMS reports show every question with the learner\u2019s answer and whether it met its requirement. Free-text answers become visible in LMS reporting. Turn off for workbooks with sensitive free text.'),
    ]),
  ]));
}
