// @ts-check
/**
 * Minimal, dependency-free PDF writer.
 *
 * WHY HAND-ROLLED: the exported SCORM package ships no third-party code, which
 * keeps it small and auditable. Bundling jsPDF or pdf-lib would add hundreds of
 * KB of vendor code to every package. A text-only report needs very little of
 * the PDF spec, so we emit it directly.
 *
 * SCOPE: base-14 Helvetica / Helvetica-Bold (built into every PDF reader, so no
 * font embedding), WinAnsi encoding, flowed text with word wrapping and
 * automatic pagination. No images.
 *
 * Runs in the browser (inside the SCO) and in Node (for tests): no DOM, no Node
 * APIs. Output is a Uint8Array of PDF bytes.
 */
export const LETTER = { width: 612, height: 792 };
export const FONT = { REGULAR: 'F1', BOLD: 'F2' };

export class PdfDoc {
  /**
   * @param {{ title?: string, page?: {width:number,height:number},
   *   margin?: number, footerText?: string }} [opts]
   */
  constructor(opts = {}) {
    this.title = opts.title || 'Document';
    this.page = opts.page || LETTER;
    this.margin = opts.margin === undefined ? 54 : opts.margin; // 0.75 inch
    this.footerText = opts.footerText || '';
    /** @type {string[][]} one array of content-stream ops per page */
    this.pages = [];
    this._newPage();
  }

  get contentWidth() { return this.page.width - this.margin * 2; }

