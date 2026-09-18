// @ts-check
/**
 * The hand-rolled PDF writer and the learner response report. Both modules are
 * DOM-free by design, so these run in plain Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfDoc, escapeText, wrapText, measure, FONT } from '../runtime-template/js/pdf.js';
import { buildResponseReport, formatAnswer, reportFileName } from '../runtime-template/js/report.js';
import { inlineScales } from '@sowb/shared/scales.js';
import { loadWorkbook, loadCustomScales, COMPLETE_REQUIRED_RESPONSES, SECTION_TITLES } from './helpers/workbook.js';

const latin = (bytes) => Buffer.from(bytes).toString('latin1');
async function runtimeWorkbook() {
  return inlineScales(await loadWorkbook(), await loadCustomScales());
}
/** A state exercising every interesting rendering path. */
const MIXED_STATE = {
  currentSection: 's1', currentPage: 0, sectionStatus: {},
  responses: {
    q_s1_1: '2026-09-14',
    q_s1_2: 'Reviewed the customer\u2019s scope \u2014 safety plan and schedule.',
    q_s1_3: ['o_scope'],            // partial: missing an expected option
    q_s2_1: 'Dana Ruiz',
    q_s2_2: '2',                    // partial: below min
    q_s2_3: '4',                    // Agree
    q_s3_2: '4',                    // unlabeled numeric
  },
};

// ---- PDF file structure --------------------------------------------------

test('produces a structurally valid PDF', () => {
  const doc = new PdfDoc({ title: 'T' });
  doc.paragraph('Hello world');
  const s = latin(doc.build());
  assert.ok(s.startsWith('%PDF-1.4'), 'has the PDF header');
  assert.ok(s.includes('/Type /Catalog'));
  assert.ok(s.includes('/Type /Pages'));
  assert.ok(s.includes('/Type /Page'));
  assert.ok(s.includes('/BaseFont /Helvetica'));
  assert.ok(s.includes('/Encoding /WinAnsiEncoding'));
  assert.ok(s.includes('\nxref\n'));
  assert.ok(s.includes('trailer'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
});

test('xref offsets point at the real object headers', () => {
  const doc = new PdfDoc({ title: 'T' });
  for (let i = 0; i < 5; i++) doc.paragraph('line ' + i);
  const s = latin(doc.build());

  const startxref = Number(/startxref\s+(\d+)/.exec(s)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref', 'startxref points at the xref table');

  const rows = [...s.slice(startxref).matchAll(/(\d{10}) (\d{5}) n/g)];
  assert.ok(rows.length >= 5, 'the xref lists the objects');
  rows.forEach((row, i) => {
    const offset = Number(row[1]);
    assert.ok(s.slice(offset).startsWith(`${i + 1} 0 obj`), `xref entry ${i + 1} points at its object`);
  });
});

test('stream /Length matches the actual stream bytes', () => {
  const doc = new PdfDoc({ title: 'T' });
  doc.paragraph('Some content to measure');
  const s = latin(doc.build());
  const m = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(s);
  assert.ok(m, 'found a content stream');
  assert.equal(Number(m[1]), m[2].length, '/Length equals the stream byte count');
});

// ---- text encoding -------------------------------------------------------

test('escapes PDF string syntax', () => {
  assert.equal(escapeText('a(b)c'), 'a\\(b\\)c');
  assert.equal(escapeText('back\\slash'), 'back\\\\slash');
});

test('substitutes characters learners paste from Word', () => {
  assert.equal(escapeText('\u201Cquoted\u201D'), '"quoted"');
  assert.equal(escapeText("it\u2019s"), "it's");
  assert.equal(escapeText('a \u2014 b'), 'a - b');
  assert.equal(escapeText('wait\u2026'), 'wait...');
  assert.equal(escapeText('\u2022 item'), '- item');
  assert.equal(escapeText('a\u00A0b'), 'a b', 'non-breaking space becomes a space');
});

test('encodes Latin-1 accents octally and replaces anything else', () => {
  assert.equal(escapeText('caf\u00E9'), 'caf\\351');
  const out = escapeText('ok \u{1F600}');
  assert.ok(out.startsWith('ok '));
  assert.ok(!/[\u{1F600}]/u.test(out), 'no raw astral character survives');
});

test('the PDF never contains an unescaped control byte', () => {
  const doc = new PdfDoc({ title: 'T' });
  doc.paragraph('tab\there and emoji \u{1F600} and accent caf\u00E9');
  const body = latin(doc.build()).split('stream\n')[1] || '';
  assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body), 'no stray control characters');
});

// ---- metrics + wrapping --------------------------------------------------

test('measures text with real Helvetica widths', () => {
  assert.ok(measure('i', FONT.REGULAR, 10) < measure('W', FONT.REGULAR, 10));
  assert.ok(measure('Hello', FONT.BOLD, 10) > measure('Hello', FONT.REGULAR, 10));
  assert.equal(Math.round(measure('AAA', FONT.REGULAR, 10) * 100) / 100, 20.01);
});

test('wraps text to the available width without losing words', () => {
  const lines = wrapText('The quick brown fox jumps over the lazy dog', FONT.REGULAR, 10.5, 120);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(measure(line, FONT.REGULAR, 10.5) <= 120, `"${line}" fits`);
  assert.equal(lines.join(' '), 'The quick brown fox jumps over the lazy dog');
});

test('hard-splits a single token longer than the line (pasted URLs)', () => {
  const long = 'https://jci.sharepoint.com/sites/ascend/' + 'segment'.repeat(20);
  const lines = wrapText(long, FONT.REGULAR, 10.5, 150);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(measure(line, FONT.REGULAR, 10.5) <= 150);
  assert.equal(lines.join(''), long, 'characters preserved exactly');
});

test('empty text yields a single empty line rather than throwing', () => {
  assert.deepEqual(wrapText('', FONT.REGULAR, 10, 100), ['']);
  assert.deepEqual(wrapText(null, FONT.REGULAR, 10, 100), ['']);
});

// ---- pagination ----------------------------------------------------------

test('long content paginates and every page is registered', () => {
  const doc = new PdfDoc({ title: 'Long' });
  for (let i = 0; i < 200; i++) doc.paragraph(`Line ${i} of a very long document used to force pagination.`);
  const s = latin(doc.build());
  const kids = /\/Kids \[([^\]]+)\]/.exec(s)[1].trim().split(/\s+0 R/).filter(Boolean);
  const count = Number(/\/Count (\d+)/.exec(s)[1]);
  assert.ok(count > 1, 'more than one page');
  assert.equal(kids.length, count, '/Kids length matches /Count');
  assert.equal((s.match(/\/Type \/Page[^s]/g) || []).length, count, 'one page object per kid');
});

