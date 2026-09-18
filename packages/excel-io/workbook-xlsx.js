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
 * For checklist and multiple_select the learner must select every expected
 * option for the question to count as complete.
 */
import { writeXlsx, readXlsx } from './index.js';
import { newOptionId } from '@sowb/shared/ids.js';

/**
 * Parse an uploaded xlsx buffer into a workbook object.
 * @param {Buffer|Uint8Array} buffer
 */
export async function importWorkbookXlsx(buffer) {
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
  attachQuestions(sections, questionRows, warnings);

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

/** Build template.xlsx with a valid mini example workbook that round-trips. */
export async function buildTemplateXlsx() {
  const instructions = [
    ['SCORM Observation Workbook Builder - Excel Import Template'],
    [''],
    ['Fill in the Settings, Sections, and Questions sheets, then import this file from the authoring app.'],
    [''],
    ['SETTINGS sheet: one Key/Value pair per row.'],
    ['  Dashboard Heading    The learner-facing heading on the section list, e.g. "Your Milestones".'],
    ['  Allow PDF Download   yes or no. Shows learners a button to download a PDF of their responses.'],
    ['                       Defaults to yes when the key is absent.'],
    ['SECTIONS sheet: one row per section. Columns: Section ID, Title, Required (yes/no), Order.'],
    ['QUESTIONS sheet: one row per question. Columns below.'],
    [''],
    ['Question columns:'],
    ['  Section ID     Must match a Section ID from the Sections sheet.'],
    ['  Type           One of: short_text, long_text, yes_no, single_select, multiple_select, rating, checklist, numeric, url, datetime, acknowledgement, evidence_ref'],
    ['  Prompt         The question text shown to the learner.'],
    ['  Required       yes or no. Only required questions gate section completion.'],
    ['  Options        Pipe-delimited choices for single_select / multiple_select / checklist, e.g. Yes | No | N/A'],
    ['                 Prefix an option with * to mark it EXPECTED, e.g. Scope review | *Safety plan'],
    ['  Rating Scale   For rating questions only: 1-5  OR  Low|Medium|High'],
    ['  Min            For numeric questions. Inclusive lower bound, e.g. 4'],
    ['  Max            For numeric questions. Inclusive upper bound, e.g. 10'],
    ['  Whole Numbers  For numeric questions. yes to reject decimals.'],
    ['  Help Text      Optional guidance shown under the prompt.'],
    [''],
    ['Completion rules:'],
    ['  - A question is COMPLETE only when its response satisfies its requirement.'],
    ['  - checklist / multiple_select: the learner must select EVERY option marked with *.'],
    ['  - numeric: the value must fall within Min/Max (inclusive).'],
    ['  - url: the value must be a valid http:// or https:// link.'],
    ['  - A question that has a response but fails its requirement is PARTIAL and does not count.'],
    ['  - A section is COMPLETED only when every REQUIRED question in it is COMPLETE.'],
    ['  - A section where nothing is blank but a requirement is unmet shows as PARTIALLY COMPLETE.'],
    ['  - The workbook reports "completed" only when every REQUIRED section is complete.'],
    ['  - evidence_ref records file metadata only; it never stores a file inside SCORM.'],
  ];

  const settings = [
    ['Key', 'Value'],
    ['Title', 'AE Install Ride-Along Observation Workbook'],
    ['Description', 'Field observation workbook for new Account Executives shadowing install activities.'],
    ['Version', '1.0'],
    ['Author', 'JCI ASCEND Learning'],
    ['Language', 'en-US'],
    ['Dashboard Heading', 'Your observation workbook'],
    ['Allow PDF Download', 'yes'],
    ['Navigation', 'free'],
    ['Completion Rule', 'all-required-sections'],
    ['Report Success', 'no'],
    ['Course ID', 'ascend-ae-install-ride-along'],
    ['Estimated Duration', '2-3 weeks'],
  ];

  const sections = [
    ['Section ID', 'Title', 'Required (yes/no)', 'Order'],
    ['s1', 'Install Team Meeting', 'yes', '1'],
    ['s2', 'Install Manager Shadow', 'yes', '2'],
    ['s3', 'Install Technician Ride Along', 'yes', '3'],
  ];

  const questions = [
    ['Section ID', 'Type', 'Prompt', 'Required', 'Options', 'Rating Scale', 'Min', 'Max', 'Whole Numbers', 'Help Text'],
    ['s1', 'datetime', 'Date of the install team meeting', 'yes', '', '', '', '', '', 'Use the date the meeting took place.'],
    ['s1', 'long_text', 'What was discussed in the meeting?', 'yes', '', '', '', '', '', 'Summarize scope, safety, and roles.'],
    ['s1', 'checklist', 'Which topics were covered?', 'yes', '*Scope review | *Safety plan | Schedule | Customer expectations', '', '', '', '', 'Check all that apply.'],
    ['s2', 'short_text', 'Manager you shadowed', 'yes', '', '', '', '', '', ''],
    ['s2', 'numeric', 'How many install jobs did you review this week?', 'yes', '', '', '4', '', 'yes', 'Review at least four jobs.'],
    ['s2', 'rating', 'How confident do you feel about the install handoff process?', 'yes', '', 'Low|Medium|High', '', '', '', ''],
    ['s2', 'long_text', 'Describe one thing you learned from the manager', 'yes', '', '', '', '', '', ''],
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
  });
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => String(c).trim() === '')) continue;
    const id = cell(row, idx.id);
    if (!id) { warnings.push(`Sections row ${r + 1} skipped: missing Section ID.`); continue; }
    out.push({
      id, title: cell(row, idx.title) || id,
      required: toBool(cell(row, idx.required)), questions: [],
      _order: parseInt(cell(row, idx.order) || '0', 10) || r,
    });
  }
  out.sort((a, b) => a._order - b._order);
  return out;
}

function attachQuestions(sections, rows, warnings) {
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

    const scaleRaw = cell(row, idx.scale);
    if (type === 'rating') {
      q.scale = scaleRaw && scaleRaw.toLowerCase() !== '1-5'
        ? scaleRaw.split('|').map((s) => s.trim()).filter(Boolean)
        : [1, 2, 3, 4, 5];
    }

    if (type === 'numeric') {
      const min = cell(row, idx.min);
      const max = cell(row, idx.max);
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
