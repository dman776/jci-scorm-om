// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as exportService from '@sowb/export-service';
import { publishWorkbook, unzipToMap, buildManifest } from '@sowb/export-service';
import { buildTemplateXlsx, importWorkbookXlsx } from '@sowb/excel-io/workbook-xlsx.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

async function demoWorkbook() {
  return JSON.parse(await readFile(join(ROOT, 'samples', 'ae-install-ride-along.workbook.json'), 'utf8'));
}

test('publish produces a SCORM zip with index.html and imsmanifest.xml at root', async () => {
  const wb = await demoWorkbook();
  const res = await publishWorkbook(wb);
  const files = await unzipToMap(res.zip);
  assert.ok(files['index.html'], 'index.html at root');
  assert.ok(files['imsmanifest.xml'], 'imsmanifest.xml at root');
  assert.ok(files['js/player.js'], 'player.js shipped');
  assert.ok(files['js/session.js'], 'session.js shipped');
  assert.ok(files['js/engine/completion.js'], 'engine shipped');
  assert.ok(!files['js/engine/completion.js'].includes('@sowb/workbook-engine'),
    'engine in package must not import workspace packages');
  assert.ok(files['imsmanifest.xml'].includes('href="index.html"'));
  assert.ok(files['imsmanifest.xml'].includes('2004 4th Edition'));
  // Always land on the dashboard on launch.
  assert.ok(files['js/player.js'].includes("this.view = 'dashboard'"));
});

test('the facilitator CSV feature is completely removed', async () => {
  // No CSV builders exported anywhere in the export service.
  assert.equal(exportService.buildFacilitatorCsv, undefined);
  assert.equal(exportService.buildLearnerResponseCsv, undefined);
  // publishWorkbook must not return CSV fields.
  const wb = await demoWorkbook();
  const res = await publishWorkbook(wb);
  assert.equal(res.csv, undefined);
  assert.equal(res.csvName, undefined);
  // No csv.js file in the package.
  await assert.rejects(() => readFile(join(ROOT, 'packages', 'export-service', 'csv.js'), 'utf8'));
  // The shipped package contains no .csv files.
  const files = await unzipToMap(res.zip);
  assert.ok(!Object.keys(files).some((f) => f.toLowerCase().endsWith('.csv')));
});

test('exported workbook.js carries the new question config', async () => {
  const wb = await demoWorkbook();
  const files = await unzipToMap((await publishWorkbook(wb)).zip);
  const src = files['js/workbook.js'];
  assert.ok(src.includes('"type":"numeric"'), 'numeric type present');
  assert.ok(src.includes('"type":"url"'), 'url type present');
  assert.ok(src.includes('"expected":true'), 'expected option flags present');
  assert.ok(src.includes('"dashboardHeading"'), 'dashboard heading present');
});

test('manifest is well-formed and lists every resource file', async () => {
  const wb = await demoWorkbook();
  const files = ['index.html', 'js/player.js', 'css/player.css'];
  const xml = buildManifest(wb, files);
  assert.ok(xml.startsWith('<?xml'));
  assert.equal((xml.match(/<manifest/g) || []).length, 1);
  assert.equal((xml.match(/<\/manifest>/g) || []).length, 1);
  assert.ok(xml.includes('adlcp:scormType="sco"'));
  for (const f of files) assert.ok(xml.includes(`href="${f}"`), `lists ${f}`);
});

test('template.xlsx round-trips, preserving expected markers and numeric bounds', async () => {
  const { workbook, warnings } = await importWorkbookXlsx(await buildTemplateXlsx());
  assert.equal(warnings.length, 0, 'no import warnings');
  assert.equal(workbook.sections.length, 3);

  // Dashboard heading comes through the Settings sheet.
  assert.equal(workbook.settings.dashboardHeading, 'Your observation workbook');

  // "*Scope review | *Safety plan | Schedule | ..." -> two expected options.
  const cl = workbook.sections[0].questions.find((q) => q.type === 'checklist');
  const expected = cl.options.filter((o) => o.expected).map((o) => o.label);
  assert.deepEqual(expected, ['Scope review', 'Safety plan']);
  // The asterisk must be stripped from the visible label.
  assert.ok(!cl.options.some((o) => o.label.startsWith('*')));

  // Numeric Min / Whole Numbers columns.
  const num = workbook.sections[1].questions.find((q) => q.type === 'numeric');
  assert.equal(num.min, 4);
  assert.equal(num.integerOnly, true);

  // URL type imports.
  assert.ok(workbook.sections[2].questions.some((q) => q.type === 'url'));
});

test('importer looks columns up by header name, so older templates still work', async () => {
  // A minimal sheet set WITHOUT the new Min/Max/Whole Numbers columns.
  const { writeXlsx } = await import('@sowb/excel-io');
  const buf = await writeXlsx([
    { name: 'Settings', rows: [['Key', 'Value'], ['Title', 'Legacy'], ['Course ID', 'legacy']] },
    { name: 'Sections', rows: [['Section ID', 'Title', 'Required (yes/no)', 'Order'], ['s1', 'One', 'yes', '1']] },
    { name: 'Questions', rows: [
      ['Section ID', 'Type', 'Prompt', 'Required', 'Options', 'Rating Scale', 'Help Text'],
      ['s1', 'long_text', 'Legacy question', 'yes', '', '', 'help'],
    ] },
  ]);
  const { workbook, warnings } = await importWorkbookXlsx(buf);
  assert.equal(warnings.length, 0);
  assert.equal(workbook.title, 'Legacy');
  assert.equal(workbook.sections[0].questions[0].helpText, 'help', 'help text found despite shifted columns');
  // Defaults are applied for the fields the old template lacks.
  assert.equal(workbook.settings.dashboardHeading, 'Your observation workbook');
});

test('publish refuses an invalid workbook', async () => {
  const wb = await demoWorkbook();
  wb.sections = [];
  await assert.rejects(() => publishWorkbook(wb), /validation/i);
});
