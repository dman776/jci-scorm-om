// @ts-check
/**
 * Tests for the hand-rolled PDF writer and the learner response report.
 * These run in plain Node: both modules are DOM-free by design.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfDoc, escapeText, wrapText, measure, FONT } from '../runtime-template/js/pdf.js';
import { buildResponseReport, formatAnswer, reportFileName } from '../runtime-template/js/report.js';

const latin = (bytes) => Buffer.from(bytes).toString('latin1');

// ---- PDF file structure --------------------------------------------------

test('produces a structurally valid PDF', () => {
  const doc = new PdfDoc({ title: 'T' });
  doc.paragraph('Hello world');
  const s = latin(doc.build());
  assert.ok(s.startsWith('%PDF-1.4'), 'has PDF header');
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
  assert.ok(rows.length >= 5, 'xref lists the objects');
  rows.forEach((row, i) => {
    const offset = Number(row[1]);
    const objNum = i + 1;
    assert.ok(
      s.slice(offset).startsWith(`${objNum} 0 obj`),
      `xref entry ${objNum} points at "${objNum} 0 obj"`
    );
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

// ---- text escaping -------------------------------------------------------

test('escapes PDF string syntax', () => {
  assert.equal(escapeText('a(b)c'), 'a\\(b\\)c');
  assert.equal(escapeText('back\\slash'), 'back\\\\slash');
});

test('substitutes characters learners paste from Word', () => {
  // Smart quotes, em/en dash, ellipsis and bullets are not in the ASCII range
  // WinAnsi base-14 text can safely carry, so they are mapped to equivalents.
  assert.equal(escapeText('\u201Cquoted\u201D'), '"quoted"');
  assert.equal(escapeText("it\u2019s"), "it's");
  assert.equal(escapeText('a \u2014 b'), 'a - b');
  assert.equal(escapeText('wait\u2026'), 'wait...');
  assert.equal(escapeText('\u2022 item'), '- item');
  assert.equal(escapeText('a\u00A0b'), 'a b', 'non-breaking space becomes a space');
});

test('encodes Latin-1 accents octally and replaces anything else', () => {
  assert.equal(escapeText('caf\u00E9'), 'caf\\351');
  // Emoji cannot be expressed in WinAnsi; it must degrade, not corrupt.
  const out = escapeText('ok \u{1F600}');
  assert.ok(out.startsWith('ok '));
  assert.ok(!/[\u{1F600}]/u.test(out), 'no raw astral character survives');
});

test('the PDF never contains an unescaped control byte', () => {
  const doc = new PdfDoc({ title: 'T' });
  doc.paragraph('tab\there and emoji \u{1F600} and accent caf\u00E9');
  const s = latin(doc.build());
  const body = s.split('stream\n')[1] || '';
  assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body), 'no stray control characters');
});

// ---- metrics + wrapping --------------------------------------------------

test('measures text with real Helvetica widths', () => {
  // 'i' is narrow (222/1000), 'W' is wide (944/1000) in Helvetica.
  assert.ok(measure('i', FONT.REGULAR, 10) < measure('W', FONT.REGULAR, 10));
  // Bold is wider than regular for the same string.
  assert.ok(measure('Hello', FONT.BOLD, 10) > measure('Hello', FONT.REGULAR, 10));
  assert.equal(Math.round(measure('AAA', FONT.REGULAR, 10) * 100) / 100, 20.01);
});

test('wraps text to the available width', () => {
  const lines = wrapText('The quick brown fox jumps over the lazy dog', FONT.REGULAR, 10.5, 120);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(measure(line, FONT.REGULAR, 10.5) <= 120, `"${line}" fits`);
  }
  assert.equal(lines.join(' '), 'The quick brown fox jumps over the lazy dog', 'no words lost');
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

function demo() {
  return {
    id: 'demo', courseId: 'demo-course', title: 'Demo Workbook', version: '1.0',
    settings: {},
    sections: [
      { id: 's1', title: 'First Section', required: true, questions: [
        { id: 'a', type: 'short_text', prompt: 'Who did you shadow?', required: true },
        { id: 'b', type: 'numeric', prompt: 'How many jobs?', required: true, min: 4 },
        { id: 'c', type: 'checklist', prompt: 'Topics covered?', required: true, options: [
          { id: 'o1', label: 'Scope review', expected: true },
          { id: 'o2', label: 'Safety plan', expected: true },
          { id: 'o3', label: 'Schedule' },
        ] },
        { id: 'd', type: 'long_text', prompt: 'Anything else?', required: false },
      ] },
    ],
  };
}

test('report includes the title, prompts and answers', () => {
  const wb = demo();
  const state = { responses: { a: 'Dana Ruiz', b: '6', c: ['o1', 'o2'] }, sectionStatus: {}, currentSection: 's1', currentPage: 0 };
  const s = latin(buildResponseReport(wb, state));
  assert.ok(s.includes('Demo Workbook'));
  assert.ok(s.includes('First Section'));
  assert.ok(s.includes('Who did you shadow?'));
  assert.ok(s.includes('Dana Ruiz'));
  assert.ok(s.includes('Scope review'));
});

test('unanswered questions are marked, not omitted', () => {
  const s = latin(buildResponseReport(demo(), { responses: { a: 'x' }, sectionStatus: {}, currentSection: 's1', currentPage: 0 }));
  assert.ok(s.includes('Not answered'));
  assert.ok(s.includes('Anything else?'), 'optional unanswered question still listed');
});

test('partial answers carry the neutral requirement hint', () => {
  const state = { responses: { a: 'x', b: '2', c: ['o1'] }, sectionStatus: {}, currentSection: 's1', currentPage: 0 };
  const s = latin(buildResponseReport(demo(), state));
  assert.ok(s.includes('Enter at least 4.'), 'numeric hint present');
  assert.ok(s.includes('Some required items are not yet selected.'), 'checklist hint present');
});

test('PRIVACY: the report never reveals which options were expected', () => {
  const wb = demo();
  // Learner selected only a non-expected option.
  const state = { responses: { a: 'x', b: '9', c: ['o3'] }, sectionStatus: {}, currentSection: 's1', currentPage: 0 };
  const s = latin(buildResponseReport(wb, state));
  assert.ok(!/expected/i.test(s), 'the word "expected" never appears');
  // Unselected options must not be listed at all, so the answer key cannot be
  // reverse engineered from the PDF.
  assert.ok(!s.includes('Safety plan'), 'unselected expected option is absent');
  assert.ok(s.includes('Schedule'), 'the learner selection is shown');
});

test('formatAnswer resolves option ids to labels and normalises values', () => {
  const wb = demo();
  const checklist = wb.sections[0].questions[2];
  assert.equal(formatAnswer(checklist, ['o1', 'o3']), '- Scope review\n- Schedule');
  assert.equal(formatAnswer({ type: 'yes_no' }, 'yes'), 'Yes');
  assert.equal(formatAnswer({ type: 'yes_no' }, false), 'No');
  assert.equal(formatAnswer({ type: 'acknowledgement' }, true), 'Confirmed');
  assert.equal(formatAnswer({ type: 'short_text' }, undefined), 'Not answered');
  assert.equal(
    formatAnswer({ type: 'evidence_ref' }, { fileSelected: true, fileName: 'notes.docx', fileType: 'docx', selectedDate: '2026-09-14' }),
    'notes.docx   |   docx   |   2026-09-14'
  );
});

test('report reflects overall progress and completion', () => {
  const wb = demo();
  const done = { responses: { a: 'x', b: '9', c: ['o1', 'o2'] }, sectionStatus: {}, currentSection: 's1', currentPage: 0 };
  const s = latin(buildResponseReport(wb, done));
  assert.ok(s.includes('100% complete'));
  assert.ok(s.includes('Completed'));
});

test('filename is slugged and dated', () => {
  const name = reportFileName(demo());
  assert.ok(/^demo-course_my-responses_\d{8}\.pdf$/.test(name), name);
});

test('a workbook with no responses still produces a valid PDF', () => {
  const bytes = buildResponseReport(demo(), { responses: {}, sectionStatus: {}, currentSection: 's1', currentPage: 0 });
  const s = latin(bytes);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.ok(bytes.length > 500);
});