  _newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = this.page.height - this.margin;
  }

  /** Reserve vertical space, starting a new page when the block will not fit. */
  _ensure(height) {
    const floor = this.margin + 22; // leave room for the footer line
    if (this.y - height < floor) this._newPage();
  }

  spacer(n = 8) { this._ensure(n); this.y -= n; }

  _line(text, { font = FONT.REGULAR, size = 10.5, indent = 0, gray = 0 } = {}) {
    const lineHeight = size * 1.35;
    this._ensure(lineHeight);
    this.y -= lineHeight;
    const x = this.margin + indent;
    const color = gray ? `${fmt(gray)} ${fmt(gray)} ${fmt(gray)} rg\n` : '0 0 0 rg\n';
    this.ops.push(`${color}BT /${font} ${fmt(size)} Tf 1 0 0 1 ${fmt(x)} ${fmt(this.y)} Tm (${escapeText(text)}) Tj ET`);
  }

  /** Word-wrapped block of text. */
  paragraph(text, opts = {}) {
    const { font = FONT.REGULAR, size = 10.5, indent = 0, gray = 0, spaceAfter = 4 } = opts;
    const maxWidth = this.contentWidth - indent;
    const source = String(text === undefined || text === null ? '' : text);
    // Respect author/learner line breaks, then wrap each resulting line.
    for (const rawLine of source.split(/\r\n|\r|\n/)) {
      for (const line of wrapText(rawLine, font, size, maxWidth)) this._line(line, { font, size, indent, gray });
    }
    if (spaceAfter) this.spacer(spaceAfter);
  }

  heading(text, opts = {}) {
    const { size = 14, spaceBefore = 10, spaceAfter = 4 } = opts;
    // Keep a heading with at least one following line.
    this._ensure(size * 1.35 * 2 + spaceBefore);
    if (spaceBefore) this.spacer(spaceBefore);
    this.paragraph(text, { font: FONT.BOLD, size, spaceAfter });
  }

  /** Horizontal rule across the content width. */
  rule({ gray = 0.75, spaceBefore = 2, spaceAfter = 6 } = {}) {
    this._ensure(spaceBefore + spaceAfter + 2);
    this.spacer(spaceBefore);
    this.y -= 1;
    this.ops.push(
      `${fmt(gray)} ${fmt(gray)} ${fmt(gray)} RG 0.6 w ${fmt(this.margin)} ${fmt(this.y)} m ` +
      `${fmt(this.margin + this.contentWidth)} ${fmt(this.y)} l S`
    );
    this.spacer(spaceAfter);
  }

  /** Two-column "Label: value" row where the label is bold and inline. */
  labelled(label, value, opts = {}) {
    const { size = 10.5, indent = 0 } = opts;
    const labelWidth = measure(label + '  ', FONT.BOLD, size);
    const maxWidth = this.contentWidth - indent - labelWidth;
    const lines = wrapText(String(value == null ? '' : value), FONT.REGULAR, size, Math.max(60, maxWidth));
    const lineHeight = size * 1.35;
    this._ensure(lineHeight);
    this.y -= lineHeight;
    const x = this.margin + indent;
    this.ops.push(`0 0 0 rg BT /${FONT.BOLD} ${fmt(size)} Tf 1 0 0 1 ${fmt(x)} ${fmt(this.y)} Tm (${escapeText(label)}) Tj ET`);
    if (lines.length) {
      this.ops.push(`BT /${FONT.REGULAR} ${fmt(size)} Tf 1 0 0 1 ${fmt(x + labelWidth)} ${fmt(this.y)} Tm (${escapeText(lines[0])}) Tj ET`);
    }
    for (let i = 1; i < lines.length; i++) this._line(lines[i], { size, indent: indent + labelWidth });
  }

  /** Serialize the document to PDF bytes. */
  build() {
    const objects = [];
    const pageCount = this.pages.length;
    // 1 catalog, 2 pages, 3 font regular, 4 font bold, then per page:
    // page object + content stream.
    const catalogId = 1, pagesId = 2, fontRegularId = 3, fontBoldId = 4, firstPageId = 5;
    const pageIds = [];
    for (let i = 0; i < pageCount; i++) pageIds.push(firstPageId + i * 2);

    objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
    objects[fontRegularId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[fontBoldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

    this.pages.forEach((ops, i) => {
      const pageId = pageIds[i], contentId = pageId + 1;
      let stream = ops.join('\n');
      const footer = this._footerOps(i + 1, pageCount);
      if (footer) stream += '\n' + footer;
      objects[pageId] =
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmt(this.page.width)} ${fmt(this.page.height)}] ` +
        `/Resources << /Font << /${FONT.REGULAR} ${fontRegularId} 0 R /${FONT.BOLD} ${fontBoldId} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>`;
      objects[contentId] = { stream };
    });

    return assemble(objects, catalogId, this.title);
  }

  _footerOps(pageNum, pageCount) {
    const parts = [];
    if (this.footerText) parts.push(this.footerText);
    parts.push(`Page ${pageNum} of ${pageCount}`);
    const y = this.margin - 14;
    return `0.45 0.45 0.45 rg BT /${FONT.REGULAR} 8 Tf 1 0 0 1 ${fmt(this.margin)} ${fmt(y)} Tm (${escapeText(parts.join('   |   '))}) Tj ET`;
  }
}

/** @returns {Uint8Array} */
function assemble(objects, rootId, title) {
  const chunks = [];
  let length = 0;
  const push = (s) => { chunks.push(s); length += s.length; };

  push('%PDF-1.4\n');
  // Binary comment marks the file as containing binary data.
  push('%\xE2\xE3\xCF\xD3\n');

  const maxId = objects.length - 1;
  const offsets = [];
  for (let id = 1; id <= maxId; id++) {
    const obj = objects[id];
    if (obj === undefined) continue;
    offsets[id] = length;
    if (typeof obj === 'string') push(`${id} 0 obj\n${obj}\nendobj\n`);
    else push(`${id} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`);
  }

  const infoId = maxId + 1;
  offsets[infoId] = length;
  push(`${infoId} 0 obj\n<< /Title (${escapeText(title)}) /Producer (SCORM Observation Workbook) >>\nendobj\n`);

  const xrefOffset = length;
  const size = infoId + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id++) {
    const off = offsets[id];
    xref += off === undefined ? '0000000000 65535 f \n' : `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${size} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  // Every chunk is a latin1-safe string; convert to bytes 1:1.
  const bytes = new Uint8Array(length);
  let p = 0;
  for (const chunk of chunks) for (let i = 0; i < chunk.length; i++) bytes[p++] = chunk.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * Characters learners routinely paste from Word that are outside the ASCII
 * range WinAnsi text can safely carry. Mapped to safe equivalents so the PDF
 * never contains a character the base-14 encoding cannot express.
 */
const SUBSTITUTIONS = {
  '\u2018': "'", '\u2019': "'", '\u201A': ',', '\u201B': "'",
  '\u201C': '"', '\u201D': '"', '\u201E': '"',
  '\u2013': '-', '\u2014': '-', '\u2012': '-', '\u2015': '-',
  '\u2026': '...', '\u2022': '-', '\u00B7': '-', '\u25CF': '-', '\u25AA': '-',
  '\u00A0': ' ', '\u2007': ' ', '\u202F': ' ', '\u2009': ' ',
  '\u2122': '(TM)', '\u00AE': '(R)', '\u00A9': '(C)',
  '\u2192': '->', '\u2190': '<-', '\u2264': '<=', '\u2265': '>=',
  '\t': '    ',
};

/** Convert a JS string to WinAnsi-safe bytes and escape PDF syntax. */
export function escapeText(text) {
  const src = String(text === undefined || text === null ? '' : text);
  let out = '';
  for (const ch of src) {
    const sub = SUBSTITUTIONS[ch];
    const piece = sub !== undefined ? sub : ch;
    for (let i = 0; i < piece.length; i++) {
      const c = piece[i], code = piece.charCodeAt(i);
      if (c === '\\' || c === '(' || c === ')') out += '\\' + c;
      else if (code >= 32 && code <= 126) out += c;
      else if (code >= 160 && code <= 255) out += '\\' + code.toString(8).padStart(3, '0');
      else out += '?'; // anything WinAnsi cannot express
    }
  }
  return out;
}

// Adobe base-14 widths (units per 1000) for printable ASCII 32-126.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Width of a string in points for a given base-14 font and size. */
export function measure(text, font, size) {
  const table = font === FONT.BOLD ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  for (const ch of String(text || '')) {
    const sub = SUBSTITUTIONS[ch];
    const piece = sub !== undefined ? sub : ch;
    for (let i = 0; i < piece.length; i++) {
      const code = piece.charCodeAt(i);
      units += (code >= 32 && code <= 126) ? table[code - 32] : 556;
    }
  }
  return (units / 1000) * size;
}

/**
 * Greedy word wrap. Falls back to hard character splitting for single words
 * longer than the line (long pasted URLs are the common case).
 * @returns {string[]}
 */
export function wrapText(text, font, size, maxWidth) {
  const src = String(text === undefined || text === null ? '' : text);
  if (src.trim() === '') return [''];
  const words = src.split(/\s+/).filter((w) => w.length > 0);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (measure(candidate, font, size) <= maxWidth) { line = candidate; continue; }
    if (line) { lines.push(line); line = ''; }
    if (measure(word, font, size) <= maxWidth) { line = word; }
    else {
      let piece = '';
      for (const ch of word) {
        if (measure(piece + ch, font, size) > maxWidth && piece) { lines.push(piece); piece = ch; }
        else piece += ch;
      }
      line = piece;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function fmt(n) {
  const r = Math.round(Number(n) * 100) / 100;
  return String(Number.isInteger(r) ? r : r.toFixed(2));
}
