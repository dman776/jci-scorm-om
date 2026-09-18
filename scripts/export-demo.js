// @ts-check
/** Builds the demo SCORM package. Run: npm run export:demo -> ./out/ */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { publishWorkbook } from '@sowb/export-service';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const workbook = JSON.parse(await readFile(join(ROOT, 'samples', 'demo.workbook.json'), 'utf8'));

// Include any author-defined scales so scaleIds resolve exactly as they do in
// the app's publish path.
let customScales = [];
try {
  customScales = JSON.parse(await readFile(join(ROOT, 'data', 'scales.json'), 'utf8')).scales || [];
} catch (_) { /* no author scales yet */ }

const res = await publishWorkbook(workbook, { customScales });
await mkdir(join(ROOT, 'out'), { recursive: true });
await writeFile(join(ROOT, 'out', res.zipName), res.zip);
console.log('Exported: ' + join('out', res.zipName) + ` (${res.zip.length} bytes)`);
console.log('Package files:', Object.keys(res.fileMap).sort().join(', '));
if (res.report.warnings.length) {
  console.log('Warnings:');
  for (const w of res.report.warnings) console.log('  - ' + w.message);
}