// ---- report content ------------------------------------------------------

test('the report includes the title, section names, prompts and answers', async () => {
  const s = latin(buildResponseReport(await runtimeWorkbook(), MIXED_STATE, { learnerName: 'Darryl Quinn' }));
  assert.ok(s.includes('AE Install Ride-Along Observation Workbook'));
  assert.ok(s.includes('Dana Ruiz'));
  assert.ok(s.includes('Scope review'));
  for (const title of SECTION_TITLES) assert.ok(s.includes(title), `${title} present`);
});

test('section headings use the author title verbatim, with no "Section N:" prefix', async () => {
  const s = latin(buildResponseReport(await runtimeWorkbook(), MIXED_STATE, {}));
  assert.ok(!/Section\s*\d+\s*:/.test(s), 'no Section N: prefix anywhere in the PDF');
  for (const title of SECTION_TITLES) assert.ok(s.includes(`(${title}) Tj`), `"${title}" drawn as its own text run`);
});

test('question numbering within a section is retained', async () => {
  const s = latin(buildResponseReport(await runtimeWorkbook(), MIXED_STATE, {}));
  assert.ok(s.includes('1. Date of the install team meeting'));
  assert.ok(s.includes('2. What was discussed in the meeting?'));
});

test('unanswered questions are marked, not omitted', async () => {
  const s = latin(buildResponseReport(await runtimeWorkbook(), MIXED_STATE, {}));
  assert.ok(s.includes('Not answered'));
  assert.ok(s.includes('Notes and observations from the ride along'), 'optional unanswered question still listed');
});

