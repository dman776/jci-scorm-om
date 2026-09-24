// @ts-check
/**
 * Export pipeline: package structure, the import graph inside the ZIP, the
 * manifest, scale inlining at publish, and the Excel round-trip.
 *
 * The import-graph test is the most valuable one here: it catches a module that
 * builds fine but 404s once the package is uploaded to an LMS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as exportService from '@sowb/export-service';
import { publishWorkbook, unzipToMap, buildManifest } from '@sowb/export-service';
import { assembleRuntime, RUNTIME_STATIC_PATHS } from '@sowb/scorm-runtime';
import { writeXlsx } from '@sowb/excel-io';
import { buildTemplateXlsx, importWorkbookXlsx } from '@sowb/excel-io/workbook-xlsx.js';
import { loadWorkbook, loadCustomScales } from './helpers/workbook.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const publish = async () => publishWorkbook(await loadWorkbook(), { customScales: await loadCustomScales() });

// ---- package structure ---------------------------------------------------

test('publish produces a SCORM zip with index.html and imsmanifest.xml at root', async () => {
  const files = await unzipToMap((await publish()).zip);
  assert.ok(files['index.html'], 'index.html at root');
  assert.ok(files['imsmanifest.xml'], 'imsmanifest.xml at root');
  assert.ok(files['imsmanifest.xml'].includes('2004 4th Edition'));
  assert.ok(files['imsmanifest.xml'].includes('adlcp:scormType="sco"'));
});

test('the package ships every runtime module, including rating and scales', async () => {
  const files = await unzipToMap((await publish()).zip);
  for (const needed of [
    'js/player.js', 'js/session.js', 'js/adapter.js', 'js/rating.js',
    'js/pdf.js', 'js/report.js',
    'js/engine/completion.js', 'js/engine/suspend.js', 'js/engine/scales.js',
    'css/player.css', 'js/workbook.js',
  ]) {
    assert.ok(files[needed], `${needed} shipped`);
  }
});

test('EVERY relative import inside the package resolves to a file in it', async () => {
  // This is the failure mode that only appears after upload: the package builds,
  // then the SCO 404s on load inside the LMS.
  const files = await unzipToMap((await publish()).zip);
  for (const [path, source] of Object.entries(files)) {
    if (!path.endsWith('.js')) continue;
    for (const m of source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      const stack = path.split('/').slice(0, -1);
      for (const seg of m[1].split('/')) {
        if (seg === '.') continue;
        else if (seg === '..') stack.pop();
        else stack.push(seg);
      }
      assert.ok(files[stack.join('/')], `${path} imports ${m[1]} which is not in the package`);
    }
  }
});

test('no shipped module imports a workspace package', async () => {
  // The SCO is offline and cannot resolve @sowb/*; any such import is fatal.
  const files = await unzipToMap((await publish()).zip);
  for (const [path, source] of Object.entries(files)) {
    if (!path.endsWith('.js')) continue;
    const specs = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
      assert.ok(spec.startsWith('./') || spec.startsWith('../'),
        `${path} imports "${spec}"; only relative paths work inside the package`);
    }
    assert.ok(!/\brequire\(/.test(source), `${path} has no CommonJS requires`);
  }
});

test('the manifest lists every shipped file', async () => {
  const files = await unzipToMap((await publish()).zip);
  for (const f of Object.keys(files)) {
    if (f === 'imsmanifest.xml') continue;
    assert.ok(files['imsmanifest.xml'].includes(`href="${f}"`), `manifest lists ${f}`);
  }
});

test('RUNTIME_STATIC_PATHS stays in step with what is emitted', async () => {
  // The preview server serves from this list, so a mismatch 404s in Preview
  // while export still works: a confusing split-brain bug.
  const files = await assembleRuntime(await loadWorkbook());
  const emitted = Object.keys(files).filter((n) => n !== 'js/workbook.js').sort();
  assert.deepEqual(emitted, [...RUNTIME_STATIC_PATHS].sort());
});

test('the manifest is well formed', async () => {
  const wb = await loadWorkbook();
  const xml = buildManifest(wb, ['index.html', 'js/player.js', 'css/player.css']);
  assert.ok(xml.startsWith('<?xml'));
  assert.equal((xml.match(/<manifest/g) || []).length, 1);
  assert.equal((xml.match(/<\/manifest>/g) || []).length, 1);
  assert.ok(xml.includes('href="index.html"'));
});

// ---- scale inlining at publish ------------------------------------------

test('publish inlines rating scales so the offline SCO needs no library', async () => {
  const files = await unzipToMap((await publish()).zip);
  const src = files['js/workbook.js'];
  assert.ok(src.includes('Strongly Agree'), 'agreement-5 labels inlined');
  assert.ok(src.includes('Almost Always'), 'frequency-5 labels inlined');
  assert.ok(src.includes('"scaleName":"Agreement (5-point)"'), 'scale name snapshotted');
});

test('a scaleId-only question still exports with concrete points', async () => {
  const wb = await loadWorkbook();
  // Authored with only a reference, no inline points.
  assert.equal(wb.sections[1].questions[2].scale, undefined);
  const res = await publishWorkbook(wb, { customScales: await loadCustomScales() });
  const published = res.workbook.sections[1].questions[2];
  assert.equal(published.scale.length, 5, 'points resolved at publish');
});

test('publish refuses a workbook with a dangling scaleId', async () => {
  const wb = await loadWorkbook();
  wb.sections[1].questions[2].scaleId = 'does-not-exist';
  await assert.rejects(
    () => publishWorkbook(wb, { customScales: [] }),
    /validation/i,
    'a dangling reference must block export rather than ship an empty scale'
  );
});

// ---- exported workbook config -------------------------------------------

test('exported workbook.js carries the question config and settings', async () => {
  const files = await unzipToMap((await publish()).zip);
  const src = files['js/workbook.js'];
  assert.ok(src.includes('"type":"numeric"'));
  assert.ok(src.includes('"type":"url"'));
  assert.ok(src.includes('"type":"rating"'));
  assert.ok(src.includes('"expected":true'));
  assert.ok(src.includes('"dashboardHeading"'));
  assert.ok(src.includes('"allowPdfDownload"'));
});

test('the facilitator CSV feature is absent', async () => {
  assert.equal(exportService.buildFacilitatorCsv, undefined);
  assert.equal(exportService.buildLearnerResponseCsv, undefined);
  const res = await publish();
  assert.equal(res.csv, undefined);
  assert.equal(res.csvName, undefined);
  const files = await unzipToMap(res.zip);
  assert.ok(!Object.keys(files).some((f) => f.toLowerCase().endsWith('.csv')));
});

test('publish refuses an invalid workbook', async () => {
  const wb = await loadWorkbook();
  wb.sections = [];
  await assert.rejects(() => publishWorkbook(wb), /validation/i);
});

// ---- Excel ---------------------------------------------------------------

test('template.xlsx round-trips through the importer', async () => {
  const { workbook, warnings } = await importWorkbookXlsx(await buildTemplateXlsx(), {
    customScales: await loadCustomScales(),
  });
  assert.equal(warnings.length, 0, JSON.stringify(warnings));
  assert.deepEqual(workbook.sections.map((s) => s.title), ['Month 1', 'Month 2', 'Month 3']);
  assert.equal(workbook.settings.dashboardHeading, 'Your Milestones');
  assert.equal(workbook.settings.allowPdfDownload, true);

  // "*Scope review | *Safety plan | ..." -> two expected options, asterisks stripped.
  const cl = workbook.sections[0].questions.find((q) => q.type === 'checklist');
  assert.deepEqual(cl.options.filter((o) => o.expected).map((o) => o.label), ['Scope review', 'Safety plan']);
  assert.ok(!cl.options.some((o) => o.label.startsWith('*')));

  const num = workbook.sections[1].questions.find((q) => q.type === 'numeric');
  assert.equal(num.min, 4);
  assert.equal(num.integerOnly, true);

  const ratings = workbook.sections.flatMap((s) => s.questions).filter((q) => q.type === 'rating');
  assert.deepEqual(ratings.map((q) => q.scaleId), ['agreement-5', 'frequency-5', 'numeric-5']);
  assert.ok(workbook.sections[2].questions.some((q) => q.type === 'url'));
});

test('Allow PDF Download can be turned off from the Settings sheet', async () => {
  const buf = await writeXlsx([
    { name: 'Settings', rows: [['Key', 'Value'], ['Title', 'T'], ['Allow PDF Download', 'no']] },
    { name: 'Sections', rows: [['Section ID', 'Title', 'Required (yes/no)', 'Order'], ['s1', 'One', 'yes', '1']] },
    { name: 'Questions', rows: [['Section ID', 'Type', 'Prompt', 'Required'], ['s1', 'long_text', 'Q', 'yes']] },
  ]);
  const { workbook } = await importWorkbookXlsx(buf);
  assert.equal(workbook.settings.allowPdfDownload, false);
});

test('older templates without the new columns still import with defaults', async () => {
  const buf = await writeXlsx([
    { name: 'Settings', rows: [['Key', 'Value'], ['Title', 'Legacy'], ['Course ID', 'legacy']] },
    { name: 'Sections', rows: [['Section ID', 'Title', 'Required (yes/no)', 'Order'], ['s1', 'One', 'yes', '1']] },
    { name: 'Questions', rows: [
      ['Section ID', 'Type', 'Prompt', 'Required', 'Options', 'Rating Scale', 'Help Text'],
      ['s1', 'long_text', 'Legacy question', 'yes', '', '', 'help'],
      ['s1', 'rating', 'Legacy rating', 'yes', '', 'Low|Medium|High', ''],
    ] },
  ]);
  const { workbook, warnings } = await importWorkbookXlsx(buf);
  assert.equal(warnings.length, 0);
  assert.equal(workbook.title, 'Legacy');
  // Help Text is found despite sitting in a different column index.
  assert.equal(workbook.sections[0].questions[0].helpText, 'help');
  assert.equal(workbook.settings.allowPdfDownload, true, 'defaults on');
  assert.equal(workbook.settings.dashboardHeading, 'Your observation workbook');
  // The legacy Low/Medium/High scale keeps its label-as-value semantics.
  assert.deepEqual(workbook.sections[0].questions[1].scale.map((p) => p.value), ['Low', 'Medium', 'High']);
});

test('the shipped demo workbook validates and publishes cleanly', async () => {
  const res = await publish();
  assert.equal(res.report.errors.length, 0, JSON.stringify(res.report.errors));
  assert.equal(res.report.warnings.length, 0, JSON.stringify(res.report.warnings));
  assert.ok(res.zip.length > 10000, 'the zip has real content');
  assert.match(res.zipName, /_SCORM2004_\d{4}-\d{2}-\d{2}\.zip$/);
});

test('the zip name carries the local export date', async () => {
  // 11pm local on Sep 24: a UTC date would already read Sep 25 west of UTC.
  const now = new Date(2026, 8, 24, 23, 30);
  const res = await publishWorkbook(await loadWorkbook(), { customScales: await loadCustomScales(), now });
  assert.equal(res.zipName, 'ascend-ae-install-ride-along_SCORM2004_2026-09-24.zip');
});
