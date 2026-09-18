// @ts-check
/** Writes samples/template.xlsx. Run: npm run build:template */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTemplateXlsx } from '@sowb/excel-io/workbook-xlsx.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const buf = await buildTemplateXlsx();
await mkdir(join(ROOT, 'samples'), { recursive: true });
const out = join(ROOT, 'samples', 'template.xlsx');
await writeFile(out, buf);
console.log(`Wrote ${out} (${buf.length} bytes)`);