test('partial answers carry the neutral requirement hint', async () => {
  const s = latin(buildResponseReport(await runtimeWorkbook(), MIXED_STATE, {}));
  assert.ok(s.includes('Enter at least 4.'), 'numeric hint present');
  assert.ok(s.includes('Some required items are not yet selected.'), 'checklist hint present');
});

test('PRIVACY: the report never reveals which options were expected', async () => {
  const s = latin(buildResponseReport(await runtimeWorkbook(), MIXED_STATE, { learnerName: 'Darryl Quinn' }));
  assert.ok(!/expected/i.test(s), 'the word "expected" never appears');
  // Unselected options must not be listed at all, so the answer key cannot be
  // reverse engineered from the PDF.
  assert.ok(!s.includes('Safety plan'), 'unselected expected option is absent');
  assert.ok(s.includes('Scope review'), 'the learner selection is shown');
});

test('rating answers render with their scale wording', async () => {
  const s = latin(buildResponseReport(await runtimeWorkbook(), MIXED_STATE, {}));
  // NOTE: parentheses delimit PDF strings, so "Agree (4)" is stored escaped as
  // "Agree \(4\)". Asserting on the escaped form also proves escapeText ran.
  assert.ok(s.includes('Agree \\(4\\)'), 'labeled scale shows wording and value');
  assert.ok(!s.includes('Agree (4)'), 'the raw parens must be escaped, or the PDF is malformed');
  // An unlabeled numeric scale must not read "4 (4)".
  assert.ok(!s.includes('4 \\(4\\)'));
});

test('the learner name appears in the heading, footer and PDF title', async () => {
  const s = latin(buildResponseReport(await runtimeWorkbook(), MIXED_STATE, { learnerName: 'Darryl Quinn' }));
  assert.ok(s.includes('Darryl Quinn'));
  assert.ok(s.includes('Learner: '), 'labelled learner row present');
  assert.ok(/\/Title \([^)]*Darryl Quinn/.test(s), 'name in the PDF /Title');
});

test('the report degrades gracefully with no learner name', async () => {
  const s = latin(buildResponseReport(await runtimeWorkbook(), MIXED_STATE, {}));
  assert.ok(s.includes('My responses'), 'falls back to the generic subtitle');
  assert.ok(!s.includes('Learner: '), 'no empty learner row');
});

test('the report reflects overall progress and completion', async () => {
  const wb = await runtimeWorkbook();
  const done = { currentSection: 's1', currentPage: 0, sectionStatus: {}, responses: COMPLETE_REQUIRED_RESPONSES };
  const s = latin(buildResponseReport(wb, done, {}));
  assert.ok(s.includes('100% complete'));
  assert.ok(s.includes('All required sections are complete.'));
});

test('formatAnswer resolves option ids to labels and normalises values', async () => {
  const wb = await runtimeWorkbook();
  const checklist = wb.sections[0].questions[2];
  assert.equal(formatAnswer(checklist, ['o_scope', 'o_sched']), '- Scope review\n- Schedule');
  assert.equal(formatAnswer({ type: 'yes_no' }, 'yes'), 'Yes');
  assert.equal(formatAnswer({ type: 'yes_no' }, false), 'No');
  assert.equal(formatAnswer({ type: 'acknowledgement' }, true), 'Confirmed');
  assert.equal(formatAnswer({ type: 'short_text' }, undefined), 'Not answered');
  assert.equal(
    formatAnswer({ type: 'evidence_ref' }, { fileSelected: true, fileName: 'notes.docx', fileType: 'docx', selectedDate: '2026-09-14' }),
    'notes.docx   |   docx   |   2026-09-14'
  );
});

test('the filename is slugged, dated, and includes the learner when known', () => {
  const wb = { courseId: 'ascend-ae-install-ride-along' };
  assert.match(reportFileName(wb, 'Darryl Quinn'),
    /^ascend-ae-install-ride-along_darryl-quinn_my-responses_\d{8}\.pdf$/);
  assert.match(reportFileName(wb, ''), /^ascend-ae-install-ride-along_my-responses_\d{8}\.pdf$/);
});

test('a workbook with no responses still produces a valid PDF', async () => {
  const bytes = buildResponseReport(await runtimeWorkbook(),
    { currentSection: 's1', currentPage: 0, sectionStatus: {}, responses: {} }, {});
  const s = latin(bytes);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.ok(bytes.length > 500);
});
