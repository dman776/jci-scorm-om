// @ts-check
/** Builds the demo SCORM package. Run: npm run export:demo -> ./out/ */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { publishWorkbook } from '@sowb/export-service';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const workbook = JSON.parse(await readFile(join(ROOT, 'samples', 'ae-install-ride-along.workbook.json'), 'utf8'));
const res = await publishWorkbook(workbook);
const outDir = join(ROOT, 'out');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, res.zipName), res.zip);
console.log('Exported: ' + join('out', res.zipName) + ` (${res.zip.length} bytes)`);
console.log('Package files:', Object.keys(res.fileMap).sort().join(', '));
if (res.report.warnings.length) {
  console.log('Warnings:');
  for (const w of res.report.warnings) console.log('  - ' + w.message);
}
