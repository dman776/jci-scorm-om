// @ts-check
/**
 * Minimal SpreadsheetML (.xlsx) reader/writer built directly on jszip.
 *
 * We deliberately avoid a heavyweight xlsx dependency (the project permits only
 * jszip + nanoid). The writer emits OOXML with inline strings; the reader
 * resolves shared strings AND inline strings so it can read files produced by
 * Excel too, and it honours cell references so blank middle cells do not shift
 * columns.
 *
 * A "sheet" is { name: string, rows: (string|number)[][] } where rows[0] is the
 * header row.
 */
import JSZip from 'jszip';

/**
 * @param {{name:string, rows:(string|number)[][]}[]} sheets
 * @returns {Promise<Buffer>}
 */
export async function writeXlsx(sheets) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes(sheets.length));
  zip.file('_rels/.rels', rootRels());
  zip.file('xl/workbook.xml', workbookXml(sheets));
  zip.file('xl/_rels/workbook.xml.rels', workbookRels(sheets.length));
  zip.file('xl/styles.xml', stylesXml());
  sheets.forEach((sheet, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet.rows)));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<{name:string, rows:string[][]}[]>}
 */
export async function readXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStrings = await parseSharedStrings(zip);
  const wbXml = await readFileText(zip, 'xl/workbook.xml');
  const relsXml = await readFileText(zip, 'xl/_rels/workbook.xml.rels');
  const relMap = parseRels(relsXml);
  const sheetDefs = parseSheetDefs(wbXml);

  /** @type {{name:string, rows:string[][]}[]} */
  const sheets = [];
  for (const def of sheetDefs) {
    const target = relMap[def.rId];
    if (!target) continue;
    const path = target.startsWith('xl/') ? target : 'xl/' + target.replace(/^\/?/, '');
    const xml = await readFileText(zip, path);
    if (xml == null) continue;
    sheets.push({ name: def.name, rows: parseSheet(xml, sharedStrings) });
  }
  return sheets;
}

// ---- writer helpers ------------------------------------------------------

function sheetXml(rows) {
  const rowsXml = rows.map((row, r) => {
    const cells = row.map((val, c) => {
      const ref = colLetter(c) + (r + 1);
      if (val === '' || val === null || val === undefined) return '';
      if (typeof val === 'number' && isFinite(val)) return `<c r="${ref}"><v>${val}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(val))}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rowsXml}</sheetData></worksheet>`;
}

function contentTypes(sheetCount) {
  const overrides = [];
  for (let i = 1; i <= sheetCount; i++) {
    overrides.push(`<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides.join('\n')}
</Types>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheets) {
  const sheetTags = sheets.map((s, i) =>
    `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetTags}</sheets></workbook>`;
}

function workbookRels(sheetCount) {
  const rels = [];
  for (let i = 1; i <= sheetCount; i++) {
    rels.push(`<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`);
  }
  rels.push(`<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels.join('\n')}
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;
}

// ---- reader helpers ------------------------------------------------------

async function readFileText(zip, path) {
  const f = zip.file(path);
  if (!f) return null;
  return f.async('string');
}

async function parseSharedStrings(zip) {
  const xml = await readFileText(zip, 'xl/sharedStrings.xml');
  if (!xml) return [];
  /** @type {string[]} */
  const out = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRegex.exec(xml))) {
    let text = '';
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRegex.exec(m[1]))) text += xmlUnescape(tm[1]);
    out.push(text);
  }
  return out;
}

function parseRels(xml) {
  /** @type {Record<string,string>} */
  const map = {};
  if (!xml) return map;
  const re = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g;
  let m;
  while ((m = re.exec(xml))) map[m[1]] = m[2];
  const re2 = /<Relationship\b[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"[^>]*\/?>/g;
  while ((m = re2.exec(xml))) { if (!map[m[2]]) map[m[2]] = m[1]; }
  return map;
}

function parseSheetDefs(xml) {
  /** @type {{name:string, rId:string}[]} */
  const defs = [];
  if (!xml) return defs;
  const re = /<sheet\b[^>]*\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const name = (/name="([^"]*)"/.exec(tag) || [])[1] || '';
    const rId = (/r:id="([^"]*)"/.exec(tag) || [])[1] || '';
    defs.push({ name: xmlUnescape(name), rId });
  }
  return defs;
}

function parseSheet(xml, sharedStrings) {
  /** @type {string[][]} */
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    /** @type {string[]} */
    const cells = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] || '';
      const body = cm[2] || '';
      const ref = (/r="([A-Z]+)\d+"/.exec(attrs) || [])[1];
      const type = (/t="([^"]+)"/.exec(attrs) || [])[1];
      const colIdx = ref ? colIndex(ref) : cells.length;
      let value = '';
      if (type === 's') {
        const vi = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        value = sharedStrings[parseInt(vi || '0', 10)] || '';
      } else if (type === 'inlineStr') {
        const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tm; let acc = '';
        while ((tm = tRegex.exec(body))) acc += xmlUnescape(tm[1]);
        value = acc;
      } else {
        value = xmlUnescape((/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1] || '');
      }
      while (cells.length < colIdx) cells.push('');
      cells[colIdx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

// ---- utilities -----------------------------------------------------------

function colLetter(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
function xmlUnescape(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}
