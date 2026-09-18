// @ts-check
/**
 * Maps between the .xlsx template (Instructions / Settings / Sections /
 * Questions sheets) and the workbook JSON model.
 *
 * Columns are looked up by HEADER NAME, not position, so templates authored
 * against an older column set still import cleanly.
 *
 * Expected options: prefix an option label with `*` to mark it expected, e.g.
 *   Scope review | *Safety plan | Schedule
 *
 * Rating Scale accepts, in precedence order:
 *   agreement-5                    a scale id from the library
 *   Agreement (5-point)            a scale NAME from the library (case-insensitive)
 *   1=Strongly Agree | 2=Agree     explicit value=label pairs (one-off scale)
 *   Low|Medium|High                bare labels; the label doubles as the value,
 *                                  matching legacy behaviour so older templates
 *                                  keep importing unchanged
 *   1-5 or blank                   the built-in numeric-5
 */
import { writeXlsx, readXlsx } from './index.js';
import { newOptionId } from '@sowb/shared/ids.js';
import { buildScaleIndex, listScales, CUSTOM_SCALE_ID } from '@sowb/shared/scales.js';

/**
 * Parse an uploaded xlsx buffer into a workbook object.
 * @param {Buffer|Uint8Array} buffer
 * @param {{customScales?: any[]}} [opts]
 */
export async function importWorkbookXlsx(buffer, opts = {}) {
  const sheets = await readXlsx(buffer);
  const byName = {};
  for (const s of sheets) byName[s.name.trim().toLowerCase()] = s.rows;

  const warnings = [];
  const settingsRows = byName['settings'] || [];
  const sectionRows = byName['sections'] || [];
  const questionRows = byName['questions'] || [];

  if (!sectionRows.length) warnings.push('No "Sections" sheet rows found.');
  if (!questionRows.length) warnings.push('No "Questions" sheet rows found.');

  const settings = parseSettings(settingsRows);
  const sections = parseSections(sectionRows, warnings);
  attachQuestions(sections, questionRows, warnings, opts.customScales || []);

  const workbook = {
    id: settings.id || slug(settings.title || 'imported-workbook'),
    title: settings.title || 'Imported Observation Workbook',
    description: settings.description || '',
    version: settings.version || '1.0',
    author: settings.author || '',
    courseId: settings.courseId || '',
    estimatedDuration: settings.estimatedDuration || '',
    settings: {
      language: settings.language || 'en-US',
      navigation: settings.navigation === 'linear' ? 'linear' : 'free',
      completionRule: 'all-required-sections',
      reportSuccess: toBool(settings.reportSuccess),
      dashboardHeading: settings.dashboardHeading || 'Your observation workbook',
      // Default ON when the key is absent, so older templates keep the button.
      allowPdfDownload: settings.allowPdfDownload === '' || settings.allowPdfDownload === undefined
        ? true : toBool(settings.allowPdfDownload),
    },
    sections: sections.map(({ _order, ...s }) => s),
  };
  return { workbook, warnings };
}

/**
 * Parse a Rating Scale cell.
 * @param {string} raw
 * @param {any[]} [customScales]
 * @returns {{scaleId?:string, scale?:any[], warning?:string}}
 */
