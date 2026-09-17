// @ts-check
import { h } from '../ui.js';

export function renderHelp(mount) {
  mount.appendChild(h('div.screen-inner.help', [
    h('h1.screen-title', 'Help & User Guide'),
    h('p.screen-sub', 'Everything you need to author, preview, publish, and upload an observation workbook.'),

    section('What this tool does', [
      p('The SCORM Observation Workbook Builder turns ride-alongs, shadowing sessions, install-team meetings, and field observations into a digital workbook that a learner completes progressively over days or weeks. It exports a self-contained SCORM 2004 4th Edition package you upload to Workday Learning.'),
      p('Learners can exit at any time and resume where they left off. On resume they always return to the section list and choose which section to continue. Their responses auto-save to the LMS after every page and every change.'),
    ]),

    section('Completion states', [
      p('A question is not simply answered or unanswered. It has three states, because a response can exist and still fail its requirement:'),
      list([
        ['Empty', 'No response at all.'],
        ['Partial', 'A response exists but the requirement is unmet: a numeric value outside its min/max, a checklist missing an expected option, or a malformed link.'],
        ['Complete', 'A response exists and satisfies the requirement. Only complete responses count.'],
      ]),
      p('Sections roll that up into four states:'),
      list([
        ['Not Started', 'Nothing answered yet.'],
        ['In Progress', 'Some answers exist, but at least one required question is still blank.'],
        ['Partially Complete', 'Nothing is blank, but at least one required question does not meet its requirement.'],
        ['Completed', 'Every required question is complete.'],
      ]),
      p('Note: SCORM 2004 has no "partial" completion value, so a partially complete section still reports the workbook as incomplete to Workday Learning. The distinction is shown on the learner dashboard and reflected in the progress measure.'),
    ]),

    section('Core concepts', [
      list([
        ['Workbook', 'The whole learning object. One SCORM package = one workbook.'],
        ['Section', 'An ordered group of questions. Sections can be Required or Optional. Only required sections gate completion.'],
        ['Question', 'A single observation prompt with its own completion requirement.'],
        ['Completion', 'The workbook reports "completed" only when every required section is Completed.'],
        ['Progress', 'cmi.progress_measure counts required questions that are complete, across required sections, so the bar moves as the learner works.'],
      ]),
    ]),

    section('Question types', [
      list([
        ['Short text', 'Single-line response.'],
        ['Long text', 'Multi-line reflection or narrative.'],
        ['Yes / No', 'Two-choice observation.'],
        ['Numeric', 'A number, with optional inclusive minimum and maximum and an optional whole-numbers-only rule. A value outside the range is partial, not complete.'],
        ['URL / link', 'A valid http:// or https:// link, for example a SharePoint document or Teams recording. Invalid text is partial. Valid links render as a clickable preview.'],
        ['Rating', 'Numeric 1-5 or Low / Medium / High.'],
        ['Checklist', 'Several behavioral items the learner checks off. Options marked Expected must all be selected.'],
        ['Single select', 'One choice from a list (post-MVP).'],
        ['Multiple select', 'One or more choices; supports Expected options (post-MVP).'],
        ['Date', 'When the activity occurred (post-MVP).'],
        ['Acknowledgement', 'A confirmation checkbox (post-MVP).'],
        ['Evidence reference', 'Records file metadata only (name, type, date). It never stores the file inside SCORM (post-MVP).'],
      ]),
    ]),

    section('Expected options on checklists', [
      p('On a checklist or multiple select, tick Expected next to any option the learner must select. The question only counts as complete once every expected option is checked. Extra, non-expected selections are allowed and never block completion.'),
      p('Expected options are never visually marked in the learner runtime, so learners cannot see which boxes are required. When a requirement is unmet they see a neutral hint: "Some required items are not yet selected."'),
      p('If no options are marked Expected, any selection completes the question, which is the original behavior.'),
    ]),

    section('Numeric rules', [
      p('Set an optional Minimum and Maximum on a numeric question. Bounds are inclusive, so a minimum of 4 means 4 passes. For example, "How many meetings did you have this week?" with a minimum of 4 stays partial until the learner enters 4 or more. Tick Whole numbers only to reject decimals.'),
    ]),

    section('Customizing the dashboard heading', [
      p('The heading above the section list is editable. On Workbook Settings, set Dashboard heading to whatever suits the program, for example "Your Milestones" or "Your Observations". Leave it blank to use the default, "Your observation workbook".'),
    ]),

    section('Authoring workflow', [
      ol([
        'Workbook Settings: title, version, author, course ID, language, dashboard heading, navigation, and completion behavior.',
        'Sections: add sections in the left rail, mark each Required or Optional, then add questions in the center editor.',
        'For each question set the prompt, response type, required flag, help text, and any completion rule (expected options, numeric bounds).',
        'Preview: run the real learner runtime against a mock LMS and test exit + resume.',
        'Publish: validate, then build the SCORM ZIP.',
      ]),
    ]),

    section('Bulk authoring with Excel', [
      p('From the Library screen, download the Excel template. It has Instructions, Settings, Sections, and Questions sheets with a working example. Fill it in, then import it back to load a whole workbook at once.'),
      p('In the Questions sheet, prefix an option with an asterisk to mark it expected, for example "Scope review | *Safety plan". Use the Min, Max, and Whole Numbers columns for numeric questions, and add a Dashboard Heading key in the Settings sheet. You can also import and export the whole workbook as project JSON.'),
    ]),

    section('Preview and the SCORM debug panel', [
      p('The Preview screen runs the exact runtime that ships in your package, wired to a mock LMS. Turn on the SCORM debug panel to watch cmi.completion_status, cmi.progress_measure, cmi.location, and suspend-data size update live. Use "Exit + resume" to prove that closing and relaunching returns the learner to the section list with every answer restored.'),
    ]),

    section('Publishing and uploading to Workday Learning', [
      ol([
        'On the Publish screen, resolve any blocking errors (warnings are advisory).',
        'Select "Build SCORM ZIP" to download the package (index.html and imsmanifest.xml sit at the ZIP root).',
        'In Workday Learning, create a lesson and upload the ZIP as SCORM 2004 content.',
        'Set the lesson to track completion. The workbook reports completed / incomplete and a progress measure automatically.',
        'Recommended: validate the package with the ADL SCORM 2004 4th Edition Test Suite before wide release.',
      ]),
    ]),

    section('Data, saving, and limits', [
      p('Learner responses are stored compactly (ids only, no prompt text) in cmi.suspend_data, which SCORM 2004 guarantees to hold at least 64000 characters. The Publish screen estimates worst-case usage and warns before you get close to the limit.'),
    ]),
  ]));
}

function section(title, children) { return h('section.help-section', [h('h2.card-title', title), ...children]); }
function p(text) { return h('p', text); }
function ol(items) { return h('ol.help-ol', items.map((i) => h('li', i))); }
function list(pairs) { return h('ul.help-dl', pairs.map(([k, v]) => h('li', [h('strong', k + ': '), v]))); }
