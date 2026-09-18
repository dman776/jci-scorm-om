// @ts-check
import { h } from '../ui.js';

export function renderHelp(mount) {
  mount.appendChild(h('div.screen-inner.help', [
    h('h1.screen-title', 'Help & User Guide'),
    h('p.screen-sub', 'Everything you need to author, preview, publish, and upload an observation workbook.'),

    section('What this tool does', [
      p('SOWB-It (the SCORM Observation Workbook Builder Internal Tool) turns ride-alongs, shadowing sessions, install-team meetings, and field observations into a digital workbook that a learner completes progressively over days or weeks. It exports a self-contained package you upload to any SCORM 2004 4th Edition compliant LMS.'),
      p('Learners can exit at any time and resume where they left off. On resume they always return to the section list and choose which section to continue. Their responses auto-save to the LMS after every page and every change.'),
    ]),

    section('Completion states', [
      p('A question is not simply answered or unanswered. It has three states, because a response can exist and still fail its requirement:'),
      list([
        ['Empty', 'No response at all.'],
        ['Partial', 'A response exists but the requirement is unmet: a numeric outside its min/max, a checklist missing an expected option, a malformed link, or a rating value no longer in its scale.'],
        ['Complete', 'A response exists and satisfies the requirement. Only complete responses count.'],
      ]),
      p('Sections roll that up into four states:'),
      list([
        ['Not Started', 'Nothing answered yet.'],
        ['In Progress', 'Some answers exist, but at least one required question is still blank.'],
        ['Partially Complete', 'Nothing is blank, but at least one required question does not meet its requirement.'],
        ['Completed', 'Every required question is complete.'],
      ]),
      p('Note: SCORM 2004 has no "partial" completion value, so a partially complete section still reports the workbook as incomplete to the LMS. The distinction is shown on the learner dashboard and reflected in the progress measure.'),
    ]),

    section('Question types', [
      list([
        ['Short text', 'Single-line response.'],
        ['Long text', 'Multi-line reflection or narrative.'],
        ['Yes / No', 'Two-choice observation.'],
        ['Numeric', 'A number, with optional inclusive minimum and maximum and an optional whole-numbers-only rule.'],
        ['URL / link', 'A valid http:// or https:// link. Invalid text is partial. Valid links render as a clickable preview.'],
        ['Rating', 'A point from a rating scale. Scales come from the Rating Scales library, or can be one-off per question.'],
        ['Checklist', 'Behavioral items the learner checks off. Options marked Expected must all be selected.'],
        ['Single select', 'One choice from a list (post-MVP).'],
        ['Multiple select', 'One or more choices; supports Expected options (post-MVP).'],
        ['Date', 'When the activity occurred (post-MVP).'],
        ['Acknowledgement', 'A confirmation checkbox (post-MVP).'],
        ['Evidence reference', 'Records file metadata only. It never stores the file inside SCORM (post-MVP).'],
      ]),
    ]),

    section('Rating scales', [
      p('The Rating Scales screen manages a global library of reusable scales. Four ship built in: Numeric 1-5, Agreement (Strongly Agree through Strongly Disagree), Frequency (Always through Never), and Confidence (Low / Medium / High). Built-ins cannot be deleted but can be duplicated as a starting point.'),
      p('Each point has a VALUE and a LABEL. The value is stored in the LMS and shown to facilitators; the label is what the learner reads. Rewording a label later is safe. Changing a value is not, because it orphans responses already recorded against the old value, which then show as partial.'),
      p('Scales are resolved and baked into the package when you publish, because the exported SCO is offline and cannot look anything up. That means editing a scale does not change an already-published package: republish to pick up the new wording.'),
      p('Short labels (numbers) render as a row of chips; longer labels render one row per point with a value badge, which reads correctly on a phone and in a screen reader. For a short numeric scale you can add optional end captions, e.g. "Not at all" and "Expert".'),
    ]),

    section('Expected options on checklists', [
      p('On a checklist or multiple select, tick Expected next to any option the learner must select. The question only counts as complete once every expected option is checked. Extra, non-expected selections are allowed and never block completion.'),
      p('Expected options are never visually marked in the learner runtime, so learners cannot see which boxes are required. When a requirement is unmet they see a neutral hint: "Some required items are not yet selected." The downloadable PDF follows the same rule and never reveals the expected options.'),
    ]),

    section('Learner PDF download', [
      p('When enabled, the runtime header shows a PDF button on the section list. Wherever the learner is, the PDF contains the ENTIRE workbook: every section with its status, every question, and their answers, plus overall progress and their name from the LMS.'),
      p('Unanswered questions appear as "Not answered", and partial answers carry the same neutral requirement hint the runtime shows. The PDF is generated entirely inside the SCO with no server call, so it works offline in the LMS.'),
      p('Turn it off per workbook on Workbook Settings, or with the "Allow PDF Download" key in the Excel Settings sheet. It defaults to on.'),
      p('If your LMS hosts the course in a sandboxed frame that blocks downloads, the browser may silently ignore the download. The runtime always shows a fallback link ("Open the PDF in a new tab") so learners can still save it. Test this in your own LMS sandbox before wide release.'),
    ]),

    section('Section titles', [
      p('Section cards and PDF headings show the author\u2019s title verbatim, with no "Section N:" prefix, so titles like "Month 1" read naturally.'),
      p('The heading above the section list is also editable on Workbook Settings, e.g. "Your Milestones".'),
    ]),

    section('Bulk authoring with Excel', [
      p('From the Library screen, download the Excel template. It has Instructions, Settings, Sections, and Questions sheets with a working example. Fill it in, then import it back to load a whole workbook at once.'),
      p('In the Questions sheet, prefix an option with an asterisk to mark it expected, for example "Scope review | *Safety plan". The Rating Scale column accepts a scale id, a scale name, explicit points like "1=Strongly Agree | 2=Agree", bare labels, or 1-5. Use Min, Max, and Whole Numbers for numeric questions. Columns are matched by header name, so older templates still import cleanly.'),
    ]),

    section('Publishing and uploading to your LMS', [
      p('The package targets any SCORM 2004 4th Edition compliant LMS.'),
      ol([
        'On the Publish screen, resolve any blocking errors (warnings are advisory).',
        'Select "Build SCORM ZIP" to download the package (index.html and imsmanifest.xml sit at the ZIP root).',
        'In your LMS, create a lesson and upload the ZIP as SCORM 2004 content.',
        'Set the lesson to track completion. The workbook reports completed / incomplete and a progress measure automatically.',
        'Recommended: validate the package with the ADL SCORM 2004 4th Edition Test Suite, and confirm the PDF download works, before wide release.',
      ]),
    ]),

    section('Data, saving, and limits', [
      p('Learner responses are stored compactly (ids and values only, no prompt text) in cmi.suspend_data, which SCORM 2004 guarantees to hold at least 64000 characters. The Publish screen estimates worst-case usage and warns before you get close to the limit.'),
    ]),
  ]));
}
function section(title, children) { return h('section.help-section', [h('h2.card-title', title), ...children]); }
function p(text) { return h('p', text); }
function ol(items) { return h('ol.help-ol', items.map((i) => h('li', i))); }
function list(pairs) { return h('ul.help-dl', pairs.map(([k, v]) => h('li', [h('strong', k + ': '), v]))); }