export function parseScaleCell(raw, customScales = []) {
  const text = String(raw == null ? '' : raw).trim();
  const all = listScales(customScales);
  const index = buildScaleIndex(customScales);

  // Blank and "1-5" both meant the numeric scale in the old template.
  if (text === '') return { scaleId: 'numeric-5' };
  if (text.toLowerCase() === '1-5') return { scaleId: 'numeric-5' };

  if (index[text]) return { scaleId: text };

  const byName = all.find((s) => s.name.toLowerCase() === text.toLowerCase());
  if (byName) return { scaleId: byName.id };

  if (text.includes('|')) {
    const parts = text.split('|').map((s) => s.trim()).filter(Boolean);
    const explicit = parts.every((p) => p.includes('='));
    const points = parts.map((part) => {
      if (explicit) {
        const eq = part.indexOf('=');
        const rawValue = part.slice(0, eq).trim();
        const label = part.slice(eq + 1).trim();
        return { value: isFinite(Number(rawValue)) && rawValue !== '' ? Number(rawValue) : rawValue, label };
      }
      // Bare labels: the label is also the value, matching what the old runtime
      // stored so existing responses keep resolving.
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

/** Render a question's scale back out to a template cell (lossless round-trip). */
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

/** Build template.xlsx with a valid mini example workbook that round-trips. */
export async function buildTemplateXlsx() {
  const instructions = [
    ['SOWB-It - Excel Import Template'],
    [''],
    ['Fill in the Settings, Sections, and Questions sheets, then import this file from the authoring app.'],
    [''],
    ['SETTINGS sheet: one Key/Value pair per row.'],
    ['  Dashboard Heading    The learner-facing heading on the section list, e.g. "Your Milestones".'],
    ['  Allow PDF Download   yes or no. Shows learners a button to download a PDF of their responses.'],
    ['                       Defaults to yes when the key is absent.'],
    ['SECTIONS sheet: one row per section. Columns: Section ID, Title, Required (yes/no), Order,'],
    ['                Lock When Complete (yes/no).'],
    ['  Lock When Complete   yes freezes the section once the learner completes it AND leaves it.'],
    ['                       They can still reopen and read it, but answers can no longer change,'],
    ['                       and nothing in the SCO can unlock it. Defaults to no.'],
    ['QUESTIONS sheet: one row per question. Columns below.'],
    [''],
    ['Question columns:'],
    ['  Section ID     Must match a Section ID from the Sections sheet.'],
    ['  Type           One of: short_text, long_text, yes_no, single_select, multiple_select, rating, checklist, numeric, url, datetime, acknowledgement, evidence_ref'],
    ['  Prompt         The question text shown to the learner.'],
    ['  Required       yes or no. Only required questions gate section completion.'],
    ['  Options        Pipe-delimited choices for single_select / multiple_select / checklist, e.g. Yes | No | N/A'],
    ['                 Prefix an option with * to mark it EXPECTED, e.g. Scope review | *Safety plan'],
    ['  Rating Scale   A scale id (agreement-5), a scale name (Agreement (5-point)),'],
    ['                 explicit points (1=Strongly Agree | 2=Agree | 3=Neutral),'],
    ['                 bare labels (Low|Medium|High), or 1-5 for the numeric built-in.'],
    ['  Min            For numeric questions. Inclusive lower bound, e.g. 4'],
    ['  Max            For numeric questions. Inclusive upper bound, e.g. 10'],
    ['  Whole Numbers  For numeric questions. yes to reject decimals.'],
    ['  Help Text      Optional guidance shown under the prompt.'],
    [''],
    ['Built-in rating scales:'],
    ['  numeric-5      1, 2, 3, 4, 5'],
    ['  agreement-5    Strongly Agree, Agree, Neutral, Disagree, Strongly Disagree'],
    ['  frequency-5    Always, Almost Always, Sometimes, Rarely, Never'],
    ['  confidence-3   Low, Medium, High'],
    ['Manage your own scales on the Rating Scales screen in the app.'],
    [''],
    ['Completion rules:'],
    ['  - A question is COMPLETE only when its response satisfies its requirement.'],
    ['  - checklist / multiple_select: the learner must select EVERY option marked with *.'],
    ['  - numeric: the value must fall within Min/Max (inclusive).'],
    ['  - url: the value must be a valid http:// or https:// link.'],
    ['  - rating: the value must be one of the points in its scale.'],
    ['  - A question that has a response but fails its requirement is PARTIAL and does not count.'],
    ['  - A section is COMPLETED only when every REQUIRED question in it is COMPLETE.'],
    ['  - A section where nothing is blank but a requirement is unmet shows as PARTIALLY COMPLETE.'],
    ['  - The workbook reports "completed" only when every REQUIRED section is complete.'],
    ['  - A section with Lock When Complete freezes its answers once the learner completes it and leaves it.'],
    ['  - evidence_ref records file metadata only; it never stores a file inside SCORM.'],
  ];

  const settings = [
    ['Key', 'Value'],
    ['Title', 'AE Install Ride-Along Observation Workbook'],
    ['Description', 'Field observation workbook for new Account Executives shadowing install activities.'],
    ['Version', '1.0'],
    ['Author', 'JCI ASCEND Learning'],
    ['Language', 'en-US'],
    ['Dashboard Heading', 'Your Milestones'],
    ['Allow PDF Download', 'yes'],
    ['Navigation', 'free'],
    ['Completion Rule', 'all-required-sections'],
    ['Report Success', 'no'],
    ['Course ID', 'ascend-ae-install-ride-along'],
    ['Estimated Duration', '3 months'],
  ];

  const sections = [
    ['Section ID', 'Title', 'Required (yes/no)', 'Order', 'Lock When Complete (yes/no)'],
    ['s1', 'Month 1', 'yes', '1', 'no'],
    ['s2', 'Month 2', 'yes', '2', 'no'],
    ['s3', 'Month 3', 'yes', '3', 'no'],
  ];

  const questions = [
    ['Section ID', 'Type', 'Prompt', 'Required', 'Options', 'Rating Scale', 'Min', 'Max', 'Whole Numbers', 'Help Text'],
    ['s1', 'datetime', 'Date of the install team meeting', 'yes', '', '', '', '', '', 'Use the date the meeting took place.'],
    ['s1', 'long_text', 'What was discussed in the meeting?', 'yes', '', '', '', '', '', 'Summarize scope, safety, and roles.'],
    ['s1', 'checklist', 'Which topics were covered?', 'yes', '*Scope review | *Safety plan | Schedule | Customer expectations', '', '', '', '', 'Check all that apply.'],
    ['s2', 'short_text', 'Manager you shadowed', 'yes', '', '', '', '', '', ''],
    ['s2', 'numeric', 'How many install jobs did you review this month?', 'yes', '', '', '4', '', 'yes', 'Review at least four jobs.'],
    ['s2', 'rating', 'The install handoff process was clearly explained.', 'yes', '', 'agreement-5', '', '', '', ''],
    ['s2', 'rating', 'How often did the team run a safety briefing?', 'yes', '', 'frequency-5', '', '', '', ''],
    ['s3', 'yes_no', 'Did you complete a full ride-along day?', 'yes', '', '', '', '', '', ''],
    ['s3', 'rating', 'Rate your understanding of on-site install steps', 'yes', '', '1-5', '', '', '', '1 = low, 5 = high'],
    ['s3', 'url', 'Link to your ride-along notes or photos', 'no', '', '', '', '', '', 'Paste a SharePoint or Teams link starting with https://'],
    ['s3', 'long_text', 'Notes and observations from the ride along', 'no', '', '', '', '', '', ''],
  ];

  return writeXlsx([
    { name: 'Instructions', rows: instructions },
    { name: 'Settings', rows: settings },
    { name: 'Sections', rows: sections },
    { name: 'Questions', rows: questions },
  ]);
}

// ---- parse helpers -------------------------------------------------------

function parseSettings(rows) {
  const kv = {};
  for (const row of rows) {
    const key = norm(row[0]);
    if (!key || key === 'key') continue;
    kv[key] = (row[1] !== undefined ? String(row[1]) : '').trim();
  }
  return {
    title: kv['title'],
    description: kv['description'],
    version: kv['version'],
    author: kv['author'],
    language: kv['language'],
    dashboardHeading: kv['dashboard heading'] || kv['heading'],
    allowPdfDownload: kv['allow pdf download'] !== undefined ? kv['allow pdf download'] : kv['pdf download'],
    navigation: (kv['navigation'] || '').toLowerCase(),
    reportSuccess: kv['report success'],
    courseId: kv['course id'],
    estimatedDuration: kv['estimated duration'],
    id: kv['workbook id'] || kv['id'],
  };
}

function parseSections(rows, warnings) {
  const out = [];
  const header = (rows[0] || []).map(norm);
  const idx = colFinder(header, {
    id: ['section id', 'id'], title: ['title'],
    required: ['required (yes/no)', 'required'], order: ['order'],
    lock: ['lock when complete (yes/no)', 'lock when complete', 'lock answers'],
  });
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => String(c).trim() === '')) continue;
    const id = cell(row, idx.id);
    if (!id) { warnings.push(`Sections row ${r + 1} skipped: missing Section ID.`); continue; }
    /** @type {any} */
    const section = {
      id, title: cell(row, idx.title) || id,
      required: toBool(cell(row, idx.required)), questions: [],
      _order: parseInt(cell(row, idx.order) || '0', 10) || r,
    };
    // Absent column (an older template) means no locking, so only set the flag
    // when the author actually asked for it.
    if (toBool(cell(row, idx.lock))) section.lockWhenComplete = true;
    out.push(section);
  }
  out.sort((a, b) => a._order - b._order);
  return out;
}

function attachQuestions(sections, rows, warnings, customScales) {
  const byId = {};
  for (const s of sections) byId[s.id] = s;
  const header = (rows[0] || []).map(norm);
  const idx = colFinder(header, {
    section: ['section id', 'section'], type: ['type'], prompt: ['prompt'],
    required: ['required'], options: ['options'], scale: ['rating scale', 'scale'],
    min: ['min', 'minimum'], max: ['max', 'maximum'],
    integer: ['whole numbers', 'integer only', 'whole numbers only'],
    help: ['help text', 'help'],
  });
  let qn = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => String(c).trim() === '')) continue;
    const sectionId = cell(row, idx.section);
    const section = byId[sectionId];
    if (!section) { warnings.push(`Questions row ${r + 1} skipped: unknown Section ID "${sectionId}".`); continue; }
    const type = cell(row, idx.type);
    const prompt = cell(row, idx.prompt);
    if (!type || !prompt) { warnings.push(`Questions row ${r + 1} skipped: missing Type or Prompt.`); continue; }

    qn++;
    /** @type {any} */
    const q = { id: `q_${sectionId}_${qn}`, type, prompt, required: toBool(cell(row, idx.required)) };

    const help = cell(row, idx.help);
    if (help) q.helpText = help;

    // Options, with a leading * marking an expected option.
    const optionsRaw = cell(row, idx.options);
    if (optionsRaw) {
      q.options = optionsRaw.split('|').map((s) => s.trim()).filter(Boolean).map((label) => {
        const expected = label.startsWith('*');
        const clean = expected ? label.slice(1).trim() : label;
        const opt = { id: newOptionId(), label: clean };
        if (expected) opt.expected = true;
        return opt;
      });
    }

    if (type === 'rating') {
      const parsed = parseScaleCell(cell(row, idx.scale), customScales);
      if (parsed.warning) warnings.push(`Questions row ${r + 1}: ${parsed.warning}`);
      if (parsed.scaleId) q.scaleId = parsed.scaleId;
      if (parsed.scale) q.scale = parsed.scale;
    }

    if (type === 'numeric') {
      const min = cell(row, idx.min), max = cell(row, idx.max);
      if (min !== '') {
        if (isFinite(Number(min))) q.min = Number(min);
        else warnings.push(`Questions row ${r + 1}: Min "${min}" is not a number and was ignored.`);
      }
      if (max !== '') {
        if (isFinite(Number(max))) q.max = Number(max);
        else warnings.push(`Questions row ${r + 1}: Max "${max}" is not a number and was ignored.`);
      }
      if (toBool(cell(row, idx.integer))) q.integerOnly = true;
    }

    section.questions.push(q);
  }
}

// ---- misc ----------------------------------------------------------------

function cell(row, i) { if (i === undefined || i < 0) return ''; return String(row[i] ?? '').trim(); }
function colFinder(header, spec) {
  const idx = {};
  for (const key of Object.keys(spec)) {
    idx[key] = -1;
    for (const alias of spec[key]) {
      const found = header.indexOf(alias);
      if (found !== -1) { idx[key] = found; break; }
    }
  }
  return idx;
}
function norm(v) { return String(v ?? '').trim().toLowerCase(); }
function toBool(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === 'y' || s === '1';
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'workbook';
}
