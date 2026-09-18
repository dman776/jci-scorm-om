// @ts-check
/**
 * Builds the learner's "my responses" PDF from the workbook definition and the
 * current learner state. Pure: takes data, returns PDF bytes. No DOM, so the
 * report is fully testable in Node.
 *
 * PRIVACY RULE: the report must never reveal which checklist / multiple-select
 * options were flagged `expected` by the author. It shows only what the learner
 * selected, plus the same neutral requirement hint the runtime displays.
 */
import { PdfDoc, FONT } from './pdf.js';
import {
  getResponseState, getRequirementHint,
  computeAllSectionStatus, computeProgressMeasure, isWorkbookComplete,
  PARTIAL, COMPLETED, IN_PROGRESS, PARTIALLY_COMPLETE, NOT_STARTED,
} from './engine/completion.js';
import { resolveScalePoints, formatScaleAnswer } from './engine/scales.js';

const STATUS_LABEL = {
  [COMPLETED]: 'Completed',
  [PARTIALLY_COMPLETE]: 'Partially Complete',
  [IN_PROGRESS]: 'In Progress',
  [NOT_STARTED]: 'Not Started',
};

/**
 * @param {any} workbook
 * @param {any} state
 * @param {{ learnerName?: string, generatedOn?: Date }} [opts]
 *   learnerName comes from cmi.learner_name via SessionCore.learnerName().
 * @returns {Uint8Array}
 */
export function buildResponseReport(workbook, state, opts = {}) {
  const responses = (state && state.responses) || {};
  const sectionStatus = computeAllSectionStatus(workbook, responses);
  const progress = Math.round(computeProgressMeasure(workbook, sectionStatus, responses) * 100);
  const complete = isWorkbookComplete(workbook, sectionStatus);
  const generatedOn = opts.generatedOn || new Date();
  const learnerName = String(opts.learnerName || '').trim();

  const doc = new PdfDoc({
    // Personalize the document title so the browser tab and any print dialog
    // identify whose responses these are.
    title: learnerName
      ? `${workbook.title} - ${learnerName} - My Responses`
      : `${workbook.title} - My Responses`,
    footerText: learnerName ? `${workbook.title}   |   ${learnerName}` : workbook.title,
  });

  // ---- heading block ----
  doc.paragraph(workbook.title, { font: FONT.BOLD, size: 18, spaceAfter: 2 });
  if (learnerName) {
    doc.paragraph(learnerName, { font: FONT.BOLD, size: 13, spaceAfter: 1 });
    doc.paragraph('My responses', { font: FONT.BOLD, size: 10.5, gray: 0.4, spaceAfter: 8 });
    doc.labelled('Learner: ', learnerName);
  } else {
    doc.paragraph('My responses', { font: FONT.BOLD, size: 11, gray: 0.35, spaceAfter: 8 });
  }
  doc.labelled('Generated: ', formatDateTime(generatedOn));
  doc.labelled('Overall progress: ', `${progress}% complete`);
  doc.labelled('Workbook status: ', complete ? 'Completed' : 'Incomplete');
  if (workbook.version) doc.labelled('Version: ', String(workbook.version));
  doc.rule();

  if (workbook.description) {
    doc.paragraph(workbook.description, { size: 10, gray: 0.3, spaceAfter: 8 });
  }

  // ---- sections ----
  (workbook.sections || []).forEach((section) => {
    const status = sectionStatus[section.id] || NOT_STARTED;
    // Use the author's section title verbatim. No "Section N:" prefix, so
    // titles like "Month 1" read naturally and the PDF matches the dashboard.
    doc.heading(section.title, { size: 13 });
    doc.paragraph(
      `${section.required ? 'Required' : 'Optional'}   |   Status: ${STATUS_LABEL[status]}`,
      { size: 9.5, gray: 0.35, spaceAfter: 6 }
    );

    (section.questions || []).forEach((q, qi) => {
      const value = responses[q.id];
      const responseState = getResponseState(q, value);

      doc.paragraph(`${qi + 1}. ${q.prompt}${q.required ? ' *' : ''}`, {
        font: FONT.BOLD, size: 10.5, spaceAfter: 2,
      });

      if (responseState === 'empty') {
        doc.paragraph('Not answered', { size: 10.5, indent: 14, gray: 0.45, spaceAfter: 2 });
      } else {
        doc.paragraph(formatAnswer(q, value), { size: 10.5, indent: 14, spaceAfter: 2 });
      }

      // Neutral requirement hint for partial answers. Never names expected options.
      if (responseState === PARTIAL) {
        doc.paragraph(getRequirementHint(q, value), { size: 9.5, indent: 14, gray: 0.4, spaceAfter: 2 });
      }
      doc.spacer(4);
    });

    doc.rule({ spaceBefore: 2, spaceAfter: 2 });
  });

  doc.spacer(6);
  doc.paragraph(
    complete
      ? 'All required sections are complete.'
      : 'This workbook is not yet complete. Sections marked Partially Complete have every item answered, but one or more responses do not yet meet their requirement.',
    { size: 9.5, gray: 0.35, spaceAfter: 0 }
  );

  return doc.build();
}

/**
 * Render a learner response as display text. For choice types this resolves
 * option ids to labels and shows ONLY what the learner selected; the author's
 * `expected` flag is never surfaced.
 */
export function formatAnswer(q, value) {
  if (value === undefined || value === null) return 'Not answered';
  switch (q.type) {
    case 'checklist':
    case 'multiple_select': {
      const chosen = Array.isArray(value) ? value : [];
      if (!chosen.length) return 'Not answered';
      const byId = new Map((q.options || []).map((o) => [o.id, o.label]));
      return chosen.map((id) => `- ${byId.get(id) || id}`).join('\n');
    }
    case 'single_select': {
      const opt = (q.options || []).find((o) => o.id === value);
      return opt ? opt.label : String(value);
    }
    case 'rating':
      // Show the wording, e.g. "Agree (2)", collapsing to just the value when
      // the scale is unlabeled so it never reads "3 (3)".
      return formatScaleAnswer(resolveScalePoints(q), value);
    case 'yes_no': {
      if (value === true) return 'Yes';
      if (value === false) return 'No';
      return String(value).toLowerCase() === 'yes' ? 'Yes' : 'No';
    }
    case 'acknowledgement':
      return value === true ? 'Confirmed' : 'Not confirmed';
    case 'evidence_ref': {
      if (!value || !value.fileSelected) return 'No file recorded';
      const bits = [value.fileName || 'file'];
      if (value.fileType) bits.push(value.fileType);
      if (value.selectedDate) bits.push(value.selectedDate);
      return bits.join('   |   ');
    }
    default:
      return String(value);
  }
}

function formatDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Filename-safe slug for the downloaded PDF. Includes the learner name when
 * available so a facilitator collecting several PDFs can tell them apart.
 */
export function reportFileName(workbook, learnerName) {
  const base = slug(workbook.courseId || workbook.id || workbook.title || 'observation-workbook', 60) || 'workbook';
  const who = slug(learnerName || '', 40);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return who ? `${base}_${who}_my-responses_${stamp}.pdf` : `${base}_my-responses_${stamp}.pdf`;
}

function slug(s, max) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
}
